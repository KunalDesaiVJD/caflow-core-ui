/**
 * mrlDocx.ts
 * Generates a Management Representation Letter as a .docx file using JSZip.
 * No extra dependencies — uses JSZip (already in the project).
 *
 * Output format matches the uploaded MRL_Format.doc template.
 */
import JSZip from "jszip";

// ── XML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format ISO date "2025-03-31" → "31.03.2025" */
function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// ── Paragraph / Run builders ─────────────────────────────────────────────────

interface RunOpts {
  bold?: boolean;
  fontSize?: number; // points, e.g. 12
  underline?: boolean;
}

interface ParaOpts extends RunOpts {
  centered?: boolean;
  leftIndentTwips?: number;  // 720 = 0.5 inch
  spaceBefore?: number;      // twips
  spaceAfter?: number;       // twips
  keepNext?: boolean;
}

/** Build a single run element. */
function wRun(text: string, opts: RunOpts = {}): string {
  const rPrParts: string[] = [];
  if (opts.bold) rPrParts.push("<w:b/><w:bCs/>");
  if (opts.fontSize) rPrParts.push(`<w:sz w:val="${opts.fontSize * 2}"/><w:szCs w:val="${opts.fontSize * 2}"/>`);
  if (opts.underline) rPrParts.push('<w:u w:val="single"/>');
  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Build a tab run. */
function wTab(): string {
  return "<w:r><w:tab/></w:r>";
}

/** Build a paragraph with one or more runs. */
function wPara(
  runs: Array<{ text: string } & RunOpts>,
  opts: ParaOpts = {}
): string {
  const pPrParts: string[] = [];
  if (opts.centered) pPrParts.push('<w:jc w:val="center"/>');
  if (opts.leftIndentTwips) pPrParts.push(`<w:ind w:left="${opts.leftIndentTwips}"/>`);
  if (opts.spaceBefore !== undefined || opts.spaceAfter !== undefined) {
    pPrParts.push(
      `<w:spacing${opts.spaceBefore !== undefined ? ` w:before="${opts.spaceBefore}"` : ""}${opts.spaceAfter !== undefined ? ` w:after="${opts.spaceAfter}"` : ""} w:line="276" w:lineRule="auto"/>`
    );
  }
  if (opts.keepNext) pPrParts.push("<w:keepNext/>");
  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";

  const runXml = runs.map((r) => wRun(r.text, r)).join("");
  return `<w:p>${pPr}${runXml}</w:p>`;
}

/** Empty paragraph (blank line). */
function blank(spacePt = 4): string {
  return `<w:p><w:pPr><w:spacing w:after="${spacePt * 20}"/></w:pPr></w:p>`;
}

/** Horizontal separator line via paragraph bottom border. */
function hrLine(): string {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
}

/** Build multi-line text into an array of paragraphs (split on \n). */
function multilinePara(text: string, opts: ParaOpts & RunOpts = {}): string[] {
  return text
    .split("\n")
    .map((line) => wPara([{ text: line, ...opts }], opts));
}

// ── Tab-stop helpers for 2-col signature ────────────────────────────────────

/**
 * Build two-column signature row using a tab stop.
 * Col 1 at left margin, Col 2 at ~4320 twips (3 inches from margin).
 */
function sigRow(left: string, right: string, opts: RunOpts = {}): string {
  const tabStop = `<w:pPr><w:tabs><w:tab w:val="left" w:pos="4320"/></w:tabs></w:pPr>`;
  const leftRun  = wRun(left, opts);
  const tabRun   = wTab();
  const rightRun = wRun(right, opts);
  return `<w:p>${tabStop}${leftRun}${tabRun}${rightRun}</w:p>`;
}

// ── Main export function ─────────────────────────────────────────────────────

export interface MRLDocxParams {
  companyName:    string;
  cin:            string;
  address:        string;
  date:           string;   // ISO
  firmName:       string;
  firmCity:       string;
  auditYear:      string;
  openingPara:    string;
  clauses: Array<{
    id:       string;
    title:    string;
    text:     string;
    selected: boolean;
  }>;
  cashAmount:    string;
  director1Name: string;
  director1Din:  string;
  director2Name: string;
  director2Din:  string;
  sigPlace:      string;
  sigDate:       string;   // ISO
}

export async function exportMrlToDocx(params: MRLDocxParams, filename: string): Promise<void> {
  const {
    companyName, cin, address, date, firmName, firmCity,
    auditYear, openingPara, clauses, cashAmount,
    director1Name, director1Din, director2Name, director2Din,
    sigPlace, sigDate,
  } = params;

  const selectedClauses = clauses.filter((c) => c.selected);
  const paras: string[] = [];

  // ── 1. Company Letterhead ──────────────────────────────────────────────────
  paras.push(wPara([{ text: companyName, bold: true, fontSize: 14 }], { centered: true, spaceAfter: 40 }));
  if (cin) {
    paras.push(wPara([{ text: `(CIN - ${cin})` }], { centered: true, spaceAfter: 40 }));
  }
  if (address) {
    paras.push(wPara([{ text: address }], { centered: true, spaceAfter: 60 }));
  }
  paras.push(hrLine());
  paras.push(blank(6));

  // ── 2. Title ───────────────────────────────────────────────────────────────
  paras.push(wPara(
    [{ text: "MANAGEMENT REPRESENTATION LETTER", bold: true, fontSize: 13 }],
    { centered: true, spaceBefore: 120, spaceAfter: 120 }
  ));

  // ── 3. Date ────────────────────────────────────────────────────────────────
  paras.push(wPara([{ text: fmtDate(date) }], { spaceAfter: 80 }));
  paras.push(blank());

  // ── 4. Addressee ──────────────────────────────────────────────────────────
  paras.push(wPara([{ text: "To" }]));
  const toName = firmName || "Your CA Firm";
  paras.push(wPara([{ text: `${toName},` }]));
  paras.push(wPara([{ text: "Chartered Accountants," }]));
  if (firmCity) {
    paras.push(wPara([{ text: `${firmCity}.` }]));
  }
  paras.push(blank());

  // ── 5. Salutation ─────────────────────────────────────────────────────────
  paras.push(wPara([{ text: "Dear Sir," }]));
  paras.push(blank());

  // ── 6. Subject ────────────────────────────────────────────────────────────
  paras.push(wPara(
    [{ text: `Re.: Statutory Audit of the Company for the year ended 31st March, ${auditYear}.`, bold: true }]
  ));
  paras.push(blank());

  // ── 7. Opening Paragraph ──────────────────────────────────────────────────
  const openLines = (openingPara || "").split("\n");
  for (const line of openLines) {
    paras.push(wPara([{ text: line }], { spaceAfter: 40 }));
  }
  paras.push(blank());

  // ── 8. Clauses ────────────────────────────────────────────────────────────
  let clauseNum = 1;
  for (const clause of selectedClauses) {
    // Replace [CASH_AMOUNT] token with actual amount (fallback to blank field)
    const clauseText = clause.text.replace(/\[CASH_AMOUNT\]/g, cashAmount || "______");

    // Clause heading: bold "1.  Title"
    paras.push(wPara(
      [{ text: `${clauseNum}.`, bold: true }, { text: `  ${clause.title}`, bold: true }],
      { spaceBefore: 80, spaceAfter: 40 }
    ));

    // Clause body lines (indented)
    const lines = clauseText.split("\n");
    for (const line of lines) {
      if (line.trim()) {
        paras.push(wPara([{ text: line }], { leftIndentTwips: 360, spaceAfter: 20 }));
      }
    }
    paras.push(blank(4));
    clauseNum++;
  }

  // ── 9. Closing ────────────────────────────────────────────────────────────
  paras.push(blank());
  paras.push(wPara([{ text: "Thank You," }]));
  paras.push(blank());
  paras.push(wPara([{ text: `For ${companyName}` }]));
  paras.push(blank());
  paras.push(blank());
  paras.push(blank());

  // ── 10. Signature Block (two-column via tab stops) ────────────────────────
  const d1 = director1Name || "Director";
  const d2 = director2Name || "Director";
  paras.push(sigRow(d1, d2, { bold: false }));
  if (director1Din || director2Din) {
    const din1 = director1Din ? `(DIN- ${director1Din})` : "";
    const din2 = director2Din ? `(DIN- ${director2Din})` : "";
    paras.push(sigRow(din1, din2));
  }
  if (sigPlace || sigDate) {
    paras.push(blank());
    paras.push(wPara([{ text: `Place: ${sigPlace || ""}     Date: ${fmtDate(sigDate)}` }]));
  }

  // ── Build document.xml ────────────────────────────────────────────────────
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  mc:Ignorable="w14">
  <w:body>
    ${paras.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1800"
               w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ── Build .docx ZIP ───────────────────────────────────────────────────────
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", docRels);

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
