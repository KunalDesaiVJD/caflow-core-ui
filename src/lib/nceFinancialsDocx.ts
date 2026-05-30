/**
 * nceFinancialsDocx.ts
 * Big4-style Word (.docx) export for NCE Financial Statements.
 *
 * Phase 1: Balance Sheet (page 1) + Profit & Loss (page 2) + Signature block
 * Phase 2: Notes 1–28 (portrait) + PPE Schedule (landscape)
 *
 * Uses the `docx` npm package (already installed in this project).
 * No new dependencies required.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalAlignSection,
  WidthType,
} from "docx";

import { NOTES_CONFIG, NOTE_META, computeDisplayData, extractSplitData } from "@/config/nceNotesConfig";
import type { NoteConfig, NoteRowDef } from "@/config/nceNotesConfig";
import { getActiveFsDivisor, FS_SCALES } from "@/lib/fsUnits";
import { getDynamicNoteDisplay } from "@/lib/nceDynamicNoteNumbers";

// ─── Export-time unit scale (set at start of generateNCEFinancialsDocx) ───────
// These module-level vars are read by fmt() and all header helpers so every
// amount and column label reflects the user's active Actual / '000 / Lakhs toggle.
let _exportDivisor = 1;
let _exportSuffix  = "(₹)";   // e.g. "(₹ in '000)"  — used in column headers
let _exportUnit    = "₹";     // e.g. "₹ in '000"    — used in prose ("All amounts in …")

function amountUnitsLabel(): string {
  // KD1: keep this one "Amounts in ₹" note (drop the leading "All").
  return `Amounts in ${_exportUnit}`;
}

// KD3 + KD6: strip the ₹ glyph from every column header, but keep any scale
// qualifier so '000 / Lakhs is still indicated.
//   "(₹)" → ""   |   "(₹ in '000)" → "(in '000)"   |   "(₹ in Lakhs)" → "(in Lakhs)"
function headerSuffix(): string {
  return _exportSuffix.replace(/₹\s*/g, "").replace(/\(\s*\)/g, "").trim();
}

/** Column-header text: label, plus the (₹-free) scale qualifier on a 2nd line. */
function hdr(label: string): string {
  const suf = headerSuffix();
  return suf ? `${label}\n${suf}` : label;
}

// ─── Layout (all DXA: 1 inch = 1440 DXA) ─────────────────────────────────────
const A4_W   = 11906;           // A4 width
const A4_H   = 16838;           // A4 height
const MARG_L = 864;             // 0.6" left — modest room for hole-punch / binding
const MARG_R = 576;             // 0.4" right
const MARG_T = 720;             // 0.5" top
const MARG_B = 720;             // 0.5" bottom — tightened for better one-page BS/PL fit
// Task 11 (doc6): notes pages get a larger bottom margin to preserve blank area
// for physical stamp/seal placement on printed documents.
const MARG_B_NOTES = 1440;      // 1.0" bottom — stamp-safe space on notes pages
const TW     = A4_W - MARG_L - MARG_R; // 10466 DXA — usable table width (unchanged)

// Columns: [Particulars, Note No., CY Amount, PY Amount]  →  must sum to TW
// Particulars trimmed so the Note No. + amount columns soak up the dead space
// that used to sit after column 1; amounts get noticeably wider.
const CW_DESC = 5800;
const CW_NOTE = 500;
const CW_CY   = 2083;
const CW_PY   = 2083;
// 5800 + 500 + 2083 + 2083 = 10466 ✓

// ─── Phase 2 — Note table column widths ───────────────────────────────────────
// Pattern B (3 cols): Particulars | CY | PY  →  must sum to TW = 10466
const NW_DESC = 7550;
const NW_CY   = 1458;
const NW_PY   = 1458;
// 7550+1458+1458 = 10466 ✓

// Pattern A (5 cols): Particulars | LT CY | LT PY | ST CY | ST PY
const NW_A_DESC = 5000;
const NW_A_LTCY = 1366;
const NW_A_LTPY = 1366;
const NW_A_STCY = 1367;
const NW_A_STPY = 1367;
// 5000+1366+1366+1367+1367 = 10466 ✓

// Capital Account portrait cols (10 cols):
//   Sr No | Partner | Share % | Opening | Introduced | Remuneration |
//   Interest | Withdrawals | Profit Share | Closing
const CAP_SR   = 450;
const CAP_NAME = 2300;
const CAP_PCT  = 850;
const CAP_NUM  = 980;   // × 6 (Opening … Profit Share)
const CAP_LAST = 986;   // 450+2300+850+6×980+986 = 10466 ✓

// Landscape (PPE Schedule) — same punch margin on the (left) binding edge
const TW_LS   = A4_H - MARG_L - MARG_R; // 16838 - 864 - 576 = 15398 DXA
// PPE cols — 9 cols after removing duplicate Net Block CY/PY columns (Task 7)
// (TW_LS - PPE_CAT - PPE_NAME - PPE_RATE) / 6 numeric cols = (15398-2500-2700-700)/6 = 1583
const PPE_CAT  = 2500;
const PPE_NAME = 2700;
const PPE_RATE =  700;
const PPE_NUM  = 1583;  // equal width for all 6 numeric columns
// 2500+2700+700+6×1583 = 5900+9498 = 15398 ✓

// ─── Typography ───────────────────────────────────────────────────────────────
// Task 1: mutable so the caller can pass a selected font family.
let FONT     = "Arial";
const SZ_XS    = 14;   // 7pt  — footnotes
const SZ_SM    = 16;   // 8pt  — column headers, footer
const SZ_BODY  = 18;   // 9pt  — data rows
const SZ_HDR    = 20;  // 10pt — section labels
const SZ_TITLE  = 22;  // 11pt — statement title + date line
const SZ_ENTITY = 28;  // 14pt — entity name (main heading)

// ─── Colour palette ───────────────────────────────────────────────────────────
const NAVY    = "1F3864";   // deep navy  — brand colour
const BG_HDR  = "1F3864";   // column header background
const BG_SECT = "D6E4F0";   // section row (light blue)
const BG_TOT  = "EBF1FA";   // subtotal row (slightly lighter)
const BG_GRAN = "D9E2F3";   // grand total row
const DK_GREY = "505050";   // secondary text
const BLACK   = "000000";
const WHITE   = "FFFFFF";

// ─── Border helpers ───────────────────────────────────────────────────────────
const bNone = { style: BorderStyle.NONE,   size: 0, color: "FFFFFF" };
const bHair = { style: BorderStyle.SINGLE, size: 2, color: "CBCBCB" };  // hairline row separator
const bThin = { style: BorderStyle.SINGLE, size: 4, color: NAVY };       // section top border
const bBold = { style: BorderStyle.SINGLE, size: 8, color: NAVY };       // grand total border

// ─── Page border (frame around every page — Task 3 doc8) ──────────────────────
// Matches the corporate DOCX page border: navy single rule, 12 half-points,
// 24-twips space from edge.  Applied to portrait AND landscape sections.
const _pgBdr = {
  pageBorders: {
    display: PageBorderDisplay.ALL_PAGES,
    offsetFrom: PageBorderOffsetFrom.PAGE,
  },
  pageBorderTop:    { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 24 },
  pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 24 },
  pageBorderLeft:   { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 24 },
  pageBorderRight:  { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 24 },
};

const BDR_NONE  = { top: bNone, bottom: bNone, left: bNone, right: bNone };
const BDR_ROW   = { top: bNone, bottom: bHair, left: bNone, right: bNone };
const BDR_SECT  = { top: bThin, bottom: bNone, left: bNone, right: bNone };
const BDR_SUB   = { top: bThin, bottom: bThin, left: bNone, right: bNone };
const BDR_GRAND = { top: bBold, bottom: bBold, left: bNone, right: bNone };

// ─── Task 1 (Issue 2): FY range helper — converts "2026" → "2025-26" ─────────
function fyRange(year: string): string {
  const y = parseInt(year, 10);
  if (isNaN(y)) return year;
  return `${y - 1}-${String(y).slice(-2)}`;
}

// ─── Task 4/2 helper: is a row invisible (both amounts zero)? ─────────────────
function blank(cy: number, py: number): boolean {
  return !cy && !py;
}

// ─── Amount formatter — Indian numbering system + active unit scale ───────────
function fmt(n: number): string {
  const scaled = _exportDivisor === 1 ? n : n / _exportDivisor;
  if (Math.abs(scaled) < 0.5) return "—";
  const abs = Math.round(Math.abs(scaled));
  const str = abs.toLocaleString("en-IN");
  return scaled < 0 ? `(${str})` : str;
}

// Sign helpers — Tally stores credits as negative, debits as positive
/** Liabilities / equity: stored as credit (negative) → flip sign for display */
function L(code: string, amts: Record<string, number>): number {
  return -(amts[code] ?? 0);
}
/** Assets / expenses: stored as debit (positive) → direct */
function A(code: string, amts: Record<string, number>): number {
  return amts[code] ?? 0;
}
/** Income: stored as credit (negative) → flip sign for display */
function I(code: string, amts: Record<string, number>): number {
  return -(amts[code] ?? 0);
}

// ─── Cell builder ─────────────────────────────────────────────────────────────
interface CellOpts {
  w: number;
  text: string;
  sz?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: AlignmentType;
  bg?: string;
  borders?: Record<string, typeof bNone>;
  padL?: number;
  padR?: number;
  indent?: number;   // each level = 200 DXA additional left pad
  colSpan?: number;
  /** Task 10 (doc6): hanging indent for multi-line wrapped text.
   *  Continuation lines indent by this many DXA, aligning below the description
   *  text rather than below the row prefix (I./V./(a) etc.). */
  hangingIndent?: number;
  /** Task 1 (doc8): override top/bottom cell margin (DXA).
   *  Default 28 for BS/PL rows; note-table rows use 18 for tighter page fitting. */
  vertPad?: number;
  /** "Keep with next" — when true the cell's paragraph is bound to the following
   *  block. Set on every note-table row (except via the trailing gap) so an entire
   *  note moves to the next page intact rather than splitting across a page break.
   *  Word still breaks a note larger than one page (keepNext is a soft constraint). */
  keepNext?: boolean;
}

function cell(o: CellOpts): TableCell {
  const {
    w, text,
    sz     = SZ_BODY,
    bold   = false,
    italic = false,
    color  = BLACK,
    align  = AlignmentType.LEFT,
    bg,
    borders = BDR_ROW,
    padL    = 80,
    padR    = 80,
    indent  = 0,
    colSpan,
    hangingIndent,
    vertPad = 28,
    keepNext = false,
  } = o;

  return new TableCell({
    ...(colSpan ? { columnSpan: colSpan } : {}),
    width:   { size: w, type: WidthType.DXA },
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    borders,
    margins: { top: vertPad, bottom: vertPad, left: padL + indent * 200, right: padR },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      spacing:   { before: 0, after: 0, line: 240, lineRule: "auto" as any },
      ...(keepNext ? { keepNext: true, keepLines: true } : {}),
      // Task 10 (doc6): hanging indent so wrapped text aligns below description, not below prefix
      ...(hangingIndent ? { indent: { left: hangingIndent, hanging: hangingIndent } } : {}),
      children: [new TextRun({ text, font: FONT, size: sz, bold, italic, color })],
    })],
  });
}

