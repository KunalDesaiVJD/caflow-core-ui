/**
 * ntaDocx.ts
 *
 * Generates Notes to Accounts (Note No : 1 — Accounting Policies) as a
 * properly formatted .docx file using JSZip.
 *
 * Formatting exactly matches the corporate template:
 *   Font     : Times New Roman 10 pt throughout
 *   Body     : fully justified
 *   Headings : bold (same 10 pt size, no extra spacing tricks)
 *   Multi-para policy text : split on "\n\n" → separate <w:p> elements
 *   Inline line-breaks     : "\n" within a paragraph → <w:br/>
 *
 * Data source : audit_engagements.stage8_nta_data (Stage 8 NTA screen)
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

// ─── Run / paragraph builders ─────────────────────────────────────────────────

interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Point size — defaults to 10 */
  fontSize?: number;
}

/** Build a single <w:r> run with Times New Roman 10 pt. */
function wRun(text: string, opts: RunOpts = {}): string {
  if (text === "") return "";
  const pt = opts.fontSize ?? 10;
  const sz = pt * 2;
  const rPrParts: string[] = [
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`,
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`,
  ];
  if (opts.bold)      rPrParts.push("<w:b/><w:bCs/>");
  if (opts.italic)    rPrParts.push("<w:i/><w:iCs/>");
  if (opts.underline) rPrParts.push('<w:u w:val="single"/>');
  return (
    `<w:r><w:rPr>${rPrParts.join("")}</w:rPr>` +
    `<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  );
}

/** Inline line-break run (used for single \n within a paragraph). */
function wBr(): string {
  return "<w:r><w:br/></w:r>";
}

interface ParaOpts extends RunOpts {
  centered?: boolean;
  leftAlign?: boolean;
  /** Space after paragraph in twips (1 pt = 20 twips). Defaults to 0. */
  spaceAfter?: number;
  spaceBefore?: number;
  /** Hanging indent: left margin in twips. */
  indLeft?: number;
  /** First-line hanging (subtracted from indLeft). */
  indHanging?: number;
}

/**
 * Build a <w:p> with a single text string.
 * Single \n within `text` → <w:br/>; \n\n must be split BEFORE calling.
 */
function wPara(text: string, opts: ParaOpts = {}): string {
  const pPrParts: string[] = [];

  if (opts.centered) {
    pPrParts.push('<w:jc w:val="center"/>');
  } else if (opts.leftAlign) {
    pPrParts.push('<w:jc w:val="left"/>');
  } else {
    pPrParts.push('<w:jc w:val="both"/>');
  }

  const before = opts.spaceBefore;
  const after  = opts.spaceAfter ?? 0;
  pPrParts.push(
    `<w:spacing${before !== undefined ? ` w:before="${before}"` : ""} w:after="${after}" w:line="240" w:lineRule="auto"/>`,
  );

  if (opts.indLeft !== undefined) {
    const hanging = opts.indHanging ?? 0;
    pPrParts.push(
      hanging
        ? `<w:ind w:left="${opts.indLeft}" w:hanging="${hanging}"/>`
        : `<w:ind w:left="${opts.indLeft}"/>`,
    );
  }

  const pPr = `<w:pPr>${pPrParts.join("")}</w:pPr>`;

  // Inline \n → <w:br/>
  const segments = text.split("\n");
  const runs: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) runs.push(wBr());
    if (segments[i]) runs.push(wRun(segments[i], opts));
  }

  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

/** Empty paragraph (blank line between sections). */
function blank(): string {
  return `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>`;
}

/**
 * Render a block of policy body text.
 * Splits on \n\n → separate paragraphs; single \n → <w:br/> within a para.
 * All body paragraphs are indented by 720 twips (matching template layout).
 */
function bodyParas(text: string, spaceAfter = 0): string[] {
  const chunks = text.split(/\n\n+/);
  return chunks.map((chunk, i) =>
    wPara(chunk, {
      spaceAfter: i < chunks.length - 1 ? 80 : spaceAfter,
      indLeft: 720,
    }),
  );
}

/**
 * Section heading: "2.x  Title" bold, no extra indent.
 * keepNext prevents orphaned headings at page breaks.
 */
function sectionHeading(label: string, title: string): string {
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:spacing w:before="120" w:after="60" w:line="240" w:lineRule="auto"/>` +
    `<w:keepNext/>` +
    `</w:pPr>`;
  const run = wRun(label + (title ? "  " + title : ""), { bold: true });
  return `<w:p>${pPr}${run}</w:p>`;
}

/**
 * Numbered general-note paragraph with hanging indent.
 *   "N.  [text]" where N. is bold and text is normal.
 */
function numberedPara(num: number, text: string): string[] {
  const indLeft    = 720;  // 36 pt
  const indHanging = 360;  // 18 pt (first line pulls back to 18 pt)
  const pPr =
    `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:tabs><w:tab w:val="left" w:pos="${indLeft}"/></w:tabs>` +
    `<w:ind w:left="${indLeft}" w:hanging="${indHanging}"/>` +
    `<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>` +
    `</w:pPr>`;

  // Split on \n\n for multi-paragraph notes; first chunk gets the number
  const chunks = text.split(/\n\n+/);

  const paras: string[] = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const segments = chunk.split("\n");

    if (ci === 0) {
      // First chunk: "N.\t[text]" with hanging indent
      const runs: string[] = [
        wRun(`${num}.`, { bold: true }),
        "<w:r><w:tab/></w:r>",
      ];
      for (let si = 0; si < segments.length; si++) {
        if (si > 0) runs.push(wBr());
        if (segments[si]) runs.push(wRun(segments[si]));
      }
      paras.push(`<w:p>${pPr}${runs.join("")}</w:p>`);
    } else {
      // Continuation paragraphs — indented to align with text (not the number)
      const contPPr =
        `<w:pPr>` +
        `<w:jc w:val="both"/>` +
        `<w:ind w:left="${indLeft}"/>` +
        `<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>` +
        `</w:pPr>`;
      const runs: string[] = [];
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

  const incDate  = fmtDate(incDateIso);
  const actYear  = getActYear(incDateIso);
  const paras: string[] = [];

  // ── 1. Main heading ──────────────────────────────────────────────────────────
  // "Note No : 1   DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING PART..."
  paras.push(
    wPara(
      "Note No : 1   DISCLOSURE OF ACCOUNTING POLICIES & NOTES FORMING PART OF THE ANNUAL ACCOUNTS",
      { bold: true, spaceAfter: 120 },
    ),
  );

  // ── 2. Overview of the Reporting Entity ──────────────────────────────────────
  // Matches template wording exactly:
  // "[Name] ('the company') was incorporated on [Date] under the Companies Act,
  //  [actYear] vide CIN [cin] having its registered office at [address] and
  //  engaged in business of [activity]."
  const overviewText =
    `${companyName || "[Name of Company]"} ('the company') was incorporated on ` +
    `${incDate} under the Companies Act, ${actYear} vide CIN ` +
    `${cin || "___________________"} having its registered office at ` +
    `${regAddress || "___________________"} and engaged in business of ` +
    `${bizActivity || "___________________"}.`;

  paras.push(wPara(overviewText, { spaceAfter: 120 }));
  paras.push(blank());

  // ── 3. Section heading: Significant Accounting Policies ──────────────────────
  paras.push(sectionHeading("2", "Significant Accounting Policies"));
  paras.push(blank());

  // ── 4. Policies 2.1 – 2.n ────────────────────────────────────────────────────
  for (let idx = 0; idx < data.policies.length; idx++) {
    const p     = data.policies[idx];
    const label = p.id || `2.${idx + 1}`;
    const title = p.title || "";
    const body  = resolvePolicy(p.id, p.body);

    paras.push(sectionHeading(label, title));
    bodyParas(body, 80).forEach(bp => paras.push(bp));
    paras.push(blank());
  }

  // ── 5. Section 2.19 — General Notes ─────────────────────────────────────────
  paras.push(sectionHeading("2.19", "General notes"));

  for (let idx = 0; idx < data.general_notes.length; idx++) {
    const note = data.general_notes[idx];
    const body = resolveGeneralNote(idx, note.body);
    numberedPara(idx + 1, body).forEach(p => paras.push(p));
  }

  paras.push(blank());

  // ─── Assemble document.xml ───────────────────────────────────────────────────

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
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"
               w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ─── styles.xml — Times New Roman 10 pt as document default ─────────────────

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="20"/>
        <w:szCs w:val="20"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:jc w:val="both"/>
        <w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="both"/>
      <w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
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
