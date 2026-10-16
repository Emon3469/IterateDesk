import json

import pytest

ADMIN = {"x-admin-key": "test-admin-key"}


def parse_sse(text):
    events = []
    for block in text.strip().split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:].strip())
        if name:
            events.append((name, data))
    return events


@pytest.fixture
def patched_ingest(monkeypatch):
    from app.services import knowledge

    store = {}

    def upsert(doc_id, chunks):
        store[doc_id] = len(chunks)
        return len(chunks)

    def delete(doc_id):
        return store.pop(doc_id, 0)

    monkeypatch.setattr(knowledge.vectorstore, "upsert_chunks", upsert)
    monkeypatch.setattr(knowledge.vectorstore, "delete_document_vectors", delete)
    monkeypatch.setattr(knowledge.vectorstore, "namespace_vector_count", lambda: sum(store.values()))
    return store


def test_health_and_root(client):
    assert client.get("/").json()["status"] == "ok"
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["knowledge_base"] == "ready"


def test_system_lists_all_providers(client):
    body = client.get("/api/system").json()
    assert [p["name"] for p in body["llm_providers"]] == ["openai", "anthropic", "groq", "gemini"]
    assert body["vector_store"]["provider"] == "pinecone"


def test_chat_validation(client):
    assert client.post("/api/chat", json={"question": ""}).status_code == 422
    assert client.post("/api/chat", json={"question": "x" * 2001}).status_code == 422
    assert client.post("/api/chat", json={}).status_code == 422
    bad_role = {"question": "hi", "history": [{"role": "system", "content": "x"}]}
    assert client.post("/api/chat", json=bad_role).status_code == 422


def test_chat_returns_answer_and_is_audited(client, fake_llm, kb_hits):
    res = client.post("/api/chat", json={"question": "How do I connect to the VPN?"})
    assert res.status_code == 200
    body = res.json()
    assert body["source_used"] == "private_kb"
    assert body["id"] and body["latency_ms"] >= 0
    assert body["top_score"] == pytest.approx(0.82)
    detail = client.get(f"/api/queries/{body['id']}").json()
    assert detail["question"] == "How do I connect to the VPN?"
    assert detail["trace"][0]["step"] == "router"


def test_stream_event_contract(client, fake_llm, kb_hits):
    with client.stream("POST", "/api/chat/stream", json={"question": "vpn help"}) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        assert res.headers["cache-control"].startswith("no-cache")
        text = "".join(res.iter_text())
    events = parse_sse(text)
    names = [e[0] for e in events]
    assert names[0] == "status"
    assert names[-1] == "done"
    assert names.count("step") == 4
    tokens = "".join(d["text"] for n, d in events if n == "token")
    done = events[-1][1]
    assert tokens.strip() == done["answer"].strip()
    assert done["source_used"] == "private_kb" and done["provider"] == "fake"
    assert client.get("/api/queries").json()[0]["id"] == done["id"]


def test_stream_reports_provider_outage_as_error_event(client, fake_llm, kb_hits):
    fake_llm.fail_stream = True
    with client.stream("POST", "/api/chat/stream", json={"question": "vpn help"}) as res:
        events = parse_sse("".join(res.iter_text()))
    assert events[-1][0] == "error"
    assert "unavailable" in events[-1][1]["message"]
    assert client.get("/api/queries").json()[0]["status"] == "error"


def test_chat_returns_503_when_all_providers_fail(client, fake_llm, kb_hits):
    fake_llm.fail_stream = True
    assert client.post("/api/chat", json={"question": "vpn"}).status_code == 503


def test_rate_limit(client, fake_llm, kb_hits, monkeypatch):
    from app.core.ratelimit import chat_limiter

    monkeypatch.setattr(chat_limiter, "limit", 2)
    for _ in range(2):
        assert client.post("/api/chat", json={"question": "hello"}).status_code == 200
    res = client.post("/api/chat", json={"question": "hello"})
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) > 0
    other = client.post("/api/chat", json={"question": "hello"}, headers={"x-forwarded-for": "10.0.0.9"})
    assert other.status_code == 200