/** Amount cell — right-aligned */
function ac(
  val: number,
  w: number,
  opts: { bold?: boolean; bg?: string; borders?: Record<string, typeof bNone>; vertPad?: number; keepNext?: boolean } = {},
): TableCell {
  return cell({
    text:    fmt(val),
    w,
    align:   AlignmentType.RIGHT,
    padL:    20,
    padR:    120,
    bold:    opts.bold,
    bg:      opts.bg,
    borders: opts.borders ?? BDR_ROW,
    vertPad: opts.vertPad,
    keepNext: opts.keepNext,
  });
}

/** Empty placeholder cell */
function ec(w: number, bg?: string, borders?: Record<string, typeof bNone>): TableCell {
  return cell({ text: "", w, bg, borders: borders ?? BDR_ROW });
}

// ─── Standard row factories ───────────────────────────────────────────────────

/** Dark navy column-header row */
function colHeaderRow(cyLabel: string, pyLabel: string): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "Particulars",    w: CW_DESC, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      cell({ text: "Note\nNo.",      w: CW_NOTE, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
      cell({ text: hdr(cyLabel), w: CW_CY,  sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
      cell({ text: hdr(pyLabel), w: CW_PY,  sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
    ],
  });
}

/** Full-width section label (e.g. "EQUITY AND LIABILITIES") */
function sectionRow(label: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        shading: { fill: BG_SECT, type: ShadingType.CLEAR },
        borders: BDR_SECT,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: label, font: FONT, size: SZ_HDR, bold: true, color: NAVY })],
        })],
      }),
    ],
  });
}

/** Sub-section parent label (no amounts) */
function parentRow(label: string, indent = 0): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        borders: BDR_ROW,
        margins: { top: 30, bottom: 30, left: 100 + indent * 200, right: 80 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0, line: 260, lineRule: "auto" as any },
          children: [new TextRun({ text: label, font: FONT, size: SZ_BODY, bold: true, color: BLACK })],
        })],
      }),
    ],
  });
}

/** Data item row: label | note no. | CY | PY */
function dataRow(
  label: string,
  noteNo: number | null,
  cy: number,
  py: number,
  indent = 0,
  bg?: string,
): TableRow {
  // Task 10 (doc6): hanging indent so text wrapping in multi-line labels aligns
  // below the description text, not below the Roman/letter prefix. 280 DXA ≈
  // width of "I.    " at 9pt Arial — keeps continuation lines visually aligned.
  const HANGING = 280;
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, indent, bg, borders: BDR_ROW, hangingIndent: HANGING }),
      cell({
        text: noteNo ? String(noteNo) : "",
        w: CW_NOTE,
        align: AlignmentType.CENTER,
        bold: true,
        color: noteNo ? NAVY : BLACK,
        bg,
        borders: BDR_ROW,
      }),
      ac(cy, CW_CY, { bg }),
      ac(py, CW_PY, { bg }),
    ],
  });
}

/** Subtotal row (thin top + bottom border) */
function subTotalRow(label: string, cy: number, py: number): TableRow {
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, bold: true, bg: BG_TOT, borders: BDR_SUB }),
      ec(CW_NOTE, BG_TOT, BDR_SUB),
      ac(cy, CW_CY, { bold: true, bg: BG_TOT, borders: BDR_SUB }),
      ac(py, CW_PY, { bold: true, bg: BG_TOT, borders: BDR_SUB }),
    ],
  });
}

/** Grand total row (bold navy border) */
// Task 9: allow right-aligning the label (used for "TOTAL" row in the BS)
function grandTotalRow(
  label: string,
  cy: number,
  py: number,
  labelAlign: AlignmentType = AlignmentType.LEFT,
): TableRow {
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, bold: true, sz: SZ_HDR, bg: BG_GRAN, borders: BDR_GRAND, padL: 100, align: labelAlign }),
      ec(CW_NOTE, BG_GRAN, BDR_GRAND),
      ac(cy, CW_CY, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(py, CW_PY, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
    ],
  });
}

/** Blank spacer row (very small height) */
function blankRow(): TableRow {
  return new TableRow({
    children: [
      cell({ text: "", w: CW_DESC, sz: 10, borders: BDR_NONE }),
      cell({ text: "", w: CW_NOTE, sz: 10, borders: BDR_NONE }),
      cell({ text: "", w: CW_CY,   sz: 10, borders: BDR_NONE }),
      cell({ text: "", w: CW_PY,   sz: 10, borders: BDR_NONE }),
    ],
  });
}

/** Title block: entity name + statement title centered, with the date
 *  centered below and the "All amounts in …" note pushed to the right. */
function titleRows(
  entityName: string,
  statementTitle: string,
  dateLine: string,
): TableRow[] {
  // Full-width, single-line, centered row factory
  const centerRow = (
    text: string,
    opts: { sz?: number; bold?: boolean; color?: string; top?: number; bottom?: number } = {},
  ): TableRow =>
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: BDR_NONE,
          margins: { top: opts.top ?? 0, bottom: opts.bottom ?? 0, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { before: 0, after: 0 },
            children: [new TextRun({
              text,
              font:   FONT,
              size:   opts.sz ?? SZ_TITLE,
              bold:   opts.bold ?? false,
              color:  opts.color ?? NAVY,
            })],
          })],
        }),
      ],
    });

  return [
    // Entity name — centered, larger (main heading)
    centerRow(entityName.toUpperCase(), { sz: SZ_ENTITY, bold: true, color: NAVY, top: 60, bottom: 20 }),
    // Statement title + date on one centered line
    centerRow(`${statementTitle} ${dateLine}`, { sz: SZ_TITLE, bold: true, color: NAVY, bottom: 10 }),
    // "All amounts in …" note — own line below, right aligned, with bottom border
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: { top: bNone, bottom: bBold, left: bNone, right: bNone },
          margins: { top: 0, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing:   { before: 0, after: 0 },
            children: [new TextRun({ text: amountUnitsLabel(), font: FONT, size: SZ_SM, color: DK_GREY })],
          })],
        }),
      ],
    }),
  ];
}

// ─── BALANCE SHEET TABLE ──────────────────────────────────────────────────────
// Task 4: helper — returns [dataRow] or [] when both years are blank
function maybeRow(
  label: string, noteNo: number | null, cy: number, py: number,
  indent = 0, bg?: string,
): TableRow[] {
  return blank(cy, py) ? [] : [dataRow(label, noteNo, cy, py, indent, bg)];
}

function buildBSTable(
  cy: Record<string, number>,
  py: Record<string, number>,
  cyYear: string,
  pyYear: string,
  entityName: string,
  noteMap: Map<number, number>,
): Table {
  // Use the dynamic note number (same map as the UI). A line whose note is
  // inactive (no data) returns null → no number shown, matching the UI's "—".
  const n = (ref: number | null) => (ref ? (noteMap.get(ref) ?? null) : null);

  // Pre-compute amounts for blank-row filtering
  const capCy  = L("NCE_CAP", cy),  capPy  = L("NCE_CAP", py);
  const ltbCy  = L("NCE_LTB", cy),  ltbPy  = L("NCE_LTB", py);
  const oltlCy = L("NCE_OLTL",cy),  oltlPy = L("NCE_OLTL",py);
  const ltpCy  = L("NCE_LTP", cy),  ltpPy  = L("NCE_LTP", py);
  const stbCy  = L("NCE_STB", cy),  stbPy  = L("NCE_STB", py);
  const tpCy   = L("NCE_TP",  cy),  tpPy   = L("NCE_TP",  py);
  const oclCy  = L("NCE_OCL", cy),  oclPy  = L("NCE_OCL", py);
  const stpCy  = L("NCE_STP", cy),  stpPy  = L("NCE_STP", py);

  const ppeCy  = A("NCE_PPE",   cy), ppePy  = A("NCE_PPE",   py);
  const intgCy = A("NCE_INTG",  cy), intgPy = A("NCE_INTG",  py);
  const cwipCy = A("NCE_CWIP",  cy), cwipPy = A("NCE_CWIP",  py);
  const ncinvCy= A("NCE_NCINV",cy), ncinvPy= A("NCE_NCINV",py);
  const ltlaCy = A("NCE_LTLA",  cy), ltlaPy = A("NCE_LTLA",  py);
  const oncaCy = A("NCE_ONCA",  cy), oncaPy = A("NCE_ONCA",  py);
  const cinvCy = A("NCE_CINV",  cy), cinvPy = A("NCE_CINV",  py);
  const stckCy = A("NCE_STCK",  cy), stckPy = A("NCE_STCK",  py);
  const trCy   = A("NCE_TR",    cy), trPy   = A("NCE_TR",    py);
  const cashCy = A("NCE_CASH",  cy), cashPy = A("NCE_CASH",  py);
  const stlaCy = A("NCE_STLA",  cy), stlaPy = A("NCE_STLA",  py);
  const ocaCy  = A("NCE_OCA",   cy), ocaPy  = A("NCE_OCA",   py);

  // Totals
  const totELcy = L("NCE_EL",  cy);
  const totELpy = L("NCE_EL",  py);
  const totAcy  = A("NCE_AST", cy);
  const totApy  = A("NCE_AST", py);

  const rows: TableRow[] = [
    ...titleRows(
      entityName,
      "BALANCE SHEET",
      `AS AT 31 MARCH ${cyYear}`,
    ),
    colHeaderRow(`As at 31 Mar ${cyYear}`, `As at 31 Mar ${pyYear}`),

    // ── EQUITY AND LIABILITIES ────────────────────────────────────────
    sectionRow("EQUITY AND LIABILITIES"),

    parentRow("(1)  Owners Funds"),
    dataRow("        (a)  Owners' Capital Account", n(2), capCy, capPy, 0),

    parentRow("(2)  Non-Current Liabilities"),
    dataRow("        (a)  Long-term borrowings",        n(3), ltbCy,  ltbPy),
    dataRow("        (b)  Other long-term liabilities", n(4), oltlCy, oltlPy),
    dataRow("        (c)  Long-term provisions",        n(5), ltpCy,  ltpPy),

    parentRow("(3)  Current Liabilities"),
    dataRow("        (a)  Short-term borrowings",    n(6), stbCy, stbPy),
    dataRow("        (b)  Trade payables",           n(7), tpCy,  tpPy),
    dataRow("        (c)  Other current liabilities",n(8), oclCy, oclPy),
    dataRow("        (d)  Short-term provisions",    n(9), stpCy, stpPy),

    blankRow(),
    grandTotalRow("TOTAL", totELcy, totELpy, AlignmentType.RIGHT),
    blankRow(),

    // ── ASSETS ───────────────────────────────────────────────────────────
    sectionRow("ASSETS"),

    parentRow("(1)  Non-Current Assets"),
    parentRow("        (a)  Property, Plant & Equipment and Intangible Assets"),
    // Task 3 (doc8): reduced excessive left indent on (i)/(ii)/(iii) child rows
    dataRow("             (i)   Property, plant and equipment", n(10), ppeCy,  ppePy,  1),
    dataRow("             (ii)  Intangible assets",             n(12), intgCy, intgPy, 1),
    dataRow("             (iii) Capital work-in-progress",      n(11), cwipCy, cwipPy, 1),
    dataRow("        (b)  Non-current investments",          n(13), ncinvCy, ncinvPy),
    dataRow("        (c)  Long-term loans and advances",    n(14), ltlaCy,  ltlaPy),
    dataRow("        (d)  Other non-current assets",        n(15), oncaCy,  oncaPy),

    parentRow("(2)  Current Assets"),
    dataRow("        (a)  Current investments",          n(16), cinvCy, cinvPy),
    dataRow("        (b)  Inventories",                  n(17), stckCy, stckPy),
    dataRow("        (c)  Trade receivables",            n(18), trCy,   trPy),
    dataRow("        (d)  Cash and bank balances",       n(19), cashCy, cashPy),
    dataRow("        (e)  Short-term loans and advances",n(20), stlaCy, stlaPy),
    dataRow("        (f)  Other current assets",         n(21), ocaCy,  ocaPy),

    blankRow(),
    grandTotalRow("TOTAL", totAcy, totApy, AlignmentType.RIGHT),
    blankRow(),

    // ── Footnote ─────────────────────────────────────────────────────────
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: BDR_NONE,
          margins: { top: 40, bottom: 20, left: 100, right: 100 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [
              new TextRun({ text: `Note ${n(1) ?? 1} `, font: FONT, size: SZ_BODY, bold: true, color: NAVY }),
              new TextRun({
                text: "Significant Accounting Policies and Notes to Accounts form an integral part of the Financial Statements.",
                font: FONT, size: SZ_BODY, italic: true, color: DK_GREY,
              }),
            ],
          })],
        }),
      ],
    }),
  ];

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [CW_DESC, CW_NOTE, CW_CY, CW_PY],
    rows,
  });
}

