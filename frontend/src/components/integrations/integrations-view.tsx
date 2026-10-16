"use client";

import { Activity, Brain, CheckCircle2, Database, Globe, Layers, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useBackend } from "@/components/providers";
import { Badge, Button, Card, CardHeader, IconButton, Skeleton } from "@/components/ui/primitives";
import { useAdminKey } from "@/hooks/use-admin-key";
import { checkProviders, type ProviderCheck, type ProviderStatus, type SystemStatus } from "@/lib/api";
import { formatMs, providerLabel } from "@/lib/format";

function LiveCheck({ onDone }: { onDone: () => void }) {
  const { key } = useAdminKey();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ProviderCheck[] | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true);
    setError("");
    try {
      const body = await checkProviders(key);
      setResults(body.results);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
            <Activity className="h-4 w-4" /> Live provider check
          </p>
          <p className="mt-0.5 text-xs text-muted">Sends a tiny prompt to every configured model right now.</p>
        </div>
        {key ? (
          <Button variant="secondary" onClick={run} disabled={running}>
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            Run live check
          </Button>
        ) : (
          <Link href="/settings" className="text-[13px] font-medium text-teal underline underline-offset-4">
            Add admin key to run
          </Link>
        )}
      </div>
      {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
      {results && (
        <ul className="mt-4 space-y-2">
          {results.map((r) => (
            <li key={r.name} className="flex items-start gap-2.5 text-[13px]">
              {r.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" />
              ) : (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red" />
              )}
              <div className="min-w-0">
                <p className="text-fg">
                  {providerLabel(r.name)} <span className="font-mono text-xs text-muted">{r.model}</span> · {formatMs(r.latency_ms)}
                </p>
                {!r.ok && <p className="line-clamp-2 text-xs text-red">{r.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProviderCard({ p }: { p: ProviderStatus }) {
  const tone = p.state === "ready" ? "green" : p.state === "cooldown" ? "amber" : "neutral";
  const label = p.state === "ready" ? "Ready" : p.state === "cooldown" ? "Cooling down" : "Not configured";
  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-fg shadow-card">
          <Brain className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-fg">{providerLabel(p.name)}</p>
          <p className="truncate font-mono text-[11.5px] text-muted">{p.model}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={tone}>{label}</Badge>
          {p.priority && <span className="text-[11px] text-muted">Priority #{p.priority}</span>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-surface px-2.5 py-1.5">
          <p className="text-muted">Calls</p>
          <p className="text-fg">{p.calls}</p>
        </div>
        <div className="rounded-lg bg-surface px-2.5 py-1.5">
          <p className="text-muted">Last latency</p>
          <p className="text-fg">{p.last_latency_ms ? formatMs(p.last_latency_ms) : "—"}</p>
        </div>
      </div>
      {p.last_error && p.state === "cooldown" && <p className="mt-3 line-clamp-2 text-[11.5px] text-amber">{p.last_error}</p>}
    </div>
  );
}

function InfraRow({ icon, name, detail, ok }: { icon: React.ReactNode; name: string; detail: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-fg-2">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-fg">{name}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <Badge tone={ok ? "green" : "red"}>{ok ? "Connected" : "Missing"}</Badge>
    </li>
  );
}

export function IntegrationsView() {
  const { state } = useBackend();
  const { data, mutate, isValidating } = useSWR<SystemStatus>(state === "online" ? "/api/system" : null, { refreshInterval: 15000 });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="p-5">
        <CardHeader
          title="Language Models"
          subtitle="Requests try providers in priority order and fall back automatically on errors, rate limits or timeouts."
          action={
            <IconButton aria-label="Refresh" onClick={() => mutate()}>
              <RefreshCw className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} />
            </IconButton>
          }
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {!data
            ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)
            : [...data.llm_providers]
                .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
                .map((p) => <ProviderCard key={p.name} p={p} />)}
        </div>
        <LiveCheck onDone={() => mutate()} />
      </Card>

      <Card className="p-5">
        <CardHeader title="Retrieval Stack" subtitle="Services behind the agentic workflow" />
        {!data ? (
          <Skeleton className="mt-4 h-56 w-full" />
        ) : (
          <ul className="mt-2 divide-y divide-border">
            <InfraRow
              icon={<Database className="h-4 w-4" />}
              name="Pinecone"
              detail={`${data.vector_store.index} · ${data.knowledge_base.vector_count} vectors`}
              ok={data.vector_store.configured && data.knowledge_base.status !== "degraded"}
            />
            <InfraRow icon={<Layers className="h-4 w-4" />} name="Embeddings" detail={`${data.embedding_model} (local, CPU)`} ok />
            <InfraRow icon={<Globe className="h-4 w-4" />} name="Tavily web search" detail="Fallback for gaps in the private KB" ok={data.web_search.configured} />
            <InfraRow
              icon={<Sparkles className="h-4 w-4" />}
              name="LangGraph workflow"
              detail={`top_k ${data.top_k} · ${data.max_retries} rewrite retry`}
              ok
            />
          </ul>
        )}
        {data?.knowledge_base.status === "degraded" && (
          <p className="mt-3 rounded-xl bg-red-soft px-3 py-2 text-xs text-red">{data.knowledge_base.detail}</p>
        )}
      </Card>
    </div>
  );
}
