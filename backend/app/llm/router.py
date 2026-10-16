import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol

import anthropic
import openai
from groq import AsyncGroq

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

REASONING_PREFIXES = ("openai/gpt-oss", "qwen/", "o1", "o3", "o4", "gpt-5", "gemini")
SWITCH_MODEL_STATUS = (404, 413, 429, 500, 502, 503, 529)
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
KNOWN_PROVIDERS = ("openai", "anthropic", "groq", "gemini")


class ProviderError(RuntimeError):
    pass


class AllProvidersFailed(RuntimeError):
    pass


class Provider(Protocol):
    name: str

    @property
    def model(self) -> str: ...

    async def complete(self, system: str, prompt: str, max_tokens: int) -> str: ...

    def stream(self, system: str, prompt: str, max_tokens: int) -> AsyncIterator[str]: ...


def _status(exc: BaseException | None) -> int | None:
    return getattr(exc, "status_code", None)


def _unique(items: list[str]) -> list[str]:
    seen, out = set(), []
    for item in items:
        item = item.strip()
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _can_switch_model(exc: Exception) -> bool:
    return isinstance(exc, ProviderError) or _status(exc) in SWITCH_MODEL_STATUS


class ModelPool:
    def __init__(self, name: str, models: list[str]):
        self.name = name
        self.models = _unique(models)
        self.retired: set[str] = set()
        self.active = self.models[0] if self.models else ""

    def candidates(self) -> list[str]:
        live = [m for m in self.models if m not in self.retired]
        if self.active in live:
            live.remove(self.active)
            live.insert(0, self.active)
        return live

    def succeeded(self, model: str) -> None:
        self.active = model

    def failed(self, model: str, exc: Exception) -> None:
        if _status(exc) == 404 and len(self.retired) < len(self.models) - 1:
            self.retired.add(model)
            logger.warning("%s model %s is unavailable, switching to the next model", self.name, model)


class OpenAICompatibleProvider:
    def __init__(self, name: str, models: list[str], client):
        self.name = name
        self.pool = ModelPool(name, models)
        self._client = client

    @property
    def model(self) -> str:
        return self.pool.active

    @staticmethod
    def _is_reasoning(model: str) -> bool:
        return model.lower().startswith(REASONING_PREFIXES)

    def _params(self, model: str, system: str, prompt: str, max_tokens: int, temperature: float) -> dict:
        reasoning = self._is_reasoning(model)
        params: dict = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "max_completion_tokens": max(max_tokens, 400) if reasoning else max_tokens,
        }
        if not reasoning:
            params["temperature"] = temperature
        elif self.name == "groq":
            if model.startswith("openai/gpt-oss"):
                params.update(reasoning_effort="low", include_reasoning=False)
            else:
                params["reasoning_format"] = "hidden"
        elif self.name in ("openai", "gemini"):
            params["reasoning_effort"] = "low"
        return params

    async def complete(self, system: str, prompt: str, max_tokens: int) -> str:
        last: Exception | None = None
        for model in self.pool.candidates():
            try:
                resp = await self._client.chat.completions.create(**self._params(model, system, prompt, max_tokens, 0))
                text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
                if not text:
                    raise ProviderError(f"{self.name}/{model} returned an empty response")
                self.pool.succeeded(model)
                return text
            except Exception as exc:
                last = exc
                self.pool.failed(model, exc)
                if not _can_switch_model(exc):
                    raise
        raise last or ProviderError(f"{self.name} has no usable model")

    async def stream(self, system: str, prompt: str, max_tokens: int) -> AsyncIterator[str]:
        last: Exception | None = None
        for model in self.pool.candidates():
            emitted = False
            try:
                stream = await self._client.chat.completions.create(
                    **self._params(model, system, prompt, max_tokens, 0.2), stream=True
                )
                async for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                        emitted = True
                        yield chunk.choices[0].delta.content
                if not emitted:
                    raise ProviderError(f"{self.name}/{model} streamed no content")
                self.pool.succeeded(model)
                return
            except Exception as exc:
                last = exc
                self.pool.failed(model, exc)
                if emitted or not _can_switch_model(exc):
                    raise
        raise last or ProviderError(f"{self.name} has no usable model")


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, models: list[str], api_key: str, timeout: float):
        self.pool = ModelPool("anthropic", models)
        self._client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout, max_retries=0)

    @property
    def model(self) -> str:
        return self.pool.active

    @staticmethod
    def _params(model: str, system: str, prompt: str, max_tokens: int) -> dict:
        params: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        if not model.startswith(("claude-haiku-4", "claude-3")):
            params["thinking"] = {"type": "disabled"}
            params["output_config"] = {"effort": "low"}
        return params

    async def complete(self, system: str, prompt: str, max_tokens: int) -> str:
        last: Exception | None = None
        for model in self.pool.candidates():
            try:
                resp = await self._client.messages.create(**self._params(model, system, prompt, max_tokens))
                if resp.stop_reason == "refusal":
                    raise ProviderError("anthropic declined the request")
                text = "".join(b.text for b in resp.content if b.type == "text").strip()
                if not text:
                    raise ProviderError("anthropic returned an empty response")
                self.pool.succeeded(model)
                return text
            except Exception as exc:
                last = exc
                self.pool.failed(model, exc)
                if not _can_switch_model(exc):
                    raise
        raise last or ProviderError("anthropic has no usable model")

    async def stream(self, system: str, prompt: str, max_tokens: int) -> AsyncIterator[str]:
        last: Exception | None = None
        for model in self.pool.candidates():
            emitted = False
            try:
                async with self._client.messages.stream(**self._params(model, system, prompt, max_tokens)) as stream:
                    async for text in stream.text_stream:
                        emitted = True
                        yield text
                    final = await stream.get_final_message()
                if final.stop_reason == "refusal":
                    raise ProviderError("anthropic declined the request")
                if not emitted:
                    raise ProviderError("anthropic streamed no content")
                self.pool.succeeded(model)
                return
            except Exception as exc:
                last = exc
                self.pool.failed(model, exc)
                if emitted or not _can_switch_model(exc):
                    raise
        raise last or ProviderError("anthropic has no usable model")