// ─── PROFIT & LOSS TABLE ──────────────────────────────────────────────────────
function buildPLTable(
  cy: Record<string, number>,
  py: Record<string, number>,
  cyYear: string,
  pyYear: string,
  entityName: string,
  noteMap: Map<number, number>,
  /** Task 7 (doc6): optional COGS note data for sub-classification in P&L.
   *  When provided, "Cost of goods sold" is shown with (i)/(ii)/(iii) sub-items. */
  cogsNoteCy?: Record<string, number>,
  cogsNotePy?: Record<string, number>,
): Table {
  const n = (ref: number | null) => (ref ? (noteMap.get(ref) ?? null) : null);

  // Income
  const revOpsCy = I("NCE_REV_OPS", cy);  const revOpsPy = I("NCE_REV_OPS", py);
  const revOthCy = I("NCE_REV_OTH", cy);  const revOthPy = I("NCE_REV_OTH", py);
  const totIncCy = revOpsCy + revOthCy;    const totIncPy = revOpsPy + revOthPy;

  // COGS includes changes in inventories (NCE_CII hidden from display but included in total)
  const cogsCy = A("NCE_COGS", cy) + A("NCE_CII", cy);
  const cogsPy = A("NCE_COGS", py) + A("NCE_CII", py);
  const empCy  = A("NCE_EMP_EXP",  cy);   const empPy  = A("NCE_EMP_EXP",  py);
  const finCy  = A("NCE_FIN_COST", cy);   const finPy  = A("NCE_FIN_COST", py);
  const depCy  = A("NCE_DEPR",     cy);   const depPy  = A("NCE_DEPR",     py);
  const othCy  = A("NCE_OTH_EXP",  cy);   const othPy  = A("NCE_OTH_EXP",  py);
  const totExpCy = cogsCy + empCy + finCy + depCy + othCy;
  const totExpPy = cogsPy + empPy + finPy + depPy + othPy;

  // Profit chain
  const pVcy   = totIncCy - totExpCy;         const pVpy   = totIncPy - totExpPy;
  // Exceptional / extraordinary: treat as income-convention (flip sign)
  const excCy  = I("NCE_EXCEP",  cy);          const excPy  = I("NCE_EXCEP",  py);
  const pVIIcy = pVcy + excCy;                 const pVIIpy = pVpy + excPy;
  const extCy  = I("NCE_EXTORD", cy);          const extPy  = I("NCE_EXTORD", py);
  const pIXcy  = pVIIcy + extCy;               const pIXpy  = pVIIpy + extPy;
  const remCy  = A("NCE_PART_REM", cy);        const remPy  = A("NCE_PART_REM", py);
  const pXIcy  = pIXcy - remCy;               const pXIpy  = pIXpy - remPy;
  const curTaxCy   = A("NCE_CUR_TAX",   cy);   const curTaxPy   = A("NCE_CUR_TAX",   py);
  const priorTaxCy = A("NCE_PRIOR_TAX", cy);   const priorTaxPy = A("NCE_PRIOR_TAX", py);
  const deferTaxCy = A("NCE_DEFER_TAX", cy);   const deferTaxPy = A("NCE_DEFER_TAX", py);
  const totTaxCy   = curTaxCy + priorTaxCy + deferTaxCy;
  const totTaxPy   = curTaxPy + priorTaxPy + deferTaxPy;
  const netProfCy  = pXIcy - totTaxCy;         const netProfPy  = pXIpy - totTaxPy;

  // Discontinued operations (XIV–XVII)
  const discOpCy    = A("NCE_DISC_OP",  cy);   const discOpPy    = A("NCE_DISC_OP",  py);
  const discTaxCy   = A("NCE_DISC_TAX", cy);   const discTaxPy   = A("NCE_DISC_TAX", py);
  const discAtCy    = discOpCy - discTaxCy;     const discAtPy    = discOpPy - discTaxPy;
  const finalProfCy = netProfCy + discAtCy;     const finalProfPy = netProfPy + discAtPy;

  const rows: TableRow[] = [
    ...titleRows(
      entityName,
      "PROFIT AND LOSS STATEMENT",
      `FOR THE YEAR ENDED 31 MARCH ${cyYear}`,
    ),
    colHeaderRow(`Year ended 31 Mar ${cyYear}`, `Year ended 31 Mar ${pyYear}`),

    // ── INCOME ───────────────────────────────────────────────────────────
    sectionRow("INCOME"),
    dataRow("I.    Revenue from operations",   n(22), revOpsCy, revOpsPy),
    dataRow("II.   Other income",              n(23), revOthCy, revOthPy),
    subTotalRow("III.  Total Income (I + II)", totIncCy, totIncPy),
    blankRow(),

    // ── EXPENSES ─────────────────────────────────────────────────────────
    sectionRow("EXPENSES"),
    // Task 7 (doc6): when COGS note data is available, show sub-classification
    // (i) Cost of Materials Consumed, (ii) Purchases of Stock-in-Trade,
    // (iii) Changes in Inventories — matching the Notes to Accounts structure.
    // Task 3 (doc8): reduced child row indentation (6 spaces + indent:1).
    // Task 4 (doc8): use maybeRow() so sub-rows with zero data are hidden,
    // and only show note number when the row has a non-zero amount.
    // Root-cause fix (Word ≠ App on COGS sub-items): the on-screen App P&L
    // (buildNCEPLRows) renders the three Cost-of-Goods-Sold sub-lines from the FS
    // COMPUTED AMOUNTS — (i) = NCE_COGS, (ii) = blank, (iii) = NCE_CII — NOT from
    // the cogs note's pa_total/pb_total/pc_total. Those note totals are frequently
    // 0 (the breakup rows live under different keys / weren't synced) even when the
    // FS amount is fully populated from COA mapping, so the old code silently
    // DROPPED "Cost of Materials Consumed" (and Purchases) from the Word export
    // while the App showed them. Mirror the App 1:1 so Word == App: same amounts,
    // same note refs (24/25/26 resolved through the shared dynamic map), all three
    // sub-lines always shown under "(a) Cost of goods sold".
    ...((): TableRow[] => {
      const matCy = A("NCE_COGS", cy); const matPy = A("NCE_COGS", py);   // (i)   materials
      const ciiCy = A("NCE_CII",  cy); const ciiPy = A("NCE_CII",  py);   // (iii) changes in inventories
      return [
        parentRow("(a)   Cost of goods sold", 0),
        dataRow("      (i)   Cost of Materials Consumed",                                      n(24), matCy, matPy, 1),
        dataRow("      (ii)  Purchases of Stock-in-Trade",                                     n(25), 0,     0,     1),
        dataRow("      (iii) Changes in Inventories of Finished Goods, WIP & Stock-in-Trade",  n(26), ciiCy, ciiPy, 1),
      ];
    })(),
    dataRow("(b)   Employee benefits expense",      n(27), empCy,  empPy),
    dataRow("(c)   Finance costs",                  n(28), finCy,  finPy),
    dataRow("(d)   Depreciation and amortisation",  n(10), depCy,  depPy),
    dataRow("(e)   Other expenses",                 n(30), othCy,  othPy),
    subTotalRow("IV.   Total Expenses", totExpCy, totExpPy),
    blankRow(),

    // ── Profit chain ─────────────────────────────────────────────────────
    dataRow(
      "V.    Profit /(Loss) before exceptional items, partners' remuneration & tax (III−IV)",
      null, pVcy, pVpy,
    ),
    dataRow("VI.   Exceptional items",                                             null, excCy,  excPy),
    dataRow("VII.  Profit / (Loss) before extraordinary items and tax (V + VI)",  null, pVIIcy, pVIIpy),
    dataRow("VIII. Extraordinary items",                                           null, extCy,  extPy),
    dataRow("IX.   Profit / (Loss) before partners' remuneration and tax (VII + VIII)",  null, pIXcy,  pIXpy),
    dataRow("X.    Partners' remuneration",                              n(31), remCy,  remPy),
    dataRow("XI.   Profit / (Loss) before tax (IX − X)",                                null, pXIcy,  pXIpy),
    blankRow(),

    // ── Tax expense (XII) ─────────────────────────────────────────────────
    parentRow("XII.  Tax expense"),
    dataRow("        (1)  Current tax",                                       null, curTaxCy,   curTaxPy,   1),
    dataRow("        (2)  Short / (excess) provision for earlier years",      null, priorTaxCy, priorTaxPy, 1),
    dataRow("        (3)  Deferred tax charge / (benefit)",                   null, deferTaxCy, deferTaxPy, 1),
    subTotalRow("             Total tax expense", totTaxCy, totTaxPy),
    blankRow(),

    grandTotalRow(
      "XIII. Profit / (Loss) for the year (XI − XII)",
      netProfCy,
      netProfPy,
    ),
    blankRow(),

    // ── Discontinued operations (XIV–XVII) ────────────────────────────────
    dataRow("XIV.  Profit/(loss) from discontinuing operations",                                   null, discOpCy,  discOpPy),
    dataRow("XV.   Tax expense of discontinuing operations",                                       null, discTaxCy, discTaxPy),
    dataRow("XVI.  Profit/(loss) from discontinuing operations (after tax) (XIV-XV)",              null, discAtCy,  discAtPy),
    grandTotalRow("XVII. Profit/(Loss) for the year (XIII+XVI)", finalProfCy, finalProfPy),
  ];

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [CW_DESC, CW_NOTE, CW_CY, CW_PY],
    rows,
  });
}

// ─── SIGNATURE BLOCK ─────────────────────────────────────────────────────────
export interface SigData {
  firmName?: string;
  firmFRN?: string;
  partnerName?: string;
  membershipNo?: string;
  clientName?: string;
  signatoryName?: string;
  /** Task 4: entity constitution type (Partnership, Proprietorship, LLP, etc.)
   *  Used to derive the signatory designation label dynamically. */
  constitution?: string;
  place?: string;
  date?: string;        // "YYYY-MM-DD" from the UI date input
  udin?: string;        // UDIN shown under the partner block
}

