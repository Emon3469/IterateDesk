import type { SourceUsed } from "./api";

export function formatBytes(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso: string, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function timeAgo(iso: string) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatMs(ms: number) {
  if (!ms && ms !== 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export const SOURCE_META: Record<string, { label: string; short: string; tone: "teal" | "red" | "amber" | "neutral" | "green" }> = {
  private_kb: { label: "Private KB", short: "KB", tone: "green" },
  web_search: { label: "Web search", short: "Web", tone: "amber" },
  insufficient_evidence: { label: "Escalated", short: "Escalated", tone: "red" },
  direct: { label: "Direct reply", short: "Direct", tone: "neutral" },
  "": { label: "Failed", short: "Failed", tone: "red" },
};

export function sourceMeta(source: SourceUsed | string) {
  return SOURCE_META[source] ?? SOURCE_META[""];
}

export const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  gemini: "Gemini",
};

export function providerLabel(name: string) {
  return PROVIDER_LABEL[name] ?? (name ? name[0].toUpperCase() + name.slice(1) : "—");
}

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
