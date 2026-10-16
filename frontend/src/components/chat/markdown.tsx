"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "@/lib/api";
import { withCitationLinks } from "@/lib/citations";


export const Markdown = memo(function Markdown({ content, citations = [] }: { content: string; citations?: Citation[] }) {
  return (
    <div className="prose-chat break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href?.startsWith("#cite-")) {
              const n = Number(href.slice(6));
              const c = citations[n - 1];
              const label = c ? `${c.title}${c.page ? ` · p.${c.page}` : ""}` : `Source ${n}`;
              const chip = (
                <sup className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-soft px-1 text-[10px] font-semibold text-teal no-underline">
                  {n}
                </sup>
              );
              return c?.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" title={label} className="no-underline">
                  {chip}
                </a>
              ) : (
                <span title={label}>{chip}</span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withCitationLinks(content)}
      </ReactMarkdown>
    </div>
  );
});
