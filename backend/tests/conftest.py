import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

LIVE = os.getenv("RUN_LIVE") == "1"
_tmp = Path(tempfile.mkdtemp(prefix="iteratedesk-tests-"))

os.environ.update(
    {
        "APP_ENV": "test",
        "AUDIT_DB_PATH": str(_tmp / "audit.db"),
        "UPLOAD_DIR": str(_tmp / "uploads"),
        "ADMIN_API_KEY": "test-admin-key",
        "AUTO_SEED_KB": "false",
        "RATE_LIMIT_PER_MINUTE": "1000",
        "CORS_ORIGINS": "http://localhost:3000",
    }
)
if not LIVE:
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTORPIC_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY",
                "GOOGLE_API_KEY", "TAVILY_API_KEY", "PINECONE_API_KEY"):
        os.environ[key] = ""


def pytest_collection_modifyitems(config, items):
    if LIVE:
        return
    skip = pytest.mark.skip(reason="live test, set RUN_LIVE=1")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


class FakeLLM:
    def __init__(self, route="kb", kb_grade="good", web_grade="good", rewrite="rewritten vpn query",
                 answer="Here is the answer [1].", fail_stream=False):
        self.route = route
        self.kb_grade = kb_grade
        self.web_grade = web_grade
        self.rewrite = rewrite
        self.answer = answer
        self.fail_stream = fail_stream
        self.prompts: list[str] = []

    async def complete(self, prompt, system="", max_tokens=512, meta=None):
        self.prompts.append(prompt)
        if "Answer with one word: kb or direct" in prompt:
            return self.route
        if "ROUTE:" in prompt:
            return f"ROUTE: {self.route}\nQUERY: standalone follow up query"
        if "Private company KB evidence" in prompt:
            return self.kb_grade
        if "Web evidence" in prompt:
            return self.web_grade
        if "Rewrite this IT support question" in prompt:
            return self.rewrite
        return "ok"

    async def stream(self, prompt, system="", max_tokens=1200, meta=None):
        from app.llm.router import AllProvidersFailed

        self.prompts.append(prompt)
        if self.fail_stream:
            raise AllProvidersFailed("all down")
        if meta is not None:
            meta.provider, meta.model = "fake", "fake-model"
        for word in self.answer.split(" "):
            yield word + " "


@pytest.fixture(autouse=True)
def _reset_state():
    from app.core.ratelimit import chat_limiter
    from app.services import audit

    audit.init_db()
    with audit._conn() as c:
        c.execute("DELETE FROM queries")
        c.execute("DELETE FROM documents")
    chat_limiter.reset()
    yield


@pytest.fixture
def fake_llm(monkeypatch):
    from app.rag import workflow

    llm = FakeLLM()
    monkeypatch.setattr(workflow, "get_llm", lambda: llm)
    return llm


@pytest.fixture
def kb_hits(monkeypatch):
    from app.rag import workflow
    from app.rag.vectorstore import RetrievedChunk
    from app.services import knowledge

    hits = [
        RetrievedChunk(id="a#0", text="Install the NovaSecure VPN client and sign in with MFA.", score=0.82,
                       metadata={"source": "company_it_handbook.md", "doc_id": "a"}),
        RetrievedChunk(id="b#0", text="Service desk escalation steps.", score=0.61,
                       metadata={"source": "service_desk_runbook.md", "doc_id": "b"}),
    ]
    calls = []

    async def fake_search(query, k=None):
        calls.append(query)
        return hits

    async def ready(timeout=90.0):
        return None

    monkeypatch.setattr(workflow.vectorstore, "asearch", fake_search)
    monkeypatch.setattr(knowledge, "wait_until_ready", ready)
    return calls


@pytest.fixture
def web_hits(monkeypatch):
    from app.rag import workflow

    calls = []

    async def fake_web(query, max_results=5, deep=False):
        calls.append(query)
        return (
            "Search summary: Microsoft reported a Teams outage.",
            [{"title": "Teams status", "url": "https://status.example.com", "type": "web", "score": 0.9,
              "snippet": "Teams outage update"}],
        )

    monkeypatch.setattr(workflow.websearch, "web_search", fake_web)
    monkeypatch.setattr(workflow.websearch, "is_configured", lambda: True)
    return calls


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main
    from app.services import knowledge

    async def fake_bootstrap():
        knowledge._state.update(status="ready", detail="", vector_count=0)
        knowledge._ready.set()

    monkeypatch.setattr(knowledge, "bootstrap_async", fake_bootstrap)
    with TestClient(main.app) as c:
        yield c
