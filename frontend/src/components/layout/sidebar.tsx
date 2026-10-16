"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { useBackend } from "@/components/providers";
import { cn } from "@/lib/format";
import { Logo } from "./logo";
import { NAV_SECTIONS } from "./nav";

const STATUS_COPY = {
  checking: { label: "Connecting", dot: "bg-amber" },
  online: { label: "All systems online", dot: "bg-green" },
  waking: { label: "Waking up server", dot: "bg-amber animate-pulse" },
  offline: { label: "Backend unreachable", dot: "bg-red" },
} as const;

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const { state, knowledgeBase } = useBackend();
  const status = STATUS_COPY[state];
  const kbWarming = state === "online" && knowledgeBase && knowledgeBase !== "ready";

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onCloseMobile}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-fg transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          collapsed ? "lg:w-[76px]" : "lg:w-[236px]",
          "w-[260px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className={cn("flex h-[72px] items-center px-5", collapsed ? "lg:justify-center lg:px-0" : "justify-between")}>
          <Link href="/" onClick={onCloseMobile} className="focus-visible:outline-none">
            <Logo collapsed={collapsed} />
          </Link>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "hidden h-6 w-6 items-center justify-center rounded-full border border-white/25 text-white/70 transition hover:border-white/60 hover:text-white lg:flex",
              collapsed && "lg:absolute lg:-right-3 lg:top-6 lg:border-white/20 lg:bg-sidebar",
            )}
          >
            <ChevronLeft className={cn("h-3.5 w-3.5 transition", collapsed && "rotate-180")} />
          </button>
          <button type="button" onClick={onCloseMobile} aria-label="Close menu" className="text-white/70 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mt-5 first:mt-3">
              <p
                className={cn(
                  "mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-white/35",
                  collapsed && "lg:text-center lg:px-0",
                )}
              >
                {collapsed ? <span className="hidden lg:inline">•</span> : null}
                <span className={cn(collapsed && "lg:hidden")}>{section.label}</span>
              </p>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] transition",
                          collapsed && "lg:justify-center lg:px-0",
                          active
                            ? "bg-sidebar-active font-medium text-sidebar-active-fg"
                            : "hover:bg-white/[0.06] hover:text-white",
                        )}
                      >
                        <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                        <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cn("border-t border-white/[0.07] px-5 py-5", collapsed && "lg:px-0")}>
          <div className={cn("flex items-center gap-3 text-[13px]", collapsed && "lg:justify-center")} title={status.label}>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", kbWarming ? "bg-amber animate-pulse" : status.dot)} />
            <span className={cn("truncate", collapsed && "lg:hidden")}>
              {kbWarming ? "Preparing knowledge base" : status.label}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
