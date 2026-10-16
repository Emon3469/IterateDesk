import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

from app.core.config import get_settings


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> float:
        if self.limit <= 0:
            return 0.0
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return self.window - (now - hits[0])
            hits.append(now)
            if len(self._hits) > 10000:
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


chat_limiter = SlidingWindowLimiter(get_settings().rate_limit_per_minute)


def client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_chat_limit(request: Request) -> None:
    retry_after = chat_limiter.check(client_key(request))
    if retry_after > 0:
        raise HTTPException(
            status_code=429,
            detail="Too many questions in a short time. Please wait a moment and try again.",
            headers={"Retry-After": str(int(retry_after) + 1)},
        )
