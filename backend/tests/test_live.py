import pytest

from app.core.config import get_settings
from app.llm.router import LLMRouter, StreamMeta, build_providers

pytestmark = pytest.mark.live


def configured():
    return [p.name for p in build_providers(get_settings())]


@pytest.mark.parametrize("name", ["openai", "anthropic", "groq", "gemini"])
async def test_provider_complete_and_stream(name):
    providers = {p.name: p for p in build_providers(get_settings())}
    if name not in providers:
        pytest.skip(f"{name} key not configured")
    provider = providers[name]
    reply = await provider.complete("Reply with the single word OK.", "Health check", 16)
    assert reply
    tokens = [t async for t in provider.stream("Be brief.", "Count from 1 to 5.", 120)]
    assert "".join(tokens).strip()


async def test_router_produces_an_answer_with_real_keys():
    if not configured():
        pytest.skip("no providers configured")
    router = LLMRouter(get_settings())
    meta = StreamMeta()
    text = "".join([t async for t in router.stream("Give one tip for a slow laptop.", max_tokens=200, meta=meta)])
    assert text.strip()
    assert meta.provider in configured()


async def test_full_pipeline_against_real_services():
    settings = get_settings()
    if not (settings.pinecone_api_key and configured()):
        pytest.skip("pinecone or llm keys missing")
    from app.rag import vectorstore
    from app.rag.workflow import ask
    from app.services import knowledge

    await knowledge.bootstrap_async()
    assert knowledge.kb_state()["status"] == "ready"
    assert vectorstore.search("VPN", 2)
    state = await ask("How do I connect to the company VPN from home?")
    assert state["source_used"] in {"private_kb", "web_search"}
    assert state["answer"]
