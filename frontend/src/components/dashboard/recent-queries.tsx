"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, MessageSquareText, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, EmptyState, iconButtonClass, Skeleton } from "@/components/ui/primitives";
import type { QueryRecord } from "@/lib/api";
import { cn, formatDate, formatMs, providerLabel, sourceMeta } from "@/lib/format";

const DOT: Record<string, string> = {
  private_kb: "bg-teal",
  web_search: "bg-amber",
  insufficient_evidence: "bg-red",
  direct: "bg-muted-2",
  "": "bg-red",
};

type SortKey = "created_at" | "top_score" | "latency_ms";

function SortHead({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-fg">
      {children}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

export function OutcomeBadge({ q }: { q: QueryRecord }) {
  if (q.status === "error") return <Badge tone="red">Failed</Badge>;
  const m = sourceMeta(q.source_used);
  const label = q.source_used === "private_kb" ? "Grounded" : q.source_used === "web_search" ? "Web" : m.short;
  return <Badge tone={m.tone === "neutral" ? "neutral" : m.tone}>{label}</Badge>;
}

export function RecentQueries({ queries, loading }: { queries?: QueryRecord[]; loading?: boolean }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created_at", dir: -1 });

  const rows = useMemo(() => {
    const list = [...(queries ?? [])];
    list.sort((a, b) => {
      const av = (a[sort.key] ?? 0) as number | string;
      const bv = (b[sort.key] ?? 0) as number | string;
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });
    return list.slice(0, 6);
  }, [queries, sort]);

  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }));

  return (
    <Card className="p-5">
      <CardHeader
        title="Recent Queries"
        action={
          <Link href="/audit" aria-label="Open audit trail" className={cn(iconButtonClass, "-mr-1 -mt-1")}>
            <MoreHorizontal className="h-5 w-5" />
          </Link>
        }
      />
      <div className="scrollbar-thin -mx-5 mt-3 overflow-x-auto px-5">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="py-2.5 pr-3 font-normal">Question</th>
              <th className="py-2.5 pr-3 font-normal">Source</th>
              <th className="py-2.5 pr-3 font-normal">
                <SortHead onClick={() => toggle("created_at")}>Date</SortHead>
              </th>
              <th className="py-2.5 pr-3 font-normal">
                <SortHead onClick={() => toggle("top_score")}>Relevance</SortHead>
              </th>
              <th className="py-2.5 pr-3 font-normal">
                <SortHead onClick={() => toggle("latency_ms")}>Latency</SortHead>
              </th>
              <th className="py-2.5 pr-3 font-normal">Model</th>
              <th className="py-2.5 font-normal">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-border">
                    <td colSpan={7} className="py-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              : rows.map((q) => {
                  const m = sourceMeta(q.source_used);
                  return (
                    <tr
                      key={q.id}
                      onClick={() => router.push(`/audit?id=${q.id}`)}
                      className="cursor-pointer border-b border-border transition last:border-0 hover:bg-surface-2"
                    >
                      <td className="max-w-[240px] py-3.5 pr-3">
                        <p className="truncate text-fg" title={q.question}>
                          {q.question}
                        </p>
                      </td>
                      <td className="whitespace-nowrap py-3.5 pr-3 text-fg-2">
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${DOT[q.source_used] ?? "bg-muted-2"}`} />
                          {q.status === "error" ? "—" : m.short}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-3.5 pr-3 text-fg-2">{formatDate(q.created_at)}</td>
                      <td className="whitespace-nowrap py-3.5 pr-3 text-fg-2">
                        {q.top_score != null ? `${Math.round(q.top_score * 100)} %` : "-"}
                      </td>
                      <td className="whitespace-nowrap py-3.5 pr-3 text-fg-2">{formatMs(q.latency_ms)}</td>
                      <td className="whitespace-nowrap py-3.5 pr-3 text-fg-2">{q.provider ? providerLabel(q.provider) : "-"}</td>
                      <td className="py-3.5">
                        <OutcomeBadge q={q} />
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && !rows.length && (
          <EmptyState
            icon={<MessageSquareText className="h-5 w-5" />}
            title="No queries recorded yet"
            hint="Every question answered by the copilot is logged here with its decision path."
          />
        )}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Last query: {queries?.[0] ? formatDate(queries[0].created_at, true) : "—"}
      </p>
    </Card>
  );
}
