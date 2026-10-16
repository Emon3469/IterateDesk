import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Database, Globe, PenLine, ScanSearch, Sparkles, Split, TriangleAlert } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "How It Works" };

const STEPS = [
  { icon: Split, title: "Route", text: "LangGraph classifies the request. Small talk is answered directly; IT questions enter the retrieval path. Follow-ups are rewritten into standalone queries using the conversation." },
  { icon: Database, title: "Retrieve", text: "The query is embedded locally with BGE-small and matched against the private knowledge base in Pinecone." },
  { icon: ScanSearch, title: "Grade evidence", text: "An LLM grader decides whether the retrieved chunks actually answer the question. Weak evidence never reaches the answer step." },
  { icon: Globe, title: "Web fallback", text: "If private knowledge is insufficient, Tavily searches trusted public sources, and that evidence is graded too." },
  { icon: PenLine, title: "Rewrite & retry", text: "When both sources are weak, the query is rewritten with sharper technical keywords and the loop runs again." },
  { icon: Sparkles, title: "Grounded answer", text: "The answer streams token by token with inline citations, the model that produced it and the full decision trace." },
  { icon: TriangleAlert, title: "Escalate", text: "If nothing reliable is found, the copilot says so and points the employee to the Service Desk instead of guessing." },
];

const STACK = [
  ["Workflow", "LangGraph state machine"],
  ["LLMs", "OpenAI → Anthropic → Groq → Gemini with automatic model and provider fallback"],
  ["Vector store", "Pinecone serverless"],
  ["Embeddings", "BAAI/bge-small-en-v1.5 via FastEmbed (ONNX, CPU)"],
  ["Web search", "Tavily"],
  ["API", "FastAPI with Server-Sent Events streaming"],
  ["Audit", "SQLite decision log"],
  ["Frontend", "Next.js, React, Tailwind CSS, Recharts"],
];

export default function HowItWorksPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="p-6">
        <CardHeader
          title="Agentic RAG, step by step"
          subtitle="Private knowledge first, evidence before answers, and a transparent trace for every decision."
        />
        <ol className="mt-6 space-y-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="flex gap-4 rounded-2xl border border-border p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-fg">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[15px] font-medium text-fg">
                    <span className="mr-2 text-muted">{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{s.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      <div className="flex flex-col gap-4">
        <Card className="p-6">
          <CardHeader title="Technology" />
          <dl className="mt-4 divide-y divide-border">
            {STACK.map(([k, v]) => (
              <div key={k} className="flex gap-4 py-2.5 text-[13px]">
                <dt className="w-24 shrink-0 text-muted">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="bg-sidebar p-6 text-white">
          <p className="text-lg font-medium">Try it with a real question</p>
          <p className="mt-1 text-[13px] text-white/60">Ask about VPN access, then about a current outage, and compare the traces.</p>
          <Link
            href="/copilot"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition hover:opacity-90"
          >
            Open Copilot <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>
    </div>
  );
}