/** Format the UI's "YYYY-MM-DD" sign-off date as "DD/MM/YYYY". */
function fmtSigDate(d?: string): string {
  if (!d) return "_______________";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/** Task 4 — derive the correct signatory designation from constitution type. */
function resolveSignatoryDesignation(constitution?: string): string {
  if (!constitution) return "Authorised Signatory";
  const c = constitution.toLowerCase().trim();
  // LLP must be checked BEFORE "partnership" because
  // "Limited Liability Partnership" contains "partnership".
  if (c.includes("llp") || c.includes("limited liability partnership")) return "Designated Partner";
  if (c.includes("partnership")) return "Partner / Authorised Signatory";
  // "Individual" is how Tally registers sole-proprietors.
  if (c.includes("proprietor") || c === "individual") return "Proprietor";
  return "Authorised Signatory";
}

/**
 * Mirrors the on-screen NCE signature block:
 *   Left  — CA firm (auto-linked from firm settings)
 *   Right — Place/Date (once only, above client block) + client + signatory
 *
 * Task 10: Place/Date appear ONCE, on the right, ABOVE "For [Client Name]".
 * Task 11: FRN and Membership No. labels shown WITHOUT colon ":".
 * Task 4:  Signatory designation is dynamic based on constitution type.
 */
function buildSignatureTable(sig: SigData): Table {
  const BLANK      = "_______________";
  const firmName   = sig.firmName     || BLANK;
  const frn        = sig.firmFRN      || BLANK;
  const partner    = sig.partnerName  || BLANK;
  const memNo      = sig.membershipNo || BLANK;
  const clientName = sig.clientName   || BLANK;
  const signatory  = sig.signatoryName || "";
  const place      = sig.place        || BLANK;
  const date       = fmtSigDate(sig.date);
  const udin       = sig.udin         || "";
  const designation = resolveSignatoryDesignation(sig.constitution);

  const half = Math.floor(TW / 2);

  function sigLines(
    lines: Array<{ text: string; bold?: boolean; gap?: boolean; muted?: boolean; spacingBefore?: number }>,
  ): Paragraph[] {
    return lines.map(l => new Paragraph({
      spacing: { before: l.spacingBefore ?? (l.gap ? 120 : 0), after: 8 },
      children: [new TextRun({
        text:  l.text,
        font:  FONT,
        size:  SZ_SM,
        bold:  l.bold ?? false,
        color: l.bold ? NAVY : (l.muted ? DK_GREY : BLACK),
      })],
    }));
  }

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [half, TW - half],
    rows: [
      new TableRow({
        children: [
          // Left — CA firm (Task 11: no colon after FRN / Membership No.)
          new TableCell({
            width:   { size: half, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 80, right: 80 },
            children: sigLines([
              { text: `For, ${firmName}`, bold: true },
              { text: "Chartered Accountants" },
              { text: `FRN ${frn}` },
              { text: "", gap: true },
              { text: "__________________" },
              { text: partner, bold: true },
              { text: "Partner" },
              { text: `Membership No. ${memNo}` },
              { text: `UDIN: ${udin}` },
            ]),
          }),
          // Right — Task 10: Place/Date ABOVE "For [Client Name]"; appears only once
          // Task 3 (doc6): add 1 row space between Place/Date and 2 rows before Client
          new TableCell({
            width:   { size: TW - half, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 1440, right: 80 },
            children: sigLines([
              { text: `Place: ${place}` },
              { text: `Date: ${date}`, spacingBefore: 240 },         // 1 row gap before Date
              { text: `For, ${clientName}`, bold: true, spacingBefore: 480 }, // 2 row gaps before Client
              { text: "", gap: true },
              { text: "__________________" },
              ...(signatory ? [{ text: signatory, bold: true }] : []),
              { text: designation, muted: true },
            ]),
          }),
        ],
      }),
    ],
  });
}

// ─── Phase 2: Note helpers ────────────────────────────────────────────────────

/** Full-width note title row (spans all columns, BG_SECT) */
function noteTitleRow(colWidths: number[], noteNumber: string, title: string): TableRow {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        columnSpan: colWidths.length,
        width:   { size: totalW, type: WidthType.DXA },
        shading: { fill: BG_SECT, type: ShadingType.CLEAR },
        borders: BDR_SECT,
        margins: { top: 56, bottom: 56, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          keepNext: true, keepLines: true,
          children: [
            new TextRun({ text: `Note ${noteNumber}:  `, font: FONT, size: SZ_HDR, bold: true, color: NAVY }),
            new TextRun({ text: title, font: FONT, size: SZ_HDR, bold: true, color: NAVY }),
          ],
        })],
      }),
    ],
  });
}

/** Full-width section header within a note table (BG_TOT background) */
function noteSecHdr(colWidths: number[], label: string): TableRow {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: colWidths.length,
        width:   { size: totalW, type: WidthType.DXA },
        shading: { fill: BG_TOT, type: ShadingType.CLEAR },
        borders: BDR_ROW,
        margins: { top: 38, bottom: 38, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          keepNext: true, keepLines: true,
          children: [new TextRun({ text: label, font: FONT, size: SZ_BODY, bold: true, color: BLACK })],
        })],
      }),
    ],
  });
}

/** Pattern B column header (3 cols) */
function noteHdrB(cyYear: string, pyYear: string): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "Particulars", w: NW_DESC, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100, vertPad: 22, keepNext: true }),
      cell({ text: hdr(cyYear), w: NW_CY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120, vertPad: 22, keepNext: true }),
      cell({ text: hdr(pyYear), w: NW_PY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120, vertPad: 22, keepNext: true }),
    ],
  });
}

/** Pattern B data/sub-total/grand-total row (3 cols) */
function noteRowB(
  label: string,
  cy: number,
  py: number,
  indent = 0,
  style: "data" | "subtotal" | "total" = "data",
): TableRow {
  const bg   = style === "total" ? BG_GRAN : style === "subtotal" ? BG_TOT : undefined;
  const bdr  = style === "total" ? BDR_GRAND : style === "subtotal" ? BDR_SUB : BDR_ROW;
  const bold = style !== "data";
  // Task 1 (doc8): use compact vertPad=18 for note rows (tighter page fitting)
  // Note 1 fix (intelligent pagination): cantSplit so a single row never breaks
  // across a page boundary (prevents half-rows / broken table continuity).
  return new TableRow({
    cantSplit: true,
    children: [
      cell({ text: label, w: NW_DESC, bold, bg, borders: bdr, indent, vertPad: 18, keepNext: true }),
      ac(cy, NW_CY, { bold, bg, borders: bdr, vertPad: 18, keepNext: true }),
      ac(py, NW_PY, { bold, bg, borders: bdr, vertPad: 18, keepNext: true }),
    ],
  });
}

