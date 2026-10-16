"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { useBackend } from "@/components/providers";
import { Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import type { Stats } from "@/lib/api";
import { formatMs, providerLabel } from "@/lib/format";

const SLICES = [
  { key: "kb_answers", label: "Private KB", color: "var(--teal)" },
  { key: "web_answers", label: "Web fallback", color: "var(--amber)" },
  { key: "insufficient", label: "Escalated", color: "var(--red)" },
  { key: "direct", label: "Direct reply", color: "var(--muted-2)" },
] as const;

export function AnalyticsView() {
  const { state } = useBackend();
  const { data: stats } = useSWR<Stats>(state === "online" ? "/api/stats?days=30" : null, { refreshInterval: 30000 });

  const pie = SLICES.map((s) => ({ name: s.label, value: stats?.[s.key] ?? 0, color: s.color }));
  const pieTotal = pie.reduce((a, b) => a + b.value, 0);
  const providerTotal = (stats?.providers ?? []).reduce((a, b) => a + b.n, 0);
  const volume = (stats?.trend ?? []).slice(-14).map((p) => ({
    label: new Date(`${p.date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    total: p.total,
  }));

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Avg. Response Time" value={formatMs(stats?.avg_latency_ms ?? 0)} loading={!stats} />
        <KpiCard label="Grounded Rate" value={`${Math.round(stats?.grounded_rate ?? 0)}%`} loading={!stats} />
        <KpiCard label="Escalations" value={stats?.insufficient ?? 0} loading={!stats} />
        <KpiCard label="Query Rewrites" value={stats?.retries ?? 0} loading={!stats} />
      </div>

      <TrendChart trend={stats?.trend} loading={!stats} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <CardHeader title="Answer Sources" subtitle="Where answers were grounded" />
          {!stats ? (
            <Skeleton className="mt-4 h-48 w-full" />
          ) : (
            <div className="mt-2 flex items-center gap-4">
              <div className="relative h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieTotal ? pie : [{ name: "None", value: 1, color: "var(--surface-3)" }]}
                      dataKey="value"
                      innerRadius={52}
                      outerRadius={74}
                      paddingAngle={pieTotal ? 2 : 0}
                      stroke="none"
                    >
                      {(pieTotal ? pie : [{ color: "var(--surface-3)" }]).map((s, i) => (
                        <Cell key={i} fill={s.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl text-fg">{pieTotal}</span>
                  <span className="text-[11px] text-muted">answers</span>
                </div>
              </div>
              <ul className="flex-1 space-y-2.5">
                {pie.map((s) => (
                  <li key={s.name} className="flex items-center gap-2 text-[13px]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-fg-2">{s.name}</span>
                    <span className="ml-auto text-fg">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader title="Model Usage" subtitle="Automatic provider fallback" />
          <ul className="mt-5 space-y-4">
            {!stats ? (
              <Skeleton className="h-24 w-full" />
            ) : stats.providers.length ? (
              stats.providers.map((p) => {
                const pct = providerTotal ? Math.round((p.n / providerTotal) * 100) : 0;
                return (
                  <li key={p.provider}>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-fg">{providerLabel(p.provider)}</span>
                      <span className="text-muted">
                        {p.n} · {pct}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })
            ) : (
              <p className="text-sm text-muted">No model calls recorded yet.</p>
            )}
          </ul>
        </Card>

        <Card className="p-5">
          <CardHeader title="Daily Volume" subtitle="Last 14 days" />
          <div className="mt-4 h-44">
            {!stats ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volume} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border-strong)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-2)", fontSize: 10 }} minTickGap={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-2)", fontSize: 10 }} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-3)" }}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "var(--muted)" }}
                    itemStyle={{ color: "var(--fg)" }}
                  />
                  <Bar dataKey="total" name="Queries" fill="var(--fg)" radius={[6, 6, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
