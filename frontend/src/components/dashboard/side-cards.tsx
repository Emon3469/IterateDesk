"use client";

import Link from "next/link";
import { ChevronDown, Download, Eye, Lightbulb, MoreHorizontal, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FileTile, IconButton, iconButtonClass, Skeleton } from "@/components/ui/primitives";
import { downloadUrl, type DocumentRecord, type KnowledgeState, type QueryRecord } from "@/lib/api";
import { cn, formatBytes, formatDate, formatMs, providerLabel, sourceMeta } from "@/lib/format";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

function DocActions({ doc }: { doc: DocumentRecord }) {
  return (
    <div className="flex items-center gap-0.5">
      <Link href={`/knowledge?doc=${doc.id}`} aria-label={`View ${doc.name}`} className={cn(iconButtonClass, "h-7 w-7")}>
            <Eye className="h-4 w-4" />
          </Link>
      {doc.downloadable ? (
        <a href={downloadUrl(doc.id)} aria-label={`Download ${doc.name}`} className={cn(iconButtonClass, "h-7 w-7")}>
            <Download className="h-4 w-4" />
          </a>
      ) : (
        <IconButton disabled className="h-7 w-7" aria-label="Download unavailable">
          <Download className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}

export function DocRow({ doc }: { doc: DocumentRecord }) {
  return (
    <div className="flex items-center gap-3">
      <FileTile type={doc.file_type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-fg" title={doc.name}>
          {doc.name}
        </p>
        <p className="text-[11px] uppercase text-muted">
          {doc.file_type} · <span className="normal-case">{formatBytes(doc.size_bytes)}</span>
        </p>
      </div>
      <DocActions doc={doc} />
    </div>
  );
}

export function KnowledgeStatusCard({
  docs,
  kb,
  loading,
}: {
  docs?: DocumentRecord[];
  kb?: KnowledgeState;
  loading?: boolean;
}) {
  const latest = docs?.[0];
  const totalChunks = (docs ?? []).reduce((acc, d) => acc + d.chunks, 0);
  const vectors = kb?.vector_count ?? 0;
  const ready = kb?.status === "ready";
  const progress = !kb ? 0 : ready ? (totalChunks ? Math.min(100, Math.round((vectors / totalChunks) * 100)) || 100 : 100) : kb.status === "warming" ? 45 : 15;
  const stage = !kb ? "Connecting" : ready ? "Indexed & Searchable" : kb.status === "degraded" ? "Degraded" : kb.detail || "Warming up";

  return (
    <Card className="p-5">
      <CardHeader
        title="Knowledge Status"
        action={
          <Link href="/knowledge" aria-label="Open knowledge base" className={cn(iconButtonClass, "-mr-1 -mt-1")}>
            <MoreHorizontal className="h-5 w-5" />
          </Link>
        }
      />
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : latest ? (
          <DocRow doc={latest} />
        ) : (
          <p className="text-sm text-muted">No documents indexed yet.</p>
        )}
      </div>
      <div className="my-4 h-px bg-border" />
      <div className="space-y-2.5">
        <Field label="Last indexed:" value={latest ? formatDate(latest.updated_at) : "—"} />
        <Field label="Documents / chunks:" value={`${docs?.length ?? 0} / ${totalChunks}`} />
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="text-[14px] text-fg">Index Health</p>
          <p className="text-[11px] text-muted">{progress}% synced</p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="progress-gradient h-full rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
        <span className="mt-2.5 inline-block rounded-md border border-border-strong px-1.5 py-0.5 text-[11px] text-muted">
          Stage: {stage}
        </span>
      </div>
    </Card>
  );
}

export function LastAnswerCard({ query, loading }: { query?: QueryRecord; loading?: boolean }) {
  const router = useRouter();
  const meta = query ? sourceMeta(query.source_used) : null;
  const evidence =
    query?.citations?.[0]?.snippet ||
    (query?.source_used === "insufficient_evidence" ? "No reliable evidence was found. The request was escalated." : "");

  return (
    <Card className="p-5">
      <CardHeader title="Latest Answer" />
      {loading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : !query ? (
        <EmptyState
          icon={<Lightbulb className="h-5 w-5" />}
          title="No questions yet"
          hint="Ask the copilot something to see the evidence summary here."
        />
      ) : (
        <>
          <p className="mt-3 line-clamp-2 text-[13px] text-fg-2" title={query.question}>
            “{query.question}”
          </p>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted">Evidence Zone:</span>
              <Badge tone={meta!.tone === "neutral" ? "neutral" : meta!.tone}>
                {query.source_used === "insufficient_evidence" && <TriangleAlert className="h-3 w-3" />}
                {meta!.label}
                {query.top_score != null && query.source_used === "private_kb" ? ` ${Math.round(query.top_score * 100)}%` : ""}
              </Badge>
            </div>
            <Field label="Answered by:" value={query.provider ? `${providerLabel(query.provider)} · ${query.model}` : "—"} />
            <Field label="Latency:" value={`${formatMs(query.latency_ms)}${query.retries ? ` · ${query.retries} retry` : ""}`} />
          </div>
          {evidence ? (
            <div className="mt-4 rounded-xl border border-violet-border bg-violet-soft p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                <Lightbulb className="h-3.5 w-3.5" />
                {query.source_used === "insufficient_evidence" ? "Recommendation" : "Top evidence"}
              </p>
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-fg-2">{evidence}</p>
            </div>
          ) : null}
        </>
      )}
      <Button className="mt-4 w-full" onClick={() => router.push(query ? `/audit?id=${query.id}` : "/copilot")}>
        {query ? "Review Decision Trace" : "Ask the Copilot"}
      </Button>
    </Card>
  );
}

export function DocumentsCard({ docs, loading }: { docs?: DocumentRecord[]; loading?: boolean }) {
  return (
    <Card className="p-5">
      <CardHeader
        title="Documents"
        subtitle="Recently indexed knowledge"
        action={
          <Link href="/knowledge?upload=1" aria-label="Upload document" className={cn(iconButtonClass, "-mr-1 -mt-1")}>
            <MoreHorizontal className="h-5 w-5" />
          </Link>
        }
      />
      <div className="mt-4 space-y-3.5">
        {loading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)
        ) : docs && docs.length ? (
          docs.slice(0, 3).map((d) => <DocRow key={d.id} doc={d} />)
        ) : (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents" hint="Upload PDFs, DOCX, Markdown or text." />
        )}
      </div>
      <Link href="/knowledge" className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-teal underline underline-offset-4">
        Show all <ChevronDown className="h-3.5 w-3.5" />
      </Link>
    </Card>
  );
}
