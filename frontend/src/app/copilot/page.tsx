import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatClient } from "@/components/chat/chat-client";

export const metadata: Metadata = { title: "Copilot" };

export default function CopilotPage() {
  return (
    <Suspense>
      <ChatClient />
    </Suspense>
  );
}
