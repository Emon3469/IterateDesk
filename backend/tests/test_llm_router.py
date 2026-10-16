import pytest

from app.core.config import get_settings
from app.llm.router import AllProvidersFailed, LLMRouter, ModelPool, OpenAICompatibleProvider, ProviderError, StreamMeta


class StatusError(Exception):
    def __init__(self, status_code, message="boom"):
        super().__init__(message)
        self.status_code = status_code


class FakeProvider:
    def __init__(self, name, reply="ok", fail=None, stream_tokens=None, fail_after=None):
        self.name = name
        self.model = f"{name}-model"
        self.reply = reply
        self.fail = fail
        self.stream_tokens = stream_tokens or ["hello ", "world"]
        self.fail_after = fail_after
        self.calls = 0

    async def complete(self, system, prompt, max_tokens):
        self.calls += 1
        if self.fail:
            raise self.fail
        return self.reply

    async def stream(self, system, prompt, max_tokens):
        self.calls += 1
        if self.fail:
            raise self.fail
        for i, token in enumerate(self.stream_tokens):
            if self.fail_after is not None and i == self.fail_after:
                raise StatusError(500, "dropped")
            yield token


def router(*providers):
    return LLMRouter(get_settings(), providers=list(providers))


async def test_complete_uses_first_healthy_provider():
    a, b = FakeProvider("openai", reply="from-a"), FakeProvider("groq", reply="from-b")
    meta = StreamMeta()
    assert await router(a, b).complete("hi", meta=meta) == "from-a"
    assert meta.provider == "openai"
    assert b.calls == 0


async def test_complete_falls_back_in_order():
    a = FakeProvider("openai", fail=StatusError(401))
    b = FakeProvider("anthropic", fail=StatusError(400))
    c = FakeProvider("groq", reply="from-groq")
    r = router(a, b, c)
    meta = StreamMeta()
    assert await r.complete("hi", meta=meta) == "from-groq"
    assert meta.provider == "groq"
    assert meta.attempts == ["openai", "anthropic"]


async def test_failed_provider_is_skipped_during_cooldown():
    a = FakeProvider("openai", fail=StatusError(429))
    b = FakeProvider("groq", reply="ok")
    r = router(a, b)
    await r.complete("one")
    await r.complete("two")
    assert a.calls == 1
    assert b.calls == 2
    assert {row["name"]: row["state"] for row in r.status()}["openai"] == "cooldown"


async def test_all_providers_failing_raises():
    r = router(FakeProvider("openai", fail=StatusError(500)), FakeProvider("groq", fail=StatusError(503)))
    with pytest.raises(AllProvidersFailed):
        await r.complete("hi")


async def test_no_providers_configured_raises():
    with pytest.raises(AllProvidersFailed, match="No LLM provider"):
        await router().complete("hi")


async def test_stream_falls_back_before_first_token():
    a = FakeProvider("openai", fail=StatusError(503))
    b = FakeProvider("groq", stream_tokens=["a", "b", "c"])
    meta = StreamMeta()
    tokens = [t async for t in router(a, b).stream("hi", meta=meta)]
    assert tokens == ["a", "b", "c"]
    assert meta.provider == "groq"


async def test_stream_failure_mid_response_is_reported():
    a = FakeProvider("openai", stream_tokens=["a", "b", "c"], fail_after=1)
    b = FakeProvider("groq")
    tokens = []
    with pytest.raises(ProviderError, match="mid-response"):
        async for t in router(a, b).stream("hi"):
            tokens.append(t)
    assert tokens == ["a"]
    assert b.calls == 0


async def test_empty_stream_counts_as_failure():
    a = FakeProvider("openai", stream_tokens=[])
    a.stream_tokens = []
    b = FakeProvider("groq", stream_tokens=["x"])

    async def empty(system, prompt, max_tokens):
        if False:
            yield ""

    a.stream = empty
    assert [t async for t in router(a, b).stream("hi")] == ["x"]


async def test_check_all_reports_each_provider():
    r = router(FakeProvider("openai", fail=StatusError(401, "bad key")), FakeProvider("groq", reply="OK"))
    results = {row["name"]: row for row in await r.check_all()}
    assert results["openai"]["ok"] is False and "bad key" in results["openai"]["error"]
    assert results["groq"]["ok"] is True and results["groq"]["reply"] == "OK"


def test_model_pool_retires_missing_models():
    pool = ModelPool("groq", ["m1", "m2", "m2", " "])
    assert pool.models == ["m1", "m2"]
    pool.failed("m1", StatusError(404))
    assert pool.candidates() == ["m2"]
    pool.failed("m2", StatusError(404))
    assert pool.candidates() == ["m2"]


class _Msg:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content):
        self.message = _Msg(content)


class _Resp:
    def __init__(self, content):
        self.choices = [_Choice(content)]


class FakeCompletions:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = []

    async def create(self, **params):
        self.calls.append(params)
        result = self.behaviour.get(params["model"])
        if isinstance(result, Exception):
            raise result
        return _Resp(result)


class FakeClient:
    def __init__(self, behaviour):
        self.chat = type("Chat", (), {})()
        self.chat.completions = FakeCompletions(behaviour)


async def test_openai_compatible_provider_switches_model_on_rate_limit_and_404():
    client = FakeClient({"big": StatusError(429), "gone": StatusError(404), "small": "hello"})
    p = OpenAICompatibleProvider("groq", ["big", "gone", "small"], client)
    assert await p.complete("sys", "hi", 10) == "hello"
    assert p.model == "small"
    assert "gone" in p.pool.retired


async def test_openai_compatible_provider_does_not_switch_on_auth_error():
    client = FakeClient({"a": StatusError(401), "b": "hello"})
    p = OpenAICompatibleProvider("openai", ["a", "b"], client)
    with pytest.raises(StatusError):
        await p.complete("sys", "hi", 10)


def test_reasoning_models_get_token_floor_and_no_temperature():
    p = OpenAICompatibleProvider("groq", ["openai/gpt-oss-120b"], FakeClient({}))
    params = p._params("openai/gpt-oss-120b", "s", "u", 4, 0)
    assert params["max_completion_tokens"] >= 400
    assert "temperature" not in params
    assert params["reasoning_effort"] == "low"
    plain = p._params("llama-3.1-8b-instant", "s", "u", 4, 0)
    assert plain["max_completion_tokens"] == 4 and plain["temperature"] == 0


def test_anthropic_params_match_model_generation():
    from app.llm.router import AnthropicProvider

    new = AnthropicProvider._params("claude-haiku-5-5", "s", "u", 50)
    assert new["thinking"] == {"type": "disabled"} and new["output_config"] == {"effort": "low"}
    assert "temperature" not in new
    old = AnthropicProvider._params("claude-haiku-4-5", "s", "u", 50)
    assert "thinking" not in old and "output_config" not in old
