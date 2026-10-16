import asyncio
import logging
from pathlib import Path

from app.core.config import get_settings
from app.rag import vectorstore
from app.services import audit
from app.services.ingestion import SUPPORTED, build_chunks

logger = logging.getLogger(__name__)

_state = {"status": "starting", "detail": "", "vector_count": 0}
_ready = asyncio.Event()


def kb_state() -> dict:
    return dict(_state)


def ingest_bytes(name: str, data: bytes, origin: str, path: str = "") -> dict:
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED:
        raise ValueError(f"Unsupported file type. Allowed: {', '.join(sorted(SUPPORTED))}")
    chunks = build_chunks(name, data, {"origin": origin, "file_type": suffix.lstrip("."), "size_bytes": len(data)})
    if not chunks:
        raise ValueError("No readable text found in the document")
    doc_id = vectorstore.document_id(name)
    for chunk in chunks:
        chunk.metadata["chunk_count"] = len(chunks)
    count = vectorstore.upsert_chunks(doc_id, chunks)
    doc = {
        "id": doc_id,
        "name": name,
        "file_type": suffix.lstrip("."),
        "size_bytes": len(data),
        "chunks": count,
        "origin": origin,
        "path": path,
    }
    audit.upsert_document(doc)
    return doc


def remove_document(doc_id: str) -> int:
    removed = vectorstore.delete_document_vectors(doc_id)
    doc = audit.get_document(doc_id)
    if doc and doc.get("origin") == "upload" and doc.get("path"):
        Path(doc["path"]).unlink(missing_ok=True)
    audit.delete_document(doc_id)
    return removed


def _sample_files() -> list[Path]:
    folder = Path(get_settings().sample_kb_dir)
    if not folder.exists():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED)


def _rebuild_registry() -> None:
    known = {d["id"] for d in audit.list_documents()}
    first_chunks = [vid for vid in vectorstore.list_vector_ids() if vid.endswith("#0")]
    missing = [vid for vid in first_chunks if vid.split("#")[0] not in known]
    for start in range(0, len(missing), 100):
        for vid, meta in vectorstore.fetch_metadata(missing[start : start + 100]).items():
            doc_id = vid.split("#")[0]
            name = str(meta.get("source", doc_id))
            sample = Path(get_settings().sample_kb_dir) / name
            upload = Path(get_settings().upload_dir) / name
            audit.upsert_document(
                {
                    "id": doc_id,
                    "name": name,
                    "file_type": meta.get("file_type", Path(name).suffix.lstrip(".")),
                    "size_bytes": int(meta.get("size_bytes", 0) or 0),
                    "chunks": int(meta.get("chunk_count", 0) or 0),
                    "origin": "sample" if sample.exists() else meta.get("origin", "upload"),
                    "path": str(sample if sample.exists() else upload if upload.exists() else ""),
                }
            )


def bootstrap() -> None:
    settings = get_settings()
    _state.update(status="warming", detail="Loading embedding model")
    vectorstore.get_embedder()
    _state.update(detail="Connecting to Pinecone")
    vectorstore.get_index()
    count = vectorstore.namespace_vector_count()

    if settings.auto_seed_kb and count == 0:
        _state.update(detail="Indexing starter knowledge base")
        for path in _sample_files():
            try:
                ingest_bytes(path.name, path.read_bytes(), origin="sample", path=str(path))
                logger.info("Seeded %s", path.name)
            except Exception as exc:
                logger.warning("Failed to seed %s: %s", path.name, exc)
        count = vectorstore.namespace_vector_count()
    else:
        try:
            _rebuild_registry()
        except Exception as exc:
            logger.warning("Could not rebuild document registry: %s", exc)

    _state.update(status="ready", detail="", vector_count=count)


async def bootstrap_async() -> None:
    try:
        await asyncio.to_thread(bootstrap)
    except Exception as exc:
        logger.exception("Knowledge base bootstrap failed")
        _state.update(status="degraded", detail=str(exc)[:300])
    finally:
        _ready.set()


async def wait_until_ready(timeout: float = 90.0) -> None:
    if _ready.is_set():
        return
    try:
        await asyncio.wait_for(_ready.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass


async def refresh_vector_count() -> None:
    try:
        _state["vector_count"] = await asyncio.to_thread(vectorstore.namespace_vector_count)
    except Exception:
        pass
