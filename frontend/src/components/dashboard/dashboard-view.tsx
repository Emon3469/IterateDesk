"use client";

import useSWR from "swr";
import { useBackend } from "@/components/providers";
import type { DocumentRecord, QueryRecord, Stats } from "@/lib/api";
import { KpiCard } from "./kpi-card";
import { RecentQueries } from "./recent-queries";
import { DocumentsCard, KnowledgeStatusCard, LastAnswerCard } from "./side-cards";
import { TrendChart } from "./trend-chart";

function signed(n: number, suffix = "") {
  return `${n >= 0 ? "+" : ""}${n}${suffix}`;
}

export function DashboardView() {
  const { state } = useBackend();
  const online = state === "online";
  const { data: stats } = useSWR<Stats>(online ? "/api/stats?days=30" : null, { refreshInterval: 20000 });
  const { data: docs } = useSWR<DocumentRecord[]>(online ? "/api/documents" : null, { refreshInterval: 30000 });
  const { data: queries } = useSWR<QueryRecord[]>(online ? "/api/queries?limit=20" : null, { refreshInterval: 15000 });

  const loadingStats = !stats;
  const lastAnswered = queries?.find((q) => q.status === "ok");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="order-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:order-1 xl:grid-cols-1 xl:content-start">
        <KnowledgeStatusCard docs={docs} kb={stats?.knowledge_base} loading={!docs} />
        <LastAnswerCard query={lastAnswered} loading={!queries} />
        <div className="md:col-span-2 xl:col-span-1">
          <DocumentsCard docs={docs} loading={!docs} />
        </div>
      </div>

      <div className="order-1 flex min-w-0 flex-col gap-4 xl:order-2">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard
            label="Queries Handled"
            value={stats?.total_queries ?? 0}
            delta={stats?.deltas.total_queries}
            deltaLabel={stats ? `${signed(stats.deltas.total_queries)} this week` : ""}
            loading={loadingStats}
          />
          <KpiCard
            label="Answered from KB"
            value={stats?.kb_answers ?? 0}
            delta={stats?.deltas.kb_answers}
            deltaLabel={stats ? `${signed(stats.deltas.kb_answers)} this week` : ""}
            loading={loadingStats}
          />
          <KpiCard
            label="Web Fallbacks"
            value={stats?.web_answers ?? 0}
            delta={stats?.deltas.web_answers}
            deltaLabel={stats ? `${signed(stats.deltas.web_answers)} this week` : ""}
            invert
            loading={loadingStats}
          />
          <KpiCard
            label="Grounded Rate"
            value={`${Math.round(stats?.grounded_rate ?? 0)}%`}
            delta={stats?.deltas.grounded_rate}
            deltaLabel={stats ? signed(stats.deltas.grounded_rate, "%") : ""}
            loading={loadingStats}
          />
        </div>
        <TrendChart trend={stats?.trend} loading={loadingStats} />
        <RecentQueries queries={queries} loading={!queries} />
      </div>
    </div>
  );
}
