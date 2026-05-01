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
    `<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>`,
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
    `<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>`,
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
function bodyPara(text: string, keepNext = true): string {
  const hasLineBreaks = text.includes("\n");
  const pPr =
    `<w:pPr>` +
    (hasLineBreaks ? `` : `<w:jc w:val="both"/>`) +
    (keepNext ? `<w:keepNext/>` : ``) +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
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
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:keepNext/>` +
    `<w:spacing${before ? ` w:before="${before}"` : ""} w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="650" w:hanging="488"/>` +
    `</w:pPr>`;
  const sz = opts.titleSize;
  const labelRun = wRun(label, { bold: true, fontSize: sz });
  const sep      = label && title ? wRun("  ", { bold: true, fontSize: sz }) : "";
  const titleRun = title ? wRun(title, { bold: true, fontSize: sz, underline: opts.underline }) : "";
  return `<w:p>${pPr}${labelRun}${sep}${titleRun}</w:p>`;
}

/**
 * Horizontal-rule paragraph — matches template's leading divider line.
 * Renders as a thin line (paragraph with just a top border).
 */
function hrPara(): string {
  return (
    `<w:p>` +
      `<w:pPr>` +
        `<w:pBdr>` +
          `<w:top w:val="single" w:sz="10" w:space="1" w:color="auto"/>` +
        `</w:pBdr>` +
        `<w:spacing w:before="120" w:after="0" w:line="240" w:lineRule="auto"/>` +
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
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="150" w:right="150"/>` +
    `</w:pPr>`;
  const runs = parts.map(p => wRun(p.text, p.opts ?? {})).join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

/**
 * Empty divider paragraph — small visual gap between sections.
 * Template uses w:left="150", after="0".
 */
function blank(): string {
  return (
    `<w:p><w:pPr>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="150"/>` +
    `</w:pPr></w:p>`
  );
}

/**
 * Render a block of policy body text as a SINGLE paragraph, matching the
 * template. Multiple newlines remain inside one <w:p> as consecutive
 * <w:br/> markers — that's what gives the template its visual sub-
 * paragraph gaps inside, e.g., the 2.9 Trade Receivables block.
 *
 * Splitting on \n\n into separate <w:p> elements (the previous behaviour)
 * forced every chunk to inherit jc="both", which justified short list
 * lines like "(i) Secured" across the full column width.
 */
function bodyBlock(text: string): string[] {
  return [bodyPara(text)];
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
  const indLeft    = 720;
  const indHanging = 360;

  const firstPPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:keepNext/>` +
    `<w:tabs><w:tab w:val="left" w:pos="${indLeft}"/></w:tabs>` +
    `<w:ind w:left="${indLeft}" w:hanging="${indHanging}"/>` +
    `<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>` +
    `</w:pPr>`;

  const contPPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="${indLeft}"/>` +
    `</w:pPr>`;

  const chunks = text.split(/\n\n+/);
  const paras: string[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const segments = chunks[ci].split("\n");
    const runs: string[] = [];
    if (ci === 0) {
      runs.push(wRun(`${num}.`, { bold: true }));
      runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:tab/></w:r>`);
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
  // Template begins with a horizontal-rule paragraph (top-bordered <w:p>
  // with w:before="120") plus a blank spacer ABOVE the Note 1 heading.
  // Without those leaders the heading sits flush to the page top and gets
  // visually clipped/hidden by the page border the way the user reported.
  paras.push(hrPara());
  paras.push(blank());

  // Template: "Note No : 1   DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING
  //            PART OF THE ANNUAL ACCOUNTS" — bold, sz=22 (11pt), underlined.
  paras.push(headingPara(
    "Note No : 1",
    "DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING PART OF THE ANNUAL ACCOUNTS",
    { titleSize: 11, underline: true, spaceBefore: 120 },
  ));
  paras.push(blank());

  // ── 2. Overview paragraph ────────────────────────────────────────────────────
  // Template wording exactly:
  // "[Name] ('the company') was incorporated on [Date] under the Companies Act,
  //  [year] vide CIN [cin] having its registered office at [address] and
  //  engaged in business of [activity]."
  //
  // The company name is rendered as a BOLD + UNDERLINED run (template style);
  // the rest of the sentence is plain.
  paras.push(bodyParaRich([
    { text: companyName || "[Name of Company]", opts: { bold: true, underline: true } },
    { text: ` ('the company') was incorporated on ${incDate} under the Companies Act, ${actYear} vide CIN ${cin || "___________________"} having its registered office at ${regAddress || "___________________"} and engaged in business of ${bizActivity || "___________________"}.` },
  ]));
  paras.push(blank());

  // ── 3. "2 Significant Accounting Policies" section heading ───────────────────
  paras.push(headingPara("2", "Significant Accounting Policies"));
  paras.push(blank());

  // ── 4. Policies 2.1 – 2.n ────────────────────────────────────────────────────
  for (let idx = 0; idx < data.policies.length; idx++) {
    const p     = data.policies[idx];
    const label = p.id || `2.${idx + 1}`;
    const title = p.title || "";
    const body  = resolvePolicy(p.id, p.body);

    paras.push(headingPara(label, title));
    bodyBlock(body).forEach(bp => paras.push(bp));
    paras.push(blank());
  }

  // ── 5. 2.19 General Notes ─────────────────────────────────────────────────────
  paras.push(headingPara("2.19", "General notes"));

  for (let idx = 0; idx < data.general_notes.length; idx++) {
    const note = data.general_notes[idx];
    const body = resolveGeneralNote(idx, note.body);
    numberedParas(idx + 1, body).forEach(p => paras.push(p));
  }

  paras.push(blank());

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
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>
</w:hdr>`;

  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>
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
        <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>
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
      <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>
      <w:sz w:val="17"/>
      <w:szCs w:val="17"/>
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
