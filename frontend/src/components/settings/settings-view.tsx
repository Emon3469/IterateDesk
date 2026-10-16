"use client";

import { CheckCircle2, KeyRound, Laptop, Loader2, Moon, Sun, Trash2, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { useAdminKey } from "@/hooks/use-admin-key";
import { API_URL } from "@/lib/api";
import { cn } from "@/lib/format";
import { STORAGE_KEYS, useMounted, writeLocal } from "@/lib/storage";

const THEMES = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Laptop },
];

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const { key, save } = useAdminKey();
  const [draftValue, setDraft] = useState<string | null>(null);
  const draft = draftValue ?? key;
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "loading" | "ok" | "error"; ms?: number }>({ state: "idle" });
  const [cleared, setCleared] = useState(false);

  const runTest = async () => {
    setTest({ state: "loading" });
    const started = performance.now();
    try {
      const res = await fetch(`${API_URL}/api/health`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setTest({ state: "ok", ms: Math.round(performance.now() - started) });
    } catch {
      setTest({ state: "error" });
    }
  };

  return (
    <div className="grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-6 lg:grid-cols-2">
      <Card className="p-5">
        <CardHeader title="Appearance" subtitle="Choose how IterateDesk looks on this device" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const Icon = t.icon;
            const active = mounted && theme === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTheme(t.key)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-[13px] transition",
                  active ? "border-teal bg-teal-soft text-fg" : "border-border text-fg-2 hover:bg-surface-2",
                )}
              >
                <Icon className="h-5 w-5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="API Connection" subtitle="The backend this dashboard talks to" />
        <p className="mt-4 break-all rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-xs text-fg-2">{API_URL}</p>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" onClick={runTest} disabled={test.state === "loading"}>
            {test.state === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
            Test connection
          </Button>
          {test.state === "ok" && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-green">
              <CheckCircle2 className="h-4 w-4" /> Reachable · {test.ms}ms
            </span>
          )}
          {test.state === "error" && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-red">
              <TriangleAlert className="h-4 w-4" /> Not reachable
            </span>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="Admin Access" subtitle="Needed to upload or remove knowledge base documents" />
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(draft.trim());
            setDraft(null);
            setSaved(true);
            setTimeout(() => setSaved(false), 1800);
          }}
        >
          <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
            <KeyRound className="h-4 w-4 text-muted-2" />
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Admin key"
              autoComplete="off"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-2"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit">Save key</Button>
            {key && (
              <Button variant="ghost" onClick={() => { save(""); setDraft(null); }}>
                Remove
              </Button>
            )}
            {saved && <span className="text-[13px] text-green">Saved on this device</span>}
          </div>
          <p className="text-xs text-muted">The key is stored only in this browser and sent with upload or delete requests.</p>
        </form>
      </Card>

      <Card className="p-5">
        <CardHeader title="Conversation History" subtitle="Copilot chats are stored locally in this browser" />
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            writeLocal(STORAGE_KEYS.chats, []);
            writeLocal(STORAGE_KEYS.activeChat, "");
            setCleared(true);
          }}
        >
          <Trash2 className="h-4 w-4" />
          Clear conversations
        </Button>
        {cleared && <p className="mt-2 text-[13px] text-green">Conversation history cleared.</p>}
      </Card>
    </div>
  );
}
