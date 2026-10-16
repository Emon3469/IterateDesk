import asyncio
import json
import logging
import re
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.ratelimit import enforce_chat_limit
from app.llm.router import AllProvidersFailed, get_llm
from app.rag import websearch
from app.rag.workflow import ask, run_stream
from app.services import audit, knowledge
from app.services.ingestion import SUPPORTED

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
settings = get_settings()


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    history: list[Turn] = Field(default_factory=list, max_length=20)


def _require_admin(key: str) -> None:
    if not key or not secrets.compare_digest(key, settings.admin_api_key):
        raise HTTPException(status_code=401, detail="Invalid admin key")


def _top_score(state: dict) -> float | None:
    docs = state.get("kb_docs") or []
    return max((d.get("score", 0.0) for d in docs), default=None)


def _result_payload(state: dict, latency_ms: int, query_id: str) -> dict:
    return {
        "id": query_id,
        "answer": state.get("answer", ""),
        "source_used": state.get("source_used", ""),
        "route": state.get("route", ""),
        "kb_grade": state.get("kb_grade", ""),
        "web_grade": state.get("web_grade", ""),
        "retries": state.get("retry_count", 0),
        "rewritten_query": state.get("current_query", state.get("question", "")),
        "citations": state.get("citations", []),
        "trace": state.get("trace", []),
        "provider": state.get("provider", ""),
        "model": state.get("model", ""),
        "top_score": _top_score(state),
        "latency_ms": latency_ms,
    }


def _audit(question: str, payload: dict, status: str = "ok") -> str:
    try:
        return audit.record_query({**payload, "question": question, "status": status})
    except Exception as exc:
        logger.warning("Audit write failed: %s", exc)
        return payload.get("id", "")


@router.get("/health")
def health():
    return {"status": "ok", "service": settings.app_name, "knowledge_base": knowledge.kb_state()["status"]}


@router.get("/system")
async def system_status():
    await knowledge.refresh_vector_count()
    return {
        "app_name": settings.app_name,
        "environment": settings.app_env,
        "knowledge_base": knowledge.kb_state(),
        "llm_providers": get_llm().status(),
        "embedding_model": settings.embedding_model,
        "vector_store": {
            "provider": "pinecone",
            "index": settings.pinecone_index_name,
            "namespace": settings.pinecone_namespace,
            "configured": bool(settings.pinecone_api_key),
        },
        "web_search": {"provider": "tavily", "configured": websearch.is_configured()},
        "max_retries": settings.max_retries,
        "top_k": settings.top_k,
    }


@router.post("/system/check-providers")
async def check_providers(x_admin_key: str = Header(default="")):
    _require_admin(x_admin_key)
    results = await get_llm().check_all()
    return {"healthy": sum(1 for r in results if r["ok"]), "total": len(results), "results": results}


@router.post("/chat", dependencies=[Depends(enforce_chat_limit)])
async def chat(payload: ChatRequest):
    started = time.perf_counter()
    question = payload.question.strip()
    try:
        state = await ask(question, [t.model_dump() for t in payload.history])
    except AllProvidersFailed as exc:
        raise HTTPException(status_code=503, detail="All language model providers are unavailable") from exc
    except Exception as exc:
        logger.exception("Chat failed")
        raise HTTPException(status_code=500, detail="The copilot could not complete this request") from exc
    result = _result_payload(state, int((time.perf_counter() - started) * 1000), "")
    result["id"] = _audit(question, result)
    return result


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat/stream", dependencies=[Depends(enforce_chat_limit)])
async def chat_stream(payload: ChatRequest):
    question = payload.question.strip()
    history = [t.model_dump() for t in payload.history]

    async def events():
        started = time.perf_counter()
        yield ": connected\n\n"
        yield _sse("status", {"message": "Thinking"})
        try:
            async for kind, data in run_stream(question, history):
                if kind == "token":
                    yield _sse("token", {"text": data["text"]})
                elif kind == "step":
                    yield _sse("step", {k: v for k, v in data.items() if k != "type"})
                elif kind == "final":
                    result = _result_payload(data, int((time.perf_counter() - started) * 1000), "")
                    result["id"] = _audit(question, result)
                    yield _sse("done", result)
        except asyncio.CancelledError:
            raise
        except AllProvidersFailed:
            logger.exception("All providers failed")
            _audit(question, {"latency_ms": int((time.perf_counter() - started) * 1000)}, status="error")
            yield _sse("error", {"message": "All language model providers are unavailable right now. Please try again shortly."})
        except Exception:
            logger.exception("Streaming chat failed")
            _audit(question, {"latency_ms": int((time.perf_counter() - started) * 1000)}, status="error")
            yield _sse("error", {"message": "The copilot could not complete this request."})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/stats")
def get_stats(days: int = Query(default=30, ge=7, le=90)):
    data = audit.stats(days)
    data["knowledge_base"] = knowledge.kb_state()
    return data


@router.get("/queries")
def list_queries(
    limit: int = Query(default=20, ge=1, le=200),
    source: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
):
    return audit.recent_queries(limit, source, q)


@router.get("/queries/{query_id}")
def query_detail(query_id: str):
    item = audit.get_query(query_id)
    if not item:
        raise HTTPException(status_code=404, detail="Query not found")
    return item


@router.get("/documents")
def documents():
    return [audit.public_document(d) for d in audit.list_documents()]


@router.get("/documents/{doc_id}/download")
def download_document(doc_id: str):
    doc = audit.get_document(doc_id)
    if not doc or not doc.get("path") or not Path(doc["path"]).is_file():
        raise HTTPException(status_code=404, detail="Original file is not available on this server")
    return FileResponse(doc["path"], filename=doc["name"])


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, x_admin_key: str = Header(default="")):
    _require_admin(x_admin_key)
    if not audit.get_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    removed = await asyncio.to_thread(knowledge.remove_document, doc_id)
    await knowledge.refresh_vector_count()
    return {"deleted": doc_id, "vectors_removed": removed}


@router.post("/ingest")
async def ingest(file: UploadFile = File(...), x_admin_key: str = Header(default="")):
    _require_admin(x_admin_key)
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(file.filename or "").name).strip() or "document"
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"Supported file types: {', '.join(sorted(SUPPORTED))}")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Maximum upload size is {settings.max_upload_mb} MB")

    await knowledge.wait_until_ready()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / name
    dest.write_bytes(data)
    try:
        doc = await asyncio.to_thread(knowledge.ingest_bytes, name, data, "upload", str(dest))
    except ValueError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Ingestion failed")
        raise HTTPException(status_code=500, detail="Indexing failed. Check the vector store configuration.") from exc
    await knowledge.refresh_vector_count()
    return {"message": "Document indexed", "document": audit.public_document(doc)}
