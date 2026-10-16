import asyncio
import logging
import re
import time
from typing import AsyncIterator, Literal

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.core.config import get_settings
from app.llm.router import StreamMeta, get_llm
from app.rag import vectorstore, websearch
from app.rag.state import AgentState
from app.services import knowledge

logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_PROMPT = (
    "You are IterateDesk, the internal IT support copilot for NovaRetail employees. "
    "You are accurate, calm and practical. Use short paragraphs, numbered steps for procedures "
    "and markdown formatting. Never invent company policy."
)

GRADER_SYSTEM = (
    "You are an evidence grader inside a retrieval pipeline. You never answer the user's question. "
    "You output exactly one lowercase word: good or weak."
)
ROUTER_SYSTEM = (
    "You are a request classifier inside a support pipeline. You never answer the message. "
    "You follow the requested output format exactly."
)

GREETING = re.compile(
    r"^\s*(hi|hello|hey|hiya|yo|good (morning|afternoon|evening)|thanks|thank you|thx|ok(ay)?|cool|great|bye|goodbye)"
    r"[\s!.,?]*(there|team|copilot|iteratedesk)?[\s!.,?]*$",
    re.IGNORECASE,
)


def _writer():
    try:
        return get_stream_writer()
    except Exception:
        return lambda _: None


def _step(state: AgentState, step: str, label: str, detail: str, started: float, status: str = "ok") -> list[dict]:
    entry = {
        "step": step,
        "label": label,
        "detail": detail,
        "status": status,
        "ms": int((time.perf_counter() - started) * 1000),
    }
    _writer()({"type": "step", **entry})
    return [*state.get("trace", []), entry]


def _history_block(state: AgentState, limit: int = 6) -> str:
    turns = state.get("history") or []
    if not turns:
        return ""
    lines = [f"{t.get('role', 'user').title()}: {str(t.get('content', ''))[:600]}" for t in turns[-limit:]]
    return "Conversation so far:\n" + "\n".join(lines) + "\n\n"


def _first_word(text: str, options: tuple[str, ...], default: str) -> str:
    lowered = text.strip().lower()
    for word in re.findall(r"[a-z_]+", lowered):
        if word in options:
            return word
    return default


def _silence(task: asyncio.Task) -> None:
    if not task.cancelled():
        task.exception()


def _cancel_prefetch(task: asyncio.Task | None) -> None:
    if task is not None and not task.done():
        task.add_done_callback(_silence)
        task.cancel()


async def route_question(state: AgentState):
    started = time.perf_counter()
    question = state["question"]
    history = _history_block(state)

    if GREETING.match(question) and not history:
        return {"route": "direct", "trace": _step(state, "router", "Router", "DIRECT (small talk)", started)}

    if history:
        prompt = (
            f"{history}Latest message: {question}\n\n"
            "Task 1: decide the route. Use DIRECT only for greetings, thanks or chit-chat that needs no information. "
            "Use KB for everything else, including IT support, company information, policies and factual questions.\n"
            "Task 2: rewrite the latest message as a standalone search query that includes context from the conversation.\n"
            "Reply in exactly two lines:\nROUTE: kb or direct\nQUERY: <standalone query>"
        )
        raw = await get_llm().complete(prompt, system=ROUTER_SYSTEM, max_tokens=80)
        route_line = next((l for l in raw.splitlines() if l.lower().startswith("route")), raw)
        query_line = next((l for l in raw.splitlines() if l.lower().startswith("query")), "")
        route = _first_word(route_line.split(":", 1)[-1], ("kb", "direct"), "kb")
        query = query_line.split(":", 1)[-1].strip() or question
    else:
        prefetch = None
        if knowledge.kb_state()["status"] == "ready":
            prefetch = asyncio.create_task(vectorstore.asearch(question))
        prompt = (
            "Classify the message for NovaRetail's internal support assistant.\n"
            "direct = ONLY greetings, thanks, goodbyes or chit-chat that needs no information at all.\n"
            "kb = everything else: IT support, devices, accounts, security, software, outages, company policies, "
            "the company itself, its products, people, processes, or any factual question.\n"
            f"Message: {question}\nAnswer with one word: kb or direct."
        )
        try:
            raw = await get_llm().complete(prompt, system=ROUTER_SYSTEM, max_tokens=4)
        except BaseException:
            _cancel_prefetch(prefetch)
            raise
        route = _first_word(raw, ("kb", "direct"), "kb")
        if route != "kb":
            _cancel_prefetch(prefetch)
            prefetch = None
        return {
            "route": route,
            "current_query": question,
            "prefetch": {"query": question, "task": prefetch} if prefetch else None,
            "trace": _step(state, "router", "Router", route.upper(), started),
        }

    return {
        "route": route,
        "current_query": query,
        "trace": _step(state, "router", "Router", route.upper(), started),
    }


