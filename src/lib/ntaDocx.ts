/**
 * ntaDocx.ts
 *
 * Generates Notes to Accounts (Note No : 1 — Accounting Policies) as a
 * properly formatted .docx file using JSZip.
 *
 * ALL formatting values are taken directly from the unpacked XML of the
 * official corporate template ("Notes to accounts for Corporate.docx"):
 *
 *   Font         : Cambria 10 pt (w:sz="20") on all body + heading runs
 *   Normal style : sz=17 (8.5 pt) — matches template, overridden per run
 *   docDefaults  : w:after="160" w:line="278" (NO justify at doc level)
 *   Body paras   : w:left="150" w:right="150", jc=both, after="0", line=240
 *   Headings     : w:left="650" w:hanging="488", bold, after="0", keepNext
 *   Numbered     : w:left="720" w:hanging="360", tab stop at 720, after="60"
 *   Page size    : A4 (11906 × 16838)
 *   Page margins : top=0, right=849, bottom=851, left=993
 *   Page border  : single sz=10 on all four sides
 */

import JSZip from "jszip";
import {
  type Stage8NtaData,
  resolvePolicy,
  resolveGeneralNote,
} from "@/lib/notesToAccountsDefaults";

// ─── XML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format ISO date as "dd Month yyyy" in Indian locale. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "____";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso as string;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

/** Returns "2013" if company incorporated ≥ 2014, else "1956". */
function getActYear(dateStr: string | null | undefined): string {
  if (!dateStr) return "____";
  const yr = new Date(dateStr).getFullYear();
  return yr >= 2014 ? "2013" : "1956";
}

// ─── Run builder ──────────────────────────────────────────────────────────────

interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Build a <w:r> using Cambria 10 pt — the exact font and size in the template.
 * Inline \n in `text` is NOT handled here; split before calling.
 */
