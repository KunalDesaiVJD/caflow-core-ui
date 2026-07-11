/**
 * Lightweight Markdown renderer for the AI-Auditor answer — headings, paragraphs, lists,
 * blockquotes and GFM tables, with inline **bold** / `code`. Shares the same parser the exporters
 * use, so what you see on screen matches the downloaded Word / PDF / Excel exactly.
 */

import { Fragment, type ReactNode } from "react";
import { parseMarkdownBlocks } from "@/lib/scrutiny/markdown";

function renderInline(text: string): ReactNode[] {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export default function MarkdownView({ md }: { md: string }) {
  const blocks = parseMarkdownBlocks(md);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const cls = b.level <= 1 ? "text-base font-semibold" : b.level === 2 ? "text-sm font-semibold" : "text-sm font-medium";
          return <div key={i} className={`${cls} text-foreground mt-1`}>{renderInline(b.text)}</div>;
        }
        if (b.type === "list") {
          const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
          return b.ordered
            ? <ol key={i} className="list-decimal pl-5 space-y-0.5">{items}</ol>
            : <ul key={i} className="list-disc pl-5 space-y-0.5">{items}</ul>;
        }
        if (b.type === "quote") {
          return <blockquote key={i} className="border-l-2 border-muted-foreground/40 pl-3 italic text-muted-foreground">{renderInline(b.text)}</blockquote>;
        }
        if (b.type === "table") {
          return (
            <div key={i} className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>{b.headers.map((h, j) => <th key={j} className="text-left font-semibold px-2 py-1.5 border-b">{renderInline(h)}</th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b last:border-0">
                      {r.map((c, k) => <td key={k} className="px-2 py-1.5 align-top">{renderInline(c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i} className="text-foreground">{renderInline(b.text)}</p>;
      })}
    </div>
  );
}