def after_router(state: AgentState) -> Literal["retrieve_kb", "direct_answer"]:
    return "retrieve_kb" if state.get("route") == "kb" else "direct_answer"


async def retrieve_kb(state: AgentState):
    started = time.perf_counter()
    await knowledge.wait_until_ready()
    try:
        pending = state.get("prefetch")
        if pending and pending["query"] == state["current_query"]:
            results = await pending["task"]
        else:
            results = await vectorstore.asearch(state["current_query"])
        docs = [
            {"id": r.id, "text": r.text, "score": round(r.score, 4), "metadata": r.metadata}
            for r in results
            if r.text
        ]
        detail = f"{len(docs)} chunks" + (f" · top {docs[0]['score']:.2f}" if docs else "")
        status = "ok"
    except Exception as exc:
        logger.warning("Retrieval failed: %s", exc)
        docs, detail, status = [], "unavailable", "error"
    return {
        "kb_docs": docs,
        "prefetch": None,
        "trace": _step(state, "retrieve", "Private KB retrieval", detail, started, status),
    }


def _kb_context(docs: list[dict]) -> str:
    parts = []
    for i, d in enumerate(docs, 1):
        meta = d.get("metadata", {})
        page = f", page {meta['page']}" if meta.get("page") else ""
        parts.append(f"[{i}] Source: {meta.get('source', 'Private KB')}{page}\n{d['text']}")
    return "\n\n".join(parts)


async def grade_kb(state: AgentState):
    started = time.perf_counter()
    docs = state.get("kb_docs") or []
    if not docs:
        return {"kb_grade": "weak", "trace": _step(state, "grade_kb", "KB evidence grade", "WEAK (no evidence)", started)}
    prompt = (
        "You grade evidence for an enterprise IT support assistant.\n"
        f"Question: {state['current_query']}\n\nPrivate company KB evidence:\n{_kb_context(docs)}\n\n"
        "Reply good only if the evidence directly and specifically answers the question. "
        "If it is unrelated, partial, generic or about a different topic, reply weak. One word: good or weak."
    )
    raw = await get_llm().complete(prompt, system=GRADER_SYSTEM, max_tokens=4)
    grade = _first_word(raw, ("good", "weak"), "weak")
    return {"kb_grade": grade, "trace": _step(state, "grade_kb", "KB evidence grade", grade.upper(), started)}


def after_kb(state: AgentState) -> Literal["generate_from_kb", "search_web"]:
    return "generate_from_kb" if state.get("kb_grade") == "good" else "search_web"


async def search_web(state: AgentState):
    started = time.perf_counter()
    if not websearch.is_configured():
        return {
            "web_results": "",
            "web_sources": [],
            "trace": _step(state, "web_search", "Web fallback", "not configured", started, "skipped"),
        }
    try:
        deep = state.get("retry_count", 0) > 0
        text, sources = await websearch.web_search(state["current_query"], deep=deep)
        detail, status = f"Tavily {'advanced' if deep else 'basic'} · {len(sources)} results", "ok"
    except Exception as exc:
        logger.warning("Web search failed: %s", exc)
        text, sources, detail, status = "", [], "unavailable", "error"
    return {
        "web_results": text,
        "web_sources": sources,
        "trace": _step(state, "web_search", "Web fallback", detail, started, status),
    }


