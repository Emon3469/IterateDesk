"use client";

import { useState, type ReactNode } from "react";
import { useBackend } from "@/components/providers";
import { STORAGE_KEYS, useLocalStorage } from "@/lib/storage";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

function WakeBanner() {
  const { state, retry } = useBackend();
  if (state !== "waking" && state !== "offline") return null;
  return (
    <div className="border-b border-amber/30 bg-amber-soft px-4 py-2 text-center text-[13px] text-amber sm:px-6">
      {state === "waking" ? (
        <>Connecting to the support API. A sleeping server can take up to a minute to wake up…</>
      ) : (
        <>
          The support API is not reachable right now.{" "}
          <button type="button" onClick={retry} className="font-medium underline underline-offset-2">
            Try again
          </button>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(STORAGE_KEYS.sidebar, false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => setCollapsed(!collapsed);

  return (
    <div className="flex min-h-screen bg-sidebar">
      <Sidebar collapsed={collapsed} onToggle={toggle} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col bg-bg lg:my-2 lg:mr-2 lg:overflow-clip lg:rounded-2xl">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <WakeBanner />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
