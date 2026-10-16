"use client";

import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Database,
  Globe,
  Loader2,
  PenLine,
  ScanSearch,
  Sparkles,
  Split,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { TraceStep } from "@/lib/api";
import { cn, formatMs } from "@/lib/format";

const STEP_ICON: Record<string, LucideIcon> = {
  router: Split,
  retrieve: Database,
  grade_kb: ScanSearch,
  web_search: Globe,
  grade_web: ScanSearch,
  rewrite: PenLine,
  generate: Sparkles,
  stop: CircleSlash,
};

function tone(step: TraceStep) {
  if (step.status === "error") return "text-red";
  if (step.status === "warning") return "text-amber";
  if (step.status === "skipped") return "text-muted-2";
  if (/WEAK/.test(step.detail)) return "text-amber";
  if (/GOOD/.test(step.detail)) return "text-green";
  return "text-teal";
}

export function TraceList({ steps, running = false, compact = false }: { steps: TraceStep[]; running?: boolean; compact?: boolean }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.step] ?? CheckCircle2;
        const last = i === steps.length - 1 && !running;
        return (
          <li key={`${s.step}-${i}`} className="fade-up relative flex gap-3 pb-3">
            {!last && <span className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-px bg-border-strong" />}
            <span className={cn("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface", tone(s))}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[12.5px] font-medium text-fg">{s.label}</p>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-2">{formatMs(s.ms)}</span>
              </div>
              <p className={cn("text-xs text-muted", compact ? "line-clamp-1" : "break-words")}>{s.detail}</p>
            </div>
          </li>
        );
      })}
      {running && (
        <li className="relative flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-teal">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
          <p className="pt-1 text-xs text-muted">Working…</p>
        </li>
      )}
    </ol>
  );
}

const STAGES = [
  { key: "router", label: "Route request", hint: "LangGraph decides KB vs direct reply" },
  { key: "retrieve", label: "Private KB retrieval", hint: "Pinecone semantic search" },
  { key: "grade_kb", label: "Grade KB evidence", hint: "Is the private evidence sufficient?" },
  { key: "web_search", label: "Web fallback", hint: "Tavily search when KB is weak" },
  { key: "grade_web", label: "Grade web evidence", hint: "Validate external evidence" },
  { key: "rewrite", label: "Rewrite & retry", hint: "Sharpen the query and loop" },
  { key: "generate", label: "Grounded answer", hint: "Stream the response with citations" },
];

export function WorkflowStages({ steps, running, interrupted = false }: { steps: TraceStep[]; running: boolean; interrupted?: boolean }) {
  const seen = new Map<string, TraceStep>();
  steps.forEach((s) => seen.set(s.step === "stop" ? "generate" : s.step, s));
  const lastKey = steps.length ? (steps[steps.length - 1].step === "stop" ? "generate" : steps[steps.length - 1].step) : "";
  const finished = !running && steps.length > 0;

  return (
    <ol className="space-y-2">
      {STAGES.map((stage) => {
        const hit = seen.get(stage.key);
        const isLast = stage.key === lastKey;
        const skipped = finished && !hit;
        const escalated = hit?.step === "stop";
        return (
          <li
            key={stage.key}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition",
              hit ? "border-border bg-surface" : "border-dashed border-border bg-transparent",
              isLast && running && "border-teal/50 ring-2 ring-[var(--ring)]",
            )}
          >
            <span className="mt-0.5">
              {hit ? (
                escalated ? (
                  <TriangleAlert className="h-4 w-4 text-amber" />
                ) : (
                  <CheckCircle2 className={cn("h-4 w-4", hit.status === "error" ? "text-red" : "text-green")} />
                )
              ) : skipped ? (
                <CircleSlash className="h-4 w-4 text-muted-2" />
              ) : (
                <CircleDashed className="h-4 w-4 text-muted-2" />
              )}
            </span>
            <div className="min-w-0">
              <p className={cn("text-[13px]", hit ? "font-medium text-fg" : "text-muted")}>{escalated ? "Escalated" : stage.label}</p>
              <p className="line-clamp-2 text-[11.5px] text-muted">{hit ? hit.detail : skipped ? (interrupted ? "Not reached" : "Not needed") : stage.hint}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
