import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-border bg-surface shadow-card", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-medium tracking-tight text-fg">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  green: "border-green/30 bg-green-soft text-green",
  red: "border-red/30 bg-red-soft text-red",
  amber: "border-amber/30 bg-amber-soft text-amber",
  teal: "border-teal/30 bg-teal-soft text-teal",
  neutral: "border-border-strong bg-surface-2 text-fg-2",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-40";

export function IconButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn(iconButtonClass, className)} {...rest}>
      {children}
    </button>
  );
}

export function Button({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-primary text-primary-fg hover:opacity-90",
    secondary: "border border-border-strong bg-surface text-fg hover:bg-surface-2",
    ghost: "text-fg-2 hover:bg-surface-3",
    danger: "bg-red text-white hover:opacity-90",
  }[variant];
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon ? <div className="mb-3 rounded-xl bg-surface-3 p-3 text-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-xs text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const FILE_COLORS: Record<string, string> = {
  pdf: "bg-[#e5484d]",
  docx: "bg-[#2f6fde]",
  doc: "bg-[#2f6fde]",
  md: "bg-[#3f4652]",
  txt: "bg-[#6b7280]",
};

export function FileTile({ type, className }: { type: string; className?: string }) {
  const ext = (type || "file").toLowerCase();
  return (
    <div className={cn("relative h-9 w-8 shrink-0", className)} aria-hidden>
      <svg viewBox="0 0 32 36" className="h-full w-full">
        <path d="M4 1h17l10 10v21a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z" fill="var(--surface)" stroke="var(--border-strong)" />
        <path d="M21 1v7a3 3 0 0 0 3 3h7" fill="none" stroke="var(--border-strong)" />
      </svg>
      <span
        className={cn(
          "absolute bottom-1.5 left-[-3px] rounded-[3px] px-1 text-[7.5px] font-bold uppercase leading-[11px] text-white",
          FILE_COLORS[ext] ?? "bg-[#6b7280]",
        )}
      >
        {ext.slice(0, 4)}
      </span>
    </div>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="truncate text-right text-fg">{value}</span>
    </div>
  );
}
