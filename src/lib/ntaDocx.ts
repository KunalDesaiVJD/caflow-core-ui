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
 * Standard body paragraph:
 *   w:left="150" w:right="150"  — template body indentation
 *   jc=both, after="0", line="240"
 *   keepNext — prevents orphan heading/body splits at page breaks
 *
 * Text is split on "\n" (single) → <w:br/>. Caller must split on "\n\n" first.
 */
function bodyPara(text: string, keepNext = true): string {
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    (keepNext ? `<w:keepNext/>` : ``) +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="150" w:right="150"/>` +
    `</w:pPr>`;

  const segments = text.split("\n");
  const runs: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) runs.push(wBr());
    if (segments[i]) runs.push(wRun(segments[i]));
  }
  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

/**
 * Section heading paragraph (e.g. "2.9  Trade and Other Receivables"):
 *   w:left="650" w:hanging="488"  — number hangs, title text wraps at 650
 *   bold, after="0", keepNext
 */
function headingPara(label: string, title: string): string {
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:keepNext/>` +
    `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:ind w:left="650" w:hanging="488"/>` +
    `</w:pPr>`;
  const labelRun = wRun(label, { bold: true });
  const sep      = label && title ? wRun("  ", { bold: true }) : "";
  const titleRun = title ? wRun(title, { bold: true }) : "";
  return `<w:p>${pPr}${labelRun}${sep}${titleRun}</w:p>`;
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
 * Render a block of policy body text.
 *   "\n\n" → separate bodyPara elements
 *   "\n"   → <w:br/> within a paragraph (handled inside bodyPara)
 */
function bodyBlock(text: string): string[] {
  const chunks = text.split(/\n\n+/);
  return chunks.map(chunk => bodyPara(chunk));
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

  // ── 1. Main heading ──────────────────────────────────────────────────────────
  // Template: "Note No : 1   DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING
  //            PART OF THE ANNUAL ACCOUNTS" — bold, heading indentation
  paras.push(headingPara(
    "Note No : 1",
    "DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING PART OF THE ANNUAL ACCOUNTS",
  ));
  paras.push(blank());

  // ── 2. Overview paragraph ────────────────────────────────────────────────────
  // Template wording exactly:
  // "[Name] ('the company') was incorporated on [Date] under the Companies Act,
  //  [year] vide CIN [cin] having its registered office at [address] and
  //  engaged in business of [activity]."
  const overviewText =
    `${companyName || "[Name of Company]"} ('the company') was incorporated on ` +
    `${incDate} under the Companies Act, ${actYear} vide CIN ` +
    `${cin || "___________________"} having its registered office at ` +
    `${regAddress || "___________________"} and engaged in business of ` +
    `${bizActivity || "___________________"}.`;

  paras.push(bodyPara(overviewText));
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
  // Page border matches template: single sz=10 on all sides, space=24
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  mc:Ignorable="">
  <w:body>
    ${paras.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="0" w:right="849" w:bottom="851" w:left="993"
               w:header="765" w:footer="850" w:gutter="0"/>
      <w:pgBorders w:offsetFrom="page">
        <w:top    w:val="single" w:sz="10" w:space="24" w:color="auto"/>
        <w:left   w:val="single" w:sz="10" w:space="24" w:color="auto"/>
        <w:bottom w:val="single" w:sz="10" w:space="24" w:color="auto"/>
        <w:right  w:val="single" w:sz="10" w:space="24" w:color="auto"/>
      </w:pgBorders>
    </w:sectPr>
  </w:body>
</w:document>`;

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
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
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
