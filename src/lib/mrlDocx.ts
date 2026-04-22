/**
 * mrlDocx.ts
 * Generates a Management Representation Letter as a .docx file using JSZip.
 * No extra dependencies — uses JSZip (already in the project).
 *
 * Format exactly matches MRL_Format.doc template:
 *   - Font : Cambria 10 pt throughout (via styles.xml default + per-run)
 *   - Body text is fully justified
 *   - Separator  : "= = = = =" characters (not a border line)
 *   - Title      : bold + underlined, centred
 *   - Date       : bold
 *   - To / Firm  : bold
 *   - "Chartered Accountants," : italic
 *   - "Re.:" line: "Re.: " plain + rest bold + underlined
 *   - "For COMPANY" : bold
 *   - Director labels / names / DINs : bold
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
  bold?:      boolean;
  italic?:    boolean;
  underline?: boolean;
  fontSize?:  number; // points, e.g. 12
}

interface ParaOpts extends RunOpts {
  centered?:        boolean;
  leftAlign?:       boolean; // explicit left (skips default justify)
  leftIndentTwips?: number;  // 720 = 0.5 inch
  hangingTwips?:    number;  // hanging indent (first line hangs left of leftIndentTwips)
  spaceBefore?:     number;  // twips
  spaceAfter?:      number;  // twips
  keepNext?:        boolean;
}

/**
 * Build a single run element.
 * Cambria font is always injected to match the MRL template.
 */
