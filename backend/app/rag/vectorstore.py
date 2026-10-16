import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from threading import Lock

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_embedder = None
_index = None
_dimension: int | None = None
_embed_lock = Lock()
_index_lock = Lock()


@dataclass
class Chunk:
    text: str
    metadata: dict


@dataclass
class RetrievedChunk:
    id: str
    text: str
    score: float
    metadata: dict


def get_embedder():
    global _embedder, _dimension
    if _embedder is None:
        with _embed_lock:
            if _embedder is None:
                from fastembed import TextEmbedding

                _embedder = TextEmbedding(model_name=settings.embedding_model, cache_dir=settings.embedding_cache_dir)
                _dimension = len(next(iter(_embedder.query_embed(["dimension probe"]))))
                logger.info("Embedding model ready: %s (%d dims)", settings.embedding_model, _dimension)
    return _embedder


def embedding_dimension() -> int:
    get_embedder()
    return _dimension or 0


def embed_query(text: str) -> list[float]:
    return next(iter(get_embedder().query_embed([text]))).tolist()


def embed_passages(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in get_embedder().passage_embed(texts, batch_size=32)]


def get_index():
    global _index
    if _index is not None:
        return _index
    with _index_lock:
        if _index is not None:
            return _index
        if not settings.pinecone_api_key:
            raise RuntimeError("PINECONE_API_KEY is missing")
        from pinecone import Pinecone, ServerlessSpec

        dimension = embedding_dimension()
        pc = Pinecone(api_key=settings.pinecone_api_key)
        name = settings.pinecone_index_name
        if not pc.has_index(name):
            logger.info("Creating Pinecone index %s (%d dims)", name, dimension)
            pc.create_index(
                name=name,
                dimension=dimension,
                metric="cosine",
                spec=ServerlessSpec(cloud=settings.pinecone_cloud, region=settings.pinecone_region),
            )
            for _ in range(120):
                if _is_ready(pc.describe_index(name)):
                    break
                time.sleep(1)
        info = pc.describe_index(name)
        current = _attr(info, "dimension")
        if current and int(current) != dimension:
            raise RuntimeError(
                f"Pinecone index '{name}' has dimension {current} but embedding model "
                f"'{settings.embedding_model}' produces {dimension}. Use a different PINECONE_INDEX_NAME."
            )
        host = _attr(info, "host")
        _index = pc.Index(host=host) if host else pc.Index(name)
        return _index


def _attr(obj, key):
    if isinstance(obj, dict):
        return obj.get(key)
    value = getattr(obj, key, None)
    if value is None and hasattr(obj, "to_dict"):
        value = obj.to_dict().get(key)
    return value


def _is_ready(info) -> bool:
    status = _attr(info, "status")
    if isinstance(status, dict):
        return bool(status.get("ready"))
    return bool(getattr(status, "ready", False))


def document_id(name: str) -> str:
    return hashlib.sha1(name.lower().encode("utf-8")).hexdigest()[:16]


def namespace_vector_count() -> int:
    stats = get_index().describe_index_stats()
    namespaces = _attr(stats, "namespaces") or {}
    ns = namespaces.get(settings.pinecone_namespace) if isinstance(namespaces, dict) else None
    if ns is None:
        return 0
    return int(_attr(ns, "vector_count") or 0)


def list_vector_ids(prefix: str | None = None) -> list[str]:
    ids: list[str] = []
    for page in get_index().list(prefix=prefix, namespace=settings.pinecone_namespace):
        items = page if isinstance(page, list) else (_attr(page, "vectors") or [])
        for item in items:
            ids.append(item if isinstance(item, str) else _attr(item, "id"))
    return [i for i in ids if i]


def fetch_metadata(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    resp = get_index().fetch(ids=ids, namespace=settings.pinecone_namespace)
    vectors = _attr(resp, "vectors") or {}
    return {vid: dict(_attr(v, "metadata") or {}) for vid, v in vectors.items()}


def delete_document_vectors(doc_id: str) -> int:
    ids = list_vector_ids(prefix=f"{doc_id}#")
    for start in range(0, len(ids), 500):
        get_index().delete(ids=ids[start : start + 500], namespace=settings.pinecone_namespace)
    return len(ids)


def upsert_chunks(doc_id: str, chunks: list[Chunk]) -> int:
    if not chunks:
        return 0
    try:
        delete_document_vectors(doc_id)
    except Exception as exc:
        logger.warning("Could not clear previous vectors for %s: %s", doc_id, exc)
    vectors = embed_passages([c.text for c in chunks])
    payload = [
        {
            "id": f"{doc_id}#{i}",
            "values": values,
            "metadata": {**chunk.metadata, "text": chunk.text, "doc_id": doc_id, "chunk": i},
        }
        for i, (chunk, values) in enumerate(zip(chunks, vectors))
    ]
    index = get_index()
    for start in range(0, len(payload), 100):
        index.upsert(vectors=payload[start : start + 100], namespace=settings.pinecone_namespace, show_progress=False)
    return len(payload)


def search(query: str, k: int | None = None) -> list[RetrievedChunk]:
    vector = embed_query(query)
    resp = get_index().query(
        vector=vector,
        top_k=k or settings.top_k,
        namespace=settings.pinecone_namespace,
        include_metadata=True,
    )
    results = []
    for match in _attr(resp, "matches") or []:
        meta = dict(_attr(match, "metadata") or {})
        results.append(
            RetrievedChunk(
                id=_attr(match, "id"),
                text=str(meta.pop("text", "")),
                score=float(_attr(match, "score") or 0.0),
                metadata=meta,
            )
        )
    return results


async def asearch(query: str, k: int | None = None) -> list[RetrievedChunk]:
    return await asyncio.to_thread(search, query, k)


def warm_up() -> None:
    get_embedder()
    get_index()
