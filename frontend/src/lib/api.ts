export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export type SourceUsed = "private_kb" | "web_search" | "insufficient_evidence" | "direct" | "";

export interface TraceStep {
  step: string;
  label: string;
  detail: string;
  status: "ok" | "error" | "warning" | "skipped";
  ms: number;
}

export interface Citation {
  title: string;
  url: string;
  type: "private_kb" | "web";
  score?: number;
  page?: number | null;
  snippet?: string;
  doc_id?: string;
}

export interface ChatResult {
  id: string;
  answer: string;
  source_used: SourceUsed;
  route: string;
  kb_grade: string;
  web_grade: string;
  retries: number;
  rewritten_query: string;
  citations: Citation[];
  trace: TraceStep[];
  provider: string;
  model: string;
  top_score: number | null;
  latency_ms: number;
}

export interface QueryRecord extends Omit<ChatResult, "id"> {
  id: string;
  created_at: string;
  question: string;
  status: "ok" | "error";
}

export interface DocumentRecord {
  id: string;
  name: string;
  file_type: string;
  size_bytes: number;
  chunks: number;
  origin: "sample" | "upload";
  created_at: string;
  updated_at: string;
  downloadable: boolean;
}

export interface TrendPoint {
  date: string;
  kb: number;
  web: number;
  insufficient: number;
  total: number;
}

export interface KnowledgeState {
  status: "starting" | "warming" | "ready" | "degraded";
  detail: string;
  vector_count: number;
}

export interface Stats {
  total_queries: number;
  kb_answers: number;
  web_answers: number;
  insufficient: number;
  direct: number;
  errors: number;
  retries: number;
  avg_latency_ms: number;
  grounded_rate: number;
  documents: number;
  chunks: number;
  deltas: {
    total_queries: number;
    kb_answers: number;
    web_answers: number;
    grounded_rate: number;
    total_queries_pct: number;
  };
  providers: { provider: string; n: number }[];
  trend: TrendPoint[];
  knowledge_base: KnowledgeState;
}

export interface ProviderStatus {
  name: string;
  model: string;
  configured: boolean;
  priority: number | null;
  state: "ready" | "cooldown" | "unconfigured";
  last_latency_ms: number;
  calls: number;
  last_error: string;
}

export interface SystemStatus {
  app_name: string;
  environment: string;
  knowledge_base: KnowledgeState;
  llm_providers: ProviderStatus[];
  embedding_model: string;
  vector_store: { provider: string; index: string; namespace: string; configured: boolean };
  web_search: { provider: string; configured: boolean };
  max_retries: number;
  top_k: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.detail) message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {}
  return new ApiError(message, res.status);
}

export async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function uploadDocument(file: File, adminKey: string): Promise<{ document: DocumentRecord }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}/api/ingest`, {
    method: "POST",
    headers: { "x-admin-key": adminKey },
    body,
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function deleteDocument(id: string, adminKey: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/documents/${id}`, {
    method: "DELETE",
    headers: { "x-admin-key": adminKey },
  });
  if (!res.ok) throw await parseError(res);
}

export interface ProviderCheck {
  name: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  reply: string;
  error: string;
}

export async function checkProviders(adminKey: string): Promise<{ healthy: number; total: number; results: ProviderCheck[] }> {
  const res = await fetch(`${API_URL}/api/system/check-providers`, {
    method: "POST",
    headers: { "x-admin-key": adminKey },
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export function downloadUrl(id: string) {
  return `${API_URL}/api/documents/${id}/download`;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onStep: (step: TraceStep) => void;
  onDone: (result: ChatResult) => void;
  onError: (message: string) => void;
}

export async function streamChat(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await parseError(res);
    handlers.onError(err.message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const dispatch = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    if (event === "token") handlers.onToken((payload as { text: string }).text);
    else if (event === "step") handlers.onStep(payload as TraceStep);
    else if (event === "done") {
      finished = true;
      handlers.onDone(payload as ChatResult);
    } else if (event === "error") {
      finished = true;
      handlers.onError((payload as { message: string }).message);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      dispatch(chunk);
    }
  }
  if (buffer.trim()) dispatch(buffer);
  if (!finished) handlers.onError("The connection closed before the answer finished.");
}
