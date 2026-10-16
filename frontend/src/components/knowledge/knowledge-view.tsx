"use client";

import { CheckCircle2, Download, FileUp, KeyRound, Loader2, Search, Trash2, TriangleAlert, UploadCloud } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent } from "react";
import useSWR from "swr";
import { useBackend } from "@/components/providers";
import { Badge, Button, Card, CardHeader, EmptyState, FileTile, IconButton, iconButtonClass, Skeleton } from "@/components/ui/primitives";
import { useAdminKey } from "@/hooks/use-admin-key";
import { deleteDocument, downloadUrl, uploadDocument, type DocumentRecord, type Stats } from "@/lib/api";
import { cn, formatBytes, formatDate } from "@/lib/format";

const ACCEPT = ".pdf,.docx,.md,.txt";
const MAX_MB = 15;

interface UploadItem {
  name: string;
  status: "uploading" | "done" | "error";
  message?: string;
}

export function KnowledgeView() {
  const { state } = useBackend();
  const online = state === "online";
  const { data: docs, mutate } = useSWR<DocumentRecord[]>(online ? "/api/documents" : null);
  const { data: stats, mutate: mutateStats } = useSWR<Stats>(online ? "/api/stats?days=7" : null);
  const { key, save, ready } = useAdminKey();
  const [keyDraft, setKeyDraft] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const [uploadedId, setHighlight] = useState<string | null>(null);
  const highlight = uploadedId ?? searchParams.get("doc");
  const wantsUpload = Boolean(searchParams.get("upload"));
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wantsUpload) dropRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [wantsUpload]);

  const handleFiles = async (files: FileList | File[]) => {
    setError("");
    if (!key) {
      setError("Add the admin key to upload documents.");
      return;
    }
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "docx", "md", "txt"].includes(ext)) {
        setUploads((u) => [{ name: file.name, status: "error", message: "Unsupported file type" }, ...u]);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setUploads((u) => [{ name: file.name, status: "error", message: `Larger than ${MAX_MB} MB` }, ...u]);
        continue;
      }
      setUploads((u) => [{ name: file.name, status: "uploading" }, ...u.filter((x) => x.name !== file.name)]);
      try {
        const res = await uploadDocument(file, key);
        setUploads((u) =>
          u.map((x) => (x.name === file.name ? { ...x, status: "done", message: `${res.document.chunks} ${res.document.chunks === 1 ? "chunk" : "chunks"} indexed` } : x)),
        );
        setHighlight(res.document.id);
        mutate();
        mutateStats();
      } catch (e) {
        setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, status: "error", message: (e as Error).message } : x)));
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const remove = async (id: string) => {
    setDeleting(id);
    setError("");
    try {
      await deleteDocument(id, key);
      mutate();
      mutateStats();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
      setConfirmId(null);
    }
  };

  const filtered = (docs ?? []).filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));
  const kb = stats?.knowledge_base;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0 p-5">
        <CardHeader
          title="Indexed Documents"
          subtitle={`${docs?.length ?? 0} documents · ${kb?.vector_count ?? 0} vectors in Pinecone`}
          action={
            <label className="flex h-9 w-full max-w-[220px] items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
              <Search className="h-4 w-4 text-muted-2" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter documents"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
              />
            </label>
          }
        />
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red/30 bg-red-soft px-3 py-2 text-[13px] text-red">
            <TriangleAlert className="h-4 w-4" />
            {error}
          </div>
        )}
        <div className="scrollbar-thin -mx-5 mt-4 overflow-x-auto px-5">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2.5 pr-3 font-normal">Name</th>
                <th className="py-2.5 pr-3 font-normal">Origin</th>
                <th className="py-2.5 pr-3 font-normal">Chunks</th>
                <th className="py-2.5 pr-3 font-normal">Size</th>
                <th className="py-2.5 pr-3 font-normal">Indexed</th>
                <th className="py-2.5 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!docs
                ? [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={6} className="py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                : filtered.map((d) => (
                    <tr
                      key={d.id}
                      className={cn(
                        "border-b border-border transition last:border-0",
                        highlight === d.id ? "bg-teal-soft/60" : "hover:bg-surface-2",
                      )}
                    >
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3">
                          <FileTile type={d.file_type} />
                          <span className="max-w-[260px] truncate text-fg" title={d.name}>
                            {d.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={d.origin === "sample" ? "teal" : "neutral"}>{d.origin === "sample" ? "Starter KB" : "Uploaded"}</Badge>
                      </td>
                      <td className="py-3 pr-3 text-fg-2">{d.chunks}</td>
                      <td className="py-3 pr-3 text-fg-2">{formatBytes(d.size_bytes)}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-fg-2">{formatDate(d.updated_at, true)}</td>
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-1">
                          {confirmId === d.id ? (
                            <>
                              <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => remove(d.id)} disabled={deleting === d.id}>
                                {deleting === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
                              </Button>
                              <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setConfirmId(null)}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              {d.downloadable && (
                                <a href={downloadUrl(d.id)} className={iconButtonClass} aria-label={`Download ${d.name}`}>
                                  <Download className="h-4 w-4" />
                                </a>
                              )}
                              <IconButton
                                aria-label={`Delete ${d.name}`}
                                disabled={!key}
                                title={key ? "Remove from knowledge base" : "Admin key required"}
                                onClick={() => setConfirmId(d.id)}
                                className="hover:text-red"
                              >
                                <Trash2 className="h-4 w-4" />
                              </IconButton>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {docs && !filtered.length && (
            <EmptyState icon={<FileUp className="h-5 w-5" />} title="No documents found" hint="Upload a policy, runbook or guide to grow the knowledge base." />
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <CardHeader title="Add Knowledge" subtitle="PDF, DOCX, Markdown or TXT · up to 15 MB" />
          {ready && !key ? (
            <form
              className="mt-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (keyDraft.trim()) save(keyDraft.trim());
              }}
            >
              <label className="text-xs text-muted">Admin key</label>
              <div className="flex gap-2">
                <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
                  <KeyRound className="h-4 w-4 text-muted-2" />
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="Required to upload"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
                  />
                </div>
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </div>
            </form>
          ) : null}
          <div
            ref={dropRef}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            className={cn(
              "mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
              dragging ? "border-teal bg-teal-soft" : "border-border-strong hover:border-teal/60 hover:bg-surface-2",
              !key && "pointer-events-none opacity-50",
            )}
          >
            <UploadCloud className="h-7 w-7 text-muted" />
            <p className="mt-2 text-sm font-medium text-fg">Drop files or click to browse</p>
            <p className="mt-1 text-xs text-muted">Documents are chunked, embedded and indexed instantly</p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {uploads.length > 0 && (
            <ul className="mt-4 space-y-2">
              {uploads.slice(0, 6).map((u) => (
                <li key={u.name} className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2">
                  {u.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-teal" />
                  ) : u.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green" />
                  ) : (
                    <TriangleAlert className="h-4 w-4 shrink-0 text-red" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-fg">{u.name}</p>
                    <p className={cn("text-[11px]", u.status === "error" ? "text-red" : "text-muted")}>
                      {u.status === "uploading" ? "Indexing…" : u.message}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <CardHeader title="Index Overview" />
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {[
              ["Documents", stats?.documents ?? "—"],
              ["Chunks", stats?.chunks ?? "—"],
              ["Vectors", kb?.vector_count ?? "—"],
              ["Status", kb?.status ?? "—"],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-surface-2 px-3 py-2.5">
                <dt className="text-[11px] text-muted">{label}</dt>
                <dd className="mt-0.5 text-lg capitalize text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