async def grade_web(state: AgentState):
    started = time.perf_counter()
    if not state.get("web_results"):
        return {"web_grade": "weak", "trace": _step(state, "grade_web", "Web evidence grade", "WEAK (no evidence)", started)}
    prompt = (
        f"Question: {state['current_query']}\n\nWeb evidence:\n{state['web_results'][:6000]}\n\n"
        "Reply good if the evidence is on-topic and lets you give a useful, accurate answer, even if it is partial "
        "or general guidance. Reply weak only if it is off-topic, empty or unreliable. One word: good or weak."
    )
    votes = await asyncio.gather(
        *(get_llm().complete(prompt, system=GRADER_SYSTEM, max_tokens=4) for _ in range(2)),
        return_exceptions=True,
    )
    answers = [_first_word(v, ("good", "weak"), "weak") for v in votes if isinstance(v, str)]
    if not answers:
        raise next(v for v in votes if isinstance(v, BaseException))
    grade = "good" if "good" in answers else "weak"
    detail = f"{grade.upper()} ({answers.count('good')}/{len(answers)} votes)"
    return {"web_grade": grade, "trace": _step(state, "grade_web", "Web evidence grade", detail, started)}


def after_web(state: AgentState) -> Literal["generate_from_web", "rewrite_query", "insufficient"]:
    if state.get("web_grade") == "good":
        return "generate_from_web"
    if state.get("retry_count", 0) < settings.max_retries:
        return "rewrite_query"
    return "insufficient"


async def rewrite_query(state: AgentState):
    started = time.perf_counter()
    prompt = (
        "Rewrite this IT support question to improve retrieval from a private knowledge base and a vendor web search. "
        "Keep the intent, add precise technical keywords and product names, do not answer it. "
        f"Return only the rewritten query.\n\nQuestion: {state['current_query']}"
    )
    rewritten = (await get_llm().complete(prompt, max_tokens=60)).strip().strip('"')
    return {
        "current_query": rewritten or state["current_query"],
        "retry_count": state.get("retry_count", 0) + 1,
        "trace": _step(state, "rewrite", "Query rewrite", rewritten, started),
    }


async def _stream_answer(prompt: str) -> tuple[str, StreamMeta]:
    writer = _writer()
    meta = StreamMeta()
    parts: list[str] = []
    async for token in get_llm().stream(prompt, system=SYSTEM_PROMPT, max_tokens=1200, meta=meta):
        parts.append(token)
        writer({"type": "token", "text": token})
    return "".join(parts).strip(), meta