@dataclass
class ProviderHealth:
    failures: int = 0
    cooldown_until: float = 0.0
    last_error: str = ""
    last_latency_ms: int = 0
    calls: int = 0


@dataclass
class StreamMeta:
    provider: str = ""
    model: str = ""
    attempts: list[str] = field(default_factory=list)


def _models(primary: str, fallbacks: str) -> list[str]:
    return [primary, *fallbacks.split(",")]


def build_providers(settings: Settings) -> list[Provider]:
    available: dict[str, Provider] = {}
    timeout = settings.llm_timeout_seconds
    if settings.openai_api_key:
        available["openai"] = OpenAICompatibleProvider(
            "openai",
            _models(settings.openai_model, settings.openai_fallback_models),
            openai.AsyncOpenAI(api_key=settings.openai_api_key, timeout=timeout, max_retries=0),
        )
    if settings.anthropic_api_key:
        available["anthropic"] = AnthropicProvider(
            _models(settings.anthropic_model, settings.anthropic_fallback_models), settings.anthropic_api_key, timeout
        )
    if settings.groq_api_key:
        available["groq"] = OpenAICompatibleProvider(
            "groq",
            _models(settings.groq_model, settings.groq_fallback_models),
            AsyncGroq(api_key=settings.groq_api_key, timeout=timeout, max_retries=0),
        )
    if settings.gemini_api_key:
        available["gemini"] = OpenAICompatibleProvider(
            "gemini",
            _models(settings.gemini_model, settings.gemini_fallback_models),
            openai.AsyncOpenAI(api_key=settings.gemini_api_key, base_url=GEMINI_BASE_URL, timeout=timeout, max_retries=0),
        )
    ordered = [available.pop(name) for name in settings.provider_order if name in available]
    return ordered + list(available.values())


