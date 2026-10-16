import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetcher, streamChat, type ChatResult, type TraceStep } from "@/lib/api";

function sseResponse(chunks: string[], init: ResponseInit = { status: 200 }) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { ...init, headers: { "Content-Type": "text/event-stream" } });
}

function collect() {
  const tokens: string[] = [];
  const steps: TraceStep[] = [];
  const done: ChatResult[] = [];
  const errors: string[] = [];
  return {
    tokens,
    steps,
    done,
    errors,
    handlers: {
      onToken: (t: string) => tokens.push(t),
      onStep: (s: TraceStep) => steps.push(s),
      onDone: (r: ChatResult) => done.push(r),
      onError: (m: string) => errors.push(m),
    },
  };
}

const step = { step: "router", label: "Router", detail: "KB", status: "ok", ms: 12 };
const result = { id: "q1", answer: "Hello world", source_used: "private_kb", citations: [], trace: [step] };

afterEach(() => vi.unstubAllGlobals());

describe("streamChat", () => {
  it("parses steps, tokens and the final result in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": connected\n\n",
          `event: step\ndata: ${JSON.stringify(step)}\n\n`,
          `event: token\ndata: {"text": "Hello "}\n\n`,
          `event: token\ndata: {"text": "world"}\n\n`,
          `event: done\ndata: ${JSON.stringify(result)}\n\n`,
        ]),
      ),
    );
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.steps).toEqual([step]);
    expect(c.tokens.join("")).toBe("Hello world");
    expect(c.done[0].id).toBe("q1");
    expect(c.errors).toEqual([]);
  });

  it("handles events split across network chunks and CRLF line endings", async () => {
    const raw = `event: token\r\ndata: {"text": "Hi"}\r\n\r\nevent: done\r\ndata: ${JSON.stringify(result)}\r\n\r\n`;
    const pieces = Array.from({ length: Math.ceil(raw.length / 7) }, (_, i) => raw.slice(i * 7, i * 7 + 7));
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(pieces)));
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.tokens).toEqual(["Hi"]);
    expect(c.done).toHaveLength(1);
  });

  it("keeps multi-byte characters intact when split mid-character", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(`event: token\ndata: {"text": "café 🚀"}\n\nevent: done\ndata: ${JSON.stringify(result)}\n\n`);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.tokens).toEqual(["café 🚀"]);
  });

  it("surfaces server error events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([`event: error\ndata: {"message": "All providers down"}\n\n`])),
    );
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.errors).toEqual(["All providers down"]);
    expect(c.done).toEqual([]);
  });

  it("reports a connection that closes before the answer finishes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([`event: token\ndata: {"text": "Hal"}\n\n`])));
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.tokens).toEqual(["Hal"]);
    expect(c.errors[0]).toMatch(/closed/);
  });

  it("uses the API detail message for HTTP errors such as rate limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "Too many questions" }), { status: 429 })),
    );
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.errors).toEqual(["Too many questions"]);
  });

  it("ignores malformed data lines without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([`event: token\ndata: {broken\n\n`, `event: done\ndata: ${JSON.stringify(result)}\n\n`]),
      ),
    );
    const c = collect();
    await streamChat("hi", [], c.handlers);
    expect(c.tokens).toEqual([]);
    expect(c.done).toHaveLength(1);
  });

  it("sends question and history as JSON", async () => {
    const fetchMock = vi.fn(async () => sseResponse([`event: done\ndata: ${JSON.stringify(result)}\n\n`]));
    vi.stubGlobal("fetch", fetchMock);
    await streamChat("next?", [{ role: "user", content: "vpn" }], collect().handlers);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/chat\/stream$/);
    expect(JSON.parse(init.body as string)).toEqual({ question: "next?", history: [{ role: "user", content: "vpn" }] });
  });
});

describe("fetcher", () => {
  it("throws ApiError with status and detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Not found" }), { status: 404 })));
    await expect(fetcher("/api/queries/x")).rejects.toMatchObject({ status: 404, message: "Not found" });
    await expect(fetcher("/api/queries/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad Gateway", { status: 502 })));
    await expect(fetcher("/api/stats")).rejects.toThrow("Request failed (502)");
  });
});