def _kb_citations(docs: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for d in docs:
        meta = d.get("metadata", {})
        src = meta.get("source", "Private KB")
        if src not in seen:
            seen[src] = {
                "title": src,
                "url": "",
                "type": "private_kb",
                "doc_id": meta.get("doc_id", ""),
                "score": d.get("score", 0.0),
                "page": meta.get("page"),
                "snippet": d["text"][:240],
            }
    return list(seen.values())


async def generate_from_kb(state: AgentState):
    started = time.perf_counter()
    prompt = (
        f"{_history_block(state)}Answer the employee's question using ONLY the private company knowledge base excerpts below. "
        "Be concise and actionable. Present procedures as numbered steps. Cite excerpts inline like [1]. "
        "If a detail is not in the excerpts, say so instead of guessing.\n\n"
        f"Question: {state['question']}\n\nPrivate KB excerpts:\n{_kb_context(state['kb_docs'])}"
    )
    answer, meta = await _stream_answer(prompt)
    return {
        "answer": answer,
        "source_used": "private_kb",
        "citations": _kb_citations(state["kb_docs"]),
        "provider": meta.provider,
        "model": meta.model,
        "trace": _step(state, "generate", "Answer generation", f"PRIVATE KB · {meta.provider}", started),
    }


async def generate_from_web(state: AgentState):
    started = time.perf_counter()
    sources = state.get("web_sources") or []
    numbered = "\n\n".join(f"[{i}] {s['title']} ({s['url']})\n{s['snippet']}" for i, s in enumerate(sources, 1))
    prompt = (
        f"{_history_block(state)}The private company knowledge base did not contain enough information. "
        "Answer using ONLY the external web evidence below and cite sources inline like [1]. "
        "Start with one short sentence noting this is public web information that IT should validate "
        "before changes are made to company-managed systems.\n\n"
        f"Question: {state['question']}\n\nWeb evidence:\n{state['web_results'][:6000]}\n\nSources:\n{numbered}"
    )
    answer, meta = await _stream_answer(prompt)
    return {
        "answer": answer,
        "source_used": "web_search",
        "citations": sources,
        "provider": meta.provider,
        "model": meta.model,
        "trace": _step(state, "generate", "Answer generation", f"WEB SEARCH · {meta.provider}", started),
    }


async def direct_answer(state: AgentState):
    started = time.perf_counter()
    prompt = (
        f"{_history_block(state)}Reply briefly and warmly to the employee. If useful, mention you can help with VPN, "
        f"passwords, MFA, devices, software access and other IT questions.\n\nMessage: {state['question']}"
    )
    answer, meta = await _stream_answer(prompt)
    return {
        "answer": answer,
        "source_used": "direct",
        "citations": [],
        "provider": meta.provider,
        "model": meta.model,
        "trace": _step(state, "generate", "Direct response", f"no retrieval · {meta.provider}", started),
    }


INSUFFICIENT_MESSAGE = (
    "I couldn't find enough reliable evidence in the company knowledge base or in external sources to answer this "
    "confidently.\n\nPlease raise a ticket with the IT Service Desk, or add more detail (device, app, error message) "
    "and ask again."
)


async def insufficient(state: AgentState):
    started = time.perf_counter()
    _writer()({"type": "token", "text": INSUFFICIENT_MESSAGE})
    return {
        "answer": INSUFFICIENT_MESSAGE,
        "source_used": "insufficient_evidence",
        "citations": [],
        "trace": _step(state, "stop", "Stopped", "insufficient reliable evidence", started, "warning"),
    }


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("route_question", route_question)
    graph.add_node("retrieve_kb", retrieve_kb)
    graph.add_node("grade_kb", grade_kb)
    graph.add_node("search_web", search_web)
    graph.add_node("grade_web", grade_web)
    graph.add_node("rewrite_query", rewrite_query)
    graph.add_node("generate_from_kb", generate_from_kb)
    graph.add_node("generate_from_web", generate_from_web)
    graph.add_node("direct_answer", direct_answer)
    graph.add_node("insufficient", insufficient)

    graph.add_edge(START, "route_question")
    graph.add_conditional_edges("route_question", after_router, ["retrieve_kb", "direct_answer"])
    graph.add_edge("retrieve_kb", "grade_kb")
    graph.add_conditional_edges("grade_kb", after_kb, ["generate_from_kb", "search_web"])
    graph.add_edge("search_web", "grade_web")
    graph.add_conditional_edges("grade_web", after_web, ["generate_from_web", "rewrite_query", "insufficient"])
    graph.add_edge("rewrite_query", "retrieve_kb")
    for node in ("generate_from_kb", "generate_from_web", "direct_answer", "insufficient"):
        graph.add_edge(node, END)
    return graph.compile()


agent_graph = build_graph()


def initial_state(question: str, history: list[dict] | None = None) -> AgentState:
    return {
        "question": question,
        "history": history or [],
        "current_query": question,
        "route": "",
        "kb_docs": [],
        "web_results": "",
        "web_sources": [],
        "kb_grade": "",
        "web_grade": "",
        "answer": "",
        "source_used": "",
        "retry_count": 0,
        "trace": [],
        "citations": [],
        "provider": "",
        "model": "",
        "prefetch": None,
    }


async def run_stream(question: str, history: list[dict] | None = None) -> AsyncIterator[tuple[str, dict]]:
    final: dict = {}
    async for mode, chunk in agent_graph.astream(initial_state(question, history), stream_mode=["custom", "values"]):
        if mode == "custom":
            yield chunk.get("type", "event"), chunk
        else:
            final = chunk
    yield "final", final


async def ask(question: str, history: list[dict] | None = None) -> dict:
    return await agent_graph.ainvoke(initial_state(question, history))
