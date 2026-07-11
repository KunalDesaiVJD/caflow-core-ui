/**
 * Minimal, dependency-free GitHub-Flavored-Markdown block parser.
 *
 * Shared by the AI-Auditor renderer (MarkdownView) and the deliverable exporters (Word / PDF /
 * Excel / CSV) so the on-screen answer and every downloaded file come from ONE structured model —
 * headings, paragraphs, lists, blockquotes and real tables. Text is stored RAW (with inline **bold**
 * / `code`); call stripInline() when a plain-text form is needed.
 */

export interface MdHeading { type: "heading"; level: number; text: string }
export interface MdParagraph { type: "paragraph"; text: string }
export interface MdList { type: "list"; ordered: boolean; items: string[] }
export interface MdTable { type: "table"; headers: string[]; rows: string[][] }
export interface MdQuote { type: "quote"; text: string }
export type MdBlock = MdHeading | MdParagraph | MdList | MdTable | MdQuote;

const splitRow = (line: string): string[] =>
  line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

// A GFM header-separator row: pipes + dashes (optional colons), and at least one dash.
const isSep = (line: string): boolean => {
  const t = line.trim();
  return t.includes("-") && /^\|?[\s:|-]+\|?$/.test(t) && t.replace(/[^|]/g, "").length >= 1;
};

/** Remove inline markdown markers for plain-text output. */
export function stripInline(s: string): string {
  return String(s ?? "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^#{1,6}\s*/, "")
    .trim();
}

export function parseMarkdownBlocks(md: string): MdBlock[] {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ type: "paragraph", text: para.join(" ").trim() }); para = []; } };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { flushPara(); i++; continue; }

    // Table: this line has a pipe and the NEXT line is a separator row.
    if (trimmed.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      flushPara();
      const headers = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        if (isSep(lines[i])) { i++; continue; }
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) { flushPara(); blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() }); i++; continue; }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const qs: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { qs.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
      blocks.push({ type: "quote", text: qs.join(" ") });
      continue;
    }

    // List (unordered or ordered)
    const ul = /^[-*+]\s+(.*)$/.exec(trimmed);
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const um = /^[-*+]\s+(.*)$/.exec(t);
        const om = /^\d+[.)]\s+(.*)$/.exec(t);
        if (ordered && om) items.push(om[1].trim());
        else if (!ordered && um) items.push(um[1].trim());
        else break;
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return blocks;
}

export const firstTable = (blocks: MdBlock[]): MdTable | null =>
  (blocks.find((b) => b.type === "table") as MdTable | undefined) ?? null;

export const hasTable = (md: string): boolean => parseMarkdownBlocks(md).some((b) => b.type === "table");

/** Flatten a block to a single plain-text line/section (used by TXT/CSV export). */
export function blockToText(b: MdBlock): string {
  switch (b.type) {
    case "heading": return stripInline(b.text).toUpperCase();
    case "list": return b.items.map((it) => `• ${stripInline(it)}`).join("\n");
    case "table": return [b.headers, ...b.rows].map((r) => r.map(stripInline).join("\t")).join("\n");
    case "quote": return stripInline(b.text);
    default: return stripInline((b as MdParagraph).text);
  }
}
