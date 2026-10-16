"use client";

import { Bell, Menu, Moon, Plus, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { IconButton } from "@/components/ui/primitives";
import type { QueryRecord, SystemStatus } from "@/lib/api";
import { cn, providerLabel, sourceMeta, timeAgo } from "@/lib/format";
import { useBackend } from "@/components/providers";
import { useMounted } from "@/lib/storage";
import { titleFor } from "./nav";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  return (
    <IconButton
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="h-9 w-9"
    >
      {mounted ? dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" /> : <span className="h-[18px] w-[18px]" />}
    </IconButton>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { state } = useBackend();
  const online = state === "online";
  const { data: system } = useSWR<SystemStatus>(online ? "/api/system" : null, { refreshInterval: 30000 });
  const { data: queries } = useSWR<QueryRecord[]>(online ? "/api/queries?limit=5" : null, { refreshInterval: 30000 });

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const alerts = (system?.llm_providers ?? []).filter((p) => p.configured && p.state === "cooldown");
  const escalations = (queries ?? []).filter((q) => q.source_used === "insufficient_evidence" || q.status === "error");
  const count = alerts.length + escalations.length;

  return (
    <div className="relative" ref={ref}>
      <IconButton aria-label="Notifications" className="relative h-9 w-9" onClick={() => setOpen((v) => !v)}>
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red ring-2 ring-surface" />}
      </IconButton>
      {open && (
        <div className="fade-up absolute right-0 top-11 z-50 w-[320px] rounded-2xl border border-border bg-surface p-2 shadow-xl">
          <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted">Notifications</p>
          {count === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {alerts.map((p) => (
                <li key={p.name} className="rounded-xl px-3 py-2.5 hover:bg-surface-2">
                  <p className="text-sm text-fg">{providerLabel(p.name)} is in cooldown</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">Requests are falling back to the next provider. {p.last_error}</p>
                </li>
              ))}
              {escalations.map((q) => (
                <li key={q.id} className="rounded-xl px-3 py-2.5 hover:bg-surface-2">
                  <p className="line-clamp-1 text-sm text-fg">{q.question}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {q.status === "error" ? "Request failed" : sourceMeta(q.source_used).label} · {timeAgo(q.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setQuery("");
    router.push(`/copilot?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6">
        <IconButton aria-label="Open menu" className="lg:hidden" onClick={onOpenMobile}>
          <Menu className="h-5 w-5" />
        </IconButton>
        <h1 className="truncate text-xl font-medium tracking-tight text-fg sm:text-[22px]">{titleFor(pathname)}</h1>

        <form onSubmit={submit} className="ml-auto hidden w-full max-w-[300px] md:block lg:max-w-[340px] xl:mr-auto xl:ml-20">
          <label className="group flex h-10 items-center gap-2.5 rounded-xl border border-border bg-surface-2 px-3.5 transition focus-within:border-teal/60 focus-within:bg-surface">
            <Search className="h-4 w-4 text-muted-2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask the copilot anything…"
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted-2"
            />
          </label>
        </form>

        <div className={cn("flex items-center gap-1", "ml-auto md:ml-0")}>
          <IconButton aria-label="Add document" title="Add document" className="h-9 w-9" onClick={() => router.push("/knowledge?upload=1")}>
            <Plus className="h-[19px] w-[19px]" />
          </IconButton>
          <ThemeToggle />
          <Notifications />
          <div className="mx-2 hidden h-7 w-px bg-border sm:block" />
          <div
            className="hidden h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#d9dde3] to-[#aeb5bf] text-xs font-semibold text-[#2b2f36] sm:flex"
            title="NovaRetail IT"
          >
            NR
          </div>
        </div>
      </div>
    </header>
  );
}
