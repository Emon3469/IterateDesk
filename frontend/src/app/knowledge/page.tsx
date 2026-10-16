import type { Metadata } from "next";
import { Suspense } from "react";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";

export const metadata: Metadata = { title: "Knowledge Base" };

export default function Page() {
  return (
    <Suspense>
      <KnowledgeView />
    </Suspense>
  );
}