class LLMRouter:
    def __init__(self, settings: Settings, providers: list[Provider] | None = None):
        self.settings = settings
        self.providers = providers if providers is not None else build_providers(settings)
        self.health: dict[str, ProviderHealth] = {p.name: ProviderHealth() for p in self.providers}

    def _ordered(self) -> list[Provider]:
        now = time.monotonic()
        ready = [p for p in self.providers if self.health[p.name].cooldown_until <= now]
        cooling = sorted(
            (p for p in self.providers if self.health[p.name].cooldown_until > now),
            key=lambda p: self.health[p.name].cooldown_until,
        )
        return ready + cooling

    def _ok(self, name: str, started: float) -> None:
        h = self.health[name]
        h.failures = 0
        h.cooldown_until = 0.0
        h.calls += 1
        h.last_latency_ms = int((time.perf_counter() - started) * 1000)

    def _fail(self, name: str, exc: Exception) -> None:
        h = self.health[name]
        h.failures += 1
        h.calls += 1
        h.last_error = f"{type(exc).__name__}: {str(exc)[:200]}"
        persistent = _status(exc) in (400, 401, 402, 403, 404)
        cooldown = self.settings.llm_cooldown_seconds * (10 if persistent else 1)
        h.cooldown_until = time.monotonic() + cooldown
        logger.warning("LLM provider %s failed, falling back: %s", name, h.last_error)

    def _ensure_configured(self) -> None:
        if not self.providers:
            raise AllProvidersFailed(
                "No LLM provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY or GEMINI_API_KEY."
            )

    async def complete(self, prompt: str, system: str = "", max_tokens: int = 512, meta: StreamMeta | None = None) -> str:
        self._ensure_configured()
        errors = []
        for provider in self._ordered():
            started = time.perf_counter()
            try:
                text = await provider.complete(system or "You are a precise assistant.", prompt, max_tokens)
                self._ok(provider.name, started)
                if meta is not None:
                    meta.provider, meta.model = provider.name, provider.model
                return text
            except Exception as exc:
                self._fail(provider.name, exc)
                errors.append(f"{provider.name}: {exc}")
                if meta is not None:
                    meta.attempts.append(provider.name)
        raise AllProvidersFailed("; ".join(errors))

    async def stream(self, prompt: str, system: str = "", max_tokens: int = 1200, meta: StreamMeta | None = None) -> AsyncIterator[str]:
        self._ensure_configured()
        meta = meta if meta is not None else StreamMeta()
        errors = []
        for provider in self._ordered():
            started = time.perf_counter()
            emitted = False
            try:
                async for token in provider.stream(system or "You are a precise assistant.", prompt, max_tokens):
                    if not emitted:
                        emitted = True
                        meta.provider, meta.model = provider.name, provider.model
                    yield token
                if not emitted:
                    raise ProviderError(f"{provider.name} streamed no content")
                meta.model = provider.model
                self._ok(provider.name, started)
                return
            except Exception as exc:
                self._fail(provider.name, exc)
                meta.attempts.append(provider.name)
                errors.append(f"{provider.name}: {exc}")
                if emitted:
                    raise ProviderError(f"{provider.name} stopped mid-response") from exc
        raise AllProvidersFailed("; ".join(errors))

    async def check_all(self, timeout: float = 20.0) -> list[dict]:
        async def probe(provider: Provider) -> dict:
            started = time.perf_counter()
            try:
                text = await asyncio.wait_for(
                    provider.complete("Reply with the single word OK.", "Health check", 16), timeout=timeout
                )
                self._ok(provider.name, started)
                return {
                    "name": provider.name,
                    "model": provider.model,
                    "ok": True,
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "reply": text[:40],
                    "error": "",
                }
            except Exception as exc:
                self._fail(provider.name, exc)
                return {
                    "name": provider.name,
                    "model": provider.model,
                    "ok": False,
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "reply": "",
                    "error": f"{type(exc).__name__}: {str(exc)[:240]}",
                }

        return list(await asyncio.gather(*(probe(p) for p in self.providers)))

    def status(self) -> list[dict]:
        now = time.monotonic()
        configured = {p.name: p for p in self.providers}
        rows = []
        for name in KNOWN_PROVIDERS:
            p = configured.get(name)
            h = self.health.get(name)
            rows.append(
                {
                    "name": name,
                    "model": p.model if p else getattr(self.settings, f"{name}_model", ""),
                    "configured": p is not None,
                    "priority": self.providers.index(p) + 1 if p else None,
                    "state": "unconfigured" if not p else ("cooldown" if h and h.cooldown_until > now else "ready"),
                    "last_latency_ms": h.last_latency_ms if h else 0,
                    "calls": h.calls if h else 0,
                    "last_error": h.last_error if h else "",
                }
            )
        return rows


_router: LLMRouter | None = None


def get_llm() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter(get_settings())
    return _router