def test_ingest_requires_admin_key(client, patched_ingest):
    files = {"file": ("guide.md", b"# VPN\nUse the client.", "text/markdown")}
    assert client.post("/api/ingest", files=files).status_code == 401
    assert client.post("/api/ingest", files=files, headers={"x-admin-key": "wrong"}).status_code == 401


def test_ingest_validation(client, patched_ingest):
    assert client.post("/api/ingest", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, headers=ADMIN).status_code == 400
    assert client.post("/api/ingest", files={"file": ("empty.md", b"", "text/markdown")}, headers=ADMIN).status_code == 400
    assert client.post("/api/ingest", files={"file": ("blank.md", b"   \n  ", "text/markdown")}, headers=ADMIN).status_code == 422


def test_ingest_rejects_oversized_files(client, patched_ingest, monkeypatch):
    from app.api import routes

    monkeypatch.setattr(routes.settings, "max_upload_mb", 0)
    res = client.post("/api/ingest", files={"file": ("big.md", b"x" * 10, "text/markdown")}, headers=ADMIN)
    assert res.status_code == 413


def test_ingest_list_download_delete_roundtrip(client, patched_ingest):
    content = b"# Printer guide\nUse floor 3 printer for colour jobs."
    res = client.post("/api/ingest", files={"file": ("../../etc/printer guide.md", content, "text/markdown")}, headers=ADMIN)
    assert res.status_code == 200
    doc = res.json()["document"]
    assert doc["name"] == "printer guide.md"
    assert "path" not in doc and doc["chunks"] == 1

    docs = client.get("/api/documents").json()
    assert [d["name"] for d in docs] == ["printer guide.md"]
    assert all("path" not in d for d in docs)

    dl = client.get(f"/api/documents/{doc['id']}/download")
    assert dl.status_code == 200 and dl.content == content

    assert client.delete(f"/api/documents/{doc['id']}").status_code == 401
    res = client.delete(f"/api/documents/{doc['id']}", headers=ADMIN)
    assert res.status_code == 200 and res.json()["vectors_removed"] == 1
    assert client.get("/api/documents").json() == []
    assert client.get(f"/api/documents/{doc['id']}/download").status_code == 404
    assert client.delete(f"/api/documents/{doc['id']}", headers=ADMIN).status_code == 404


def test_reingest_same_file_replaces_instead_of_duplicating(client, patched_ingest):
    files = lambda: {"file": ("kb.md", b"# A\nfirst version", "text/markdown")}
    client.post("/api/ingest", files=files(), headers=ADMIN)
    client.post("/api/ingest", files=files(), headers=ADMIN)
    assert len(client.get("/api/documents").json()) == 1


def test_queries_endpoints(client):
    from app.services import audit

    audit.record_query({"question": "VPN?", "source_used": "private_kb"})
    assert client.get("/api/queries?limit=0").status_code == 422
    assert client.get("/api/queries?source=private_kb").json()[0]["question"] == "VPN?"
    assert client.get("/api/queries/does-not-exist").status_code == 404


def test_stats_endpoint(client):
    body = client.get("/api/stats?days=14").json()
    assert len(body["trend"]) == 14
    assert body["knowledge_base"]["status"] == "ready"
    assert client.get("/api/stats?days=3").status_code == 422


def test_check_providers_requires_admin(client, monkeypatch):
    from app.api import routes

    class Stub:
        async def check_all(self):
            return [{"name": "groq", "model": "m", "ok": True, "latency_ms": 5, "reply": "OK", "error": ""}]

    monkeypatch.setattr(routes, "get_llm", lambda: Stub())
    assert client.post("/api/system/check-providers").status_code == 401
    body = client.post("/api/system/check-providers", headers=ADMIN).json()
    assert body["healthy"] == 1 and body["total"] == 1


@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("http://localhost:3000", True),
        ("https://iteratedesk.vercel.app", True),
        ("https://iteratedesk-git-main-me.vercel.app", True),
        ("https://evil.example.com", False),
    ],
)
def test_cors(client, origin, allowed):
    res = client.options(
        "/api/chat/stream",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert (res.headers.get("access-control-allow-origin") == origin) is allowed
