"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/primitives";

export const ChatClient = dynamic(() => import("./chat-view").then((m) => m.ChatView), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex h-[calc(100dvh-88px)] max-w-3xl flex-col justify-end gap-3 p-6">
      <Skeleton className="h-14 w-full rounded-2xl" />
    </div>
  ),
});
