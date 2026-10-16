from typing import Any, List, Optional

from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    question: str
    history: List[dict]
    current_query: str
    route: str
    kb_docs: List[dict]
    web_results: str
    web_sources: List[dict]
    kb_grade: str
    web_grade: str
    answer: str
    source_used: str
    retry_count: int
    trace: List[dict]
    citations: List[dict]
    provider: str
    model: str
    prefetch: Optional[dict[str, Any]]
