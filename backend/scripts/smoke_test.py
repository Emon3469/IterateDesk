import argparse
import asyncio
import json
import sys
import time

import httpx

GREEN, RED, YELLOW, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[0m"


class Report:
    def __init__(self):
        self.failures = 0

    def ok(self, name, detail=""):
        print(f"{GREEN}PASS{RESET} {name} {detail}")

    def fail(self, name, detail=""):
        self.failures += 1
        print(f"{RED}FAIL{RESET} {name} {detail}")

    def warn(self, name, detail=""):
        print(f"{YELLOW}WARN{RESET} {name} {detail}")

    def check(self, condition, name, detail=""):
        (self.ok if condition else self.fail)(name, detail)
        return condition


async def stream_chat(client, base, question, history=None):
    started = time.perf_counter()
    first_token = None
    events = []
    async with client.stream(
        "POST", f"{base}/api/chat/stream", json={"question": question, "history": history or []}, timeout=120
    ) as res:
        if res.status_code != 200:
            return {"status": res.status_code, "events": [], "first_token_ms": None, "total_ms": 0}
        buffer = ""
        async for chunk in res.aiter_text():
            buffer += chunk
            while "\n\n" in buffer:
                block, buffer = buffer.split("\n\n", 1)
                name = data = None
                for line in block.splitlines():
                    if line.startswith("event:"):
                        name = line[6:].strip()
                    elif line.startswith("data:"):
                        data = json.loads(line[5:].strip())
                if name:
                    if name == "token" and first_token is None:
                        first_token = int((time.perf_counter() - started) * 1000)
                    events.append((name, data))
    return {
        "status": 200,
        "events": events,
        "first_token_ms": first_token,
        "total_ms": int((time.perf_counter() - started) * 1000),
    }


async def main(base: str, origin: str, admin_key: str, concurrency: int) -> int:
    r = Report()
    base = base.rstrip("/")
    async with httpx.AsyncClient(timeout=60) as client:
        for attempt in range(30):
            try:
                health = (await client.get(f"{base}/api/health")).json()
                if health.get("knowledge_base") == "ready":
                    break
            except httpx.HTTPError:
                health = {}
            await asyncio.sleep(4)
        r.check(health.get("status") == "ok", "health", json.dumps(health))
        r.check(health.get("knowledge_base") == "ready", "knowledge base ready")

        system = (await client.get(f"{base}/api/system")).json()
        configured = [p["name"] for p in system["llm_providers"] if p["configured"]]
        r.check(bool(configured), "llm providers configured", ", ".join(configured))
        r.check(system["vector_store"]["configured"], "pinecone configured")
        r.check(system["web_search"]["configured"], "tavily configured")
        r.check(system["knowledge_base"]["vector_count"] > 0, "vectors indexed", str(system["knowledge_base"]["vector_count"]))

        if admin_key:
            res = await client.post(f"{base}/api/system/check-providers", headers={"x-admin-key": admin_key}, timeout=90)
            if r.check(res.status_code == 200, "provider check endpoint"):
                body = res.json()
                for row in body["results"]:
                    line = f"{row['name']} ({row['model']}) {row['latency_ms']}ms {row['error'][:120]}"
                    (r.ok if row["ok"] else r.warn)(f"provider {row['name']}", line)
                r.check(body["healthy"] >= 1, "at least one provider answering", f"{body['healthy']}/{body['total']}")

        docs = (await client.get(f"{base}/api/documents")).json()
        r.check(len(docs) > 0, "documents listed", ", ".join(d["name"] for d in docs))
        r.check(all("path" not in d for d in docs), "server paths hidden")

        scenarios = [
            ("How do I connect to the company VPN from home?", {"private_kb"}),
            ("What is the latest Microsoft Teams outage guidance?", {"web_search", "insufficient_evidence", "private_kb"}),
            ("hello", {"direct"}),
        ]
        for question, expected in scenarios:
            result = await stream_chat(client, base, question)
            names = [e[0] for e in result["events"]]
            done = next((d for n, d in result["events"] if n == "done"), None)
            error = next((d for n, d in result["events"] if n == "error"), None)
            if not r.check(done is not None, f"stream: {question[:40]}", f"error={error}" if error else ""):
                continue
            tokens = "".join(d["text"] for n, d in result["events"] if n == "token")
            r.check(tokens.strip() == done["answer"].strip() and len(tokens) > 0, "  streamed tokens match final answer")
            r.check(names.index("token") > names.index("step"), "  steps arrive before tokens")
            r.check(done["source_used"] in expected, "  route", f"{done['source_used']} via {done['provider']}/{done['model']}")
            r.check(
                done["source_used"] == "direct" or bool(done["citations"]) or done["source_used"] == "insufficient_evidence",
                "  citations returned",
                str(len(done["citations"])),
            )
            r.ok("  latency", f"first token {result['first_token_ms']}ms · total {result['total_ms']}ms")

        follow = await stream_chat(
            client,
            base,
            "and what if my MFA prompt never arrives?",
            [
                {"role": "user", "content": "How do I connect to the VPN?"},
                {"role": "assistant", "content": "Install the NovaSecure VPN client and approve MFA."},
            ],
        )
        done = next((d for n, d in follow["events"] if n == "done"), None)
        r.check(done is not None and "mfa" in done["rewritten_query"].lower(), "follow-up rewritten with context",
                done["rewritten_query"] if done else "")

        started = time.perf_counter()
        results = await asyncio.gather(
            *(stream_chat(client, base, q) for q in
              ["How do I reset my password?", "What is the MFA policy?", "My laptop is slow", "How do I request software?",
               "How do I connect to the VPN?", "Who do I contact for a broken monitor?"][:concurrency])
        )
        completed = sum(1 for x in results if any(n == "done" for n, _ in x["events"]))
        r.check(completed == len(results), f"{len(results)} concurrent users", f"{completed} completed in {int((time.perf_counter()-started)*1000)}ms")

        res = await client.post(f"{base}/api/chat", json={"question": ""})
        r.check(res.status_code == 422, "empty question rejected")
        res = await client.post(f"{base}/api/ingest", files={"file": ("x.md", b"# x", "text/markdown")})
        r.check(res.status_code == 401, "upload without admin key rejected")
        res = await client.delete(f"{base}/api/documents/anything")
        r.check(res.status_code == 401, "delete without admin key rejected")

        pre = await client.options(
            f"{base}/api/chat/stream",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
        )
        r.check(pre.headers.get("access-control-allow-origin") == origin, "CORS allows frontend", origin)
        evil = await client.options(
            f"{base}/api/chat/stream",
            headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"},
        )
        r.check(evil.headers.get("access-control-allow-origin") is None, "CORS blocks unknown origins")

        stats = (await client.get(f"{base}/api/stats")).json()
        r.check(stats["total_queries"] >= 4, "queries audited", str(stats["total_queries"]))

    print()
    print(f"{RED if r.failures else GREEN}{r.failures} failure(s){RESET}")
    return 1 if r.failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="End-to-end smoke test for a running IterateDesk API")
    parser.add_argument("base_url", nargs="?", default="http://localhost:8080")
    parser.add_argument("--origin", default="http://localhost:3000")
    parser.add_argument("--admin-key", default="")
    parser.add_argument("--concurrency", type=int, default=5)
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.base_url, args.origin, args.admin_key, args.concurrency)))