/** Pattern A column header (2 rows: LT/ST then CY/PY) */
function noteHdrA(cyYear: string, pyYear: string): TableRow[] {
  const ltw = NW_A_LTCY + NW_A_LTPY;
  const stw = NW_A_STCY + NW_A_STPY;
  const spanCell = (text: string, w: number, span: number) =>
    new TableCell({
      columnSpan: span,
      width:   { size: w, type: WidthType.DXA },
      shading: { fill: BG_HDR, type: ShadingType.CLEAR },
      borders: BDR_NONE,
      margins: { top: 36, bottom: 0, left: 80, right: 80 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        keepNext: true, keepLines: true,
        children: [new TextRun({ text, font: FONT, size: SZ_BODY, bold: true, color: WHITE })],
      })],
    });

  const r1 = new TableRow({
    children: [
      cell({ text: "Particulars", w: NW_A_DESC, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100, vertPad: 22, keepNext: true }),
      spanCell("Long Term", ltw, 2),
      spanCell("Short Term", stw, 2),
    ],
  });
  const r2 = new TableRow({
    children: [
      cell({ text: "", w: NW_A_DESC, sz: SZ_BODY, color: WHITE, bg: BG_HDR, borders: BDR_NONE, vertPad: 22, keepNext: true }),
      cell({ text: hdr(cyYear), w: NW_A_LTCY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
      cell({ text: hdr(pyYear), w: NW_A_LTPY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
      cell({ text: hdr(cyYear), w: NW_A_STCY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
      cell({ text: hdr(pyYear), w: NW_A_STPY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
    ],
  });
  return [r1, r2];
}

/** Pattern A data/sub-total/grand-total row (5 cols) */
function noteRowA(
  label: string,
  ltCy: number, ltPy: number,
  stCy: number, stPy: number,
  indent = 0,
  style: "data" | "subtotal" | "total" = "data",
): TableRow {
  const bg   = style === "total" ? BG_GRAN : style === "subtotal" ? BG_TOT : undefined;
  const bdr  = style === "total" ? BDR_GRAND : style === "subtotal" ? BDR_SUB : BDR_ROW;
  const bold = style !== "data";
  // Task 1 (doc8): compact vertPad=18 for note rows
  // Note 1 fix (intelligent pagination): cantSplit so a row never breaks across pages.
  return new TableRow({
    cantSplit: true,
    children: [
      cell({ text: label, w: NW_A_DESC, bold, bg, borders: bdr, indent, vertPad: 18, keepNext: true }),
      ac(ltCy, NW_A_LTCY, { bold, bg, borders: bdr, vertPad: 18, keepNext: true }),
      ac(ltPy, NW_A_LTPY, { bold, bg, borders: bdr, vertPad: 18, keepNext: true }),
      ac(stCy, NW_A_STCY, { bold, bg, borders: bdr, vertPad: 18, keepNext: true }),
      ac(stPy, NW_A_STPY, { bold, bg, borders: bdr, vertPad: 18, keepNext: true }),
    ],
  });
}

// ─── Phase 2: Build functions ─────────────────────────────────────────────────

/** Note 1 — Accounting Policies (text paragraphs) */
const NOTE1_POLICIES = [
  { label: "a) Property, Plant and Equipment",
    text: "Property, Plant and Equipment are stated at cost less accumulated depreciation and impairment losses, if any. Cost includes purchase price and all directly attributable costs of bringing the asset to working condition for its intended use." },
  { label: "b) Depreciation",
    text: "Depreciation is charged on the Written Down Value (WDV) method at the rates prescribed under the relevant provisions of the Income Tax Act, 1961 / as estimated by the management based on the useful life of assets." },
  { label: "c) Inventories",
    text: "Inventories are valued at cost or net realisable value, whichever is lower. Cost is determined on First-In-First-Out (FIFO) / Weighted Average basis. Cost includes purchase price, duties and taxes (other than those subsequently recoverable), freight, and other directly attributable costs." },
  { label: "d) Revenue Recognition",
    text: "Revenue is recognised when it is earned and there is reasonable certainty of its ultimate collection. Revenue from sale of goods is recognised when significant risks and rewards of ownership are transferred to the buyer. Revenue from services is recognised on completion of the service." },
  { label: "e) Investments",
    text: "Long-term investments are stated at cost. Provision is made for diminution in value of investments, if the diminution is other than temporary in nature. Current investments are stated at cost or market value, whichever is lower." },
  { label: "f) Provisions and Contingent Liabilities",
    text: "Provisions are recognised when there is a present obligation as a result of a past event and it is probable that an outflow of resources will be required to settle the obligation and a reliable estimate can be made. Contingent liabilities are not recognised but are disclosed in the notes. Contingent assets are neither recognised nor disclosed." },
  { label: "g) Employee Benefits",
    text: "Short-term employee benefits are recognised as an expense at the undiscounted amount in the period in which the related service is rendered. Long-term employee benefits, including gratuity and leave encashment, are provided on the basis of actuarial valuation using the Projected Unit Credit method." },
  { label: "h) Foreign Currency Transactions",
    text: "Foreign currency transactions are recorded at the exchange rate prevailing on the date of the transaction. Monetary assets and liabilities denominated in foreign currency outstanding at the year-end are translated at the closing rate. Exchange differences arising on settlement and restatement are recognised in the Statement of Profit and Loss." },
  { label: "i) Borrowing Costs",
    text: "Borrowing costs directly attributable to the acquisition or construction of qualifying assets are capitalised as part of the cost of such assets. Other borrowing costs are charged to revenue in the period in which they are incurred." },
  { label: "j) Taxes on Income",
    text: "Tax expense comprises current and deferred tax. Current tax is determined based on the provisions of the Income Tax Act, 1961. Deferred tax is recognised for all timing differences between accounting income and taxable income, subject to the consideration of prudence." },
  { label: "k) Use of Estimates",
    text: "The preparation of financial statements in conformity with generally accepted accounting principles requires management to make estimates and assumptions that affect the reported amounts of assets, liabilities, revenue, and expenses. Actual results could differ from such estimates." },
  { label: "l) Cash and Cash Equivalents",
    text: "For the purposes of the Cash Flow Statement, cash and cash equivalents comprise cash on hand, cheques and drafts in hand, and balances with banks in current accounts." },
];

/** NCE Task 8: Notes page title block — mirrors BS/PL heading style.
 *  The entity name is intentionally omitted here because the notes section
 *  prepends its own client-name body banner (see makeNotesBanner in the
 *  export function). We only need the statement subtitle + amount units. */
function buildNotesTitleBlock(_entityName: string, cyYear: string): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 60, after: 10 },
      children: [new TextRun({
        text: `Notes to Financial Statements for the year ended 31st March, ${cyYear}`,
        font: FONT, size: SZ_TITLE, bold: true, color: NAVY,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing:   { before: 0, after: 60 },
      border:    { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
      children: [new TextRun({ text: amountUnitsLabel(), font: FONT, size: SZ_SM, color: DK_GREY })],
    }),
  ];
}

function buildNote1Section(entityName: string, cyYear: string): Paragraph[] {
  // Vertical gap between policy points — reduced for better page fitting (Task 1, doc8)
  const GAP = 140;

  const txt = (text: string, bold = false) =>
    new TextRun({ text, font: FONT, size: SZ_BODY, bold, color: BLACK });

  // Block paragraph with professional line spacing
  const block = (
    runs: TextRun[],
    opts: { indent?: number; hanging?: number; after?: number; keepNext?: boolean } = {},
  ): Paragraph =>
    new Paragraph({
      spacing:   { before: 0, after: opts.after ?? 50, line: 264, lineRule: "auto" as any },
      indent:    opts.indent ? { left: opts.indent, hanging: opts.hanging } : undefined,
      keepLines: true,
      keepNext:  opts.keepNext ?? false,
      children:  runs,
    });

  const last = NOTE1_POLICIES.length - 1;

  return [
    new Paragraph({
      spacing:   { before: 0, after: 100 },
      border:    { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 4 } },
      keepNext:  true,
      keepLines: true,
      children: [
        new TextRun({ text: "Note 1:  ", font: FONT, size: SZ_HDR, bold: true, color: NAVY }),
        new TextRun({ text: "Significant Accounting Policies", font: FONT, size: SZ_HDR, color: NAVY }),
      ],
    }),
    block([txt("1.  Basis of Preparation", true)], { after: 20, keepNext: true }),
    block(
      [txt(`The financial statements of ${entityName} have been prepared in accordance with the Generally Accepted Accounting Principles in India (GAAP) under the historical cost convention on an accrual basis. The financial statements comply with the Accounting Standards applicable to the entity and other relevant provisions of the applicable law.`)],
      { after: GAP },
    ),
    block([txt("2.  Significant Accounting Policies", true)], { after: 40, keepNext: true }),
    // Each policy = bold label heading + description below; GAP separates points
    ...NOTE1_POLICIES.flatMap((p, i) => [
      block([txt(p.label, true)], { indent: 280, after: 10, keepNext: true }),
      block([txt(p.text)],        { indent: 280, after: i === last ? 40 : GAP, keepNext: i !== last }),
    ]),
  ];
}

/** Note 2 — Partners' Capital Account tables (CY + PY) */
function buildCapitalAccountSection(
  capitalData: any[],
  cyYear: string,
  pyYear: string,
): Table[] {
  const PY_SENTINEL    = 99;
  const PY_PARTNER_BASE = 100;

  const cyPartners = (capitalData ?? [])
    .filter((r: any) => r.partner_no < PY_SENTINEL)
    .sort((a: any, b: any) => a.partner_no - b.partner_no);

  const pyAggregate = (capitalData ?? []).find((r: any) => r.partner_no === PY_SENTINEL);
  const pyPartners  = (capitalData ?? [])
    .filter((r: any) => r.partner_no >= PY_PARTNER_BASE)
    .sort((a: any, b: any) => a.partner_no - b.partner_no);

  const calcClosingCy = (p: any): number =>
    (p.opening_balance_cy ?? 0) + (p.introduced_cy ?? 0) + (p.remuneration_cy ?? 0)
    + (p.interest_cy ?? 0) - (p.withdrawals_cy ?? 0) + (p.profit_share_cy ?? 0);

  // Task 1: pyPartners store their data in _cy-suffixed fields (same record as
  // CY partners with partner_no >= 100).  Fall back to _cy fields when the
  // "plain" PY field is absent so closing-balance and totals are non-zero.
  const calcClosingPy = (p: any): number =>
    (p.opening ?? p.opening_balance_cy ?? 0) + (p.introduced ?? p.introduced_cy ?? 0)
    + (p.remuneration ?? p.remuneration_cy ?? 0) + (p.interest ?? p.interest_cy ?? 0)
    - (p.withdrawals ?? p.withdrawals_cy ?? 0) + (p.profit_share ?? p.profit_share_cy ?? 0);

  // KD5/KD6/KD7: 10 cols — Sr No | Partner | Share % | Opening | Introduced |
  // Remuneration | Interest | Withdrawals | Profit Share | Closing.
  const cw = [CAP_SR, CAP_NAME, CAP_PCT, CAP_NUM, CAP_NUM, CAP_NUM, CAP_NUM, CAP_NUM, CAP_NUM, CAP_LAST];

  const makeHdrRow = (): TableRow => {
    const h = (text: string, w: number) =>
      cell({ text, w, sz: SZ_XS, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER, padL: 40, padR: 40 });
    return new TableRow({
      tableHeader: true,
      children: [
        h("Sr.\nNo.",                    CAP_SR),
        h("Partner",                     CAP_NAME),
        h("Share of Profit /\n(Loss) %", CAP_PCT),
        h(hdr("Opening Balance"),        CAP_NUM),
        h(hdr("Introduced"),             CAP_NUM),
        h(hdr("Remuneration"),           CAP_NUM),
        h(hdr("Interest"),               CAP_NUM),
        h(hdr("Withdrawals"),            CAP_NUM),
        h(hdr("Profit Share"),           CAP_NUM),
        h(hdr("Closing Balance"),        CAP_LAST),
      ],
    });
  };

  const nc = (v: number, w: number, bold = false, bg?: string, bdr = BDR_ROW) =>
    ac(v, w, { bold, bg, borders: bdr });

  // Share-of-profit % cell text — value comes from the UI (profit_share_pct)
  const pctText = (v: any): string => (v != null && v !== "" ? `${v}%` : "—");

  // CY table — Sr No + Share % columns prepended (KD5)
  const cyDataRows = cyPartners.map((p: any, idx: number) =>
    new TableRow({
      children: [
        cell({ text: String(idx + 1), w: CAP_SR, sz: SZ_BODY, align: AlignmentType.CENTER }),
        cell({ text: p.partner_name || "Partner", w: CAP_NAME, sz: SZ_BODY }),
        cell({ text: pctText(p.profit_share_pct), w: CAP_PCT, sz: SZ_BODY, align: AlignmentType.CENTER }),
        nc(p.opening_balance_cy ?? 0, CAP_NUM),
        nc(p.introduced_cy      ?? 0, CAP_NUM),
        nc(p.remuneration_cy    ?? 0, CAP_NUM),
        nc(p.interest_cy        ?? 0, CAP_NUM),
        nc(p.withdrawals_cy     ?? 0, CAP_NUM),
        nc(p.profit_share_cy    ?? 0, CAP_NUM),
        nc(calcClosingCy(p),          CAP_LAST),
      ],
    }),
  );

  const totCyOpening  = cyPartners.reduce((s: number, p: any) => s + (p.opening_balance_cy ?? 0), 0);
  const totCyIntro    = cyPartners.reduce((s: number, p: any) => s + (p.introduced_cy ?? 0), 0);
  const totCyRem      = cyPartners.reduce((s: number, p: any) => s + (p.remuneration_cy ?? 0), 0);
  const totCyInt      = cyPartners.reduce((s: number, p: any) => s + (p.interest_cy ?? 0), 0);
  const totCyWith     = cyPartners.reduce((s: number, p: any) => s + (p.withdrawals_cy ?? 0), 0);
  const totCyPS       = cyPartners.reduce((s: number, p: any) => s + (p.profit_share_cy ?? 0), 0);
  const totCyClosing  = cyPartners.reduce((s: number, p: any) => s + calcClosingCy(p), 0);
  const totCyPct      = cyPartners.reduce((s: number, p: any) => s + (Number(p.profit_share_pct) || 0), 0);

  const cyTotalRow = new TableRow({
    children: [
      ec(CAP_SR, BG_GRAN, BDR_GRAND),
      cell({ text: "Total", w: CAP_NAME, bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      cell({ text: totCyPct ? `${+totCyPct.toFixed(2)}%` : "", w: CAP_PCT, bold: true, bg: BG_GRAN, borders: BDR_GRAND, align: AlignmentType.CENTER }),
      nc(totCyOpening,  CAP_NUM,  true, BG_GRAN, BDR_GRAND),
      nc(totCyIntro,    CAP_NUM,  true, BG_GRAN, BDR_GRAND),
      nc(totCyRem,      CAP_NUM,  true, BG_GRAN, BDR_GRAND),
      nc(totCyInt,      CAP_NUM,  true, BG_GRAN, BDR_GRAND),
      nc(totCyWith,     CAP_NUM,  true, BG_GRAN, BDR_GRAND),
      nc(totCyPS,       CAP_NUM,  true, BG_GRAN, BDR_GRAND),
      nc(totCyClosing,  CAP_LAST, true, BG_GRAN, BDR_GRAND),
    ],
  });

  // KD7: drop the separate Prior-Year table; append one "Previous Year"
  // comparison line below the CY total. Values = prior-year aggregate
  // (per-partner rows summed, else the stored total); "—" when no PY data.
  const pySrc = pyPartners.length > 0 ? pyPartners : (pyAggregate ? [pyAggregate] : []);
  const sumPy = (fn: (p: any) => number) => pySrc.reduce((s: number, p: any) => s + fn(p), 0);
  // Task 1: fall back to _cy fields for all sumPy calls (pyPartners store data there)
  const pyOpening = sumPy((p) => p.opening      ?? p.opening_balance_cy ?? 0);
  const pyIntro   = sumPy((p) => p.introduced   ?? p.introduced_cy      ?? 0);
  const pyRem     = sumPy((p) => p.remuneration ?? p.remuneration_cy    ?? 0);
  const pyInt     = sumPy((p) => p.interest     ?? p.interest_cy        ?? 0);
  const pyWith    = sumPy((p) => p.withdrawals  ?? p.withdrawals_cy     ?? 0);
  const pyPS      = sumPy((p) => p.profit_share ?? p.profit_share_cy    ?? 0);
  const pyClose   = sumPy((p) => calcClosingPy(p));

  const previousYearRow = new TableRow({
    children: [
      ec(CAP_SR, BG_TOT, BDR_SUB),
      cell({ text: "Previous Year", w: CAP_NAME, bold: true, bg: BG_TOT, borders: BDR_SUB }),
      cell({ text: "", w: CAP_PCT, bg: BG_TOT, borders: BDR_SUB }),
      nc(pyOpening, CAP_NUM,  true, BG_TOT, BDR_SUB),
      nc(pyIntro,   CAP_NUM,  true, BG_TOT, BDR_SUB),
      nc(pyRem,     CAP_NUM,  true, BG_TOT, BDR_SUB),
      nc(pyInt,     CAP_NUM,  true, BG_TOT, BDR_SUB),
      nc(pyWith,    CAP_NUM,  true, BG_TOT, BDR_SUB),
      nc(pyPS,      CAP_NUM,  true, BG_TOT, BDR_SUB),
      nc(pyClose,   CAP_LAST, true, BG_TOT, BDR_SUB),
    ],
  });

  const makePeriodHdr = (label: string): TableRow =>
    new TableRow({
      children: [
        new TableCell({
          columnSpan: cw.length,
          width:   { size: TW, type: WidthType.DXA },
          shading: { fill: BG_TOT, type: ShadingType.CLEAR },
          borders: BDR_ROW,
          margins: { top: 30, bottom: 30, left: 100, right: 100 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: label, font: FONT, size: SZ_HDR, bold: true, color: NAVY })],
          })],
        }),
      ],
    });

  const cyTable = new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: cw,
    rows: [
      noteTitleRow(cw, "2", "Partners' Capital Account"),
      makePeriodHdr(`Current Year — FY ${fyRange(cyYear)}`),
      makeHdrRow(),
      ...cyDataRows,
      cyTotalRow,
      previousYearRow,
    ],
  });

  return [cyTable];
}

