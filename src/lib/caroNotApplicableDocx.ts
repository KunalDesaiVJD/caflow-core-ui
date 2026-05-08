/**
 * caroNotApplicableDocx — generates a real .docx for the WITHOUT-CARO
 * report (CARO 2020 Not Applicable) using the docx library.
 *
 * Why this exists: the previous HTML→Word export went through Word's
 * HTML import which produced inconsistent line-wrap, ignored some
 * border / spacing CSS, and applied default font metrics that didn't
 * match the firm's hand-crafted template.  Generating a real .docx
 * with explicit paragraph properties (page margins, font, indents,
 * justification) gives Word the same inputs the template was authored
 * with, so line wraps land on the same words.
 *
 * Page setup (matches the firm's WITHOUT CARO.doc):
 *   • A4 portrait
 *   • 2 cm side margins, 1.5 cm top, 2 cm bottom
 *   • Body font: Times New Roman 10 pt
 *   • Title: bold + underlined, no indent
 *   • Body paragraphs: justified, no indent
 *   • Sub-heading "As required by section 143(3)…": justified,
 *     left indent 720 twip (0.5 inch ≈ 4 chars at Times 10pt)
 *   • Lettered points (a) – (h): justified, hanging indent
 *     (left 720, hanging 360 — marker hangs back into the indent)
 *   • Roman sub-points (i) – (iv): justified, deeper hanging indent
 *     (left 1440, hanging 360)
 *   • Signature block: 2-column borderless table (firm/partner left;
 *     Place / Date / UDIN right)
 *
 * 1 inch = 1440 twip ; 1 cm ≈ 567 twip ; 1 pt = 20 twip.
 */

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, BorderStyle, WidthType, HeightRule,
  TabStopType, TabStopPosition, PageOrientation,
} from "docx";

const FONT       = "Times New Roman";
const FONT_HALFP = 22;             // 11 pt = 22 half-points (default body)
const INTRO_HALFP = 20;            // 10 pt — applied only to the intro paragraph

// Indent values (twip — 1 inch = 1440)
// At Times 11pt, ~120 twip per character.  INDENT_SUBHEAD = 360 twip ≈ 3 chars
// — this is the previous 720 (≈ 6 chars) reduced by 3 character widths per
// user request ("remove 3 characters of space from the beginning of the
// heading: 'As required by section 143(3)…'").
const INDENT_SUBHEAD     = 360;
const INDENT_LETTER      = 720;    // (a) starts here
const INDENT_LETTER_HANG = 360;    // marker hangs back into this gap
const INDENT_ROMAN       = 1440;   // i. starts here
const INDENT_ROMAN_HANG  = 360;

// Tab stop AFTER each marker — keeps 1 char-width of gap regardless of
// marker length so "ii." and "iv." both align to the same text column.
const LETTER_TEXT_TAB = INDENT_LETTER;     // text starts at 720 twip
const ROMAN_TEXT_TAB  = INDENT_ROMAN;      // text starts at 1440 twip

/** Default text body — every glyph matches the firm's WITHOUT-CARO.doc. */
const DEFAULT_TITLE = "Report on Other Legal and Regulatory Requirements";

// Intro paragraph — verbatim per the firm's latest copy.  Rendered at
// INTRO_HALFP (10pt) regardless of the body's default 11pt.
const DEFAULT_INTRO =
  "The Company is a private limited company and falls within the exemptions " +
  "specified under paragraph 2(iv) of the Companies (Auditor's Report) Order, " +
  "2020. Hence, the matters specified in paragraphs 3 and 4 of the said Order " +
  "issued by the Central Government of India in terms of sub-section (11) of " +
  "section 143 of the Act are not enclosed.";

const DEFAULT_SUBHEAD =
  "As required by section 143(3) of the Act, we further report that:";

interface Letter { marker: string; text: string }
interface Roman  { marker: string; text: string }

const DEFAULT_LETTERS: Letter[] = [
  { marker: "a)", text:
    "We have sought and obtained all the information and explanations which " +
    "to the best of our knowledge and belief were necessary for the purpose of our audit;" },
  { marker: "b)", text:
    "In our opinion proper books of account as required by law have been kept " +
    "by the Company so far as it appears from our examination of those books;" },
  { marker: "c)", text:
    "The company does not have any branch, this para is not applicable." },
  { marker: "d)", text:
    "The Balance Sheet and Statement of Profit and Loss dealt with by this " +
    "Report are in agreement with the books of account;" },
  { marker: "e)", text:
    "In our opinion, the aforesaid financial statements comply with the " +
    "Accounting Standards specified under Section 133 of the Act, read with " +
    "Rule 7 of the Companies (Accounts) Rules 2014." },
  { marker: "f)", text:
    "On the basis of written representations received from the directors as on " +
    "March 31, {YEAR}, and taken on record by the Board of Directors, none of " +
    "the directors is disqualified as on March 31, {YEAR}, from being appointed " +
    "as a director in terms of Section 164(2) of the Act." },
  { marker: "g)", text:
    "The report on adequacy of the internal financial control over financial " +
    "reporting is not applicable as the company is falls within the exemptions " +
    "specified under sub-section 3(1) of section 143 of the Act." },
  { marker: "h)", text:
    "In our opinion and to the best of our information and according to the " +
    "explanations given to us, we report with respect to other matters to be " +
    "included in the Auditor's Report in accordance with Rule 11 of the " +
    "Companies (Audit and Auditors) Rules, 2014 as under:" },
];

