"use client";

import { ThemeProvider } from "next-themes";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { API_URL, fetcher } from "@/lib/api";

type BackendState = "checking" | "online" | "waking" | "offline";

interface BackendContextValue {
  state: BackendState;
  knowledgeBase: string;
  retry: () => void;
}

const BackendContext = createContext<BackendContextValue>({ state: "checking", knowledgeBase: "", retry: () => {} });

export function useBackend() {
  return useContext(BackendContext);
}

function BackendProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BackendState>("checking");
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const check = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let delay = 3000;
      try {
        const res = await fetch(`${API_URL}/api/health`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        attempts = 0;
        if (cancelled) return;
        setState("online");
        setKnowledgeBase(body.knowledge_base ?? "");
        delay = body.knowledge_base === "ready" ? 60000 : 4000;
      } catch {
        attempts += 1;
        if (cancelled) return;
        setState(attempts > 24 ? "offline" : "waking");
        delay = attempts > 24 ? 15000 : 3000;
      } finally {
        clearTimeout(timeout);
      }
      if (!cancelled) timer = setTimeout(check, delay);
    };

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [nonce]);

  const retry = useCallback(() => {
    setState("checking");
    setNonce((n) => n + 1);
  }, []);

  return <BackendContext.Provider value={{ state, knowledgeBase, retry }}>{children}</BackendContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig
        value={{
          fetcher,
          revalidateOnFocus: true,
          shouldRetryOnError: true,
          errorRetryInterval: 4000,
          dedupingInterval: 2000,
        }}
      >
        <BackendProvider>{children}</BackendProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
