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
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

import { NOTES_CONFIG, computeDisplayData, extractSplitData } from "@/config/nceNotesConfig";
import type { NoteConfig } from "@/config/nceNotesConfig";
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
const TW_LS   = A4_H - MARG_L - MARG_R; // 16838 - 1080 - 360 = 15398 DXA (unchanged)
// PPE cols (11 cols, sum = 15398)
const PPE_CAT  = 2500;
const PPE_NAME = 2700;
const PPE_RATE =  700;
const PPE_OPEN = 1400;
const PPE_APRE = 1200;
const PPE_APOST= 1200;
const PPE_TOT  = 1400;
const PPE_DEPR = 1400;
const PPE_CLOS = 1400;
const PPE_NCY  = 1249;
const PPE_NPY  = 1249;
// 2500+2700+700+1400+1200+1200+1400+1400+1400+1249+1249 = 15398 ✓

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
  } = o;

  return new TableCell({
    ...(colSpan ? { columnSpan: colSpan } : {}),
    width:   { size: w, type: WidthType.DXA },
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    borders,
    margins: { top: 28, bottom: 28, left: padL + indent * 200, right: padR },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      spacing:   { before: 0, after: 0, line: 240, lineRule: "auto" as any },
      children: [new TextRun({ text, font: FONT, size: sz, bold, italic, color })],
    })],
  });
}

