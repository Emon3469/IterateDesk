"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "iteratedesk:storage";

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  } catch {}
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

function readRaw(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalStorage<T>(key: string, fallback: T) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {}
  }
  const set = useCallback((next: T) => writeLocal(key, next), [key]);
  return [value, set] as const;
}

const noopSubscribe = () => () => {};

export function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export const STORAGE_KEYS = {
  adminKey: "iteratedesk.adminKey",
  chats: "iteratedesk.chats",
  activeChat: "iteratedesk.activeChat",
  sidebar: "iteratedesk.sidebarCollapsed",
} as const;
