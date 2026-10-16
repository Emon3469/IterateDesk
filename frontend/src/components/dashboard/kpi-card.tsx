import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/format";

export function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  invert = false,
  loading = false,
}: {
  label: string;
  value: string | number;
  delta?: number;
  deltaLabel?: string;
  invert?: boolean;
  loading?: boolean;
}) {
  const positive = (delta ?? 0) >= 0;
  const good = invert ? !positive : positive;
  return (
    <Card className="min-w-0 px-4 py-4 sm:px-5">
      <p className="text-[13px] text-fg-2">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-x-2.5 gap-y-1">
          <span className="text-[28px] font-normal sm:text-[34px] leading-none tracking-tight text-fg">{value}</span>
          {delta !== undefined && (
            <span className={cn("mb-1 inline-flex items-center gap-1 text-xs font-medium", good ? "text-green" : "text-red")}>
              <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", good ? "border-green" : "border-red")}>
                {positive ? <ArrowUp className="h-2.5 w-2.5" strokeWidth={3} /> : <ArrowDown className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              {deltaLabel}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
