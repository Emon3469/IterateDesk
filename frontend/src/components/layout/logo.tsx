export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path d="M16 3 4 9.5l12 6.5 12-6.5L16 3Z" fill="currentColor" />
      <path d="m4 15.5 12 6.5 12-6.5" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="m4 21.5 12 6.5 12-6.5" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-white">
      <LogoMark className="h-6 w-6 shrink-0" />
      {!collapsed && <span className="text-[17px] font-semibold tracking-tight">IterateDesk</span>}
    </div>
  );
}