const DEFAULT_ROMANS: Roman[] = [
  { marker: "i.",   text:
    "The Company does not have any pending litigations which would impact on its financial position." },
  { marker: "ii.",  text:
    "The Company did not have any long-term contracts including derivative " +
    "contracts for which there were any material foreseeable losses." },
  { marker: "iii.", text:
    "There were no amounts which were required to be transferred to the Investor " +
    "Education and Protection Fund by the Company." },
  { marker: "iv.",  text:
    "Based on our examination, the Company has used accounting software for " +
    "maintaining its books of account, which has a feature of recording audit " +
    "trail (edit log) facility and as informed by the management the same has " +
    "operated throughout the year for all relevant transactions recorded in the software." },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function tr(
  text: string,
  opts: { bold?: boolean; underline?: boolean; size?: number } = {},
): TextRun {
  return new TextRun({
    text,
    font: FONT,
    size: opts.size ?? FONT_HALFP,
    bold: !!opts.bold,
    underline: opts.underline ? {} : undefined,
  });
}

const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

/** Build a list-item paragraph with a hanging indent and a tab stop after
 *  the marker so the text always lines up at a fixed column.  Wrapped lines
 *  start at the same column.  Word handles this natively — no HTML quirks. */
function listItemPara(
  marker:  string,
  text:    string,
  indentLeft: number,
  hanging: number,
  tabStop: number,
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 280 },                 // 6pt after, 1.4 line
    indent: { left: indentLeft, hanging: hanging },
    tabStops: [{ type: TabStopType.LEFT, position: tabStop }],
    children: [tr(marker), tr("\t"), tr(text)],
  });
}

interface NotApplicableInputs {
  companyName:     string;
  fyEndYear:       string;       // e.g. "2026" — substituted for "{YEAR}"
  firmName:        string;
  firmFRN:         string;
  partnerName:     string;
  membershipNo:    string;
  place:           string;
  reportDateText:  string;       // already-formatted "DD.MM.YYYY"
  udin:            string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the full WITHOUT-CARO document and return a Blob ready for download.
 * Wrap-points match the firm's template because Word renders the .docx
 * directly — no HTML→native conversion in the middle.
 */
export async function buildCaroNotApplicableDocx(
  inputs: NotApplicableInputs,
): Promise<Blob> {
  const sub = (s: string) => s.replace(/\{YEAR\}/g, inputs.fyEndYear || "20XX");

  // ── Body ──────────────────────────────────────────────────────────────────
  const children: (Paragraph | Table)[] = [];

  // Title — bold + underlined
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 240, line: 280 },
    children: [tr(DEFAULT_TITLE, { bold: true, underline: true })],
  }));

  // Intro paragraph — justified, full-width.  Rendered at 10pt (INTRO_HALFP)
  // while the rest of the document stays at 11pt (FONT_HALFP).
  children.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 200, line: 280 },
    children: [tr(DEFAULT_INTRO, { size: INTRO_HALFP })],
  }));

  // Sub-heading — indented
  children.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 200, line: 280 },
    indent: { left: INDENT_SUBHEAD },
    children: [tr(DEFAULT_SUBHEAD)],
  }));

  // Lettered list a) … h)
  for (const l of DEFAULT_LETTERS) {
    children.push(listItemPara(
      l.marker, sub(l.text),
      INDENT_LETTER, INDENT_LETTER_HANG, LETTER_TEXT_TAB,
    ));
  }

  // Roman sub-list i. … iv.   (sits under (h))
  for (const r of DEFAULT_ROMANS) {
    children.push(listItemPara(
      r.marker, sub(r.text),
      INDENT_ROMAN, INDENT_ROMAN_HANG, ROMAN_TEXT_TAB,
    ));
  }

  // ── Signature block ────────────────────────────────────────────────────────
  // 2-cell borderless table: firm/partner left, Place/Date/UDIN right.
  const sigP = (text: string, opts: { bold?: boolean } = {}) =>
    new Paragraph({ children: [tr(text, opts)], spacing: { line: 280 } });

  const sigTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    rows: [new TableRow({
      height: { value: 240, rule: HeightRule.AUTO },
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: NO_BORDER,
          margins: { top: 120, bottom: 0, left: 0, right: 60 },
          children: [
            sigP(`For, ${inputs.firmName}`, { bold: true }),
            sigP(`Chartered Accountants`,    { bold: true }),
            sigP(`Firm Regi.No.${inputs.firmFRN}`, { bold: true }),
            sigP(``),
            sigP(``),
            sigP(``),
            sigP(inputs.partnerName, { bold: true }),
            sigP(`Partner`,           { bold: true }),
            sigP(`Membership No.${inputs.membershipNo}`, { bold: true }),
          ],
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: NO_BORDER,
          margins: { top: 120, bottom: 0, left: 60, right: 0 },
          children: [
            sigP(``),
            sigP(``),
            sigP(`Place :  ${inputs.place || "[Place]"}`,        { bold: true }),
            sigP(`Date  :  ${inputs.reportDateText || "[Date]"}`, { bold: true }),
            sigP(``),
            sigP(``),
            sigP(``),
            sigP(`UDIN :  ${inputs.udin || ""}`, { bold: true }),
          ],
        }),
      ],
    })],
  });
  children.push(sigTable);

  // ── Document ──────────────────────────────────────────────────────────────
  const doc = new Document({
    creator: "CAFlow",
    title: `CARO Not Applicable - ${inputs.companyName}`,
    styles: {
      default: { document: { run: { font: FONT, size: FONT_HALFP } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, // A4 in twip
          margin: { top: 850, right: 1134, bottom: 1134, left: 1134 }, // 1.5cm/2cm sides
        },
      },
      children,
    }],
  });

  // Use Packer.toBlob() in browser; fall back to toBuffer when toBlob is missing.
  const anyPacker = Packer as any;
  if (typeof anyPacker.toBlob === "function") {
    return await anyPacker.toBlob(doc);
  }
  const buf = await Packer.toBuffer(doc);
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