/** Custom-row shape stored in cy_data._custom_rows (subset we need). */
interface NoteCustomRow { id: string; label?: string; section?: string; attachedTo?: string; }

/** Notes 3–28 — generic note table from NOTES_CONFIG */
function buildNoteSection(
  cfg: NoteConfig,
  rawCy: Record<string, number>,
  rawPy: Record<string, number>,
  displayNoteNumber: string,
  cyYear: string,
  pyYear: string,
  expandedRows?: Set<string>,
  hideBlankNoteRows?: boolean,
): Table {
  // Auto/manual breakup rows are stored in cy_data._custom_rows; their amounts
  // live as ordinary keys (id or id+"_lt"/"_st") in rawCy/rawPy. For notes like
  // Borrowings the per-ledger amounts sit on custom rows ATTACHED to a static
  // row, so they must be folded into that static row (and the totals) — exactly
  // as the on-screen note does in its collapsed view.
  const rawCustomRows: NoteCustomRow[] = Array.isArray((rawCy as any)._custom_rows)
    ? ((rawCy as any)._custom_rows as NoteCustomRow[])
    : [];

  // Note 4 fix (render-time safety net): legacy saved data can carry the SAME
  // breakup ledger many times (a pre-fix runaway re-sync appended a fresh copy
  // of every ledger on each cycle — e.g. "ICICI Bank Car Loan" x20, the "390
  // manual" purchases note). Rendering them verbatim inflates every total and
  // wastes dozens of pages. Collapse duplicates by label+parent+section and keep
  // the FIRST occurrence, so the export is clean regardless of DB corruption.
  // computeDisplayData also receives the deduped list so totals stop multiplying.
  const _seenRow = new Set<string>();
  const customRows: NoteCustomRow[] = rawCustomRows.filter(cr => {
    const key = `${(cr.label || "").trim().toLowerCase()}|${cr.attachedTo ?? ""}|${cr.section ?? ""}`;
    // Keep rows with no label as-is (can't safely dedupe blank labels).
    if (!(cr.label || "").trim()) return true;
    if (_seenRow.has(key)) return false;
    _seenRow.add(key);
    return true;
  });

  const { cy, py } = computeDisplayData(cfg, rawCy, rawPy, customRows);
  const isA = cfg.pattern === "A";
  const colWidths = isA
    ? [NW_A_DESC, NW_A_LTCY, NW_A_LTPY, NW_A_STCY, NW_A_STPY]
    : [NW_DESC, NW_CY, NW_PY];

  const reversedRows = [...cfg.rows].reverse();
  const grandTotalId = reversedRows.find(r => r.isTotal)?.id ?? null;

  // Suffix-aware lookup mirroring computeDisplayData: a bare key only counts
  // when neither _lt nor _st exists (legacy data); _st never falls back to bare.
  const suffixed = (base: Record<string, number>, id: string) => {
    const ltKey = id + "_lt", stKey = id + "_st";
    const useBare = !(ltKey in base) && !(stKey in base);
    return {
      lt: base[ltKey] ?? (useBare ? base[id] ?? 0 : 0),
      st: base[stKey] ?? 0,
    };
  };
  const attachedRows = (staticId: string) => customRows.filter(cr => cr.attachedTo === staticId);

  // Displayed value for a STATIC data row = its own amount + every custom row
  // attached to it (collapsed-view aggregate). computeDisplayData only updates
  // the TOTAL rows, so the per-row aggregation is done here.
  const aggA = (id: string) => {
    let lt = cy[id + "_lt"] ?? 0, st = cy[id + "_st"] ?? 0;
    let ltP = py[id + "_lt"] ?? 0, stP = py[id + "_st"] ?? 0;
    for (const cr of attachedRows(id)) {
      const c = suffixed(cy, cr.id); const p = suffixed(py, cr.id);
      lt += c.lt; st += c.st; ltP += p.lt; stP += p.st;
    }
    return { lt, ltP, st, stP };
  };
  const aggB = (id: string) => {
    let c = cy[id] ?? 0, p = py[id] ?? 0;
    for (const cr of attachedRows(id)) { c += cy[cr.id] ?? 0; p += py[cr.id] ?? 0; }
    return { c, p };
  };

  // Strip "Note X: " prefix from config title to get just the name
  const cleanTitle = cfg.title.replace(/^Note\s[\d &]+:\s*/i, "");

  const rows: TableRow[] = [
    noteTitleRow(colWidths, displayNoteNumber, cleanTitle),
    ...(isA ? noteHdrA(cyYear, pyYear) : [noteHdrB(cyYear, pyYear)]),
  ];

  // Unattached custom rows (no attachedTo) render as their own lines: section-
  // tagged ones just before their section total, the rest before the grand total.
  // 2026-05-30 — indent 0 (was 1) so unattached customs align with the static
  // Particulars above instead of looking like sub-items of "Rates and Taxes" /
  // whichever static row preceded them. Reported on OM REALTY Note 18 where
  // "Architect Fees - 18%", "Site Expense", "BU Expense" etc. (which are
  // unmatched ledgers, not children of any static head) were getting a
  // misleading sub-row indent in the .docx export.
  const emittedCustoms = new Set<string>();
  const emitCustoms = (predicate: (cr: NoteCustomRow) => boolean) => {
    for (const cr of customRows) {
      if (cr.attachedTo || emittedCustoms.has(cr.id) || !predicate(cr)) continue;
      emittedCustoms.add(cr.id);
      if (isA) {
        const c = suffixed(cy, cr.id); const p = suffixed(py, cr.id);
        if (!c.lt && !c.st && !p.lt && !p.st) continue;
        rows.push(noteRowA(cr.label || "—", c.lt, p.lt, c.st, p.st, 0, "data"));
      } else {
        const c = cy[cr.id] ?? 0, p = py[cr.id] ?? 0;
        if (!c && !p) continue;
        rows.push(noteRowB(cr.label || "—", c, p, 0, "data"));
      }
    }
  };

  // Task 5 (doc7) + Task 2 (doc8): pre-compute which section headers are empty
  // (all data rows blank) and which section-total rows belong to empty sections.
  // Only active when hideBlankNoteRows=true (locked preview / export).
  const emptySectionHeaders = new Set<string>();
  const emptySectionTotals  = new Set<string>();
  if (hideBlankNoteRows) {
    let currentHdrId: string | null = null;
    let currentSectionTotalId: string | null = null;
    let sectionHasData = false;
    const checkRow = (row: NoteRowDef) => {
      if (isA) {
        const v = aggA(row.id);
        return !!(v.lt || v.st || v.ltP || v.stP);
      } else {
        const v = aggB(row.id);
        return !!(v.c || v.p);
      }
    };
    for (const row of cfg.rows) {
      if (row.isSectionHeader) {
        if (currentHdrId !== null && !sectionHasData) {
          emptySectionHeaders.add(currentHdrId);
          if (currentSectionTotalId) emptySectionTotals.add(currentSectionTotalId);
        }
        currentHdrId = row.id;
        currentSectionTotalId = null;
        sectionHasData = false;
      } else if (row.isTotal && row.id !== grandTotalId) {
        // Track the nearest non-grand section total for this section
        currentSectionTotalId = row.id;
      } else {
        if (!row.isTotal && checkRow(row)) sectionHasData = true;
      }
    }
    if (currentHdrId !== null && !sectionHasData) {
      emptySectionHeaders.add(currentHdrId);
      if (currentSectionTotalId) emptySectionTotals.add(currentSectionTotalId);
    }
  }

  // Task 4: all static rows are always exported — no blank-row suppression.
  // User requirement: export must match software structure exactly, including rows
  // with zero amounts. Section headers always show. Total rows always show.
  for (let i = 0; i < cfg.rows.length; i++) {
    const row = cfg.rows[i];
    if (row.isSectionHeader) {
      if (!emptySectionHeaders.has(row.id)) {
        rows.push(noteSecHdr(colWidths, row.label));
      }
    } else if (row.isTotal) {
      const style = row.id === grandTotalId ? "total" : "subtotal";
      // Task 2 (doc8): when locked, skip section totals for empty sections and
      // skip any non-grand total row whose computed value is 0 in both years
      // (prevents "blank Total" rows and duplicate totals in sparse notes).
      if (hideBlankNoteRows && row.id !== grandTotalId) {
        if (emptySectionTotals.has(row.id)) continue;
        const totCy = isA
          ? (cy[row.id + "_lt"] ?? 0) + (cy[row.id + "_st"] ?? 0)
          : (cy[row.id] ?? 0);
        const totPy = isA
          ? (py[row.id + "_lt"] ?? 0) + (py[row.id + "_st"] ?? 0)
          : (py[row.id] ?? 0);
        if (!totCy && !totPy) continue;
      }
      // Before a section total, emit that section's unattached customs; before
      // the grand total, emit the section-less ones.
      if (row.id === grandTotalId) emitCustoms(cr => !cr.section);
      else if ((row as any).sectionTag) emitCustoms(cr => cr.section === (row as any).sectionTag);
      if (isA) {
        rows.push(noteRowA(
          row.label,
          cy[row.id + "_lt"] ?? 0, py[row.id + "_lt"] ?? 0,
          cy[row.id + "_st"] ?? 0, py[row.id + "_st"] ?? 0,
          row.indent ?? 0, style,
        ));
      } else {
        rows.push(noteRowB(row.label, cy[row.id] ?? 0, py[row.id] ?? 0, row.indent ?? 0, style));
      }
    } else {
      // Task 2 (doc6): when locked (hideBlankNoteRows=true), skip data rows
      // where the aggregate value is 0 in BOTH current year and previous year.
      // Section headers and total rows are always shown regardless.
      if (hideBlankNoteRows) {
        if (isA) {
          const v = aggA(row.id);
          if (!v.lt && !v.st && !v.ltP && !v.stP) continue;
        } else {
          const v = aggB(row.id);
          if (!v.c && !v.p) continue;
        }
      }
      // Main (static) row shows the collapsed aggregate; its attached sub-items
      // (auto/manual breakup ledgers) are then listed indented beneath it.
      const subIndent = (row.indent ?? 0) + 1;
      if (isA) {
        const v = aggA(row.id);
        rows.push(noteRowA(row.label, v.lt, v.ltP, v.st, v.stP, row.indent ?? 0, "data"));
        if (!expandedRows || expandedRows.has(row.id)) {
          for (const cr of attachedRows(row.id)) {
            const c = suffixed(cy, cr.id); const p = suffixed(py, cr.id);
            if (!c.lt && !c.st && !p.lt && !p.st) continue;   // skip empty sub-items
            rows.push(noteRowA(cr.label || "—", c.lt, p.lt, c.st, p.st, subIndent, "data"));
          }
        }
      } else {
        const v = aggB(row.id);
        rows.push(noteRowB(row.label, v.c, v.p, row.indent ?? 0, "data"));
        if (!expandedRows || expandedRows.has(row.id)) {
          for (const cr of attachedRows(row.id)) {
            const c = cy[cr.id] ?? 0, p = py[cr.id] ?? 0;
            if (!c && !p) continue;                            // skip empty sub-items
            rows.push(noteRowB(cr.label || "—", c, p, subIndent, "data"));
          }
        }
      }
    }
  }
  // Any remaining unattached customs (notes with no total row) — emit at end.
  emitCustoms(() => true);

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows,
  });
}

