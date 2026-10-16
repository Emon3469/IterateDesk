"use client";

import { STORAGE_KEYS, useLocalStorage, useMounted } from "@/lib/storage";

export function useAdminKey() {
  const [key, save] = useLocalStorage<string>(STORAGE_KEYS.adminKey, "");
  const ready = useMounted();
  return { key, save, ready };
}
