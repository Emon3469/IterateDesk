"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatResult, TraceStep } from "@/lib/api";
import { readLocal, STORAGE_KEYS, writeLocal } from "@/lib/storage";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: TraceStep[];
  result?: ChatResult;
  status?: "streaming" | "done" | "error" | "stopped";
  error?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);

function newSession(): ChatSession {
  const now = Date.now();
  return { id: uid(), title: "New conversation", createdAt: now, updatedAt: now, messages: [] };
}

const MAX_SESSIONS = 30;

function loadInitial(): { sessions: ChatSession[]; activeId: string } {
  const stored = readLocal<ChatSession[]>(STORAGE_KEYS.chats, []).map((s) => ({
    ...s,
    messages: s.messages.map((m) => (m.status === "streaming" ? { ...m, status: "stopped" as const } : m)),
  }));
  if (!stored.length) {
    const s = newSession();
    return { sessions: [s], activeId: s.id };
  }
  const active = readLocal<string>(STORAGE_KEYS.activeChat, "");
  return { sessions: stored, activeId: stored.some((s) => s.id === active) ? active : stored[0].id };
}

export function useChats() {
  const [initial] = useState(loadInitial);
  const [sessions, setSessions] = useState<ChatSession[]>(initial.sessions);
  const [activeId, setActiveId] = useState<string>(initial.activeId);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeLocal(
        STORAGE_KEYS.chats,
        sessions.filter((s) => s.messages.length).slice(0, MAX_SESSIONS),
      );
      writeLocal(STORAGE_KEYS.activeChat, activeId);
    }, 400);
  }, [sessions, activeId]);

  const active = sessions.find((s) => s.id === activeId);

  const create = useCallback(() => {
    const existingEmpty = sessions.find((s) => !s.messages.length);
    if (existingEmpty) {
      setActiveId(existingEmpty.id);
      return existingEmpty.id;
    }
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    return s.id;
  }, [sessions]);

  const remove = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (!next.length) {
          const s = newSession();
          setActiveId(s.id);
          return [s];
        }
        if (id === activeId) setActiveId(next[0].id);
        return next;
      });
    },
    [activeId],
  );

  const updateSession = useCallback((id: string, fn: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  }, []);

  const updateMessage = useCallback(
    (sessionId: string, messageId: string, fn: (m: ChatMessage) => ChatMessage) => {
      updateSession(sessionId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) => (m.id === messageId ? fn(m) : m)),
      }));
    },
    [updateSession],
  );

  return { sessions, active, activeId, setActiveId, create, remove, updateSession, updateMessage };
}
