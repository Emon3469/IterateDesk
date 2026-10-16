from app.rag.workflow import ask, run_stream


def steps(state):
    return [s["step"] for s in state["trace"]]


async def test_kb_path_answers_from_private_knowledge(fake_llm, kb_hits, web_hits):
    state = await ask("How do I connect to the VPN?")
    assert state["source_used"] == "private_kb"
    assert steps(state) == ["router", "retrieve", "grade_kb", "generate"]
    assert state["answer"].startswith("Here is the answer")
    assert [c["title"] for c in state["citations"]] == ["company_it_handbook.md", "service_desk_runbook.md"]
    assert state["provider"] == "fake"
    assert web_hits == []


async def test_weak_kb_falls_back_to_web(fake_llm, kb_hits, web_hits):
    fake_llm.kb_grade = "weak"
    state = await ask("What is the latest Teams outage guidance?")
    assert state["source_used"] == "web_search"
    assert steps(state) == ["router", "retrieve", "grade_kb", "web_search", "grade_web", "generate"]
    assert state["citations"][0]["url"] == "https://status.example.com"


async def test_weak_everywhere_rewrites_then_escalates(fake_llm, kb_hits, web_hits):
    fake_llm.kb_grade = "weak"
    fake_llm.web_grade = "weak"
    state = await ask("Something obscure")
    assert state["source_used"] == "insufficient_evidence"
    assert steps(state) == [
        "router", "retrieve", "grade_kb", "web_search", "grade_web",
        "rewrite", "retrieve", "grade_kb", "web_search", "grade_web", "stop",
    ]
    assert state["retry_count"] == 1
    assert kb_hits[-1] == "rewritten vpn query"
    assert "IT Service Desk" in state["answer"]


async def test_greeting_skips_llm_router_and_retrieval(fake_llm, kb_hits):
    state = await ask("hello!")
    assert state["source_used"] == "direct"
    assert steps(state) == ["router", "generate"]
    assert kb_hits == []
    assert not any("Answer with one word" in p for p in fake_llm.prompts)


async def test_llm_can_route_direct(fake_llm, kb_hits):
    fake_llm.route = "direct"
    state = await ask("tell me a joke about printers")
    assert state["source_used"] == "direct"
    assert kb_hits == []


async def test_follow_up_uses_history_to_build_standalone_query(fake_llm, kb_hits, web_hits):
    history = [{"role": "user", "content": "How do I use the VPN?"}, {"role": "assistant", "content": "Install the client."}]
    state = await ask("and on mac?", history)
    assert state["current_query"] == "standalone follow up query"
    assert kb_hits == ["standalone follow up query"]
    assert "Conversation so far" in fake_llm.prompts[-1]


async def test_retrieval_failure_degrades_to_web(fake_llm, web_hits, monkeypatch):
    from app.rag import workflow
    from app.services import knowledge

    async def broken(query, k=None):
        raise RuntimeError("pinecone down")

    async def ready(timeout=90.0):
        return None

    monkeypatch.setattr(workflow.vectorstore, "asearch", broken)
    monkeypatch.setattr(knowledge, "wait_until_ready", ready)
    state = await ask("vpn issue")
    assert state["trace"][1]["status"] == "error"
    assert state["source_used"] == "web_search"


async def test_missing_web_search_key_escalates_cleanly(fake_llm, kb_hits, monkeypatch):
    from app.rag import workflow

    monkeypatch.setattr(workflow.websearch, "is_configured", lambda: False)
    fake_llm.kb_grade = "weak"
    state = await ask("unknown topic")
    assert state["source_used"] == "insufficient_evidence"
    assert any(s["status"] == "skipped" for s in state["trace"])


async def test_run_stream_emits_steps_tokens_then_final(fake_llm, kb_hits):
    events = [kind async for kind, _ in run_stream("How do I connect to the VPN?")]
    assert events[0] == "step"
    assert "token" in events
    assert events[-1] == "final"
    first_token = events.index("token")
    assert events[:first_token].count("step") == 3


async def test_unparseable_grade_defaults_to_weak(fake_llm, kb_hits, web_hits):
    fake_llm.kb_grade = "I am not sure"
    state = await ask("vpn")
    assert state["kb_grade"] == "weak"


async def test_retrieval_is_prefetched_while_routing(fake_llm, kb_hits, monkeypatch):
    from app.services import knowledge

    monkeypatch.setitem(knowledge._state, "status", "ready")
    state = await ask("How do I connect to the VPN?")
    assert state["source_used"] == "private_kb"
    assert kb_hits == ["How do I connect to the VPN?"]
    assert state.get("prefetch") is None


async def test_prefetch_is_discarded_for_direct_route(fake_llm, kb_hits, monkeypatch):
    from app.services import knowledge

    monkeypatch.setitem(knowledge._state, "status", "ready")
    fake_llm.route = "direct"
    state = await ask("tell me about your weekend")
    assert state["source_used"] == "direct"
    assert state.get("prefetch") is None


async def test_retry_uses_deeper_web_search(fake_llm, kb_hits, monkeypatch):
    from app.rag import workflow

    depths = []

    async def fake_web(query, max_results=5, deep=False):
        depths.append(deep)
        return "evidence", [{"title": "t", "url": "https://x", "type": "web", "score": 0.5, "snippet": "s"}]

    monkeypatch.setattr(workflow.websearch, "web_search", fake_web)
    monkeypatch.setattr(workflow.websearch, "is_configured", lambda: True)
    fake_llm.kb_grade = "weak"
    fake_llm.web_grade = "weak"
    await ask("obscure question")
    assert depths == [False, True]


async def test_graders_and_router_use_strict_system_prompts(kb_hits, web_hits, monkeypatch):
    from conftest import FakeLLM

    from app.rag import workflow

    systems = []

    class Recording(FakeLLM):
        async def complete(self, prompt, system="", max_tokens=512, meta=None):
            systems.append(system)
            return await super().complete(prompt, system, max_tokens, meta)

    monkeypatch.setattr(workflow, "get_llm", lambda: Recording())
    await ask("vpn help")
    assert systems == [workflow.ROUTER_SYSTEM, workflow.GRADER_SYSTEM]


async def test_web_grade_accepts_when_any_vote_is_good(fake_llm, kb_hits, web_hits):
    votes = iter(["weak", "good"])
    original = fake_llm.complete

    async def complete(prompt, system="", max_tokens=512, meta=None):
        if "Web evidence" in prompt:
            return next(votes)
        return await original(prompt, system, max_tokens, meta)

    fake_llm.complete = complete
    fake_llm.kb_grade = "weak"
    state = await ask("Is Zoom down right now?")
    assert state["source_used"] == "web_search"
    assert "1/2 votes" in next(s["detail"] for s in state["trace"] if s["step"] == "grade_web")
