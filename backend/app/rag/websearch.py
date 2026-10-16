import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        from tavily import AsyncTavilyClient

        _client = AsyncTavilyClient(api_key=get_settings().tavily_api_key)
    return _client


def is_configured() -> bool:
    return bool(get_settings().tavily_api_key)


async def web_search(query: str, max_results: int = 5, deep: bool = False) -> tuple[str, list[dict]]:
    if not is_configured():
        return "", []
    result = await _get_client().search(
        query=query,
        max_results=max_results,
        topic="general",
        search_depth="advanced" if deep else "basic",
        include_answer=True,
        include_raw_content=False,
        timeout=15,
    )
    lines, sources = [], []
    if result.get("answer"):
        lines.append("Search summary: " + result["answer"])
    for item in result.get("results", []):
        title, url, content = item.get("title", ""), item.get("url", ""), item.get("content", "")
        lines.append(f"Title: {title}\nURL: {url}\nContent: {content}")
        sources.append(
            {
                "title": title or url,
                "url": url,
                "type": "web",
                "score": round(float(item.get("score") or 0.0), 3),
                "snippet": content[:240],
            }
        )
    return "\n\n".join(lines), sources