function wRun(text: string, opts: RunOpts = {}): string {
  if (!text) return "";
  const rPrParts: string[] = [
    `<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>`,
    `<w:sz w:val="20"/><w:szCs w:val="20"/>`,
  ];
  if (opts.bold)      rPrParts.push("<w:b/><w:bCs/>");
  if (opts.italic)    rPrParts.push("<w:i/><w:iCs/>");
  if (opts.underline) rPrParts.push('<w:u w:val="single"/>');
  return (
    `<w:r><w:rPr>${rPrParts.join("")}</w:rPr>` +
    `<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  );
}

/** Inline line-break run — used for single \n within a paragraph. */
function wBr(opts: RunOpts = {}): string {
  const rPrParts: string[] = [
    `<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>`,
    `<w:sz w:val="20"/><w:szCs w:val="20"/>`,
  ];
  if (opts.bold) rPrParts.push("<w:b/><w:bCs/>");
  return `<w:r><w:rPr>${rPrParts.join("")}</w:rPr><w:br/></w:r>`;
}

// ─── Paragraph builders ───────────────────────────────────────────────────────

/**
 * Standard body paragraph — matches the template's 2.x body layout exactly.
 *
 *   w:left="150" w:right="150"  — template body indentation
 *   keepNext, after="0", line="240"
 *
 * Justification is applied ONLY to paragraphs with no internal line breaks.
 * The template's multi-line body paragraphs (e.g. the "(i)/(ii)/(iii)…"
 * list inside 2.9 Trade Receivables) do not set <w:jc>; if we forced
 * jc="both" on them Word would visually justify each line, scattering the
 * short list items across the column ("(i)        Secured" etc.).
 *
 * Within a paragraph: every "\n" produces one <w:br/>; consecutive
 * newlines therefore produce consecutive <w:br/> markers, which Word
 * renders as a blank line — matching the template's pattern of double
 * <w:br/> for sub-paragraph gaps inside one <w:p>.
 */
function bodyPara(text: string, keepNext = false): string {
  const hasLineBreaks = text.includes("\n");
  // Template has NO <w:spacing> on body paragraphs — pPrDefault provides
  // line height. Earlier versions emitted line=240/lineRule=auto on every
  // paragraph which the user perceived as wrong spacing.
  //
  // keepNext defaults to FALSE for body paragraphs. The heading → spacer →
  // first-body chain (via keepNext on headingPara and blankAfterHeading) is
  // sufficient to keep the heading with the start of its section. Adding
  // keepNext to every body paragraph creates an impossibly long chain across
  // multi-paragraph policies (2.5 has 6 sub-paragraphs) which Word may
  // break unpredictably — producing the "heading at page bottom, body on
  // next page" layout the user reported.
  const pPr =
    `<w:pPr>` +
    (hasLineBreaks ? `` : `<w:jc w:val="both"/>`) +
    (keepNext ? `<w:keepNext/>` : ``) +
    `<w:ind w:left="150" w:right="150"/>` +
    `</w:pPr>`;

  // Walk the text emitting one run per text segment and one <w:br/> for
  // every "\n". This preserves consecutive newlines as consecutive line
  // breaks, the way the template does it.
  const runs: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "\n") {
      if (buf) { runs.push(wRun(buf)); buf = ""; }
      runs.push(wBr());
    } else {
      buf += ch;
    }
  }
  if (buf) runs.push(wRun(buf));

  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

/**
 * Section heading paragraph (e.g. "2.9  Trade and Other Receivables"):
 *   w:left="650" w:hanging="488"  — number hangs, title text wraps at 650
 *   bold, after="0", keepNext
 *
 * `opts.titleSize` lets the main "Note No : 1" heading use 11 pt
 * (template's sz=22) instead of body 10 pt; `opts.underline` underlines
 * the title (template's "DISCLOSURE OF ACCOUNTING POLICIES..." has
 * <w:u w:val="single"/>).
 */
function headingPara(label: string, title: string, opts: { titleSize?: number; underline?: boolean; spaceBefore?: number } = {}): string {
  const before = opts.spaceBefore ?? 0;
  // Template heading paragraphs have NO w:jc and NO w:line/lineRule —
  // just bare w:after="0". Forcing jc="both" caused the visible spacing
  // mismatch. Bare spacing element only.
  const pPr =
    `<w:pPr>` +
    `<w:keepNext/>` +
    `<w:spacing${before ? ` w:before="${before}"` : ""} w:after="0"/>` +
    `<w:ind w:left="650" w:hanging="488"/>` +
    `</w:pPr>`;
  // Template detail: ONLY the title run (e.g. "DISCLOSURE OF...") gets the
  // larger size + underline. The label run ("Note No : 1") stays at body
  // size 20 (10pt) and unstyled-bold. Earlier code applied titleSize to
  // both runs, which made "Note No : 1" oversized too.
  const labelRun = wRun(label, { bold: true });
  const sep      = label && title ? wRun("  ", { bold: true }) : "";
  const titleRun = title ? wRun(title, { bold: true, fontSize: opts.titleSize, underline: opts.underline }) : "";
  return `<w:p>${pPr}${labelRun}${sep}${titleRun}</w:p>`;
}

/**
 * Outer-level heading ("1. Overview of the Reporting Entity",
 * "2. Significant Accounting Policies") — bold, sz=20, slight left indent
 * mimicking the template's auto-numbered ListParagraph rendering.
 *
 * Template uses w:numPr/numId=4 for these and lets Word inject the "1."
 * and "2." prefixes from numbering.xml. Replicating the numbering machinery
 * is fragile across renderers, so we hard-code the prefix and emit a
 * plain bold paragraph.
 */
function outerHeading(prefix: string, title: string): string {
  // Template uses pStyle=ListParagraph + numId=4 (abstractNumId=2) for these
  // headings. abstractNumId=2 defines level-0 indent as left=522 hanging=360.
  // We hard-code "1." / "2." prefixes for renderer parity and replicate the
  // exact indent so the text aligns at the same position as the template.
  const pPr =
    `<w:pPr>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0"/>` +
    `<w:ind w:left="522" w:hanging="360"/>` +
    `</w:pPr>`;
  return `<w:p>${pPr}${wRun(prefix, { bold: true })}${wRun(" ", { bold: true })}${wRun(title, { bold: true })}</w:p>`;
}

/**
 * Horizontal-rule paragraph — matches template's leading divider line.
 * Renders as a thin line (paragraph with just a top border).
 */
function hrPara(): string {
  // Template's first paragraph carries a top border with w:space="0"
  // and a Cambria sz=20 paragraph-mark rPr. WITHOUT the rPr, Word
  // renders the empty paragraph at the default 11pt line height,
  // inflating the top band by ~2pt. Adding the rPr matches the
  // template's exact row height.
  return (
    `<w:p>` +
      `<w:pPr>` +
        `<w:pBdr>` +
          `<w:top w:val="single" w:sz="10" w:space="0" w:color="auto"/>` +
        `</w:pBdr>` +
        `<w:spacing w:before="120" w:after="0" w:line="240" w:lineRule="auto"/>` +
        `<w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
      `</w:pPr>` +
    `</w:p>`
  );
}

/**
 * Mixed-styling body paragraph: each segment is its own run with its own
 * formatting opts (bold/italic/underline). Used for the overview paragraph
 * where "[Company Name]" is bold + underlined and the rest is plain.
 */
function bodyParaRich(parts: Array<{ text: string; opts?: RunOpts }>): string {
  // Match bodyPara: NO <w:spacing>, jc=both, slim ind L=150 R=150.
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:keepNext/>` +
    `<w:ind w:left="150" w:right="150"/>` +
    `</w:pPr>`;
  const runs = parts.map(p => wRun(p.text, p.opts ?? {})).join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

// ─── Blank / spacer paragraph variants ───────────────────────────────────────
// The template uses several distinct spacer styles depending on context.
// Replicating them exactly preserves the visual rhythm of the template.

const BLANK_RPR = `<w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>`;
const BLANK_BDR = `<w:pBdr><w:top w:val="none" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="2" w:space="2" w:color="auto"/></w:pBdr>`;

/**
 * Generic section spacer (template P1, P3, P8 style).
 *
 * NOTE: previously used the doc-default line height (~14pt). To honour
 * the user requirement that points 1 through 2.5 all fit on page 1, the
 * spacer height is now pinned to lineRule="exact" line="80" (4pt) —
 * tall enough to preserve visible separation between sections, but
 * compact enough that the cumulative whitespace across ~6 spacers
 * doesn't push 2.5 onto page 2.
 */
function blankSpacer(keepNext = false): string {
  return (
    `<w:p><w:pPr>` +
    (keepNext ? `<w:keepNext/>` : ``) +
    BLANK_BDR +
    `<w:spacing w:after="0" w:line="80" w:lineRule="exact"/>` +
    `<w:ind w:left="150"/>` +
    BLANK_RPR +
    `</w:pPr></w:p>`
  );
}

/**
 * Spacer after a policy heading (template P10, P16, P20, P31… style).
 *
 * Compressed to lineRule="exact" line="80" (4pt) for the same reason as
 * blankSpacer above — preserves a hairline visual gap between the
 * "2.x Title" heading and its body without consuming the ~14pt the
 * doc-default line height would otherwise produce.
 */
function blankAfterHeading(): string {
  return (
    `<w:p><w:pPr>` +
    `<w:keepNext/>` +
    BLANK_BDR +
    `<w:spacing w:after="0" w:line="80" w:lineRule="exact"/>` +
    `<w:ind w:left="150"/>` +
    BLANK_RPR +
    `</w:pPr></w:p>`
  );
}

/**
 * Spacer after the "1. Overview of the Reporting Entity" outer heading
 * (template P5 style — ListParagraph indent carry-over).
 *
 * Compressed to lineRule="exact" line="80" (4pt) so points 1 → 2.5 all
 * fit on page 1 (see note on blankSpacer above).
 */
function blankListSpacer(): string {
  return (
    `<w:p><w:pPr>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0" w:line="80" w:lineRule="exact"/>` +
    `<w:ind w:left="522"/>` +
    BLANK_RPR +
    `</w:pPr></w:p>`
  );
}

/**
 * Right-indented border spacer used before "2.19 General notes" and at the
 * very end of the document (template P75 / P97 style).
 * border + spacing after=0 + ind right=200.
 */
function blankRightIndent(): string {
  return (
    `<w:p><w:pPr>` +
    `<w:pBdr><w:top w:val="none" w:sz="2" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="2" w:space="0" w:color="auto"/></w:pBdr>` +
    `<w:spacing w:after="0"/>` +
    `<w:ind w:right="200"/>` +
    BLANK_RPR +
    `</w:pPr></w:p>`
  );
}

/**
 * Spacer after the "2.19 General notes" heading (template P77 style).
 * spacing after=0 + ind left=650 hanging=488 + keepNext (no border, no line=).
 * Template P77 carries bold on its paragraph-mark rPr — replicated here.
 */
function blankAfterGenNotesHeading(): string {
  const boldRPR = `<w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>`;
  return (
    `<w:p><w:pPr>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0"/>` +
    `<w:ind w:left="650" w:hanging="488"/>` +
    boldRPR +
    `</w:pPr></w:p>`
  );
}

/**
 * Spacer between individual general-note items (template P79 style).
 * keepNext + spacing after=0 line=240 lineRule=auto +
 * ind left=650 hanging=488 (matches numberedParas — the template's empty
 * inter-note rows carry the same hanging indent as the numbered notes
 * themselves, so the visual whitespace lines up under the note text).
 */
function blankBetweenNotes(): string {
  return (
    `<w:p><w:pPr>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="650" w:hanging="488"/>` +
    BLANK_RPR +
    `</w:pPr></w:p>`
  );
}

/**
 * Bold-rPr trailing spacer (template P96 style).
 * Same shape as blankBetweenNotes but the paragraph-mark rPr carries
 * <w:b/><w:bCs/>, exactly as in the template's penultimate paragraph.
 * Used immediately after the very last general note, before the final
 * right-indent border spacer.
 */
function blankBetweenNotesBold(): string {
  return (
    `<w:p><w:pPr>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="650" w:hanging="488"/>` +
    `<w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
    `</w:pPr></w:p>`
  );
}

/**
 * Last body paragraph of policy 2.5, with the 2.6 heading appended inline.
 *
 * Template P26 is a single <w:p> (body indent left=150 right=150) that contains:
 *   1. The "Assets which are not ready…" body text
 *   2. Two consecutive <w:br/> elements (equivalent to \n\n within a paragraph)
 *   3. Bold runs: "2.6  Depreciation /Amortization and Impairment"
 *
 * This matches exactly: keeping the 2.6 heading in the same paragraph as the
 * 2.5 body means it inherits the body indent (left=150), not the heading indent
 * (left=650 hanging=488), and no blankAfterHeading spacer sits between the
 * inline heading and the 2.6 body paragraphs. Template uses keepNext=true here.
 */
function bodyParaWithInlineHeading(
  bodyText: string,
  headingLabel: string,
  headingTitle: string,
): string {
  // <w:keepLines/> stops Word from splitting THIS paragraph across a page
  // boundary, so the body text + inline 2.6 heading runs always render
  // together as one block.
  //
  // We deliberately DO NOT set <w:keepNext/> here. With keepNext the
  // 2.5 keepNext-chain would extend through the inline-heading paragraph
  // into the 2.6 body paragraphs, making Word treat all of 2.5 + 2.6 as
  // one unbreakable unit. Combined with the leading 2.1–2.4 content,
  // that block becomes taller than a single page, so Word pushes the
  // entire 2.5–2.6 chunk to page 2 — leaving page 1 short and 2.5
  // missing. Dropping keepNext closes the 2.5 chain after this paragraph
  // and lets 2.6's body start fresh on the next page.
  const pPr =
    `<w:pPr>` +
    `<w:keepLines/>` +
    `<w:ind w:left="150" w:right="150"/>` +
    `</w:pPr>`;
  const runs: string[] = [];
  if (bodyText) runs.push(wRun(bodyText));
  // Two line breaks before the inline heading (matching template's double <w:br/>).
  runs.push(wBr());
  runs.push(wBr());
  // Bold heading text inline.
  runs.push(wRun(`${headingLabel}  ${headingTitle}`, { bold: true }));
  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

/**
 * Render a block of policy body text. Template style:
 *   * "\n\n" → SEPARATE <w:p> paragraphs (gives proper paragraph-level
 *      spacing between sub-paragraphs of policies like 2.3, 2.5, 2.6,
 *      2.7, 2.14, 2.16)
 *   * "\n"   → <w:br/> within the same paragraph (handled by bodyPara
 *      via the no-jc branch — used by 2.9's "(i) Secured / (ii) …")
 *
 * Earlier the whole body was emitted in one <w:p> with <w:br/> chains,
 * which broke template's vertical rhythm because Word doesn't space
 * around <w:br/> the way it spaces around paragraph marks.
 */
function bodyBlock(text: string): string[] {
  // Per user requirement: each policy point (heading + all of its body
  // paragraphs) must stay together on a single page — no section should
  // split across pages. To enforce this, every body paragraph carries
  // keepNext EXCEPT the very last one, forming a chain that links the
  // section heading → spacer → body 1 → body 2 → ... → body N. Word
  // will move the entire chain to the next page if it can't fit
  // together, which produces the no-orphan layout the user wants.
  const chunks = text.split(/\n\n+/);
  return chunks.map((chunk, i) => bodyPara(chunk, /* keepNext */ i < chunks.length - 1));
}

/**
 * Numbered general-note paragraph with hanging indent matching the template:
 *   w:left="720" w:hanging="360"
 *   tab stop at 720 — after the "N." number
 *   after="60" (matches template's small gap between notes)
 *
 * Multi-paragraph notes (split on \n\n) get continuation paras indented at
 * w:left="720" (aligns with text, not number).
 */
function numberedParas(num: number, text: string): string[] {
  // Template values (from P79–P95 in the template doc): w:left="650"
  // w:hanging="488", spacing=after=0 with w:line="240" w:lineRule="auto",
  // and NO w:jc. Earlier we used after="60" which template never has.
  const indLeft    = 650;
  const indHanging = 488;

  const firstPPr =
    `<w:pPr>` +
    `<w:keepNext/>` +
    `<w:tabs><w:tab w:val="left" w:pos="${indLeft}"/></w:tabs>` +
    `<w:ind w:left="${indLeft}" w:hanging="${indHanging}"/>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `</w:pPr>`;

  const contPPr =
    `<w:pPr>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="${indLeft}"/>` +
    `</w:pPr>`;

  const chunks = text.split(/\n\n+/);
  const paras: string[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const segments = chunks[ci].split("\n");
    const runs: string[] = [];
    if (ci === 0) {
      // Template's "1.", "2.", ... prefix on each general-note item is
      // PLAIN (not bold). Earlier the digit was emitted bold, which
      // didn't match the template.
      runs.push(wRun(`${num}.`));
      runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:tab/></w:r>`);
      for (let si = 0; si < segments.length; si++) {
        if (si > 0) runs.push(wBr());
        if (segments[si]) runs.push(wRun(segments[si]));
      }
      paras.push(`<w:p>${firstPPr}${runs.join("")}</w:p>`);
    } else {
      for (let si = 0; si < segments.length; si++) {
        if (si > 0) runs.push(wBr());
        if (segments[si]) runs.push(wRun(segments[si]));
      }
      paras.push(`<w:p>${contPPr}${runs.join("")}</w:p>`);
    }
  }
  return paras;
}

// ─── Export params ────────────────────────────────────────────────────────────

export interface NtaDocxParams {
  companyName:   string;
  cin:           string;
  incDateIso:    string;   // ISO YYYY-MM-DD
  regAddress:    string;
  bizActivity:   string;
  financialYear: string;   // e.g. "2025-26"
  data:          Stage8NtaData;
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportNtaToDocx(
  params: NtaDocxParams,
  filename: string,
): Promise<void> {
  const {
    companyName, cin, incDateIso, regAddress, bizActivity, data,
  } = params;

  const incDate = fmtDate(incDateIso);
  const actYear = getActYear(incDateIso);
  const paras: string[] = [];

  // ── 1. Leading divider + Note 1 heading ─────────────────────────────────────
  // Template P0: hrPara (top-border rule), P1: blankSpacer, P2: Note1 heading,
  // P3: blankSpacer (keepNext=true — keeps it on the same page as "1.").
  paras.push(hrPara());
  paras.push(blankSpacer());          // P1: between hr and Note1

  // Template title run for "DISCLOSURE…" uses sz=22 but we keep sz=20 so
  // the full heading fits on one line within the narrow page margins.
  paras.push(headingPara(
    "Note No : 1",
    "DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING PART OF THE ANNUAL ACCOUNTS",
    { underline: true },
  ));
  paras.push(blankSpacer(true));      // P3: between Note1 and "1." (keepNext)

  // ── 2. "1. Overview of the Reporting Entity" heading ────────────────────────
  // Template P4: ListParagraph numId=4 (left=522 hanging=360 from abstractNumId=2).
  // P5: blank with ind left=522 carrying the ListParagraph indent.
  paras.push(outerHeading("1.", "Overview of the Reporting Entity"));
  paras.push(blankListSpacer());      // P5: list-indent spacer (ind left=522)

  // ── 3. Overview paragraph ────────────────────────────────────────────────────
  // Template P6: "[Name] bold+underlined, rest plain, jc=both, ind left/right=150".
  paras.push(bodyParaRich([
    { text: companyName || "[Name of Company]", opts: { bold: true, underline: true } },
    { text: ` ('the company') was incorporated on ${incDate} under the Companies Act, ${actYear} vide CIN ${cin || "___________________"} having its registered office at ${regAddress || "___________________"} and engaged in business of ${bizActivity || "___________________"}.` },
  ]));
  // Template P7 follows directly (no spacer between overview body and "2." heading).

  // ── 4. "2. Significant Accounting Policies" heading ─────────────────────────
  // Template P7: ListParagraph numId=4 (same style as "1." heading).
  // P8: blankSpacer (keepNext, no ind) before first policy heading.
  paras.push(outerHeading("2.", "Significant Accounting Policies"));
  paras.push(blankSpacer(true));      // P8: between "2." and first policy heading

  // ── 5. Policies 2.1 – 2.n ────────────────────────────────────────────────────
  // Standard pattern (e.g. 2.1 → 2.2):
  //   heading  "2.1 Basis of Preparation…"   (P9)
  //   spacer   blankAfterHeading — border + line=240, ind left=150  (P10)
  //   body     "The financial statements…"  (P11)
  //   heading  "2.2 Use of Estimates"  DIRECTLY after body (P12)
  //   spacer   blankAfterHeading  (P13)
  //   body…
  //
  // Special case — 2.5 / 2.6 (template P26):
  //   The "2.6 Depreciation /Amortization and Impairment" heading is NOT a
  //   separate paragraph in the template. It appears as bold inline runs at the
  //   END of the last body paragraph of 2.5, preceded by two <w:br/> elements.
  //   The 2.6 body paragraphs then follow directly — no blankAfterHeading spacer.
  for (let idx = 0; idx < data.policies.length; idx++) {
    const p     = data.policies[idx];
    const label = p.id || `2.${idx + 1}`;
    const title = p.title || "";
    const body  = resolvePolicy(p.id, p.body);

    // 2.6: heading already emitted inline at the end of 2.5 body. Skip heading+spacer.
    if (label === "2.6") {
      bodyBlock(body).forEach(bp => paras.push(bp));
      continue;
    }

    paras.push(headingPara(label, title));
    paras.push(blankAfterHeading());

    if (label === "2.5") {
      // Append 2.6 heading inline to the LAST body paragraph of 2.5.
      const nextP     = data.policies[idx + 1];
      const nextLabel = nextP?.id ?? "2.6";
      const nextTitle = nextP?.title ?? "Depreciation /Amortization and Impairment";

      // Only inline if the following policy is actually 2.6.
      if (nextLabel === "2.6") {
        const chunks = body.split(/\n\n+/);
        // All body chunks except the last get keepNext so the entire
        // 2.5 + inline-2.6 chain stays on one page.
        for (let ci = 0; ci < chunks.length - 1; ci++) {
          paras.push(bodyPara(chunks[ci], /* keepNext */ true));
        }
        // Last chunk gets the 2.6 heading appended inline. The function
        // already sets keepNext + keepLines so it links forward to 2.6's
        // body and never splits across a page.
        paras.push(bodyParaWithInlineHeading(
          chunks[chunks.length - 1] ?? "",
          nextLabel,
          nextTitle,
        ));
      } else {
        // 2.6 is absent or reordered — fall back to normal body block.
        bodyBlock(body).forEach(bp => paras.push(bp));
      }
    } else {
      bodyBlock(body).forEach(bp => paras.push(bp));
    }
    // Next heading follows directly — no inter-section spacer.
  }
  // Template P75: right-indented border spacer before "2.19 General notes".
  paras.push(blankRightIndent());

  // ── 6. 2.19 General Notes ─────────────────────────────────────────────────────
  // Template P76: "2.19 General notes" heading (same headingPara style).
  // Template P77: blankAfterGenNotesHeading — ind left=650 hanging=488, no border.
  paras.push(headingPara("2.19", "General notes"));
  paras.push(blankAfterGenNotesHeading());  // P77 style

  for (let idx = 0; idx < data.general_notes.length; idx++) {
    const note = data.general_notes[idx];
    const body = resolveGeneralNote(idx, note.body);
    numberedParas(idx + 1, body).forEach(p => paras.push(p));
    // Add a blank between notes (template P79/P81 style) — not after the last.
    if (idx < data.general_notes.length - 1) {
      paras.push(blankBetweenNotes());
    }
  }

  // Template P95-P96: two trailing blanks in numbered-note style after the
  // very last general note. The second one uses a bold paragraph-mark rPr.
  // These give the document its characteristic bottom whitespace before
  // the closing page border.
  paras.push(blankBetweenNotes());
  paras.push(blankBetweenNotesBold());

  // Template P97: right-indented border spacer at end of document.
  paras.push(blankRightIndent());

  // ─── document.xml ─────────────────────────────────────────────────────────────
  //
  // Section properties match the template byte-for-byte, INCLUDING the
  // headerReference / footerReference that point at empty header1.xml /
  // footer1.xml stubs added below. Without those references Word treats
  // a top margin of 0 + page borders + no header as a no-printable-area
  // section and clips the top page border, which is exactly what the user
  // saw — the side and bottom borders rendered but the top line vanished.
  // Adding empty header/footer parts gives Word the section frame it
  // needs and the full border now renders.
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  mc:Ignorable="">
  <w:body>
    ${paras.join("\n    ")}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:footerReference w:type="default" r:id="rId3"/>
      <w:pgSz w:w="11906" w:h="16838" w:code="9"/>
      <w:pgMar w:top="0" w:right="849" w:bottom="851" w:left="993"
               w:header="765" w:footer="850" w:gutter="0"/>
      <w:pgBorders>
        <w:top    w:val="single" w:sz="10" w:space="1" w:color="auto"/>
        <w:left   w:val="single" w:sz="10" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="10" w:space="1" w:color="auto"/>
        <w:right  w:val="single" w:sz="10" w:space="0" w:color="auto"/>
      </w:pgBorders>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ─── header1.xml / footer1.xml ────────────────────────────────────────────────
  // Minimal empty-paragraph header and footer. Required so Word renders the
  // page border with w:top="0" — without these references the top border is
  // clipped at the page edge.
  // Header: empty paragraph using the Header pStyle (zero spacing) so the
  // header zone collapses to its minimum height. Using "Normal" inherits
  // the doc-level after=160 / line=278 defaults, which adds ~14pt of
  // unwanted whitespace above the page content.
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>
</w:hdr>`;

  // Footer: empty paragraph with the Footer pStyle. The template carries
  // NO page number, so we drop the previous PAGE field. Keeping the empty
  // <w:p> is required so Word still renders the section's bottom page
  // border correctly.
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p>
</w:ftr>`;

  // ─── styles.xml ───────────────────────────────────────────────────────────────
  //
  // docDefaults: Cambria, no justify at doc level, line=278 after=160 (template)
  // Normal:      Cambria 8.5 pt (sz=17) — matches template Normal style
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>
        <w:sz w:val="17"/>
        <w:szCs w:val="17"/>
        <w:lang w:val="en-IN" w:eastAsia="en-IN" w:bidi="ar-SA"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="278" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>
      <w:sz w:val="17"/>
      <w:szCs w:val="17"/>
    </w:rPr>
  </w:style>
  <!-- Header / Footer styles force a near-zero line height so the empty
       header / footer paragraphs collapse to almost no vertical space.
       lineRule="exact" + line="40" pins the line to 2pt regardless of the
       paragraph's font size, which prevents the visible "header
       rectangle" gap above the body content the user reported. -->
  <w:style w:type="paragraph" w:styleId="Header">
    <w:name w:val="header"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="0" w:line="40" w:lineRule="exact"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>
      <w:sz w:val="2"/>
      <w:szCs w:val="2"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Footer">
    <w:name w:val="footer"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="0" w:line="40" w:lineRule="exact"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>
      <w:sz w:val="2"/>
      <w:szCs w:val="2"/>
    </w:rPr>
  </w:style>
</w:styles>`;

  // ─── Build ZIP ────────────────────────────────────────────────────────────────

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
  <Relationship Id="rId2"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
    Target="header1.xml"/>
  <Relationship Id="rId3"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
    Target="footer1.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file("word/header1.xml", headerXml);
  zip.file("word/footer1.xml", footerXml);
  zip.file("word/_rels/document.xml.rels", docRels);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
