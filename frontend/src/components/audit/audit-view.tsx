"use client";

import { ExternalLink, FileText, Globe, ScrollText, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Markdown } from "@/components/chat/markdown";
import { TraceList } from "@/components/chat/trace";
import { OutcomeBadge } from "@/components/dashboard/recent-queries";
import { useBackend } from "@/components/providers";
import { Card, EmptyState, IconButton, Skeleton } from "@/components/ui/primitives";
import type { QueryRecord } from "@/lib/api";
import { cn, formatDate, formatMs, providerLabel } from "@/lib/format";

const FILTERS = [
  { key: "", label: "All" },
  { key: "private_kb", label: "Private KB" },
  { key: "web_search", label: "Web" },
  { key: "insufficient_evidence", label: "Escalated" },
  { key: "direct", label: "Direct" },
];

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useSWR<QueryRecord>(`/api/queries/${id}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="fade-up relative flex h-full w-full max-w-xl flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs text-muted">Query {id}</p>
            <p className="text-[15px] font-medium text-fg">Decision record</p>
          </div>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {error ? (
            <p className="text-sm text-red">This record could not be loaded.</p>
          ) : !data ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted">Question</p>
                <p className="mt-1 text-[15px] text-fg">{data.question}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <OutcomeBadge q={data} />
                  <span>{formatDate(data.created_at, true)}</span>
                  <span>· {formatMs(data.latency_ms)}</span>
                  {data.provider && (
                    <span>
                      · {providerLabel(data.provider)} ({data.model})
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["KB grade", data.kb_grade || "—"],
                  ["Web grade", data.web_grade || "—"],
                  ["Rewrites", String(data.retries ?? 0)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
                    <p className="text-[11px] text-muted">{k}</p>
                    <p className="text-sm uppercase text-fg">{v}</p>
                  </div>
                ))}
              </div>
              {data.rewritten_query && data.rewritten_query !== data.question && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">Search query used</p>
                  <p className="mt-1 text-[13px] text-fg-2">{data.rewritten_query}</p>
                </div>
              )}
              {data.answer && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">Answer</p>
                  <div className="mt-2 rounded-xl border border-border p-3.5">
                    <Markdown content={data.answer} citations={data.citations} />
                  </div>
                </div>
              )}
              {data.citations?.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">Evidence</p>
                  <ul className="mt-2 space-y-2">
                    {data.citations.map((c, i) => (
                      <li key={i} className="rounded-xl border border-border p-3">
                        <div className="flex items-center gap-2 text-[13px] text-fg">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-soft text-[10px] font-semibold text-teal">
                            {i + 1}
                          </span>
                          {c.type === "web" ? <Globe className="h-3.5 w-3.5 text-muted" /> : <FileText className="h-3.5 w-3.5 text-muted" />}
                          <span className="truncate">{c.title}</span>
                          {typeof c.score === "number" && <span className="ml-auto text-xs text-muted">{Math.round(c.score * 100)}%</span>}
                          {c.url && (
                            <a href={c.url} target="_blank" rel="noreferrer" className="text-muted hover:text-fg" aria-label="Open source">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                        {c.snippet && <p className="mt-1.5 line-clamp-3 text-xs text-muted">{c.snippet}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.trace?.length > 0 && (
                <div>
                  <p className="mb-3 text-xs uppercase tracking-wider text-muted">Decision trace</p>
                  <TraceList steps={data.trace} />
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export function AuditView() {
  const { state } = useBackend();
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const selected = picked ?? (dismissed ? null : searchParams.get("id"));
  const q = useDebounced(search);
  const params = new URLSearchParams({ limit: "100" });
  if (source) params.set("source", source);
  if (q) params.set("q", q);
  const { data } = useSWR<QueryRecord[]>(state === "online" ? `/api/queries?${params}` : null, { refreshInterval: 20000 });

  const close = () => {
    setPicked(null);
    setDismissed(true);
    if (searchParams.get("id")) router.replace("/audit", { scroll: false });
  };

  return (
    <div className="p-4 sm:p-6">
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setSource(f.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  source === f.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 sm:max-w-[260px]">
            <Search className="h-4 w-4 text-muted-2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
            />
          </label>
        </div>

        <div className="scrollbar-thin -mx-5 mt-4 overflow-x-auto px-5">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2.5 pr-3 font-normal">Time</th>
                <th className="py-2.5 pr-3 font-normal">Question</th>
                <th className="py-2.5 pr-3 font-normal">Path</th>
                <th className="py-2.5 pr-3 font-normal">Model</th>
                <th className="py-2.5 pr-3 font-normal">Latency</th>
                <th className="py-2.5 font-normal">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {!data
                ? [0, 1, 2, 3, 4].map((i) => (
                    <tr key={i}>
                      <td colSpan={6} className="py-3">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                : data.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setPicked(row.id)}
                      className="cursor-pointer border-b border-border transition last:border-0 hover:bg-surface-2"
                    >
                      <td className="whitespace-nowrap py-3 pr-3 text-fg-2">{formatDate(row.created_at, true)}</td>
                      <td className="max-w-[320px] py-3 pr-3">
                        <p className="truncate text-fg">{row.question}</p>
                      </td>
                      <td className="py-3 pr-3 text-xs text-muted">
                        <span className="line-clamp-1">{row.trace.map((t) => t.label.split(" ")[0]).join(" → ") || "—"}</span>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-fg-2">{row.provider ? providerLabel(row.provider) : "—"}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-fg-2">{formatMs(row.latency_ms)}</td>
                      <td className="py-3">
                        <OutcomeBadge q={row} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {data && !data.length && (
            <EmptyState
              icon={<ScrollText className="h-5 w-5" />}
              title="No matching records"
              hint="Every copilot answer is logged with its route, evidence grades, sources and latency."
            />
          )}
        </div>
      </Card>
      {selected && <Detail id={selected} onClose={close} />}
    </div>
  );
}
