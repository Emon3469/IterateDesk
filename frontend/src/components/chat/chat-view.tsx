"use client";

import { ArrowUp, History, MessageSquarePlus, Square, Trash2, Workflow, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { mutate } from "swr";
import { LogoMark } from "@/components/layout/logo";
import { useBackend } from "@/components/providers";
import { IconButton } from "@/components/ui/primitives";
import { uid, useChats, type ChatMessage } from "@/hooks/use-chats";
import { streamChat, type TraceStep } from "@/lib/api";
import { cn, timeAgo } from "@/lib/format";
import { MessageBubble } from "./message";
import { WorkflowStages } from "./trace";

const SUGGESTIONS = [
  "How do I connect to the company VPN from home?",
  "How do I reset my password and set up MFA?",
  "My laptop is running slow, what should I check first?",
  "What is the latest Microsoft Teams outage guidance?",
];

export function ChatView() {
  const router = useRouter();
  const { state: backend } = useBackend();
  const { sessions, active, activeId, setActiveId, create, remove, updateSession, updateMessage } = useChats();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();
  const pendingQuery = searchParams.get("q")?.trim() || null;
  const handledQuery = useRef<string | null>(null);

  const messages = useMemo(() => active?.messages ?? [], [active]);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    stickToBottom.current = true;
    scrollToBottom();
  }, [activeId, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = useCallback(
    async (text: string, sessionOverride?: string) => {
      const question = text.trim();
      if (!question || busy || backend !== "online") return;
      const sessionId = sessionOverride || activeId;
      const session = sessions.find((s) => s.id === sessionId);
      const history = (session?.messages ?? [])
        .filter((m) => m.status !== "error" && m.content)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));

      const userMsg: ChatMessage = { id: uid(), role: "user", content: question, createdAt: Date.now() };
      const botMsg: ChatMessage = { id: uid(), role: "assistant", content: "", steps: [], status: "streaming", createdAt: Date.now() };

      updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length ? s.title : question.slice(0, 60),
        updatedAt: Date.now(),
        messages: [...s.messages, userMsg, botMsg],
      }));
      setInput("");
      setBusy(true);
      stickToBottom.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      let pending = "";
      let frame = 0;
      const flush = () => {
        frame = 0;
        if (!pending) return;
        const chunk = pending;
        pending = "";
        updateMessage(sessionId, botMsg.id, (m) => ({ ...m, content: m.content + chunk }));
      };

      try {
        await streamChat(
          question,
          history,
          {
            onToken: (t) => {
              pending += t;
              if (!frame) frame = requestAnimationFrame(flush);
            },
            onStep: (step: TraceStep) => updateMessage(sessionId, botMsg.id, (m) => ({ ...m, steps: [...(m.steps ?? []), step] })),
            onDone: (result) => {
              if (frame) cancelAnimationFrame(frame);
              flush();
              updateMessage(sessionId, botMsg.id, (m) => ({
                ...m,
                content: result.answer || m.content,
                result,
                steps: result.trace?.length ? result.trace : m.steps,
                status: "done",
              }));
            },
            onError: (message) => {
              if (frame) cancelAnimationFrame(frame);
              flush();
              updateMessage(sessionId, botMsg.id, (m) => ({ ...m, status: "error", error: message }));
            },
          },
          controller.signal,
        );
      } catch (err) {
        if (frame) cancelAnimationFrame(frame);
        flush();
        const aborted = (err as Error)?.name === "AbortError";
        updateMessage(sessionId, botMsg.id, (m) => ({
          ...m,
          status: aborted ? "stopped" : "error",
          error: aborted ? undefined : "Could not reach the support API. Check your connection and try again.",
        }));
      } finally {
        abortRef.current = null;
        setBusy(false);
        mutate((key) => typeof key === "string" && (key.startsWith("/api/queries") || key.startsWith("/api/stats")));
        textareaRef.current?.focus();
      }
    },
    [activeId, backend, busy, sessions, updateMessage, updateSession],
  );

  useEffect(() => {
    if (!pendingQuery) {
      handledQuery.current = null;
      return;
    }
    if (busy || handledQuery.current === pendingQuery) return;
    handledQuery.current = pendingQuery;
    router.replace("/copilot");
    const id = create();
    setTimeout(() => send(pendingQuery, id), 0);
  }, [pendingQuery, busy, create, router, send]);

  const stop = () => abortRef.current?.abort();

  const retry = (assistantId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantId);
    const question = idx > 0 ? messages[idx - 1] : undefined;
    if (!question || question.role !== "user") return;
    updateSession(activeId, (s) => ({ ...s, messages: s.messages.filter((m) => m.id !== assistantId && m.id !== question.id) }));
    setTimeout(() => send(question.content), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const historyList = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Conversations</p>
        <IconButton aria-label="New conversation" title="New conversation" onClick={() => { create(); setHistoryOpen(false); }}>
          <MessageSquarePlus className="h-4 w-4" />
        </IconButton>
      </div>
      <ul className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {sessions
          .filter((s) => s.messages.length || s.id === activeId)
          .map((s) => (
            <li key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => { setActiveId(s.id); setHistoryOpen(false); }}
                className={cn(
                  "w-full rounded-xl px-3 py-2.5 text-left transition",
                  s.id === activeId ? "bg-surface-3" : "hover:bg-surface-2",
                )}
              >
                <p className="truncate pr-6 text-[13px] text-fg">{s.title}</p>
                <p className="text-[11px] text-muted">{s.messages.length ? timeAgo(new Date(s.updatedAt).toISOString()) : "Empty"}</p>
              </button>
              {s.messages.length > 0 && (
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={() => remove(s.id)}
                  className="absolute right-2 top-3 rounded-md p-1 text-muted opacity-0 transition hover:bg-surface hover:text-red group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
      </ul>
    </div>
  );

  const workflowPanel = (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-2 pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Live workflow</p>
        <p className="mt-1 text-xs text-muted">How the agent handled the latest question.</p>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
        <WorkflowStages
          steps={lastAssistant?.steps ?? []}
          running={lastAssistant?.status === "streaming"}
          interrupted={lastAssistant?.status === "stopped" || lastAssistant?.status === "error"}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-72px)] lg:h-[calc(100dvh-88px)]">
      <aside className="hidden w-[250px] shrink-0 border-r border-border bg-surface lg:block">{historyList}</aside>

      {historyOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] bg-surface shadow-xl">
            <IconButton className="absolute right-2 top-3" aria-label="Close" onClick={() => setHistoryOpen(false)}>
              <X className="h-4 w-4" />
            </IconButton>
            {historyList}
          </div>
        </div>
      )}
      {panelOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPanelOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[300px] bg-bg shadow-xl">
            <IconButton className="absolute right-2 top-3" aria-label="Close" onClick={() => setPanelOpen(false)}>
              <X className="h-4 w-4" />
            </IconButton>
            {workflowPanel}
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-border px-3 py-2 xl:hidden">
          <IconButton aria-label="Conversations" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" />
          </IconButton>
          <p className="min-w-0 flex-1 truncate px-1 text-sm text-fg-2">{active?.title}</p>
          <IconButton aria-label="Workflow" onClick={() => setPanelOpen(true)}>
            <Workflow className="h-4 w-4" />
          </IconButton>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
            {!messages.length ? (
              <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar text-white">
                  <LogoMark className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-xl font-medium tracking-tight text-fg">How can IT help you today?</h2>
                <p className="mt-1.5 max-w-md text-sm text-muted">
                  Answers come from NovaRetail&apos;s private knowledge base first. When it falls short, the copilot checks trusted
                  web sources and shows you exactly how it decided.
                </p>
                <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      disabled={busy || backend !== "online"}
                      className="rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-[13px] text-fg-2 transition hover:border-border-strong hover:text-fg disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onRetry={m.role === "assistant" && i === messages.length - 1 && !busy ? () => retry(m.id) : undefined}
                />
              ))
            )}
          </div>
        </div>

        <div className="border-t border-border bg-bg px-4 pb-4 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border-strong bg-surface p-2 pl-4 shadow-card transition focus-within:border-teal/60">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                maxLength={2000}
                placeholder={backend === "online" ? "Ask about VPN, passwords, devices, software access…" : "Connecting to the support API…"}
                className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-2 text-[14px] text-fg outline-none placeholder:text-muted-2"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop generating"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg transition hover:opacity-90"
                >
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim() || backend !== "online"}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg transition hover:opacity-90 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-2">
              Grounded in company knowledge · Verify critical changes with the IT Service Desk
            </p>
          </div>
        </div>
      </section>

      <aside className="hidden w-[280px] shrink-0 border-l border-border bg-bg xl:block">{workflowPanel}</aside>
    </div>
  );
}
