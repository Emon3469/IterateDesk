"use client";

import { Check, ChevronDown, Copy, ExternalLink, FileText, Globe, RotateCcw, TriangleAlert } from "lucide-react";
import { memo, useState } from "react";
import { LogoMark } from "@/components/layout/logo";
import { Badge } from "@/components/ui/primitives";
import type { ChatMessage } from "@/hooks/use-chats";
import { cn, formatMs, providerLabel, sourceMeta } from "@/lib/format";
import { Markdown } from "./markdown";
import { TraceList } from "./trace";

function Sources({ message }: { message: ChatMessage }) {
  const citations = message.result?.citations ?? [];
  if (!citations.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {citations.map((c, i) => {
        const inner = (
          <>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-teal-soft text-[10px] font-semibold text-teal">{i + 1}</span>
            {c.type === "web" ? <Globe className="h-3.5 w-3.5 text-muted" /> : <FileText className="h-3.5 w-3.5 text-muted" />}
            <span className="min-w-0 max-w-[220px] truncate">{c.title}</span>
            {c.page ? <span className="text-muted">p.{c.page}</span> : null}
            {typeof c.score === "number" && c.type === "private_kb" ? (
              <span className="text-muted">{Math.round(c.score * 100)}%</span>
            ) : null}
            {c.url ? <ExternalLink className="h-3 w-3 text-muted" /> : null}
          </>
        );
        const cls =
          "inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg-2 transition hover:border-border-strong";
        return c.url ? (
          <a key={i} href={c.url} target="_blank" rel="noreferrer" className={cls} title={c.snippet}>
            {inner}
          </a>
        ) : (
          <span key={i} className={cls} title={c.snippet}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

function AssistantMeta({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const r = message.result;
  const steps = message.steps ?? [];
  const meta = r ? sourceMeta(r.source_used) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {meta && <Badge tone={meta.tone === "neutral" ? "neutral" : meta.tone}>{meta.label}</Badge>}
        {r?.provider && (
          <span>
            {providerLabel(r.provider)} · {r.model}
          </span>
        )}
        {r && <span>· {formatMs(r.latency_ms)}</span>}
        {r?.retries ? <span>· {r.retries} rewrite</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {steps.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-surface-3 hover:text-fg"
            >
              Decision trace
              <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
            </button>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} className="rounded-md p-1 hover:bg-surface-3 hover:text-fg" aria-label="Ask again" title="Ask again">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={copy} className="rounded-md p-1 hover:bg-surface-3 hover:text-fg" aria-label="Copy answer" title="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-green" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="fade-up mt-3 rounded-xl border border-border bg-surface-2 p-3">
          <TraceList steps={steps} />
          {r?.rewritten_query && r.rewritten_query !== "" && (
            <p className="mt-1 border-t border-border pt-2 text-[11.5px] text-muted">
              Search query: <span className="text-fg-2">{r.rewritten_query}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="fade-up flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-primary-fg">
          {message.content}
        </div>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  const steps = message.steps ?? [];
  const waiting = streaming && !message.content;

  return (
    <div className="fade-up flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar text-white">
        <LogoMark className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {waiting && (
          <div className="rounded-2xl border border-border bg-surface p-3.5">
            <TraceList steps={steps} running compact />
          </div>
        )}
        {message.content && (
          <div className={cn(streaming && "caret")}>
            <Markdown content={message.content} citations={message.result?.citations} />
          </div>
        )}
        {message.status === "error" && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-red/30 bg-red-soft px-3 py-2.5 text-[13px] text-red">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{message.error || "Something went wrong."}</div>
            {onRetry && (
              <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
                Retry
              </button>
            )}
          </div>
        )}
        {message.status === "stopped" && <p className="mt-2 text-xs text-muted">Response stopped.</p>}
        {!streaming && message.status !== "error" && <Sources message={message} />}
        {!streaming && message.status === "done" && <AssistantMeta message={message} onRetry={onRetry} />}
      </div>
    </div>
  );
});
