"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import type { TrendPoint } from "@/lib/api";
import { cn } from "@/lib/format";

const RANGES = [7, 14, 30] as const;

interface ChartRow {
  label: string;
  kb: number;
  web: number;
  total: number;
  grounded: number;
}

function ChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ChartRow;
  return (
    <div className="rounded-lg border border-red/40 bg-surface px-2.5 py-1 text-xs font-medium text-red shadow-sm">
      {row.total ? `Grounded: ${row.grounded}% · ${row.total} queries` : "No queries"}
    </div>
  );
}

function ColumnCursor(props: { x?: number; y?: number; width?: number; height?: number; points?: { x: number }[] }) {
  const { points, y = 0, height = 0 } = props;
  if (!points?.length) return null;
  const w = 26;
  const x = points[0].x - w / 2;
  return (
    <g>
      <defs>
        <linearGradient id="cursorFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.02} />
          <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.22} />
        </linearGradient>
      </defs>
      <rect x={x} y={y + height * 0.45} width={w} height={height * 0.55} rx={13} fill="url(#cursorFill)" />
    </g>
  );
}

export function TrendChart({ trend, loading }: { trend?: TrendPoint[]; loading?: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);

  const data: ChartRow[] = useMemo(() => {
    const slice = (trend ?? []).slice(-range);
    return slice.map((p) => {
      const d = new Date(`${p.date}T00:00:00`);
      const answerable = p.kb + p.web + p.insufficient;
      return {
        label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        kb: p.kb,
        web: p.web,
        total: p.total,
        grounded: answerable ? Math.round(((p.kb + p.web) / answerable) * 100) : 0,
      };
    });
  }, [trend, range]);

  return (
    <Card className="p-5">
      <CardHeader
        title="Evidence Trend"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full border border-teal/50 px-2.5 py-0.5 text-[11px] font-medium text-teal">Private KB answers</span>
            <span className="rounded-full border border-red/50 px-2.5 py-0.5 text-[11px] font-medium text-red">Web fallbacks</span>
            <div className="ml-1 flex rounded-lg border border-border bg-surface-2 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium transition",
                    range === r ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>
          </div>
        }
      />
      <div className="relative mt-4 h-[200px] w-full">
        {!loading && data.every((d) => d.total === 0) && (
          <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-xs text-muted">
            No questions in this period yet
          </p>
        )}
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border-strong)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={18}
                dy={8}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                width={40}
              />
              <Tooltip content={<ChartTooltip />} cursor={<ColumnCursor />} />
              <Line
                type="monotone"
                dataKey="kb"
                stroke="var(--teal)"
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 5, fill: "var(--surface)", stroke: "var(--teal)", strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="web"
                stroke="var(--red)"
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 5, fill: "var(--surface)", stroke: "var(--red)", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
