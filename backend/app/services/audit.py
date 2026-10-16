import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

from app.core.config import get_settings

_lock = Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    question TEXT NOT NULL,
    rewritten_query TEXT,
    route TEXT,
    source_used TEXT,
    kb_grade TEXT,
    web_grade TEXT,
    retries INTEGER DEFAULT 0,
    provider TEXT,
    model TEXT,
    latency_ms INTEGER,
    top_score REAL,
    answer TEXT,
    citations TEXT,
    trace TEXT,
    status TEXT DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_queries_created ON queries(created_at);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_type TEXT,
    size_bytes INTEGER,
    chunks INTEGER,
    origin TEXT,
    path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _conn():
    path = Path(get_settings().audit_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with _lock:
            yield conn
            conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _conn() as c:
        c.executescript(SCHEMA)


def record_query(data: dict) -> str:
    qid = data.get("id") or uuid.uuid4().hex[:12]
    with _conn() as c:
        c.execute(
            """INSERT OR REPLACE INTO queries
            (id, created_at, question, rewritten_query, route, source_used, kb_grade, web_grade, retries,
             provider, model, latency_ms, top_score, answer, citations, trace, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                qid,
                _now(),
                data.get("question", ""),
                data.get("rewritten_query", ""),
                data.get("route", ""),
                data.get("source_used", ""),
                data.get("kb_grade", ""),
                data.get("web_grade", ""),
                int(data.get("retries", 0)),
                data.get("provider", ""),
                data.get("model", ""),
                int(data.get("latency_ms", 0)),
                data.get("top_score"),
                data.get("answer", ""),
                json.dumps(data.get("citations", [])),
                json.dumps(data.get("trace", [])),
                data.get("status", "ok"),
            ),
        )
    return qid


def _row_to_query(row: sqlite3.Row, full: bool = False) -> dict:
    item = dict(row)
    item["citations"] = json.loads(item.get("citations") or "[]")
    item["trace"] = json.loads(item.get("trace") or "[]")
    if not full:
        item["answer"] = (item.get("answer") or "")[:280]
    return item


def recent_queries(limit: int = 20, source: str | None = None, search: str | None = None) -> list[dict]:
    sql = "SELECT * FROM queries"
    clauses, params = [], []
    if source:
        clauses.append("source_used = ?")
        params.append(source)
    if search:
        clauses.append("question LIKE ?")
        params.append(f"%{search}%")
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with _conn() as c:
        return [_row_to_query(r) for r in c.execute(sql, params).fetchall()]


def get_query(qid: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM queries WHERE id = ?", (qid,)).fetchone()
    return _row_to_query(row, full=True) if row else None


def upsert_document(doc: dict) -> None:
    now = _now()
    with _conn() as c:
        existing = c.execute("SELECT created_at FROM documents WHERE id = ?", (doc["id"],)).fetchone()
        c.execute(
            """INSERT OR REPLACE INTO documents
            (id, name, file_type, size_bytes, chunks, origin, path, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                doc["id"],
                doc["name"],
                doc.get("file_type", ""),
                int(doc.get("size_bytes", 0)),
                int(doc.get("chunks", 0)),
                doc.get("origin", "upload"),
                doc.get("path", ""),
                doc.get("created_at") or (existing["created_at"] if existing else now),
                now,
            ),
        )


def list_documents() -> list[dict]:
    with _conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM documents ORDER BY updated_at DESC").fetchall()]


def public_document(doc: dict) -> dict:
    item = {k: v for k, v in doc.items() if k != "path"}
    item["downloadable"] = bool(doc.get("path")) and Path(doc["path"]).is_file()
    return item


def get_document(doc_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    return dict(row) if row else None


def delete_document(doc_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM documents WHERE id = ?", (doc_id,))


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 100.0 if current else 0.0
    return round((current - previous) / previous * 100, 1)


def stats(days: int = 30) -> dict:
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks_ago = (now - timedelta(days=14)).isoformat()
    since = (now - timedelta(days=days - 1)).date()

    with _conn() as c:
        totals = c.execute(
            """SELECT COUNT(*) total,
                SUM(source_used='private_kb') kb,
                SUM(source_used='web_search') web,
                SUM(source_used='insufficient_evidence') insufficient,
                SUM(source_used='direct') direct,
                SUM(status='error') errors,
                AVG(CASE WHEN status='ok' THEN latency_ms END) avg_latency,
                SUM(retries) retries
            FROM queries"""
        ).fetchone()

        def window(start: str, end: str | None) -> sqlite3.Row:
            sql = """SELECT COUNT(*) total, SUM(source_used='private_kb') kb, SUM(source_used='web_search') web,
                     SUM(source_used IN ('private_kb','web_search')) grounded,
                     SUM(source_used IN ('private_kb','web_search','insufficient_evidence')) answerable
                     FROM queries WHERE created_at >= ?"""
            params = [start]
            if end:
                sql += " AND created_at < ?"
                params.append(end)
            return c.execute(sql, params).fetchone()

        this_week = window(week_ago, None)
        last_week = window(two_weeks_ago, week_ago)

        daily_rows = c.execute(
            """SELECT substr(created_at,1,10) day,
                SUM(source_used='private_kb') kb,
                SUM(source_used='web_search') web,
                SUM(source_used='insufficient_evidence') insufficient,
                COUNT(*) total
            FROM queries WHERE substr(created_at,1,10) >= ? GROUP BY day""",
            (since.isoformat(),),
        ).fetchall()

        docs = c.execute("SELECT COUNT(*) n, COALESCE(SUM(chunks),0) chunks FROM documents").fetchone()
        providers = c.execute(
            "SELECT provider, COUNT(*) n FROM queries WHERE provider != '' GROUP BY provider ORDER BY n DESC"
        ).fetchall()

    by_day = {r["day"]: dict(r) for r in daily_rows}
    trend = []
    for i in range(days):
        day = (since + timedelta(days=i)).isoformat()
        row = by_day.get(day, {})
        trend.append(
            {
                "date": day,
                "kb": int(row.get("kb") or 0),
                "web": int(row.get("web") or 0),
                "insufficient": int(row.get("insufficient") or 0),
                "total": int(row.get("total") or 0),
            }
        )

    total = int(totals["total"] or 0)
    kb = int(totals["kb"] or 0)
    web = int(totals["web"] or 0)
    insufficient = int(totals["insufficient"] or 0)
    answerable = kb + web + insufficient
    grounded_rate = round((kb + web) / answerable * 100, 1) if answerable else 0.0

    def rate(row: sqlite3.Row) -> float:
        a = int(row["answerable"] or 0)
        return (int(row["grounded"] or 0) / a * 100) if a else 0.0

    return {
        "total_queries": total,
        "kb_answers": kb,
        "web_answers": web,
        "insufficient": insufficient,
        "direct": int(totals["direct"] or 0),
        "errors": int(totals["errors"] or 0),
        "retries": int(totals["retries"] or 0),
        "avg_latency_ms": int(totals["avg_latency"] or 0),
        "grounded_rate": grounded_rate,
        "documents": int(docs["n"] or 0),
        "chunks": int(docs["chunks"] or 0),
        "deltas": {
            "total_queries": int(this_week["total"] or 0) - int(last_week["total"] or 0),
            "kb_answers": int(this_week["kb"] or 0) - int(last_week["kb"] or 0),
            "web_answers": int(this_week["web"] or 0) - int(last_week["web"] or 0),
            "grounded_rate": round(rate(this_week) - rate(last_week), 1),
            "total_queries_pct": _pct_change(int(this_week["total"] or 0), int(last_week["total"] or 0)),
        },
        "providers": [dict(r) for r in providers],
        "trend": trend,
    }