/** Amount cell — right-aligned */
function ac(
  val: number,
  w: number,
  opts: { bold?: boolean; bg?: string; borders?: Record<string, typeof bNone> } = {},
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
  return new TableRow({
    children: [
      cell({ text: label, w: CW_DESC, indent, bg, borders: BDR_ROW }),
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

  // Parent visibility flags (Task 4: parent shown only when ≥1 child is non-blank)
  const hasNCL = !blank(ltbCy,ltbPy)||!blank(oltlCy,oltlPy)||!blank(ltpCy,ltpPy);
  const hasCL  = !blank(stbCy,stbPy)||!blank(tpCy,tpPy)||!blank(oclCy,oclPy)||!blank(stpCy,stpPy);
  const hasPPE = !blank(ppeCy,ppePy)||!blank(intgCy,intgPy)||!blank(cwipCy,cwipPy);
  const hasNCA = hasPPE||!blank(ncinvCy,ncinvPy)||!blank(ltlaCy,ltlaPy)||!blank(oncaCy,oncaPy);
  const hasCA  = !blank(cinvCy,cinvPy)||!blank(stckCy,stckPy)||!blank(trCy,trPy)||
                 !blank(cashCy,cashPy)||!blank(stlaCy,stlaPy)||!blank(ocaCy,ocaPy);

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
    ...maybeRow("        (a)  Owners' Capital Account", n(2), capCy, capPy, 0),

    ...(hasNCL ? [
      parentRow("(2)  Non-Current Liabilities"),
      ...maybeRow("        (a)  Long-term borrowings",        n(3), ltbCy,  ltbPy),
      ...maybeRow("        (b)  Other long-term liabilities", n(4), oltlCy, oltlPy),
      ...maybeRow("        (c)  Long-term provisions",        n(5), ltpCy,  ltpPy),
    ] : []),

    ...(hasCL ? [
      parentRow("(3)  Current Liabilities"),
      ...maybeRow("        (a)  Short-term borrowings",    n(6), stbCy, stbPy),
      ...maybeRow("        (b)  Trade payables",           n(7), tpCy,  tpPy),
      ...maybeRow("        (c)  Other current liabilities",n(8), oclCy, oclPy),
      ...maybeRow("        (d)  Short-term provisions",    n(9), stpCy, stpPy),
    ] : []),

    blankRow(),
    grandTotalRow("TOTAL", totELcy, totELpy, AlignmentType.RIGHT),
    blankRow(),

    // ── ASSETS ───────────────────────────────────────────────────────────
    sectionRow("ASSETS"),

    ...(hasNCA ? [
      parentRow("(1)  Non-Current Assets"),
      ...(hasPPE ? [
        parentRow("        (a)  Property, Plant & Equipment and Intangible Assets"),
        ...maybeRow("                   (i)   Property, plant and equipment", n(10), ppeCy,  ppePy,  2),
        ...maybeRow("                   (ii)  Intangible assets",             n(12), intgCy, intgPy, 2),
        ...maybeRow("                   (iii) Capital work-in-progress",      n(11), cwipCy, cwipPy, 2),
      ] : []),
      ...maybeRow("        (b)       Non-current investments",    n(13), ncinvCy, ncinvPy),
      ...maybeRow("        (c)       Long-term loans and advances",n(14), ltlaCy,  ltlaPy),
      ...maybeRow("        (d)       Other non-current assets",   n(15), oncaCy,  oncaPy),
    ] : []),

    ...(hasCA ? [
      parentRow("(2)  Current Assets"),
      ...maybeRow("        (a)  Current investments",          n(16), cinvCy, cinvPy),
      ...maybeRow("        (b)  Inventories",                  n(17), stckCy, stckPy),
      ...maybeRow("        (c)  Trade receivables",            n(18), trCy,   trPy),
      ...maybeRow("        (d)  Cash and bank balances",       n(19), cashCy, cashPy),
      ...maybeRow("        (e)  Short-term loans and advances",n(20), stlaCy, stlaPy),
      ...maybeRow("        (f)  Other current assets",         n(21), ocaCy,  ocaPy),
    ] : []),

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

  // Task 4: visibility flags — optional / supplementary lines hidden when blank
  const hasExc  = !blank(excCy,      excPy);
  const hasExt  = !blank(extCy,      extPy);
  const hasRem  = !blank(remCy,      remPy);
  const hasTax  = !blank(curTaxCy,   curTaxPy)  || !blank(priorTaxCy, priorTaxPy) || !blank(deferTaxCy, deferTaxPy);
  const hasDisc = !blank(discOpCy,   discOpPy)  || !blank(discTaxCy,  discTaxPy);

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
    ...maybeRow("II.   Other income",          n(23), revOthCy, revOthPy),
    subTotalRow("III.  Total Income (I + II)", totIncCy, totIncPy),
    blankRow(),

    // ── EXPENSES ─────────────────────────────────────────────────────────
    sectionRow("EXPENSES"),
    ...maybeRow("(a)   Cost of goods sold",            n(24), cogsCy, cogsPy),
    ...maybeRow("(b)   Employee benefits expense",      n(25), empCy,  empPy),
    ...maybeRow("(c)   Finance costs",                  n(26), finCy,  finPy),
    ...maybeRow("(d)   Depreciation and amortisation",  n(27), depCy,  depPy),
    ...maybeRow("(e)   Other expenses",                 n(28), othCy,  othPy),
    subTotalRow("IV.   Total Expenses", totExpCy, totExpPy),
    blankRow(),

    // ── Profit chain ─────────────────────────────────────────────────────
    dataRow(
      "V.    Profit /(Loss) before exceptional items, partners' remuneration & tax (III−IV)",
      null, pVcy, pVpy,
    ),
    ...(hasExc ? [dataRow("VI.   Exceptional items",                                             null, excCy,  excPy)]  : []),
    dataRow("VII.  Profit / (Loss) before extraordinary items and tax (V + VI)",         null, pVIIcy, pVIIpy),
    ...(hasExt ? [dataRow("VIII. Extraordinary items",                                           null, extCy,  extPy)]  : []),
    dataRow("IX.   Profit / (Loss) before partners' remuneration and tax (VII + VIII)",  null, pIXcy,  pIXpy),
    ...(hasRem ? [dataRow("X.    Partners' remuneration",                              n(29), remCy,  remPy)]  : []),
    dataRow("XI.   Profit / (Loss) before tax (IX − X)",                                null, pXIcy,  pXIpy),
    blankRow(),

    // ── Tax expense (XII) — hidden when all sub-items are blank ──────────
    ...(hasTax ? [
      parentRow("XII.  Tax expense"),
      ...maybeRow("        (1)  Current tax",                                       null, curTaxCy,   curTaxPy,   1),
      ...maybeRow("        (2)  Short / (excess) provision for earlier years",      null, priorTaxCy, priorTaxPy, 1),
      ...maybeRow("        (3)  Deferred tax charge / (benefit)",                   null, deferTaxCy, deferTaxPy, 1),
      subTotalRow("             Total tax expense", totTaxCy, totTaxPy),
      blankRow(),
    ] : []),

    grandTotalRow(
      "XIII. Profit / (Loss) for the year (XI − XII)",
      netProfCy,
      netProfPy,
    ),
    blankRow(),

    // ── Discontinued operations (XIV–XVII) — hidden when all blank ───────
    ...(hasDisc ? [
      ...maybeRow("XIV.  Profit/(loss) from discontinuing operations",                                   null, discOpCy,  discOpPy),
      ...maybeRow("XV.   Tax expense of discontinuing operations",                                       null, discTaxCy, discTaxPy),
      ...maybeRow("XVI.  Profit/(loss) from discontinuing operations (after tax) (XIV-XV)",              null, discAtCy,  discAtPy),
      grandTotalRow("XVII. Profit/(Loss) for the year (XIII+XVI)", finalProfCy, finalProfPy),
    ] : []),
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
    lines: Array<{ text: string; bold?: boolean; gap?: boolean; muted?: boolean }>,
  ): Paragraph[] {
    return lines.map(l => new Paragraph({
      spacing: { before: l.gap ? 120 : 0, after: 8 },
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
          new TableCell({
            width:   { size: TW - half, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 1440, right: 80 },
            children: sigLines([
              { text: `Place: ${place}` },
              { text: `Date: ${date}` },
              { text: `For, ${clientName}`, bold: true, gap: true },
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
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
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
        margins: { top: 30, bottom: 30, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
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
      cell({ text: "Particulars", w: NW_DESC, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      cell({ text: hdr(cyYear), w: NW_CY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
      cell({ text: hdr(pyYear), w: NW_PY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
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
  return new TableRow({
    children: [
      cell({ text: label, w: NW_DESC, bold, bg, borders: bdr, indent }),
      ac(cy, NW_CY, { bold, bg, borders: bdr }),
      ac(py, NW_PY, { bold, bg, borders: bdr }),
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
        children: [new TextRun({ text, font: FONT, size: SZ_BODY, bold: true, color: WHITE })],
      })],
    });

  const r1 = new TableRow({
    children: [
      cell({ text: "Particulars", w: NW_A_DESC, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      spanCell("Long Term", ltw, 2),
      spanCell("Short Term", stw, 2),
    ],
  });
  const r2 = new TableRow({
    children: [
      cell({ text: "", w: NW_A_DESC, sz: SZ_BODY, color: WHITE, bg: BG_HDR, borders: BDR_NONE }),
      cell({ text: hdr(cyYear), w: NW_A_LTCY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80 }),
      cell({ text: hdr(pyYear), w: NW_A_LTPY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80 }),
      cell({ text: hdr(cyYear), w: NW_A_STCY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80 }),
      cell({ text: hdr(pyYear), w: NW_A_STPY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 80 }),
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
  return new TableRow({
    children: [
      cell({ text: label, w: NW_A_DESC, bold, bg, borders: bdr, indent }),
      ac(ltCy, NW_A_LTCY, { bold, bg, borders: bdr }),
      ac(ltPy, NW_A_LTPY, { bold, bg, borders: bdr }),
      ac(stCy, NW_A_STCY, { bold, bg, borders: bdr }),
      ac(stPy, NW_A_STPY, { bold, bg, borders: bdr }),
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

function buildNote1Section(entityName: string, cyYear: string): Paragraph[] {
  // Vertical gap between policy points (~0.07")
  const GAP = 100;

  const txt = (text: string, bold = false) =>
    new TextRun({ text, font: FONT, size: SZ_BODY, bold, color: BLACK });

  // Compact block paragraph — keepLines/keepNext bind the whole note to one page
  const block = (
    runs: TextRun[],
    opts: { indent?: number; hanging?: number; after?: number; keepNext?: boolean } = {},
  ): Paragraph =>
    new Paragraph({
      spacing:   { before: 0, after: opts.after ?? 40, line: 240, lineRule: "auto" as any },
      indent:    opts.indent ? { left: opts.indent, hanging: opts.hanging } : undefined,
      keepLines: true,
      keepNext:  opts.keepNext ?? true,
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
    block([txt("1.  Basis of Preparation", true)], { after: 20 }),
    block(
      [txt(`The financial statements of ${entityName} have been prepared in accordance with the Generally Accepted Accounting Principles in India (GAAP) under the historical cost convention on an accrual basis. The financial statements comply with the Accounting Standards applicable to the entity and other relevant provisions of the applicable law.`)],
      { after: GAP },
    ),
    block([txt("2.  Significant Accounting Policies", true)], { after: 40 }),
    // Each policy = bold label heading + description below; GAP separates points
    ...NOTE1_POLICIES.flatMap((p, i) => [
      block([txt(p.label, true)], { indent: 280, after: 10 }),
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
): Table {
  // Auto/manual breakup rows are stored in cy_data._custom_rows; their amounts
  // live as ordinary keys (id or id+"_lt"/"_st") in rawCy/rawPy. For notes like
  // Borrowings the per-ledger amounts sit on custom rows ATTACHED to a static
  // row, so they must be folded into that static row (and the totals) — exactly
  // as the on-screen note does in its collapsed view.
  const customRows: NoteCustomRow[] = Array.isArray((rawCy as any)._custom_rows)
    ? ((rawCy as any)._custom_rows as NoteCustomRow[])
    : [];

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
  const emittedCustoms = new Set<string>();
  const emitCustoms = (predicate: (cr: NoteCustomRow) => boolean) => {
    for (const cr of customRows) {
      if (cr.attachedTo || emittedCustoms.has(cr.id) || !predicate(cr)) continue;
      emittedCustoms.add(cr.id);
      if (isA) {
        const c = suffixed(cy, cr.id); const p = suffixed(py, cr.id);
        if (!c.lt && !c.st && !p.lt && !p.st) continue;
        rows.push(noteRowA(cr.label || "—", c.lt, p.lt, c.st, p.st, 1, "data"));
      } else {
        const c = cy[cr.id] ?? 0, p = py[cr.id] ?? 0;
        if (!c && !p) continue;
        rows.push(noteRowB(cr.label || "—", c, p, 1, "data"));
      }
    }
  };

  // Task 2: pre-pass — decide which static rows are visible (blank rows suppressed).
  // Total rows are always visible.  Section headers are visible only when at least
  // one subsequent data row (before the next header/total) is non-blank.
  const includedIdxs = new Set<number>();
  for (let i = 0; i < cfg.rows.length; i++) {
    const row = cfg.rows[i];
    if (row.isTotal) {
      includedIdxs.add(i);
    } else if (row.isSectionHeader) {
      for (let j = i + 1; j < cfg.rows.length; j++) {
        const nxt = cfg.rows[j];
        if (nxt.isSectionHeader || nxt.isTotal) break;
        const nonBlank = isA
          ? (() => { const v = aggA(nxt.id); return !!(v.lt || v.ltP || v.st || v.stP); })()
          : (() => { const v = aggB(nxt.id); return !!(v.c  || v.p); })();
        if (nonBlank) { includedIdxs.add(i); break; }
      }
    } else {
      const nonBlank = isA
        ? (() => { const v = aggA(row.id); return !!(v.lt || v.ltP || v.st || v.stP); })()
        : (() => { const v = aggB(row.id); return !!(v.c  || v.p); })();
      if (nonBlank) includedIdxs.add(i);
    }
  }

  for (let i = 0; i < cfg.rows.length; i++) {
    if (!includedIdxs.has(i)) continue;
    const row = cfg.rows[i];
    if (row.isSectionHeader) {
      rows.push(noteSecHdr(colWidths, row.label));
    } else if (row.isTotal) {
      const style = row.id === grandTotalId ? "total" : "subtotal";
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
      // Main (static) row shows the collapsed aggregate; its attached sub-items
      // (auto/manual breakup ledgers) are then listed indented beneath it.
      const subIndent = (row.indent ?? 0) + 1;
      if (isA) {
        const v = aggA(row.id);
        rows.push(noteRowA(row.label, v.lt, v.ltP, v.st, v.stP, row.indent ?? 0, "data"));
        for (const cr of attachedRows(row.id)) {
          const c = suffixed(cy, cr.id); const p = suffixed(py, cr.id);
          if (!c.lt && !c.st && !p.lt && !p.st) continue;   // skip empty sub-items
          rows.push(noteRowA(cr.label || "—", c.lt, p.lt, c.st, p.st, subIndent, "data"));
        }
      } else {
        const v = aggB(row.id);
        rows.push(noteRowB(row.label, v.c, v.p, row.indent ?? 0, "data"));
        for (const cr of attachedRows(row.id)) {
          const c = cy[cr.id] ?? 0, p = py[cr.id] ?? 0;
          if (!c && !p) continue;                            // skip empty sub-items
          rows.push(noteRowB(cr.label || "—", c, p, subIndent, "data"));
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
  const ppeColWidths = [PPE_CAT, PPE_NAME, PPE_RATE, PPE_OPEN, PPE_APRE, PPE_APOST, PPE_TOT, PPE_DEPR, PPE_CLOS, PPE_NCY, PPE_NPY];
  const totalW = ppeColWidths.reduce((s, w) => s + w, 0); // 15398

  const h = (text: string, w: number) =>
    cell({ text, w, sz: SZ_XS, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER, padL: 40, padR: 40 });

  const hdrRow = new TableRow({
    tableHeader: true,
    children: [
      h("Asset Category",          PPE_CAT),
      h("Asset Name",              PPE_NAME),
      h("Rate\n(%)",               PPE_RATE),
      h("Opening\nBalance",        PPE_OPEN),
      h("Additions\n(Pre 1 Oct)",  PPE_APRE),
      h("Additions\n(Post 1 Oct)", PPE_APOST),
      h("Total\nCost",             PPE_TOT),
      h("Depreciation\nCharged",   PPE_DEPR),
      h("Closing\nBalance",        PPE_CLOS),
      h(hdr(`Net Block ${cyYear}`), PPE_NCY),
      h(hdr(`Net Block ${pyYear}`), PPE_NPY),
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
          nac(r.opening_balance, PPE_OPEN),
          nac(r.additions_pre,   PPE_APRE),
          nac(r.additions_post,  PPE_APOST),
          nac(r.total,           PPE_TOT),
          nac(r.depreciation,    PPE_DEPR),
          nac(r.closing_balance, PPE_CLOS),
          nac(r.net_cy,          PPE_NCY),
          nac(r.net_py,          PPE_NPY),
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
      ac(sum("opening_balance"), PPE_OPEN,  { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("additions_pre"),   PPE_APRE,  { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("additions_post"),  PPE_APOST, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("total"),           PPE_TOT,   { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("depreciation"),    PPE_DEPR,  { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("closing_balance"), PPE_CLOS,  { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("net_cy"),          PPE_NCY,   { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("net_py"),          PPE_NPY,   { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
    ],
  });

  return new Table({
    width:        { size: TW_LS, type: WidthType.DXA },
    columnWidths: ppeColWidths,
    rows: [
      noteTitleRow(ppeColWidths, noteNum, "Property, Plant and Equipment — PPE Schedule"),
      hdrRow,
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

  // Phase 1 tables
  const bsTable  = buildBSTable(nceCyAmounts, ncePyAmounts, cyYear, pyYear, entityName, dynamicNoteMap);
  const plTable  = buildPLTable(nceCyAmounts, ncePyAmounts, cyYear, pyYear, entityName, dynamicNoteMap);
  // A docx Table instance can't be reused across pages, so build a fresh
  // signature block per page (Balance Sheet + P&L) from the same data.
  // Task 4: merge constitution so buildSignatureTable can derive designation
  const sigArgs: SigData = { clientName: entityName, constitution, ...signature };
  const sigBlock = () => buildSignatureTable(sigArgs);

  // Phase 2 — Note 1
  const note1Paras = buildNote1Section(entityName, cyYear);

  // Phase 2 — Note 2 (Capital Account)
  const capitalTables = buildCapitalAccountSection(capitalData, cyYear, pyYear);

  // Phase 2 — Notes 3–28 from NOTES_CONFIG
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

  // Notes 3-28: export exactly the notes the UI shows — i.e. those active in
  // the dynamic note map (their BS/PL line carries data). The note number used
  // is the SAME dynamic number shown on screen.
  // For split notes (sourceNoteType + splitSide set), read from the source DB
  // record and extract only the _lt or _st suffixed keys via extractSplitData().
  const noteTables: Table[] = [];
  for (const cfg of NOTES_CONFIG) {
    const dynNum = getDynamicNoteDisplay(cfg.noteType, dynamicNoteMap);
    if (dynNum === null) continue;                        // inactive (no data) → skip

    // Determine where to read raw data from
    const sourceKey = cfg.sourceNoteType ?? cfg.noteType;
    const rawData   = savedNotes[sourceKey] ?? { cy: {}, py: {} };

    // For split notes, extract only the relevant side (_lt or _st suffixes)
    const data = cfg.splitSide ? extractSplitData(rawData, cfg.splitSide) : rawData;

    noteTables.push(buildNoteSection(cfg, data.cy, data.py, dynNum, cyYear, pyYear));
  }

  // Phase 2 — PPE Schedule (landscape). PPE is always-active (ref 10); use its
  // dynamic number so the title matches the Balance-Sheet reference.
  const ppeNoteNum = String(dynamicNoteMap.get(10) ?? 10);
  const ppeTable = buildPPETable(ppeData, cyYear, pyYear, ppeNoteNum);

  // Page settings
  const portraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
  };
  const landscapeProps = {
    size:   { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
  };

  const spacer = () => new Paragraph({ spacing: { before: 240, after: 0 }, children: [] });

  // Build notes section children: Note 1 paragraphs, Note 2 tables, Notes 3-28 tables
  const noteChildren: (Paragraph | Table)[] = [
    ...note1Paras,
    ...capitalTables.flatMap(t => [spacer(), t]),
    ...noteTables.flatMap(t => [spacer(), t]),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SZ_BODY } },
      },
    },
    sections: [
      // Page 1: Balance Sheet + Signature
      {
        properties: { page: portraitProps },
        children: [
          bsTable,
          // Task 2: minimal gap — avoids the large dead zone that triggered Word's
          // aggressive "shrink to one page" scaling on BS/PL pages.
          new Paragraph({ spacing: { before: 60 }, children: [] }),
          sigBlock(),
        ],
      },
      // Page 2+: P&L + Signature
      {
        properties: { page: portraitProps },
        children: [
          plTable,
          new Paragraph({ spacing: { before: 60 }, children: [] }),
          sigBlock(),
        ],
      },
      // Notes 1–28 (portrait, flows across pages)
      {
        properties: { page: portraitProps },
        children:   noteChildren,
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