/** PPE Schedule — landscape table, grouped by asset_category (Task 3) */
function buildPPETable(ppeData: any[], cyYear: string, pyYear: string, noteNum: string): Table {
  const ppeColWidths = [PPE_CAT, PPE_NAME, PPE_RATE, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM];
  const totalW = ppeColWidths.reduce((s, w) => s + w, 0); // 15398

  // Task 4 (doc6): 2-row grouped header matching the PPE Schedule UI exactly.
  // Row 1: Category | Asset Name | Rate% | Opening | Additions (₹) colSpan=2 | Total | Depr | Closing
  // Row 2: (only Additions sub-headers)              Pre / Post
  const hdrCell = (text: string, w: number, rowSpan?: number, colSpan?: number) =>
    new TableCell({
      ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
      ...(colSpan && colSpan > 1 ? { columnSpan: colSpan } : {}),
      width:   { size: w, type: WidthType.DXA },
      shading: { fill: BG_HDR, type: ShadingType.CLEAR },
      borders: BDR_NONE,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing:   { before: 0, after: 0 },
        children: [new TextRun({ text, font: FONT, size: SZ_XS, bold: true, color: WHITE })],
      })],
    });

  const hdrRow1 = new TableRow({
    tableHeader: true,
    children: [
      hdrCell("Asset\nCategory",                              PPE_CAT,  2),
      hdrCell("Asset Name",                                   PPE_NAME, 2),
      hdrCell("Rate\n(%)",                                    PPE_RATE, 2),
      hdrCell(`Opening Balance\nas on 01/04/${pyYear}`,       PPE_NUM,  2),
      hdrCell("Additions (₹)",                                PPE_NUM * 2, 1, 2),
      hdrCell("Total",                                        PPE_NUM,  2),
      hdrCell("Depreciation\nCharged",                        PPE_NUM,  2),
      hdrCell(`Closing Balance\nas on 31/03/${cyYear}`,       PPE_NUM,  2),
    ],
  });
  const hdrRow2 = new TableRow({
    tableHeader: true,
    children: [
      hdrCell(`Acquired on or\nbefore 29/09/${pyYear}`, PPE_NUM),
      hdrCell(`Acquired\nafter 29/09/${pyYear}`,         PPE_NUM),
    ],
  });

  /** Task 3: full-width spanning row for each asset category heading */
  const catHdrRow = (catName: string): TableRow =>
    new TableRow({
      children: [
        new TableCell({
          columnSpan: ppeColWidths.length,
          width:   { size: totalW, type: WidthType.DXA },
          shading: { fill: BG_TOT, type: ShadingType.CLEAR },
          borders: BDR_ROW,
          margins: { top: 30, bottom: 30, left: 100, right: 100 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: catName, font: FONT, size: SZ_XS, bold: true, color: BLACK })],
          })],
        }),
      ],
    });

  const nac = (v: number | null | undefined, w: number) => ac(v ?? 0, w);

  /** Task 3: skip assets where every numeric column is zero / null */
  const isBlankAsset = (r: any): boolean =>
    !r.opening_balance && !r.additions_pre && !r.additions_post &&
    !r.total && !r.depreciation && !r.closing_balance && !r.net_cy && !r.net_py;

  // Task 3: group by asset_category (insertion order preserved — Map is ES6+)
  const categoryMap = new Map<string, any[]>();
  for (const r of (ppeData ?? [])) {
    const cat = r.asset_category ?? "Other";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(r);
  }

  const dataRows: TableRow[] = [];
  for (const [cat, assets] of categoryMap) {
    const visible = assets.filter((r: any) => !isBlankAsset(r));
    if (visible.length === 0) continue;    // skip whole category if all children blank
    dataRows.push(catHdrRow(cat));
    for (const r of visible) {
      dataRows.push(new TableRow({
        children: [
          cell({ text: "", w: PPE_CAT,  sz: SZ_XS }),      // category shown in header
          cell({ text: r.asset_name ?? "", w: PPE_NAME, sz: SZ_XS }),
          cell({ text: r.rate_pct != null ? `${r.rate_pct}%` : "", w: PPE_RATE, sz: SZ_XS, align: AlignmentType.CENTER }),
          nac(r.opening_balance, PPE_NUM),
          nac(r.additions_pre,   PPE_NUM),
          nac(r.additions_post,  PPE_NUM),
          nac(r.total,           PPE_NUM),
          nac(r.depreciation,    PPE_NUM),
          nac(r.closing_balance, PPE_NUM),
        ],
      }));
    }
  }

  const sum = (field: string) =>
    (ppeData ?? []).reduce((s: number, r: any) => s + (r[field] ?? 0), 0);

  const totalRow = new TableRow({
    children: [
      cell({ text: "Total", w: PPE_CAT,  sz: SZ_XS, bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      cell({ text: "",      w: PPE_NAME, sz: SZ_XS, bg: BG_GRAN, borders: BDR_GRAND }),
      cell({ text: "",      w: PPE_RATE, sz: SZ_XS, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("opening_balance"), PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("additions_pre"),   PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("additions_post"),  PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("total"),           PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("depreciation"),    PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("closing_balance"), PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
    ],
  });

  return new Table({
    width:        { size: TW_LS, type: WidthType.DXA },
    columnWidths: ppeColWidths,
    rows: [
      noteTitleRow(ppeColWidths, noteNum, "Property, Plant and Equipment — PPE Schedule"),
      // Task 4 (doc6): two-row grouped header matching the PPE Schedule UI
      hdrRow1,
      hdrRow2,
      ...dataRows,
      totalRow,
    ],
  });
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
export interface NCEDocxParams {
  engagement: any;
  nceCyAmounts: Record<string, number>;
  ncePyAmounts: Record<string, number>;
  cyYear: string;
  pyYear: string;
  /** Dynamic note number map (static noteRef → sequential display number).
   *  Pass `nceDynamicNoteMap` from PipelineFinancialStatements. Notes absent
   *  from the map are inactive (no data) and get no number / are not exported. */
  dynamicNoteMap?: Map<number, number>;
  /** Phase 2 data — pass from PipelineFinancialStatements state */
  capitalData?: any[];   // from nce_capital_account
  notesData?: any[];     // from nce_financial_notes
  ppeData?: any[];       // from nce_ppe_schedule
  /** Signature block data — pass the UI's resolved sig* values so the
   *  Word block matches the on-screen signature block exactly. */
  signature?: SigData;
  /** Task 1: Font for the Word document (Arial / Calibri / Times New Roman etc.)
   *  Defaults to "Arial" if not provided. */
  font?: string;
  /** Task 4: Entity constitution type (Partnership / Proprietorship / LLP …)
   *  Used to derive signatory designation label. */
  constitution?: string;
  /** Task 8: rows that are "expanded" in the UI at the time of export.
   *  When provided, sub-item ledger rows are shown only for expanded static rows;
   *  collapsed rows show the aggregate only. When undefined, all sub-items shown. */
  expandedRows?: Set<string>;
  /** Task 2 (doc6): when true (Lock Preview active), notes rows where both CY
   *  and PY are blank/zero are hidden from the export. Section headers and total
   *  rows are always shown. Totals / calculations are NOT affected. */
  hideBlankNoteRows?: boolean;
}

export async function generateNCEFinancialsDocx(params: NCEDocxParams): Promise<void> {
  const {
    engagement,
    nceCyAmounts,
    ncePyAmounts,
    cyYear,
    pyYear,
    dynamicNoteMap = new Map<number, number>(),
    capitalData    = [],
    notesData      = [],
    ppeData        = [],
    signature      = {},
    font           = "Arial",
    constitution,
    expandedRows,
    hideBlankNoteRows = false,
  } = params;

  // Task 1: apply chosen font for the entire document
  FONT = font;

  // Phase 3 — sync unit scale with the active FS toggle (Actual / '000 / Lakhs)
  _exportDivisor = getActiveFsDivisor();
  const _scaleMeta = FS_SCALES.find(s => s.divisor === _exportDivisor) ?? FS_SCALES[0];
  _exportSuffix  = _scaleMeta.suffix;
  _exportUnit    = _scaleMeta.suffix.replace(/^\(|\)$/g, ""); // strip outer parens

  const entityName = engagement?.clients?.name ?? "Entity Name";
  const fy         = engagement?.financial_year ?? `${Number(cyYear) - 1}-${cyYear}`;

  // Phase 2 — Notes 3–28 from NOTES_CONFIG (build savedNotes first so COGS sub-items
  // can be passed to buildPLTable for Task 7 sub-classification in P&L)
  const savedNotes: Record<string, { cy: Record<string, number>; py: Record<string, number> }> = {};
  for (const row of notesData) {
    const key = String((row as any).note_type ?? "");
    if (!key) continue;
    savedNotes[key] = {
      cy: (row as any).cy_data && typeof (row as any).cy_data === "object"
        ? (row as any).cy_data as Record<string, number>
        : {},
      py: (row as any).py_data && typeof (row as any).py_data === "object"
        ? (row as any).py_data as Record<string, number>
        : {},
    };
  }

  // Task 9 (doc7): compute COGS sub-totals via computeDisplayData so formula-driven
  // totals (pa_total, pb_total, pc_total) are available for P&L sub-classification.
  const cogsRaw = savedNotes["cogs"];
  let cogsNoteCy: Record<string, number> | null = null;
  let cogsNotePy: Record<string, number> | null = null;
  if (cogsRaw) {
    const cogsConfig = NOTES_CONFIG.find(nc => nc.noteType === "cogs");
    if (cogsConfig) {
      const computed = computeDisplayData(cogsConfig, cogsRaw.cy ?? {}, cogsRaw.py ?? {});
      cogsNoteCy = computed.cy;
      cogsNotePy = computed.py;
    }
  }

  // Phase 1 tables (built after savedNotes so COGS data is available)
  const bsTable  = buildBSTable(nceCyAmounts, ncePyAmounts, cyYear, pyYear, entityName, dynamicNoteMap);
  const plTable  = buildPLTable(nceCyAmounts, ncePyAmounts, cyYear, pyYear, entityName, dynamicNoteMap,
    cogsNoteCy ?? undefined, cogsNotePy ?? undefined);
  // A docx Table instance can't be reused across pages, so build a fresh
  // signature block per page (Balance Sheet + P&L) from the same data.
  // Task 4: merge constitution so buildSignatureTable can derive designation
  const sigArgs: SigData = { clientName: entityName, constitution, ...signature };
  const sigBlock = () => buildSignatureTable(sigArgs);

  // Phase 2 — Note 1
  const note1Paras = buildNote1Section(entityName, cyYear);

  // Phase 2 — Note 2 (Capital Account)
  const capitalTables = buildCapitalAccountSection(capitalData, cyYear, pyYear);

  // Notes 3-28: export exactly the notes the UI shows — i.e. those active in
  // the dynamic note map (their BS/PL line carries data). The note number used
  // is the SAME dynamic number shown on screen.
  // For split notes (sourceNoteType + splitSide set), read from the source DB
  // record and extract only the _lt or _st suffixed keys via extractSplitData().
  // NCE Task 6: collect [numericNoteNumber, Table, sectionTag] triples then sort by note number
  // so export always follows chronological sequence (Note 3, 4, 5 … never random).
  // NCE Task 9 (doc8): sectionTag ("BS" | "PL") used to inject section transition headers.
  const noteTablePairs: Array<[number, Table, string]> = [];
  for (const cfg of NOTES_CONFIG) {
    const dynNum = getDynamicNoteDisplay(cfg.noteType, dynamicNoteMap);
    if (dynNum === null) continue;                        // inactive (no data) → skip

    // Determine where to read raw data from
    const sourceKey = cfg.sourceNoteType ?? cfg.noteType;
    const rawData   = savedNotes[sourceKey] ?? { cy: {}, py: {} };

    // For split notes, extract only the relevant side (_lt or _st suffixes)
    const data = cfg.splitSide ? extractSplitData(rawData, cfg.splitSide) : rawData;

    // NCE Task 4 (doc8): a note with a dynamic number is referenced in the BS/P&L
    // statement and MUST appear in the export, even if the detail rows are still zero.
    // Only skip when the note has NO dynamic number at all (handled by the guard above).
    // We keep a soft guard for COGS sub-notes whose activation was driven by a sibling
    // note (e.g. cogs_b activated because cogs_a has data) — if both CY and PY grand
    // totals are zero AND this note was not directly mapped to a FS line item, skip.
    const displayData = computeDisplayData(cfg, data.cy, data.py);
    const grandTotalRowDef = [...cfg.rows].reverse().find(r => r.isTotal);
    if (grandTotalRowDef) {
      const isPatA = cfg.pattern === "A";
      const totalCy = isPatA
        ? (displayData.cy[grandTotalRowDef.id + "_lt"] ?? 0) + (displayData.cy[grandTotalRowDef.id + "_st"] ?? 0)
        : (displayData.cy[grandTotalRowDef.id] ?? 0);
      const totalPy = isPatA
        ? (displayData.py[grandTotalRowDef.id + "_lt"] ?? 0) + (displayData.py[grandTotalRowDef.id + "_st"] ?? 0)
        : (displayData.py[grandTotalRowDef.id] ?? 0);
      // Only skip COGS sub-notes (cogs_b / cogs_c) when their detail is zero —
      // these are activated by sibling note linkage, not by a direct FS reference.
      const isCogsSub = cfg.noteType === "cogs_b" || cfg.noteType === "cogs_c";
      if (isCogsSub && !totalCy && !totalPy) continue;
      // For all other notes: always include when a dynamic number exists (they are
      // directly referenced in the BS or P&L statement).
    }

    // NCE Task 9 (doc8): record each note's section (BS or PL) so the children
    // array builder can insert "Notes to Balance Sheet" / "Notes to P&L" headers.
    const noteSectionTag = NOTE_META[cfg.noteType]?.section ?? "BS";
    noteTablePairs.push([parseInt(dynNum, 10), buildNoteSection(cfg, data.cy, data.py, dynNum, cyYear, pyYear, expandedRows, hideBlankNoteRows), noteSectionTag] as [number, Table, string]);
  }
  // Sort ascending by note number for correct sequential order in export
  noteTablePairs.sort((a, b) => a[0] - b[0]);
  const noteTables: Table[] = noteTablePairs.map(([, t]) => t);

  // NCE Task 9 (doc8): helper to build a "Notes to Balance Sheet" / "Notes to P&L" heading.
  // Bold, underlined, left-aligned; preceded by a spacer and followed by a thin spacer.
  const sectionTransitionParagraph = (section: "BS" | "PL"): Paragraph => {
    const cyYearStr = String(cyYear);
    const text = section === "PL"
      ? `Notes to Profit & Loss A/c as at 31.03.${cyYearStr}`
      : `Notes to Balance Sheet as on 31.03.${cyYearStr}`;
    return new Paragraph({
      spacing: { before: 280, after: 80 },
      // Note 1 fix (intelligent pagination): keepNext binds the section heading to
      // the following note table so it is never left orphaned at the bottom of a
      // page — if the first rows won't fit, the whole block moves to the next page.
      keepNext: true,
      keepLines: true,
      children: [new TextRun({ text, font: FONT, size: SZ_HDR, bold: true, underline: {} })],
    });
  };

  // Phase 2 — PPE Schedule (landscape). PPE is always-active (ref 10); use its
  // dynamic number so the title matches the Balance-Sheet reference.
  const ppeNoteNum = String(dynamicNoteMap.get(10) ?? 10);
  const ppeTable = buildPPETable(ppeData, cyYear, pyYear, ppeNoteNum);

  // Page settings
  const portraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
    borders: _pgBdr,
  };
  // Task 11 (doc6): notes pages use larger bottom margin for stamp/seal space
  const notesPortraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B_NOTES, left: MARG_L },
    borders: _pgBdr,
  };
  const landscapeProps = {
    size:   { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
    borders: _pgBdr,
  };

  // Note 1 fix ("changes in non corporate" doc): INTELLIGENT PROFESSIONAL
  // PAGINATION — replaces the previous forced one-note-per-page behaviour that
  // wasted pages and produced unprofessional, lengthy exports. Notes now FLOW:
  //   • multiple notes share a page until it genuinely fills
  //   • the section heading ("Notes to Balance Sheet…" / "Notes to P&L…") is
  //     emitted ONCE when the section starts, not before every note
  //   • keepNext on the heading + cantSplit on every row prevent orphan headings,
  //     half-tables, and separated totals (Word moves a block whole when it
  //     cannot fit, instead of splitting awkwardly)
  //   • large notes still continue naturally across pages with repeating headers
  // A single page break separates the free-text Accounting Policies (Note 1) from
  // the structured notes — that is a logical section boundary, not page wastage.
  const pageBreakPara = () => new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] });
  // Slightly larger gap between consecutive notes so they read as distinct blocks
  // while still flowing on the same page.
  const noteGap       = () => new Paragraph({ spacing: { before: 220, after: 0 }, children: [] });

  // Build the flowing notes list. The Capital Account (Note 2) is a BS-section
  // note, so we seed lastSection = "BS": the BS heading is emitted once before the
  // capital tables and the first structured BS note does not repeat it. The P&L
  // heading appears once, the moment the first P&L note is reached.
  const noteTablesWithHeaders: (Paragraph | Table)[] = [];
  let lastSection: "BS" | "PL" = "BS";
  for (const [, table, sectionTag] of noteTablePairs) {
    const sec = sectionTag as "BS" | "PL";
    if (sec !== lastSection) {
      // Section boundary (BS → P&L): emit the section heading once. keepNext keeps
      // it attached to the following note table.
      noteTablesWithHeaders.push(sectionTransitionParagraph(sec));
      lastSection = sec;
    } else {
      // Same section: a small gap so the next note flows beneath the previous one.
      noteTablesWithHeaders.push(noteGap());
    }
    noteTablesWithHeaders.push(table);
  }

  // Note 1 (Significant Accounting Policies) — free-text page, no section heading.
  // After it, a single page break starts the structured notes. The BS section
  // heading is shown once, then Capital Account + all BS notes flow, then the P&L
  // heading + P&L notes flow — filling each page before moving to the next.
  const noteChildren: (Paragraph | Table)[] = [
    ...note1Paras,
    pageBreakPara(),
    sectionTransitionParagraph("BS"),
    ...capitalTables.flatMap((t, i) => i === 0 ? [t] : [noteGap(), t]),
    ...noteTablesWithHeaders,
  ];

  // 2026-05-30 (revision 4) — User reported the client name was being
  // displayed TWICE on the first notes page (body banner + running header)
  // and the running-header copies on subsequent pages appeared LIGHT because
  // Word's editing view renders running-header content at reduced opacity.
  //
  // Resolution: show the client name banner exactly ONCE per page, as BODY
  // content, on every notes page. We achieve this by:
  //   1. Removing the running header entirely (eliminates the faded duplicate)
  //   2. Building one section per note, each section begins with the same
  //      navy body banner used on BS / P&L title rows
  //   3. Page break BEFORE each section (sectionType: NEXT_PAGE) so every
  //      note starts on a fresh page that opens with the dark banner
  // Banner = Calibri 14pt bold NAVY (#1F3864) + thick navy underline,
  // matching the BS / P&L titleRows entity row exactly.
  const makeNotesBanner = (): Paragraph => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:   { before: 60, after: 200 },
    border:    { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
    children:  [new TextRun({
      text: entityName.toUpperCase(),
      font: FONT, size: SZ_ENTITY, bold: true, color: NAVY,
    })],
  });

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SZ_BODY } },
      },
    },
    sections: [
      // Page 1: Balance Sheet + Signature
      {
        // Task 6 (doc6): BOTH = justified vertical alignment — pushes the
        // signature block to the page bottom and eliminates dead whitespace.
        properties: { page: portraitProps, verticalAlign: VerticalAlignSection.BOTH },
        children: [
          bsTable,
          new Paragraph({ spacing: { before: 60 }, children: [] }),
          sigBlock(),
        ],
      },
      // Page 2+: P&L + Signature
      {
        // Task 6 (doc6): same justified vertical fill as the BS page.
        properties: { page: portraitProps, verticalAlign: VerticalAlignSection.BOTH },
        children: [
          plTable,
          new Paragraph({ spacing: { before: 60 }, children: [] }),
          sigBlock(),
        ],
      },
      // Notes 1–28 (portrait, flows across pages)
      // Task 11: larger bottom margin for stamp/seal space
      //
      // 2026-05-30 (revision 4) — Banner shown ONCE at the top of the notes
      // section as BODY content (not a running header), matching how the BS
      // and P&L sections each show their entity-name title once on their
      // page. This:
      //   • eliminates the duplicate banner the user saw on the first notes
      //     page (body banner + running header rendering both at the same
      //     position)
      //   • removes the faded running-header copies on continuation pages
      //     that the user reported as "still light" — Word's editing view
      //     fades running-header text to ~60%, while body content always
      //     renders at full opacity
      // Result: one dark, bold NAVY (#1F3864) banner at the start of the
      // notes section, identical in font / size / colour / weight to the
      // BS / P&L title rows.
      {
        properties: { page: notesPortraitProps },
        children:   [makeNotesBanner(), ...noteChildren],
      },
      // PPE Schedule (landscape)
      {
        properties: { page: landscapeProps },
        children:   [ppeTable],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `FS_${entityName.replace(/[^a-z0-9]/gi, "_")}_${fy}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