function wRun(text: string, opts: RunOpts = {}): string {
  const rPrParts: string[] = [];
  // Always use Cambria to match template
  rPrParts.push('<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>');
  if (opts.bold)      rPrParts.push("<w:b/><w:bCs/>");
  if (opts.italic)    rPrParts.push("<w:i/><w:iCs/>");
  if (opts.fontSize)  rPrParts.push(`<w:sz w:val="${opts.fontSize * 2}"/><w:szCs w:val="${opts.fontSize * 2}"/>`);
  if (opts.underline) rPrParts.push('<w:u w:val="single"/>');
  const rPr = `<w:rPr>${rPrParts.join("")}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Build a tab run. */
function wTab(): string {
  return "<w:r><w:tab/></w:r>";
}

/**
 * Build a paragraph with one or more runs.
 * Default alignment is "both" (fully justified) to match the template,
 * unless opts.centered or opts.leftAlign is set.
 */
function wPara(
  runs: Array<{ text: string } & RunOpts>,
  opts: ParaOpts = {}
): string {
  const pPrParts: string[] = [];

  // Alignment
  if (opts.centered) {
    pPrParts.push('<w:jc w:val="center"/>');
  } else if (opts.leftAlign) {
    pPrParts.push('<w:jc w:val="left"/>');
  } else {
    // Justify by default — matches MRL template
    pPrParts.push('<w:jc w:val="both"/>');
  }

  if (opts.leftIndentTwips || opts.hangingTwips) {
    const left    = opts.leftIndentTwips ?? 0;
    const hanging = opts.hangingTwips    ?? 0;
    pPrParts.push(
      hanging
        ? `<w:ind w:left="${left}" w:hanging="${hanging}"/>`
        : `<w:ind w:left="${left}"/>`
    );
  }
  if (opts.spaceBefore !== undefined || opts.spaceAfter !== undefined) {
    pPrParts.push(
      `<w:spacing${opts.spaceBefore !== undefined ? ` w:before="${opts.spaceBefore}"` : ""}` +
      `${opts.spaceAfter !== undefined ? ` w:after="${opts.spaceAfter}"` : ""}` +
      ` w:line="276" w:lineRule="auto"/>`
    );
  }
  if (opts.keepNext) pPrParts.push("<w:keepNext/>");
  const pPr = `<w:pPr>${pPrParts.join("")}</w:pPr>`;

  const runXml = runs.map((r) => wRun(r.text, r)).join("");
  return `<w:p>${pPr}${runXml}</w:p>`;
}

/** Empty paragraph (blank line). */
function blank(spacePt = 4): string {
  return `<w:p><w:pPr><w:spacing w:after="${spacePt * 20}"/></w:pPr></w:p>`;
}

/**
 * Section separator — "= = = = = ..." text centred, matching template.
 * (Template uses repeated "= =" characters, NOT a paragraph border line.)
 */
function mrlSeparator(): string {
  const line = "= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =";
  return wPara([{ text: line }], { centered: true, spaceAfter: 40 });
}

// ── Tab-stop helpers for 2-col signature ────────────────────────────────────

/**
 * Build a two-column signature row using a tab stop.
 * Col 1 at left margin, Col 2 at ~4320 twips (3 inches from margin).
 */
function sigRow(left: string, right: string, opts: RunOpts = {}): string {
  const tabStop = `<w:pPr><w:tabs><w:tab w:val="left" w:pos="4320"/></w:tabs></w:pPr>`;
  const leftRun  = wRun(left, opts);
  const tabRun   = wTab();
  const rightRun = wRun(right, opts);
  return `<w:p>${tabStop}${leftRun}${tabRun}${rightRun}</w:p>`;
}

/**
 * Numbered clause paragraph with hanging indent — matches template's
 *   margin-left:36pt; text-indent:-18pt; tab-stops:list 36.0pt
 *
 * OOXML layout:
 *   w:left="720"    → wrapped lines start at 36 pt
 *   w:hanging="360" → first line (the number) is at 36 pt − 18 pt = 18 pt
 *   tab stop @720   → tab after "N." jumps text to the 36 pt indent
 */
function clausePara(num: number, text: string, spaceAfterTwips: number): string {
  const indLeft = 720;  // 36 pt
  const indHang = 360;  // 18 pt
  const pPr = `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:tabs><w:tab w:val="left" w:pos="${indLeft}"/></w:tabs>` +
    `<w:ind w:left="${indLeft}" w:hanging="${indHang}"/>` +
    `<w:spacing w:after="${spaceAfterTwips}" w:line="276" w:lineRule="auto"/>` +
    `</w:pPr>`;
  return `<w:p>${pPr}${wRun(`${num}.`, { bold: true })}${wTab()}${wRun(text)}</w:p>`;
}

/**
 * Sub-clause paragraph (lines (a),(b),(c)…) with hanging indent — matches template's
 *   margin-left:63pt; text-indent:-18pt
 *
 * OOXML layout:
 *   w:left="1260"   → wrapped lines start at 63 pt
 *   w:hanging="360" → first line label "(a)" is at 63 pt − 18 pt = 45 pt
 */
function subClausePara(text: string, spaceAfterTwips: number): string {
  const indLeft = 1260; // 63 pt
  const indHang = 360;  // 18 pt
  const pPr = `<w:pPr>` +
    `<w:jc w:val="both"/>` +
    `<w:ind w:left="${indLeft}" w:hanging="${indHang}"/>` +
    `<w:spacing w:after="${spaceAfterTwips}" w:line="276" w:lineRule="auto"/>` +
    `</w:pPr>`;
  return `<w:p>${pPr}${wRun(text)}</w:p>`;
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
  // Company name: 16 pt bold centered (matches template 16pt Cambria bold)
  paras.push(wPara([{ text: companyName, bold: true, fontSize: 16 }], { centered: true, spaceAfter: 40 }));
  if (cin) {
    paras.push(wPara([{ text: `(CIN - ${cin})`, bold: true }], { centered: true, spaceAfter: 20 }));
  }
  if (address) {
    paras.push(wPara([{ text: address, bold: true }], { centered: true, spaceAfter: 40 }));
  }

  // Separator: "= = = =" characters — matches template (NOT a border line)
  paras.push(mrlSeparator());
  paras.push(blank(6));

  // ── 2. Title ───────────────────────────────────────────────────────────────
  // Template: bold + underlined, centred, 10 pt Cambria
  paras.push(wPara(
    [{ text: "MANAGEMENT REPRESENTATION LETTER", bold: true, underline: true }],
    { centered: true, spaceBefore: 120, spaceAfter: 120 }
  ));

  // ── 3. Date ────────────────────────────────────────────────────────────────
  // Template: bold, left-aligned
  paras.push(wPara([{ text: fmtDate(date), bold: true }], { leftAlign: true, spaceAfter: 80 }));
  paras.push(blank());

  // ── 4. Addressee ──────────────────────────────────────────────────────────
  // "To" and firm name are bold; "Chartered Accountants," is italic; city is plain
  paras.push(wPara([{ text: "To", bold: true }], { leftAlign: true }));
  const toName = firmName || "Your CA Firm";
  paras.push(wPara([{ text: `${toName},`, bold: true }], { leftAlign: true }));
  paras.push(wPara([{ text: "Chartered Accountants,", italic: true }], { leftAlign: true }));
  if (firmCity) {
    paras.push(wPara([{ text: `${firmCity}.` }], { leftAlign: true }));
  }
  paras.push(blank());

  // ── 5. Salutation ─────────────────────────────────────────────────────────
  paras.push(wPara([{ text: "Dear Sir," }], { leftAlign: true }));
  paras.push(blank());

  // ── 6. Subject line ───────────────────────────────────────────────────────
  // Template: "Re.: " is plain; "Statutory Audit..." is bold + underlined
  paras.push(wPara([
    { text: "Re.: " },
    { text: `Statutory Audit of the Company for the year ended 31st March, ${auditYear}.`, bold: true, underline: true },
  ]));
  paras.push(blank());

  // ── 7. Opening Paragraph ──────────────────────────────────────────────────
  const openLines = (openingPara || "").split("\n");
  for (const line of openLines) {
    paras.push(wPara([{ text: line }], { spaceAfter: 40 }));
  }
  paras.push(blank());

  // ── 8. Clauses ────────────────────────────────────────────────────────────
  // Format: "N.  [first line of text]" inline — number bold, text normal.
  // Additional lines (sub-clauses like (a),(b),(c)) are indented below.
  let clauseNum = 1;
  for (const clause of selectedClauses) {
    // Replace [CASH_AMOUNT] token with actual amount
    const clauseText = clause.text.replace(/\[CASH_AMOUNT\]/g, cashAmount || "______");

    const lines = clauseText.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) { clauseNum++; continue; }

    // First line: numbered clause with hanging indent matching template's
    // ol>li margin-left:36pt; text-indent:-18pt; tab-stops:list 36.0pt
    // spaceAfter 140 twips ≈ 7pt blank paragraph gap used between clauses in template.
    paras.push(clausePara(clauseNum, lines[0], lines.length > 1 ? 20 : 140));

    // Remaining lines (sub-clauses like (a),(b),(c)) — hanging indent matching
    // template's margin-left:63pt; text-indent:-18pt
    for (let i = 1; i < lines.length; i++) {
      paras.push(subClausePara(lines[i], i === lines.length - 1 ? 140 : 20));
    }

    clauseNum++;
  }

  // ── 9. Closing ────────────────────────────────────────────────────────────
  paras.push(blank());
  paras.push(wPara([{ text: "Thank You," }], { leftAlign: true }));
  paras.push(blank());
  // "For COMPANY" is bold in the template
  paras.push(wPara([{ text: `For ${companyName}`, bold: true }], { leftAlign: true }));
  paras.push(blank());
  paras.push(blank());
  paras.push(blank());

  // ── 10. Signature Block (two-column via tab stops) ────────────────────────
  // Template format (all bold):
  //   Director               Director
  //   [Name1]                [Name2]
  //   (DIN- xxx)             (DIN- xxx)
  //   Place: xxx   Date: xxx
  paras.push(sigRow("Director", "Director", { bold: true }));
  const d1 = director1Name || "";
  const d2 = director2Name || "";
  if (d1 || d2) {
    paras.push(sigRow(d1, d2, { bold: true }));
  }
  if (director1Din || director2Din) {
    const din1 = director1Din ? `(DIN- ${director1Din})` : "";
    const din2 = director2Din ? `(DIN- ${director2Din})` : "";
    paras.push(sigRow(din1, din2, { bold: true }));
  }
  // Place/Date intentionally omitted — not present in MRL template

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

  // ── styles.xml — sets Cambria 10 pt as document default ──────────────────
  // This ensures the base font matches the template even for runs that
  // don't override the font explicitly.
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>
        <w:sz w:val="20"/>
        <w:szCs w:val="20"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:jc w:val="both"/>
        <w:spacing w:after="0" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="both"/>
      <w:spacing w:after="0" w:line="276" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>
</w:styles>`;

  // ── Build .docx ZIP ───────────────────────────────────────────────────────
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
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
