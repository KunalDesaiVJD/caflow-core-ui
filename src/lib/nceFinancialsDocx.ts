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
  Header,
  HeightRule,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  Packer,
  PageOrientation,
  Paragraph,
  SectionType,
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
// 2026-06-05 Phase 3 — canonical per-row aggregator. DOCX aggA/aggB now
// read perRow lookups instead of duplicating the math locally.
import { computeNoteTotals } from "@/lib/nceNoteTotals";
import { collapseDuplicateCustomRows } from "@/lib/nceAutoPopulate";
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
const MARG_T = 720;             // 0.5" top — used for BS / P&L pages
// Notes pages need a taller top margin so the two-line running header
// (entity name + section heading) sits comfortably above the body content
// without overlapping. 1350 DXA ≈ 0.94" gives ~0.4" of breathing room
// after the header text while keeping the layout compact.
const MARG_T_NOTES   = 1350;   // 0.94" top for notes portrait pages
const MARG_HDR_NOTES =  450;   // 0.31" from page top to running header start
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
// PPE cols — 9 cols: Asset Name | Rate | Opening | Add-pre | Add-post |
// Deletions | Total | Depreciation | Closing. (Category column removed per
// client request; Deletions column added — net column count unchanged.)
// (TW_LS - PPE_NAME - PPE_RATE) / 7 numeric cols = (15398-2700-700)/7 = 1714
const PPE_NAME = 2700;
const PPE_RATE =  700;
const PPE_NUM  = 1714;  // equal width for all 7 numeric columns
// 2700+700+7×1714 = 3400+11998 = 15398 ✓

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
// "actual" → whole rupees. "thousands" / "lakhs" → 2 decimals, matching the
// on-screen FS toolbar so the exported Word file shows the same precision the
// auditor sees in the browser (₹7,18,540 → 718.54 in '000s, not 719).
function fmt(n: number): string {
  const scaled = _exportDivisor === 1 ? n : n / _exportDivisor;
  if (_exportDivisor === 1) {
    if (Math.abs(scaled) < 0.5) return "—";
    const abs = Math.round(Math.abs(scaled)).toLocaleString("en-IN");
    return scaled < 0 ? `(${abs})` : abs;
  }
  if (Math.abs(scaled) < 0.005) return "—";
  const abs = Math.abs(scaled).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return scaled < 0 ? `(${abs})` : abs;
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

/** Full-width category/group header within a note table.
 *  Issue 4 — rendered with NO fill (just bold black text + bottom hairline) so
 *  group headers like "Interest income" stay consistent with the no-color
 *  "Particulars" header. A light-blue BG_TOT fill here used to clash visually
 *  with the now-uncoloured Particulars row. */
function noteSecHdr(colWidths: number[], label: string): TableRow {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: colWidths.length,
        width:   { size: totalW, type: WidthType.DXA },
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

/** Right-aligned "In ₹" units line shown at the top of every note table
 *  (Notes 3+), between the note title and the column header — mirroring the
 *  firm reference where each note carries an "In ₹" indicator.
 *  Scale-aware via _exportUnit ("₹" / "₹ in '000" / "₹ in Lakhs"). The ₹ glyph
 *  is rendered in Arial regardless of the chosen export font, because some
 *  fonts (e.g. Garamond / Georgia) lack the ₹ (U+20B9) glyph and would
 *  otherwise show a missing-glyph box. */
function noteUnitsRow(colWidths: number[]): TableRow {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  // _exportUnit always begins with "₹"; force just that glyph to Arial.
  const after = _exportUnit.startsWith("₹") ? _exportUnit.slice(1) : ` ${_exportUnit}`;
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: colWidths.length,
        width:   { size: totalW, type: WidthType.DXA },
        borders: BDR_NONE,
        margins: { top: 24, bottom: 8, left: 100, right: 100 },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing:   { before: 0, after: 0 },
          keepNext:  true, keepLines: true,
          children: [
            new TextRun({ text: "In ", font: FONT,    size: SZ_HDR, bold: true, color: BLACK }),
            new TextRun({ text: "₹",    font: "Arial", size: SZ_HDR, bold: true, color: BLACK }),
            ...(after ? [new TextRun({ text: after, font: FONT, size: SZ_HDR, bold: true, color: BLACK })] : []),
          ],
        })],
      }),
    ],
  });
}

/** Pattern B column header (3 cols) */
function noteHdrB(cyLabel: string, pyLabel: string): TableRow {
  // Issue 3 — "Particulars" header rendered with NO fill + black BOLD text
  // (firm-reference style). Issue-4 refinement: framed with top+bottom navy
  // rules (BDR_SUB) for a clear, distinct header band, and the text is bumped
  // +2 (SZ_BODY 18 → SZ_HDR 20, i.e. 9pt → 10pt) so it stands apart from the
  // 9pt data rows below.
  return new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "Particulars", w: NW_DESC, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, padL: 100, vertPad: 22, keepNext: true }),
      cell({ text: hdr(cyLabel), w: NW_CY, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: 120, vertPad: 22, keepNext: true }),
      cell({ text: hdr(pyLabel), w: NW_PY, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: 120, vertPad: 22, keepNext: true }),
    ],
  });
}

/** Pattern B data/sub-total/grand-total row (3 cols) */
function noteRowB(
  label: string,
  cy: number | null,
  py: number | null,
  indent = 0,
  style: "data" | "subtotal" | "total" = "data",
): TableRow {
  const bg   = style === "total" ? BG_GRAN : style === "subtotal" ? BG_TOT : undefined;
  const bdr  = style === "total" ? BDR_GRAND : style === "subtotal" ? BDR_SUB : BDR_ROW;
  const bold = style !== "data";
  // null → blank cell (same border/padding as a normal amount cell but no text).
  // Used when a parent row is expanded and its children already represent the total
  // — passing null prevents "—" from appearing where the amount should be invisible.
  // Issue 2 — keep every note whole: bind all rows with keepNext so Word never
  // splits a note across a page boundary (a note that doesn't fit moves to the
  // next page intact, column header repeating via tableHeader). The grand-total
  // row (style "total", always the LAST row of a note) is left free
  // (keepNext=false) so the note does NOT chain to the following note — that
  // lets a short next note still pack into leftover space rather than be dragged.
  // cantSplit additionally prevents a single tall row from breaking mid-row.
  const keepNext = style !== "total";
  const amtCell = (val: number | null, w: number) =>
    val !== null
      ? ac(val, w, { bold, bg, borders: bdr, vertPad: 18, keepNext })
      : cell({ text: "", w, align: AlignmentType.RIGHT, padL: 20, padR: 120, bold, bg, borders: bdr, vertPad: 18, keepNext });
  return new TableRow({
    cantSplit: true,
    children: [
      cell({ text: label, w: NW_DESC, bold, bg, borders: bdr, indent, vertPad: 18, keepNext }),
      amtCell(cy, NW_CY),
      amtCell(py, NW_PY),
    ],
  });
}

/** Pattern A column header (2 rows: LT/ST then CY/PY) */
function noteHdrA(cyLabel: string, pyLabel: string): TableRow[] {
  const ltw = NW_A_LTCY + NW_A_LTPY;
  const stw = NW_A_STCY + NW_A_STPY;
  // Issue 3 + Issue-4 refinement — Pattern A header: NO fill, black BOLD text,
  // framed with navy top+bottom rules (BDR_SUB) for a clear header band, and
  // text bumped +2 (SZ_HDR 20 = 10pt) to stand apart from the 9pt data rows.
  const spanCell = (text: string, w: number, span: number) =>
    new TableCell({
      columnSpan: span,
      width:   { size: w, type: WidthType.DXA },
      borders: BDR_SUB,
      margins: { top: 36, bottom: 0, left: 80, right: 80 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        keepNext: true, keepLines: true,
        children: [new TextRun({ text, font: FONT, size: SZ_HDR, bold: true, color: BLACK })],
      })],
    });

  const r1 = new TableRow({
    children: [
      cell({ text: "Particulars", w: NW_A_DESC, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, padL: 100, vertPad: 22, keepNext: true }),
      spanCell("Long Term", ltw, 2),
      spanCell("Short Term", stw, 2),
    ],
  });
  const r2 = new TableRow({
    children: [
      cell({ text: "", w: NW_A_DESC, sz: SZ_HDR, color: BLACK, borders: BDR_SUB, vertPad: 22, keepNext: true }),
      cell({ text: hdr(cyLabel), w: NW_A_LTCY, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
      cell({ text: hdr(pyLabel), w: NW_A_LTPY, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
      cell({ text: hdr(cyLabel), w: NW_A_STCY, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
      cell({ text: hdr(pyLabel), w: NW_A_STPY, sz: SZ_HDR, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: 80, vertPad: 22, keepNext: true }),
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
  // Issue 2 — keep every note whole (see noteRowB): keepNext on all rows except
  // the grand total (last row) so the note is atomic but doesn't chain forward.
  const keepNext = style !== "total";
  return new TableRow({
    cantSplit: true,
    children: [
      cell({ text: label, w: NW_A_DESC, bold, bg, borders: bdr, indent, vertPad: 18, keepNext }),
      ac(ltCy, NW_A_LTCY, { bold, bg, borders: bdr, vertPad: 18, keepNext }),
      ac(ltPy, NW_A_LTPY, { bold, bg, borders: bdr, vertPad: 18, keepNext }),
      ac(stCy, NW_A_STCY, { bold, bg, borders: bdr, vertPad: 18, keepNext }),
      ac(stPy, NW_A_STPY, { bold, bg, borders: bdr, vertPad: 18, keepNext }),
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
      children: [new TextRun({ text: amountUnitsLabel(), font: FONT, size: SZ_HDR, bold: true, color: BLACK })],
    }),
  ];
}

/**
 * Mirror of the on-screen NCE Stage 7 Notes-to-Accounts template that lives
 * in src/components/stage7/NotesToAccounts.tsx::buildNotesTemplate(). Used as
 * the fallback when notes_to_accounts_data has no saved notes_json yet (fresh
 * engagement, auditor hasn't visited Stage 7 → Notes to Accounts) so the
 * Word file never exports an empty Note 1 page.
 *
 * IF YOU EDIT THIS, UPDATE THE STAGE 7 TEMPLATE TOO — the two must agree so
 * the Word file matches the on-screen rendering byte-for-byte.
 */
function defaultNceNote1Template(auditYear: string): Array<{
  id: string; label: string; title: string; selected: boolean; text: string;
}> {
  return [
    { id: "note-1", label: "Note 1", title: "Balance Confirmation", selected: true,
      text: "All debit and credit balances and accounts squared up during the year are subject to confirmation from respective parties." },
    { id: "note-2", label: "Note 2", title: "Rearrangement of Figures", selected: true,
      text: "The figures are rearranged/regrouped wherever considered necessary and rounded off to the nearest rupee." },
    { id: "note-3", label: "Note 3", title: "Cash Balance & Closing Stock", selected: true,
      text: `Cash balance on hand was Rs. [CASH_AMOUNT]/- and value of Closing Stock Rs. [CLOSING_STOCK]/- as at 31st March, ${auditYear} are taken as certified by proprietor.` },
    { id: "note-4", label: "Note 4", title: "Current Assets Valuation", selected: true,
      text: "In opinion of assessee, current assets, loans & advances are approximately of the value at which these are stated in the balance sheet." },
    { id: "note-5", label: "Note 5", title: "Fixed Assets", selected: true,
      text: "Fixed Assets are stated at Cost less depreciation as shown in Note- [FA_NOTE]. Details of rate and amount of Depreciation claimed has been stated in Note-[DEP_NOTE]." },
    { id: "note-6", label: "Note 6", title: "Reliance on Vouchers", selected: true,
      text: "Whenever the supporting proof for the entries made in the books of accounts are not available for the purpose of audit, we are relied on the vouchers prepared and authenticated by the partner." },
    { id: "note-7", label: "Note 7", title: "Loans via Cheque/DD/ECS", selected: true,
      text: "As informed by the partner, the amount of loan or deposits or specified sums taken or accepted or repaid by the assessee through a/c. payee cheque/demand draft or ECS only. However, it is not possible for us to verify the same as necessary evidence are not in possession of the assessee." },
    { id: "note-8", label: "Note 8", title: "Notes form Part of Accounts", selected: true,
      text: `Notes No. 1 to [LAST_NOTE] forms part of accounts for the year ended on 31st March, ${auditYear}.` },
  ];
}

function buildNote1Section(
  entityName: string,
  cyYear: string,
  ntaData?: any | null,
  sigData?: SigData,
): (Paragraph | Table)[] {
  // ROOT-CAUSE FIX (BHAKTI INFRA Word export of Note 1 didn't match the app):
  // the previous implementation hardcoded a corporate-style "Significant
  // Accounting Policies" boilerplate (NOTE1_POLICIES). For non-corporate
  // entities the auditor uses Stage 7 → Notes to Accounts which holds
  // "Balance Confirmation", "Rearrangement of Figures", etc. — the Word
  // file must render THOSE notes, with the same numbering / selection /
  // header overrides / token substitutions the on-screen view uses.
  //
  // Source order:
  //   1. ntaData.notes_json  (saved by the auditor in Stage 7).
  //   2. Built-in template (defaultNceNote1Template) when the auditor
  //      hasn't visited Stage 7 yet — keeps the Word file populated on
  //      a fresh engagement instead of emitting an empty Note 1 page.

  const auditYear = cyYear; // e.g. "2026" — matches the Stage 7 page
  const saved: any[] = Array.isArray(ntaData?.notes_json) ? ntaData.notes_json : [];
  const template = defaultNceNote1Template(auditYear);
  const templateMap = new Map(template.map(t => [t.id, t]));

  // Merge saved overrides into the template (selected / text / title) and
  // append any custom notes the auditor added beyond the 8 built-ins.
  const merged: Array<{
    id: string; label: string; title: string; selected: boolean; text: string;
  }> = saved.length === 0
    ? template
    : saved.map((r: any) => {
        const tmpl = templateMap.get(r.id);
        if (tmpl) {
          return {
            ...tmpl,
            selected: r.selected ?? tmpl.selected,
            text:     r.text     ?? tmpl.text,
            title:    r.title    ?? tmpl.title,
          };
        }
        return {
          id:       String(r.id ?? ""),
          label:    String(r.label ?? r.title ?? ""),
          title:    String(r.title ?? ""),
          selected: r.selected ?? true,
          text:     String(r.text  ?? ""),
        };
      });

  // Header overrides (Cash amount, Closing stock, FA note num, …) are typed
  // by the auditor in the Stage 7 page header and stored in
  // notes_to_accounts_data.header_overrides. We substitute them into every
  // note body the same way the on-screen renderer / Excel export does.
  const header = (ntaData?.header_overrides || {}) as Record<string, any>;
  const lastNoteOverride = header.lastNoteOverride;
  const selectedNotes    = merged.filter(n => n.selected !== false);
  const lastNoteNum      = lastNoteOverride
    ? String(lastNoteOverride)
    : String(selectedNotes.length);

  const resolveTokens = (text: string): string =>
    (text || "")
      .replace(/\[CASH_AMOUNT\]/g,   String(header.cashAmount   || ""))
      .replace(/\[CLOSING_STOCK\]/g, String(header.closingStock || ""))
      .replace(/\[FA_NOTE\]/g,       String(header.faNoteNum    || ""))
      .replace(/\[DEP_NOTE\]/g,      String(header.depNoteNum   || ""))
      .replace(/\[LAST_NOTE\]/g,     lastNoteNum);

  // ─── Note 1 layout (Excel-parity, 2026-06-17) ─────────────────────────────
  // The Word export of Note 1 now MIRRORS the Stage 7 → Notes to Accounts
  // Excel export (see NotesToAccounts.tsx ~750-918) so both deliverables
  // look identical to the auditor:
  //
  //   1. Bordered header table
  //        Row A — Entity name (centred, bold, NAVY)
  //        Row B — "Notes forming part of the Financial Statements for
  //                 the year ended, 31st March, <yyyy>" (centred, bold)
  //        Row C — thin spacer (kept inside the border box)
  //        Row D — "Note :  | 1 | Summary of Significant accounting policies"
  //   2. Borderless body table — col 1 (narrow, centred) = number,
  //                              col 2 (wide, top-aligned) = body text.
  //      Multi-paragraph items split on "\n\n" → each segment becomes its
  //      own <w:p> inside the same cell so newEntity / note-3 variants
  //      flow cleanly. Inter-paragraph gap = 60 DXA (3pt) — matches the
  //      Excel rendering when wrapText breaks long policies across lines.
  //   3. Borderless signature block — left col = assessee; right col = CA
  //      firm. Lays out exactly like the Excel cells C/D/E (assessee) and
  //      H/I (firm) — see NotesToAccounts.tsx rows 846-918.
  //
  // ROOT-CAUSE FIX: previous revisions emitted a single NAVY-banner heading
  // plus loose <w:p> paragraphs. The Excel deliverable uses a TABLE-based
  // layout with thin borders for the header and zero borders for the body
  // — fundamentally different geometry. Rebuilt as tables so the gap
  // between numbered items is row-driven (cell margins + paragraph after)
  // instead of paragraph-driven (lineRule + grid snap), which removes the
  // residual whitespace problem the prior revisions kept hitting.
  // Heading year used in the "Note 1 — NOTES FORMING PART OF ACCOUNTS FOR
  // THE YEAR ENDED 31.03.<yyyy>" heading.
  const headingYear = String(cyYear || "").slice(-4) || "20XX";

  const NOTE_COL_NUM_W = 700;             // narrow number column
  const NOTE_COL_TEXT_W = TW - NOTE_COL_NUM_W;

  const noBorderAll: any = BDR_NONE;

  // ── 1) Banner-style headers — three Paragraph banners (NO outer box) ──────
  // User correction (2026-06-17): the previous revision wrapped the entity
  // name + subtitle + "Note 1 — Summary…" inside a 4-row bordered table.
  // That table draws a rectangular border around every side which the user
  // does NOT want. The reference style (screenshot 2) shows each heading as
  // a centred NAVY-bold line with thin NAVY horizontal rules above AND
  // below it — same banner geometry the BS / P&L title rows use elsewhere
  // in this document. Implementing as three Paragraph nodes with
  // top + bottom NAVY borders only (no left / right) gives that banner
  // look natively, with no nested table required.
  //
  // ROOT-CAUSE FIX: paragraph-level borders honour Word's flow layout
  // (heading sits flush against the page margins, no inner-cell padding,
  // no merge-cell artefacts) so the visual output is identical to the
  // BS / P&L title rows the user already approved. Lives in the shared
  // nceFinancialsDocx.ts helper → applies to EVERY non-corporate client
  // automatically.
  const NAVY_RULE = { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 };
  const NAVY_RULE_THIN = { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 2 };

  // Entity-name banner — 14pt bold NAVY, thick NAVY rules top + bottom.
  // Tight spacing values so the three header banners sit close to each other
  // (entity → subtitle → "Note 1 — …") in the compact, professional layout
  // the auditor expects. Combined with verticalAlign:TOP on the section
  // (see Sections array below — verticalAlign:BOTH was previously stretching
  // these gaps to fill the page).
  const entityBanner = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:   { before: 80, after: 40 },
    border:    { top: NAVY_RULE, bottom: NAVY_RULE },
    keepNext:  true,
    keepLines: true,
    children: [new TextRun({
      text: entityName.toUpperCase(),
      font: FONT, size: SZ_ENTITY, bold: true, color: NAVY,
    })],
  });

  // Subtitle banner removed (2026-06-20) — auditor asked for a tighter
  // header stack without the "Notes forming part of the Financial
  // Statements for the year ended, …" line. The entity banner alone now
  // sits above the "Note 1 — Summary…" heading.

  // Note 1 heading banner — left-aligned (matches the on-screen "Note 1 |
  // Summary of Significant accounting policies" row), thin rule below.
  // Combines "Note 1 — " prefix and the title into one paragraph so the
  // bottom rule spans the full row.
  const note1HeadingBanner = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing:   { before: 0, after: 60 },   // small after-gap → tight body coupling
    border:    { bottom: NAVY_RULE_THIN },
    keepNext:  true,
    keepLines: true,
    children: [
      new TextRun({
        text: "Note 1 — ",
        font: FONT, size: SZ_HDR, bold: true, color: NAVY,
      }),
      new TextRun({
        text: `NOTES FORMING PART OF ACCOUNTS FOR THE YEAR ENDED 31.03.${headingYear}`,
        font: FONT, size: SZ_HDR, bold: true, color: NAVY,
      }),
    ],
  });

  // ── 2) Borderless body table ───────────────────────────────────────────────
  // Build the body text for each note. Stage 7 supports note-1 newEntity
  // and note-3 variant appendages — same logic the Excel export uses.
  const note1NewEntityText = String(ntaData?.note1_new_entity_text ?? "").trim();
  const note1NewEntityOn   = !!ntaData?.note1_new_entity_enabled && note1NewEntityText.length > 0;
  const note3Variant       = (ntaData?.header_overrides?.note3Variant
                          || ntaData?.note3_variant
                          || "none") as string;
  const note3VariantText   = String(
    ntaData?.header_overrides?.note3VariantText
    || ntaData?.note3_variant_text
    || ""
  ).trim();

  // Multi-paragraph body: split on \n\n into segments, each rendered as its
  // own <w:p> inside the cell with a 60-DXA gap below for visual breathing.
  // Note 1 body is set to SZ_HDR (10pt) instead of the BS/PL data-row
  // SZ_BODY (9pt) so the policies read at the same size as the standalone
  // Note 1 / Client Certificate / Management Letter Word exports.
  const SZ_NOTE1_BODY = SZ_HDR;
  const bodyParas = (body: string): Paragraph[] => {
    const segments = body.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length > 0);
    if (segments.length === 0) return [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })];
    return segments.map((seg, idx) => new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: idx === segments.length - 1 ? 0 : 80, line: 264, lineRule: "auto" as any },
      children: [new TextRun({ text: seg, font: FONT, size: SZ_NOTE1_BODY, color: BLACK })],
    }));
  };

  const numberPara = (n: number): Paragraph => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:   { before: 0, after: 0, line: 264, lineRule: "auto" as any },
    children: [new TextRun({ text: String(n), font: FONT, size: SZ_NOTE1_BODY, color: BLACK })],
  });

  const bodyRows: TableRow[] = selectedNotes.map((n, i) => {
    const num = i + 1;
    let body  = resolveTokens(n.text || "");
    if (n.id === "note-1" && note1NewEntityOn) {
      body += "\n\n" + resolveTokens(note1NewEntityText);
    }
    if (n.id === "note-3" && note3Variant !== "none" && note3VariantText) {
      body += "\n\n" + resolveTokens(note3VariantText);
    }
    return new TableRow({
      cantSplit: false, // allow long notes to break across pages
      children: [
        new TableCell({
          width:   { size: NOTE_COL_NUM_W, type: WidthType.DXA },
          borders: noBorderAll,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: [numberPara(num)],
        }),
        new TableCell({
          width:   { size: NOTE_COL_TEXT_W, type: WidthType.DXA },
          borders: noBorderAll,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: bodyParas(body),
        }),
      ],
    });
  });

  const bodyTable = new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [NOTE_COL_NUM_W, NOTE_COL_TEXT_W],
    borders: {
      top:           bNone, bottom:        bNone, left:          bNone, right:         bNone,
      insideHorizontal: bNone, insideVertical:   bNone,
    } as any,
    rows: bodyRows,
  });

  // ── 3) Borderless signature block (Note-1-specific) ───────────────────────
  // Mirrors the Excel signature layout exactly (NotesToAccounts.tsx ~846-918).
  // Different from the universal buildSignatureTable() used on BS / P&L
  // pages so Note 1 reads identically to the Excel deliverable the auditor
  // is comparing it against.
  const sig = sigData || {};
  const assesseeName    = (sig.clientName     || entityName || "").trim();
  const firmName        = (sig.firmName       || "_______________");
  const firmFRN         = (sig.firmFRN        || "_______________");
  const partnerName     = (sig.partnerName    || "_______________");
  const partnerMembNo   = (sig.membershipNo   || "_______________");
  const assesseePlace   = (sig.place          || "_______________");
  const assesseeDate    = fmtSigDate(sig.date);

  const sigLineL = (text: string, bold = false): Paragraph => new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing:   { before: 0, after: 40, line: 264, lineRule: "auto" as any },
    children:  [new TextRun({ text, font: FONT, size: SZ_NOTE1_BODY, bold, color: BLACK })],
  });
  const sigLineR = (text: string, bold = false): Paragraph => new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing:   { before: 0, after: 40, line: 264, lineRule: "auto" as any },
    children:  [new TextRun({ text, font: FONT, size: SZ_NOTE1_BODY, bold, color: BLACK })],
  });
  const sigBlankL = sigLineL("");
  const sigBlankR = sigLineR("");

  const half = Math.floor(TW / 2);
  const signatureTable = new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [half, TW - half],
    borders: {
      top:    bNone, bottom: bNone, left:   bNone, right:  bNone,
      insideHorizontal: bNone, insideVertical:   bNone,
    } as any,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          // Left col — Assessee block
          new TableCell({
            width:   { size: half, type: WidthType.DXA },
            borders: noBorderAll,
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              sigLineL(`For, ${assesseeName}`, true),
              sigBlankL,
              sigLineL("x__________________", true),
              sigLineL("Signature of assessee", true),
              sigBlankL,
              sigLineL(`Place: ${assesseePlace}`, true),
              sigLineL(`Date : ${assesseeDate}`, true),
            ],
          }),
          // Right col — CA firm block
          new TableCell({
            width:   { size: TW - half, type: WidthType.DXA },
            borders: noBorderAll,
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            verticalAlign: VerticalAlign.TOP,
            children: [
              sigLineR(`For ${firmName}`, true),
              sigLineR("Chartered Accountants", true),
              sigLineR(`FRN: ${firmFRN}`, true),
              sigBlankR,
              sigLineR(partnerName, true),
              sigLineR("Partner", true),
              sigLineR(`Membership No.: ${partnerMembNo}`, true),
            ],
          }),
        ],
      }),
    ],
  });

  // Pre-signature breathing room (~12 pt) so the signature isn't glued to
  // the last numbered policy.
  const preSigSpacer = new Paragraph({ spacing: { before: 240, after: 0 }, children: [] });

  // Reference NOTE1_POLICIES so the legacy boilerplate constant doesn't
  // become a dead-code lint warning while we keep it around for any
  // corporate-style consumer still relying on it.
  void NOTE1_POLICIES;

  // Banner stack → body table directly (NO interstitial spacer paragraph).
  // The note1HeadingBanner already carries `spacing.after: 60` so the body
  // table sits tight below the heading — fixes Issue 2 ("too much gap
  // between Note 1 heading & note description").
  return [
    entityBanner,
    note1HeadingBanner,
    bodyTable,
    preSigSpacer,
    signatureTable,
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
    .sort((a: any, b: any) => (a.partner_name ?? "").localeCompare(b.partner_name ?? ""));

  const pyAggregate = (capitalData ?? []).find((r: any) => r.partner_no === PY_SENTINEL);
  const pyPartners  = (capitalData ?? [])
    .filter((r: any) => r.partner_no >= PY_PARTNER_BASE)
    .sort((a: any, b: any) => (a.partner_name ?? "").localeCompare(b.partner_name ?? ""));

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
/** Source-ledger entry stored in cy_sources[staticRowId] */
type CySourceEntry = { ledger: string; amountCy: number; amountPy?: number; column?: "lt" | "st" };

function buildNoteSection(
  cfg: NoteConfig,
  rawCy: Record<string, number>,
  rawPy: Record<string, number>,
  displayNoteNumber: string,
  cyYear: string,
  pyYear: string,
  expandedRows?: Set<string>,
  hideBlankNoteRows?: boolean,
  /** GL breakup ledgers per static row — mirrors NCEDetailedNotes cySources prop */
  cySources?: Record<string, CySourceEntry[]>,
  /** Sub-ledger name overrides, keyed `${staticRowId}::${ledger}` — mirrors
   *  NCEDetailedNotes sourceLabelOverrides so renamed Tally ledgers print. */
  sourceLabelOverrides?: Record<string, string>,
): Table {
  // Auto/manual breakup rows are stored in cy_data._custom_rows; their amounts
  // live as ordinary keys (id or id+"_lt"/"_st") in rawCy/rawPy. For notes like
  // Borrowings the per-ledger amounts sit on custom rows ATTACHED to a static
  // row, so they must be folded into that static row (and the totals) — exactly
  // as the on-screen note does in its collapsed view.
  const rawCustomRows: NoteCustomRow[] = Array.isArray((rawCy as any)._custom_rows)
    ? ((rawCy as any)._custom_rows as NoteCustomRow[])
    : [];

  // Render-time safety net: collapse re-sync near-duplicates so the export is
  // clean regardless of DB corruption. Uses the shared strict collapse (id slug
  // + parent + identical amounts) so it catches both legacy runaway accumulation
  // ("ICICI Bank Car Loan" x20) AND the full-label/base-head pair of one ledger
  // ("X - 18%" + "X"), while never merging genuinely distinct ledgers. The
  // deduped list also drives computeDisplayData so totals stop multiplying.
  const { rows: customRows } = collapseDuplicateCustomRows(
    rawCustomRows,
    rawCy as Record<string, number>,
    rawPy as Record<string, number>,
  );

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

  // BUG N2 FIX (2026-06-04) — recursive descendant collector. The previous
  // aggA / aggB only summed DIRECT children, so any custom row that had
  // grand-children produced an under-counted parent figure in the Word
  // export — making the printed value disagree with what the on-screen
  // recursive renderer (renderTreeB/A in NCEDetailedNotes.tsx) showed.
  // Now the export matches the screen for any nesting depth.
  const allDescendantsOf = (parentId: string, seen: Set<string> = new Set()): NoteCustomRow[] => {
    if (seen.has(parentId)) return [];
    seen.add(parentId);
    const direct = customRows.filter(cr => cr.attachedTo === parentId);
    const out: NoteCustomRow[] = [];
    for (const c of direct) {
      out.push(c);
      out.push(...allDescendantsOf(c.id, seen));
    }
    return out;
  };

  // SHREE HARI FIX (2026-06-04, DOCX layer) — also include each customRow's
  // own `sources[]` sub-ledger breakup array. Without this, a heading-style
  // customRow with cy[id]=0 but `sources[]` containing the actual amounts
  // exports as 0 in Word — disagreeing with the on-screen renderer which
  // includes sources. Pattern A routes by `column` ("lt"|"st"); default "lt".
  const sourcesSumB = (cr: NoteCustomRow): { cCy: number; pCy: number } => {
    const list = (cr as any).sources;
    if (!Array.isArray(list) || list.length === 0) return { cCy: 0, pCy: 0 };
    // Only count sources when the row's own cy[id] is zero (heading pattern).
    if ((cy[cr.id] ?? 0) !== 0 && (py[cr.id] ?? 0) !== 0) return { cCy: 0, pCy: 0 };
    let cCy = 0, pCy = 0;
    for (const x of list) {
      cCy += Number((x as any)?.amountCy) || 0;
      pCy += Number((x as any)?.amountPy) || 0;
    }
    return {
      cCy: (cy[cr.id] ?? 0) === 0 ? cCy : 0,
      pCy: (py[cr.id] ?? 0) === 0 ? pCy : 0,
    };
  };
  const sourcesSumA = (cr: NoteCustomRow): { ltC: number; ltP: number; stC: number; stP: number } => {
    const list = (cr as any).sources;
    if (!Array.isArray(list) || list.length === 0) return { ltC: 0, ltP: 0, stC: 0, stP: 0 };
    let ltC = 0, ltP = 0, stC = 0, stP = 0;
    for (const x of list) {
      const aC = Number((x as any)?.amountCy) || 0;
      const aP = Number((x as any)?.amountPy) || 0;
      if ((x as any)?.column === "st") {
        if ((cy[cr.id + "_st"] ?? 0) === 0) stC += aC;
        if ((py[cr.id + "_st"] ?? 0) === 0) stP += aP;
      } else {
        if ((cy[cr.id + "_lt"] ?? 0) === 0) ltC += aC;
        if ((py[cr.id + "_lt"] ?? 0) === 0) ltP += aP;
      }
    }
    return { ltC, ltP, stC, stP };
  };

  // 2026-06-05 Phase 3 — aggA and aggB now read from the canonical
  // computeNoteTotals.perRow so the DOCX export matches the on-screen
  // Notes Total row, the BS / P&L face and the renderer's per-row
  // aggregate exactly. The legacy inline algorithms (suffixed,
  // allDescendantsOf, sourcesSumA, sourcesSumB) above are no longer
  // called by aggA / aggB, but are kept in place because the row-by-row
  // descendant walk below still uses allDescendantsOf for emit logic.
  const docxTotals = computeNoteTotals(cfg, cy, py, customRows as any);
  const aggA = (id: string) => {
    const v = docxTotals.pattern === "A" ? docxTotals.perRow[id] : undefined;
    if (v) return { lt: v.ltCy, ltP: v.ltPy, st: v.stCy, stP: v.stPy };
    return {
      lt: cy[id + "_lt"] ?? 0, ltP: py[id + "_lt"] ?? 0,
      st: cy[id + "_st"] ?? 0, stP: py[id + "_st"] ?? 0,
    };
  };
  const aggB = (id: string) => {
    const v = docxTotals.pattern === "B" ? docxTotals.perRow[id] : undefined;
    if (v) return { c: v.cy, p: v.py };
    return { c: cy[id] ?? 0, p: py[id] ?? 0 };
  };

  // Strip "Note X: " prefix from config title to get just the name
  const cleanTitle = cfg.title.replace(/^Note\s[\d &]+:\s*/i, "");

  // Issue 4 — note tables label the amount columns with the full closing date
  // (31.03.YYYY) instead of the bare year, matching the firm reference format.
  // BS/P&L face headers and the Capital Account / PPE schedules are unaffected.
  const cyColHdr = `31.03.${cyYear}`;
  const pyColHdr = `31.03.${pyYear}`;
  const rows: TableRow[] = [
    noteTitleRow(colWidths, displayNoteNumber, cleanTitle),
    noteUnitsRow(colWidths),
    ...(isA ? noteHdrA(cyColHdr, pyColHdr) : [noteHdrB(cyColHdr, pyColHdr)]),
  ];

  // Unattached custom rows (no attachedTo) render as their own lines: section-
  // tagged ones just before their section total, the rest before the grand total.
  // 2026-05-30 — indent 0 (was 1) so unattached customs align with the static
  // Particulars above instead of looking like sub-items of "Rates and Taxes" /
  // whichever static row preceded them. Reported on OM REALTY Note 18 where
  // "Architect Fees - 18%", "Site Expense", "BU Expense" etc. (which are
  // unmatched ledgers, not children of any static head) were getting a
  // misleading sub-row indent in the .docx export.
  // Flat note: a note with no section headers (e.g. Other Expenses, Employee
  // Benefits Expense). For flat notes we collect ALL data rows (static + custom)
  // into flatRows, sort them A-Z, then flush the entire sorted block before
  // the grand-total row — giving true full-alphabetical interleaving.
  // A "flat" note is a simple list (data rows + one grand total) whose rows are
  // sorted A-Z for export (e.g. Other Expenses). A note with SUBTOTALS — isTotal
  // rows other than the grand total, e.g. Revenue from Operations' "Net Sale of
  // products" — is NOT flat: its rows must stay in config order so each subtotal
  // renders AFTER the components it sums, instead of being hoisted above them by
  // the A-Z sort (and by the subtotal being emitted at its config position while
  // the data rows are deferred to the grand-total flush). Such notes have no
  // section headers either, so the original header-only check mis-flagged them.
  const isFlatNote = !cfg.rows.some(r => r.isSectionHeader)
    && !cfg.rows.some(r => r.isTotal && r.id !== grandTotalId);
  const flatRows: { label: string; emit: () => void }[] = [];

  const emittedCustoms = new Set<string>();
  const emitCustoms = (predicate: (cr: NoteCustomRow) => boolean) => {
    // Sort unattached custom rows alphabetically by label before emitting so the
    // exported order matches the user-facing alphabetical convention (Issue 2).
    const toEmit = [...customRows]
      .filter(cr => !cr.attachedTo && !emittedCustoms.has(cr.id) && predicate(cr))
      .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
    for (const cr of toEmit) {
      emittedCustoms.add(cr.id);
      if (isA) {
        // Issue 3 — use the recursive aggregator aggA (own raw amount + attached
        // child custom rows + source ledgers) instead of the row's bare own value.
        // An expandable manual parent whose amounts live in its children used to
        // compute as 0 here and was silently dropped by the guard below — even
        // though the on-screen note shows it (the renderer uses the same aggregate).
        const v = aggA(cr.id);
        if (!v.lt && !v.st && !v.ltP && !v.stP) continue;
        const tableRow = noteRowA(cr.label || "—", v.lt, v.ltP, v.st, v.stP, 0, "data");
        if (isFlatNote) flatRows.push({ label: cr.label || "—", emit: () => rows.push(tableRow) });
        else rows.push(tableRow);
      } else {
        // Issue 3 — see aggA note above; aggB already folds in descendants and
        // sources[], so one aggregated line is emitted (matching the clean
        // one-line-per-head format of flat notes such as Other Expenses).
        const v = aggB(cr.id);
        if (!v.c && !v.p) continue;
        const tableRow = noteRowB(cr.label || "—", v.c, v.p, 0, "data");
        if (isFlatNote) flatRows.push({ label: cr.label || "—", emit: () => rows.push(tableRow) });
        else rows.push(tableRow);
      }
    }
  };

  // Always-on: detect the "single active section" case — when only ONE of the
  // note's sections has data, its subtotal equals the grand total, producing a
  // duplicate "Total" row.  suppressSubtotal holds that subtotal's id so the
  // render loop skips it regardless of lock / hideBlankNoteRows state.
  const suppressSubtotal = new Set<string>();
  {
    let _hdr: string | null = null;
    let _sub: string | null = null;
    let _has = false;
    const _chkRow = (row: NoteRowDef) =>
      isA ? (() => { const v = aggA(row.id); return !!(v.lt || v.st || v.ltP || v.stP); })()
           : (() => { const v = aggB(row.id); return !!(v.c || v.p); })();
    const _nonEmpty = new Set<string>();
    const _flush = () => {
      if (_hdr === null) return;
      if (_has && _sub) _nonEmpty.add(_sub);
    };
    for (const row of cfg.rows) {
      if (row.isSectionHeader)                          { _flush(); _hdr = row.id; _sub = null; _has = false; }
      else if (row.isTotal && row.id !== grandTotalId)  { _sub = row.id; }
      else if (!row.isTotal && _chkRow(row))            { _has = true; }
    }
    _flush();
    if (_nonEmpty.size === 1) { const [id] = _nonEmpty; suppressSubtotal.add(id); }
  }

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
    const _flushSection = () => {
      if (currentHdrId === null) return;
      if (!sectionHasData) {
        emptySectionHeaders.add(currentHdrId);
        if (currentSectionTotalId) emptySectionTotals.add(currentSectionTotalId);
      }
      // Note: the single-active-section case (suppressing the non-empty section's
      // subtotal) is now handled by suppressSubtotal above (always-on), so
      // nonEmptySectionTotalSet is no longer needed here.
    };
    for (const row of cfg.rows) {
      if (row.isSectionHeader) {
        _flushSection();
        currentHdrId = row.id;
        currentSectionTotalId = null;
        sectionHasData = false;
      } else if (row.isTotal && row.id !== grandTotalId) {
        currentSectionTotalId = row.id;
      } else {
        if (!row.isTotal && checkRow(row)) sectionHasData = true;
      }
    }
    _flushSection();
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
      // Always: suppress this subtotal when it's the lone non-empty section
      // subtotal (its value equals the grand total → duplicate "Total" row).
      // suppressSubtotal is computed unconditionally above, so this fix applies
      // to all exports regardless of lock state.
      if (row.id !== grandTotalId && suppressSubtotal.has(row.id)) {
        // Still emit section-tagged custom rows before skipping the subtotal.
        if ((row as any).sectionTag) emitCustoms(cr => cr.section === (row as any).sectionTag);
        continue;
      }
      // Task 2 (doc8): when locked, skip section totals for empty sections and
      // skip any non-grand total row whose computed value is 0 in both years
      // (prevents "blank Total" rows in sparse notes).
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
      // the grand total, emit the section-less ones.  For flat notes, emitCustoms
      // collects into flatRows; the sorted flush happens just before grand total.
      if (row.id === grandTotalId) {
        emitCustoms(cr => !cr.section);
        if (isFlatNote) {
          // Merge all static + custom data rows into one A-Z sorted block.
          flatRows.sort((a, b) => a.label.localeCompare(b.label));
          flatRows.forEach(f => f.emit());
          flatRows.length = 0; // clear so end-of-loop fallback does not double-emit
        }
      } else if ((row as any).sectionTag) {
        emitCustoms(cr => cr.section === (row as any).sectionTag);
      }
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
      // BUG N2 FIX — recurse via emitDescendants so every depth renders, not
      // just direct children. Indent grows by 1 per depth level so the Word
      // table visually reflects the hierarchy (e.g. "Other payables — Others"
      // at indent 2, "A" at 3, "Office No. 201" at 4, "A-0903 Dineshbhai" at 5).
      const subIndent = (row.indent ?? 0) + 1;
      const emitDescendants = (parentId: string, depth: number) => {
        // Sort children alphabetically by label so sub-ledger breakups (e.g.
        // under "Rates and Taxes", "Other payables") also export in A-Z order.
        const children = [...attachedRows(parentId)]
          .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
        for (const cr of children) {
          if (isA) {
            const cc = suffixed(cy, cr.id); const pp = suffixed(py, cr.id);
            // Only skip a row whose own AND every descendant amount is empty.
            const v = aggA(cr.id);
            if (!v.lt && !v.st && !v.ltP && !v.stP) continue;
            // Print this row at the collapsed aggregate so the parent indent
            // visually matches the renderer; recurse for its own children.
            rows.push(noteRowA(cr.label || "—", v.lt, v.ltP, v.st, v.stP, depth, "data"));
            emitDescendants(cr.id, depth + 1);
            // Optional: show the row's own amount when it differs from agg.
            // Skipped intentionally — children rows below already itemise it.
            void cc; void pp;
          } else {
            const v = aggB(cr.id);
            if (!v.c && !v.p) continue;
            rows.push(noteRowB(cr.label || "—", v.c, v.p, depth, "data"));
            emitDescendants(cr.id, depth + 1);
          }
        }
      };
      if (isA) {
        const v = aggA(row.id);
        // Pattern A: source-ledger entries route to LT or ST column via the
        // optional `column` field ("lt" | "st").  Default when absent is "lt".
        const hasSrcsA = (id: string) =>
          (cySources?.[id] ?? []).some(s => (s.amountCy ?? 0) !== 0 || (s.amountPy ?? 0) !== 0);
        const emitSourcesA = (id: string, indent: number) => {
          if (!cySources?.[id]) return;
          const srcs = cySources[id].filter(s => (s.amountCy ?? 0) !== 0 || (s.amountPy ?? 0) !== 0);
          for (const s of srcs) {
            const isLT = !s.column || s.column === "lt";
            const slLabel = sourceLabelOverrides?.[`${id}::${s.ledger}`] ?? s.ledger;
            rows.push(noteRowA(
              slLabel,
              isLT ? s.amountCy : 0,
              isLT ? (s.amountPy ?? 0) : 0,
              isLT ? 0 : s.amountCy,
              isLT ? 0 : (s.amountPy ?? 0),
              indent,
              "data",
            ));
          }
        };
        const isExpandedA = (id: string) => !expandedRows || expandedRows.has(id);
        if (isFlatNote) {
          // Capture row + descendants as a unit; sort key is the row label.
          const capturedRow = noteRowA(row.label, v.lt, v.ltP, v.st, v.stP, row.indent ?? 0, "data");
          const capturedId  = row.id;
          flatRows.push({ label: row.label, emit: () => {
            rows.push(capturedRow);
            if (isExpandedA(capturedId)) {
              if (hasSrcsA(capturedId)) emitSourcesA(capturedId, subIndent);
              emitDescendants(capturedId, subIndent);
            }
          }});
        } else {
          rows.push(noteRowA(row.label, v.lt, v.ltP, v.st, v.stP, row.indent ?? 0, "data"));
          if (isExpandedA(row.id)) {
            if (hasSrcsA(row.id)) emitSourcesA(row.id, subIndent);
            emitDescendants(row.id, subIndent);
          }
        }
      } else {
        const v = aggB(row.id);
        // Helper: is this row "expanded" (descendants should be printed)?
        // True when expandedRows is absent (show all) or explicitly contains this id.
        const isExpandedB = (id: string) => !expandedRows || expandedRows.has(id);
        // Helper: does this row have non-zero source-ledger (GL) entries?
        const hasSrcsB = (id: string) =>
          (cySources?.[id] ?? []).some(s => (s.amountCy ?? 0) !== 0 || (s.amountPy ?? 0) !== 0);
        // Emit the source-ledger breakdown rows (indented one level below parent).
        const emitSourcesB = (id: string, indent: number) => {
          if (!cySources?.[id]) return;
          const srcs = cySources[id].filter(s => (s.amountCy ?? 0) !== 0 || (s.amountPy ?? 0) !== 0);
          for (const s of srcs) {
            const slLabel = sourceLabelOverrides?.[`${id}::${s.ledger}`] ?? s.ledger;
            rows.push(noteRowB(slLabel, s.amountCy, s.amountPy ?? 0, indent, "data"));
          }
        };
        // Helper: does the row have at least one attached custom child OR source-ledger
        // entry with a non-zero amount?  When true AND the row is expanded, the parent's
        // own amount is suppressed (blank cell) so the same total is not shown twice.
        const hasChildrenB = (id: string) =>
          isExpandedB(id) &&
          (attachedRows(id).some(cr => { const cv = aggB(cr.id); return cv.c !== 0 || cv.p !== 0; }) || hasSrcsB(id));
        if (isFlatNote) {
          const capturedId = row.id;
          const capturedCy = v.c;
          const capturedPy = v.p;
          flatRows.push({ label: row.label, emit: () => {
            // null → blank cell (no "—") when children already represent the total.
            const hide = hasChildrenB(capturedId);
            rows.push(noteRowB(row.label, hide ? null : capturedCy, hide ? null : capturedPy, row.indent ?? 0, "data"));
            if (isExpandedB(capturedId)) {
              if (hasSrcsB(capturedId)) emitSourcesB(capturedId, subIndent);
              emitDescendants(capturedId, subIndent);
            }
          }});
        } else {
          const hide = hasChildrenB(row.id);
          // null → blank cell (no "—") when children already represent the total.
          rows.push(noteRowB(row.label, hide ? null : v.c, hide ? null : v.p, row.indent ?? 0, "data"));
          if (isExpandedB(row.id)) {
            if (hasSrcsB(row.id)) emitSourcesB(row.id, subIndent);
            emitDescendants(row.id, subIndent);
          }
        }
      }
    }
  }
  // Any remaining unattached customs (notes with no total row) — emit at end.
  emitCustoms(() => true);
  // For flat notes with no grand-total row: flush here (edge case).
  if (isFlatNote && flatRows.length > 0) {
    flatRows.sort((a, b) => a.label.localeCompare(b.label));
    flatRows.forEach(f => f.emit());
  }

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows,
  });
}

/** PPE Schedule — landscape table, grouped by asset_category (Task 3) */
function buildPPETable(ppeData: any[], cyYear: string, pyYear: string, noteNum: string): Table {
  const ppeColWidths = [PPE_NAME, PPE_RATE, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM, PPE_NUM];

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
      hdrCell("Asset Name",                                   PPE_NAME, 2),
      hdrCell("Rate\n(%)",                                    PPE_RATE, 2),
      hdrCell(`Opening Balance\nas on 01/04/${pyYear}`,       PPE_NUM,  2),
      hdrCell("Additions (₹)",                                PPE_NUM * 2, 1, 2),
      hdrCell("Deletions\nduring the year",                   PPE_NUM,  2),
      hdrCell("Total",                                        PPE_NUM,  2),
      hdrCell("Depreciation",                                 PPE_NUM,  2),
      hdrCell(`Closing Balance\nas on 31/03/${cyYear}`,       PPE_NUM,  2),
    ],
  });
  const hdrRow2 = new TableRow({
    tableHeader: true,
    children: [
      hdrCell("Acquired on or\nbefore 180 days", PPE_NUM),
      hdrCell("Acquired\nafter 180 days",        PPE_NUM),
    ],
  });

  const nac = (v: number | null | undefined, w: number) => ac(v ?? 0, w);

  /** skip assets where every numeric column is zero / null */
  const isBlankAsset = (r: any): boolean =>
    !r.opening_balance && !r.additions_pre && !r.additions_post && !r.deletions &&
    !r.total && !r.depreciation && !r.closing_balance && !r.net_cy && !r.net_py;

  // Category column + per-category heading rows removed per client request:
  // assets render as one flat list. Order tangible block first, then intangible,
  // each sorted by sort_order (parents 1–11, then sub-ledgers ≥ 100) so the list
  // reads in the same order as the on-screen schedule.
  const bySortOrder = (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  const inCat = (cat: string) =>
    (ppeData ?? []).filter((r: any) => (r.asset_category ?? "") === cat).sort(bySortOrder);
  const otherCat = (ppeData ?? [])
    .filter((r: any) => !["tangible", "intangible"].includes(r.asset_category ?? ""))
    .sort(bySortOrder);
  const orderedAssets = [...inCat("tangible"), ...inCat("intangible"), ...otherCat];

  const dataRows: TableRow[] = [];
  for (const r of orderedAssets) {
    if (isBlankAsset(r)) continue;
    dataRows.push(new TableRow({
      children: [
        cell({ text: r.asset_name ?? "", w: PPE_NAME, sz: SZ_XS }),
        cell({ text: r.rate_pct != null ? `${r.rate_pct}%` : "", w: PPE_RATE, sz: SZ_XS, align: AlignmentType.CENTER }),
        nac(r.opening_balance, PPE_NUM),
        nac(r.additions_pre,   PPE_NUM),
        nac(r.additions_post,  PPE_NUM),
        nac(r.deletions,       PPE_NUM),
        nac(r.total,           PPE_NUM),
        nac(r.depreciation,    PPE_NUM),
        nac(r.closing_balance, PPE_NUM),
      ],
    }));
  }

  const sum = (field: string) =>
    (ppeData ?? []).reduce((s: number, r: any) => s + (r[field] ?? 0), 0);

  const totalRow = new TableRow({
    children: [
      cell({ text: "Total", w: PPE_NAME, sz: SZ_XS, bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      cell({ text: "",      w: PPE_RATE, sz: SZ_XS, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("opening_balance"), PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("additions_pre"),   PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("additions_post"),  PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("deletions"),       PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("total"),           PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("depreciation"),    PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(sum("closing_balance"), PPE_NUM, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
    ],
  });

  return new Table({
    width:        { size: TW_LS, type: WidthType.DXA },
    columnWidths: ppeColWidths,
    rows: [
      noteTitleRow(ppeColWidths, noteNum, "Property, Plant and Equipment and Intangible Assets"),
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
  /** Stage 7 Notes-to-Accounts row from `notes_to_accounts_data` — drives
   *  the Note 1 page so the Word file mirrors the on-screen Note 1
   *  ("Balance Confirmation", "Rearrangement of Figures", etc.) instead of
   *  a hardcoded boilerplate of accounting policies that doesn't match
   *  what the auditor sees in CAFlow. Single DB row (not an array) —
   *  contains notes_json, header_overrides, note1_new_entity_*,
   *  note3_variant, and similar fields the Excel export already reads. */
  ntaData?: any | null;
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
    ntaData        = null,
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
  // cy_sources per note type — GL breakup ledgers for each static row.
  // Keyed exactly like savedNotes (note_type string → Record<staticRowId, CySourceEntry[]>).
  // cy_sources is stored as _cy_sources INSIDE cy_data (same pattern as _custom_rows).
  // Key: note_type; value: Record<staticRowId, CySourceEntry[]>
  const savedCySources: Record<string, Record<string, CySourceEntry[]>> = {};
  // Sub-ledger name overrides (user-renamed Tally ledgers) — stored as
  // _source_label_overrides inside cy_data, keyed `${staticRowId}::${ledger}`.
  // Threaded into buildNoteSection so a corrected ledger name prints in DOCX.
  const savedSourceLabelOverrides: Record<string, Record<string, string>> = {};
  for (const row of notesData) {
    const key = String((row as any).note_type ?? "");
    if (!key) continue;
    const rawCyData = ((row as any).cy_data && typeof (row as any).cy_data === "object")
      ? (row as any).cy_data as Record<string, any>
      : {};
    savedNotes[key] = {
      cy: rawCyData,
      py: (row as any).py_data && typeof (row as any).py_data === "object"
        ? (row as any).py_data as Record<string, number>
        : {},
    };
    // _cy_sources lives inside cy_data — extract it from the same JSON blob
    if (rawCyData._cy_sources && typeof rawCyData._cy_sources === "object") {
      savedCySources[key] = rawCyData._cy_sources as Record<string, CySourceEntry[]>;
    }
    // _source_label_overrides lives in the same blob — renamed sub-ledger names.
    if (rawCyData._source_label_overrides && typeof rawCyData._source_label_overrides === "object") {
      savedSourceLabelOverrides[key] = rawCyData._source_label_overrides as Record<string, string>;
    }
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

  // Phase 2 — Note 1 (uses Stage 7 user-edited notes when present).
  // Returns a self-contained section (bordered header table + borderless
  // body table + custom signature block) that mirrors the Stage 7 Excel
  // export pixel-for-pixel. sigArgs is threaded through so the right-hand
  // CA-firm column reads the same firm name / FRN / partner / membership
  // the BS / P&L pages use.
  const note1Paras = buildNote1Section(entityName, cyYear, ntaData, sigArgs);

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
    // For split notes (Pattern A LT/ST), filter cy_sources to only the relevant
    // side — entries with column="lt" go to the LT note, column="st" to the ST note.
    const rawSources = savedCySources[sourceKey];
    let noteCySources = rawSources;
    if (rawSources && cfg.splitSide) {
      const filtered: Record<string, CySourceEntry[]> = {};
      for (const [rowId, srcs] of Object.entries(rawSources)) {
        const relevant = srcs.filter(s => !s.column || s.column === cfg.splitSide);
        if (relevant.length > 0) filtered[rowId] = relevant;
      }
      noteCySources = Object.keys(filtered).length > 0 ? filtered : undefined;
    }
    const noteSourceOverrides = savedSourceLabelOverrides[sourceKey];
    noteTablePairs.push([parseInt(dynNum, 10), buildNoteSection(cfg, data.cy, data.py, dynNum, cyYear, pyYear, expandedRows, hideBlankNoteRows, noteCySources, noteSourceOverrides), noteSectionTag] as [number, Table, string]);
  }
  // Sort ascending by note number for correct sequential order in export
  noteTablePairs.sort((a, b) => a[0] - b[0]);
  const noteTables: Table[] = noteTablePairs.map(([, t]) => t);

  // Task 6 (revision 2): section headings ("Notes to Balance Sheet…" /
  // "Notes to Profit & Loss A/c…") belong in the running page HEADER so Word
  // repeats them automatically at the top of every page. Two separate DOCX
  // sections are created (one BS, one PL) each with its own running header.
  // Factory helper — entity banner paragraph + section-heading paragraph.
  const makeNotesHeader = (sectionLine: string): Header =>
    new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          // spacing.before = 200 DXA ≈ 10 pt — pushes entity name away from
          // the page border (drawn at 24 pt from page edge via _pgBdr space:24)
          // so there is a visible gap between the border line and the text.
          spacing:   { before: 200, after: 20 },
          border:    { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
          children:  [new TextRun({
            text: entityName.toUpperCase(),
            font: FONT, size: SZ_ENTITY, bold: true, color: NAVY,
          })],
        }),
        new Paragraph({
          // after: 40 DXA — minimal trailer; the reliable gap comes from the
          // body-level notesSectionTopSpacer paragraph in Sections B/C.
          spacing:  { before: 80, after: 40 },
          children: [new TextRun({ text: sectionLine, font: FONT, size: SZ_HDR, bold: true, underline: {} })],
        }),
      ],
    });
  const bsNotesRunningHdr = makeNotesHeader(`Notes to Balance Sheet as on 31.03.${String(cyYear)}`);
  // Issue 2 — P&L is a period statement, so its notes heading reads "for the
  // accounting year YYYY-YYYY" (e.g. 2025-2026) rather than the point-in-time
  // "as on 31.03.YYYY". The Balance Sheet heading above keeps "as on …".
  const plNotesRunningHdr = makeNotesHeader(`Notes to Profit & Loss A/c for the accounting year ${Number(cyYear) - 1}-${cyYear}`);

  // Phase 2 — PPE Schedule (landscape). Note 10 is now data-driven: it is
  // active only when the dynamic map assigned it a number (the schedule has
  // data). An empty/all-zero schedule → no note number and the landscape page
  // is omitted entirely (nothing about PPE is exported).
  const ppeDynNum  = dynamicNoteMap.get(10);
  const ppeHasData = (ppeData ?? []).some((r: any) =>
    r.opening_balance || r.additions_pre || r.additions_post || r.deletions ||
    r.total || r.depreciation || r.closing_balance);
  const ppeTable = (ppeDynNum !== undefined && ppeHasData)
    ? buildPPETable(ppeData, cyYear, pyYear, String(ppeDynNum))
    : null;

  // Page settings
  const portraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B, left: MARG_L },
    borders: _pgBdr,
  };
  // Note 1 uses an EMPTY running header (body banner provides the title).
  // It keeps the original compact top margin so the accounting policies
  // text is not pushed down by unnecessary whitespace.
  const note1PortraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_R, bottom: MARG_B_NOTES, left: MARG_L },
    borders: _pgBdr,
  };
  // Task 11 (doc6): structured notes pages (Sections B + C) use larger top
  // margin + explicit header distance so the two-line running header (entity
  // name + section heading) sits above the body content with a visible gap.
  const notesPortraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T_NOTES, right: MARG_R, bottom: MARG_B_NOTES, left: MARG_L, header: MARG_HDR_NOTES },
    borders: _pgBdr,
  };
  // Border-free variant — used only for Section B (BS notes 2-11) which ends
  // with type: CONTINUOUS. Word silently promotes CONTINUOUS → NEXT_PAGE when
  // the section carries <w:pgBorders>, so the border is omitted here.
  const notesPortraitPropsNoBdr = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T_NOTES, right: MARG_R, bottom: MARG_B_NOTES, left: MARG_L, header: MARG_HDR_NOTES },
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
  // Slightly larger gap between consecutive notes so they read as distinct blocks
  // while still flowing on the same page.
  const noteGap       = () => new Paragraph({ spacing: { before: 220, after: 0 }, children: [] });
  // Spacer placed at the very top of the body in Sections B and C so there is
  // a reliable gap between the running section-heading line and the first note.
  // Using a body paragraph is more dependable than relying on spacing.after
  // inside the running header (Word may clip header overflow).
  // 120 DXA ≈ 6 pt — modest but visible breathing room.
  const notesSectionTopSpacer = () => new Paragraph({ spacing: { before: 0, after: 120 }, children: [] });

  // 2026-05-30 (revision 7) — User insists the client banner must appear on
  // EVERY notes page AND notes must flow (multiple notes per page).
  //
  // Both at once requires a RUNNING HEADER (the only mechanism Word repeats
  // on every page of a section). The catch: Word's editing view always
  // renders running-header text at ~60% opacity — this is a Word UI
  // behaviour that no XML setting can override.
  //
  // IMPORTANT for the user: when the .docx is printed or exported to PDF,
  // running-header text renders at FULL opacity. So the printed/PDF output
  // will show the dark navy banner on every page, identical to the BS / P&L
  // title rows. Only Word's on-screen editor displays the faded preview.
  //
  // Setup: NAVY (#1F3864) Calibri 14pt bold + thick navy underline — exact
  // match to the BS / P&L titleRows entity row. Body-content banner on the
  // first notes page (full opacity always) PLUS a running header for every
  // continuation page.
  const makeNotesBanner = (opts: { pageBreak?: boolean } = {}): Paragraph =>
    new Paragraph({
      alignment:       AlignmentType.CENTER,
      pageBreakBefore: opts.pageBreak ?? false,
      spacing:         { before: 60, after: 200 },
      border:          { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
      children:        [new TextRun({
        text: entityName.toUpperCase(),
        font: FONT, size: SZ_ENTITY, bold: true, color: NAVY,
      })],
    });

  // 2026-05-30 (revision 9) — Final pragmatic layout after multiple failed
  // attempts at a perfect Word editor preview:
  //
  //   • Running header on every notes page (the only Word mechanism that
  //     repeats content across all pages of a flowing section)
  //   • Body banner ALSO on the first notes page so page 1 reads dark in
  //     the editor — the running header is suppressed on page 1 via
  //     titlePage: true to avoid duplication
  //
  // Known Word UI behaviour: the editor renders running-header text at
  // ~60% opacity (UI helper to indicate 'not currently editing the
  // header'). No XML setting overrides this — every previous workaround
  // (tableHeader rows, per-section page breaks, etc.) either broke the
  // user's flowing-pagination requirement or introduced blank pages.
  //
  // The PRINTED output and PDF EXPORT render running headers at FULL
  // opacity, so the actual deliverable shows the dark navy banner on
  // every page identically to the BS / P&L title rows.
  // Suppressed first-page header so the body banner on page 1 isn't duplicated.
  const emptyFirstHeader = new Header({ children: [new Paragraph({ children: [] })] });

  // Task 6 (revision 2): split notes into BS and PL groups so each gets its
  // own DOCX section with a section-specific running header.
  const bsNoteTablePairs = noteTablePairs.filter(([, , sec]) => sec === "BS");
  const plNoteTablePairs = noteTablePairs.filter(([, , sec]) => sec === "PL");

  // ── Notes sections ───────────────────────────────────────────────────────────
  // Three DOCX sections so BS and PL each get their own running header while
  // notes still flow continuously across the BS→PL boundary:
  //
  //   Section A — Note 1 page: body banner + accounting policies.
  //               emptyFirstHeader suppresses running header so makeNotesBanner()
  //               is not duplicated. Ends with nextPage (default) → Note 2
  //               starts on its own page with the BS running header.
  //
  //   Section B — Notes 2-11 (structured BS tables): bsNotesRunningHdr on every
  //               page. type: CONTINUOUS so PL notes flow on the same page as
  //               the last BS note (no forced page break, no wasted space).
  //               IMPORTANT: notesPortraitPropsNoBdr (no _pgBdr) is used here —
  //               Word silently promotes CONTINUOUS → NEXT_PAGE when the section
  //               carries <w:pgBorders>. Removing the border from this section
  //               is the only way to honour the continuous break.
  //
  //   Section C — PL notes (Notes 12+): plNotesRunningHdr on every page.
  //               notesPortraitProps (with border) restores the page frame.
  //               Inline mkSectionHeading paragraph makes "Notes to P&L A/c…"
  //               visible on the transition page (which carries the BS running
  //               header since the page started in Section B).

  const mkSectionHeading = (text: string, before = 200): Paragraph =>
    new Paragraph({
      spacing: { before, after: 60 },
      border:  { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
      children: [new TextRun({ text, font: FONT, size: SZ_HDR, bold: true, underline: {} })],
    });

  // Section A children — Note 1 page only (no pageBreakBefore needed; the
  // section boundary already forces a new page before Section B content).
  // Signature block (assessee + auditor sign-off) is appended so the printed
  // Note 1 page ends with the same Place / Date / "For <client>" / "(Signature
  // of assessee)" — "As per our Audit Report of even date" / "For <firm>" /
  // "Chartered Accountants" / "Firm Regi No" / partner / membership block
  // the on-screen NCE Stage 7 → Notes to Accounts page shows. Re-uses the
  // exact same sigBlock() helper as the BS / P&L pages so styling stays
  // identical across the document.
  // 2026-06-17: Note 1 now mirrors the Stage 7 Excel export — the new
  // buildNote1Section() returns its OWN bordered entity-name header and
  // Note-1-specific signature block, so the universal makeNotesBanner()
  // and sigBlock() (used on BS / P&L pages) are intentionally omitted
  // here to avoid a duplicate header / signature stack.
  const note1SectionChildren: (Paragraph | Table)[] = [
    ...note1Paras,
  ];
  // Keep makeNotesBanner referenced for the other sections — preserved
  // here to avoid an unused-import / dead-helper TypeScript warning
  // since the helper is still defined inside the same closure.
  void makeNotesBanner;

  // Section B children — BS structured notes (capital account + BS note tables).
  // No inline BS heading; the bsNotesRunningHdr running header provides it on
  // every page of this section.
  const bsNotesSectionChildren: (Paragraph | Table)[] = [
    notesSectionTopSpacer(),
    ...capitalTables.flatMap((t, i) => i === 0 ? [t] : [noteGap(), t]),
    ...bsNoteTablePairs.flatMap(([, table]) => [noteGap(), table]),
  ];

  // Section C children — PL notes. The inline heading appears on the transition
  // page (mid-page after BS notes end) so the PL section start is clearly
  // labelled even though the running header on that page still shows the BS
  // heading (Word locks the header when the page starts).
  const plNotesSectionChildren: (Paragraph | Table)[] = plNoteTablePairs.length > 0
    ? [
        notesSectionTopSpacer(),
        mkSectionHeading(`Notes to Profit & Loss A/c for the accounting year ${Number(cyYear) - 1}-${cyYear}`),
        ...plNoteTablePairs.flatMap(([, table], i) => (i === 0 ? [table] : [noteGap(), table])),
      ]
    : [];

  const doc = new Document({
    styles: {
      default: {
        // Document-level defaults — applied to every paragraph in the file.
        // The paragraph block zeroes spacing.before / after so Word never
        // adds the Normal-style default 8pt-after on top of our explicit
        // values. (Word silently inherits the default when an explicit
        // value isn't repeated at every nesting level.) Tables build their
        // own pPr so they're not affected; the BS / P&L tables read fine
        // because cells override line spacing inside makeRow().
        document: {
          run:       { font: FONT, size: SZ_BODY },
          paragraph: { spacing: { before: 0, after: 0, line: 240, lineRule: "auto" as any } },
        },
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
      // Section A — Note 1 page. Uses note1PortraitProps (compact top margin,
      // no header distance) because the running header is empty — the body
      // banner (makeNotesBanner) provides the title inline. The larger
      // notesPortraitProps margin is only needed for Sections B/C which carry
      // a real two-line running header.
      //
      // verticalAlign intentionally omitted (defaults to TOP). BS / P&L pages
      // use BOTH because dense tables fill the page, so the justified vertical
      // fill is invisible. Note 1 is short free-text (8 numbered policies);
      // with BOTH, Word stretched every paragraph and the signature block to
      // fill the page top-to-bottom, producing huge visual gaps between
      // entity name / subtitle / heading / first policy, and another gap
      // before the signature. Letting content flow from the top gives the
      // tight, professional layout the auditor expects.
      {
        properties: {
          page: note1PortraitProps,
          // grid.type "default" disables Word's per-paragraph line-grid
          // snapping. Without this, each section silently emits
          // <w:docGrid w:linePitch="360"/> (the docx-js default) and
          // Word snaps every paragraph onto an 18pt vertical grid —
          // adding ~half a line of empty space between consecutive
          // <w:p> blocks regardless of paragraph-level spacing.before /
          // after / line / lineRule. Setting type=default makes
          // linePitch advisory only, so our lineRule="exact" line=220
          // numbered-note paragraphs stack flush against each other
          // exactly as a hand-formatted Word numbered list does.
          grid:          { type: "default" as any, linePitch: 360 },
        },
        headers:    { default: emptyFirstHeader },
        children:   note1SectionChildren,
      },
      // Section B — BS notes 2-11.  No type → defaults to nextPage so BS
      // notes always start on a fresh page after Note 1.  Borders restored:
      // Section B starts on its own page so Word can render the full border
      // frame normally.
      {
        properties: { page: notesPortraitProps },
        headers:    { default: bsNotesRunningHdr },
        children:   bsNotesSectionChildren,
      },
      // Section C — PL notes.
      //
      // ECMA-376 §17.6.18: w:type says how THE CURRENT section begins.
      // type=CONTINUOUS here means "PL notes begin without a page break,
      // on the same page where BS notes end."
      //
      // Borders: Section B and Section C share the same pgBorders definition
      // so there is no layout conflict on the transition page.  Word can apply
      // the border to all pages normally.  plNotesRunningHdr provides
      // "Notes to Profit & Loss A/c for the accounting year…" on every full PL page.
      // Omitted entirely when there are no PL notes.
      ...(plNotesSectionChildren.length > 0 ? ([{
        properties: { page: notesPortraitProps, type: SectionType.CONTINUOUS },
        headers:    { default: plNotesRunningHdr },
        children:   plNotesSectionChildren,
      }] as Parameters<typeof Document>[0]["sections"]) : []),
      // PPE Schedule (landscape) — BS note; omitted entirely when the schedule
      // has no data (note 10 gets no number, nothing about PPE is exported).
      ...(ppeTable ? [{
        properties: { page: landscapeProps },
        headers:    { default: bsNotesRunningHdr },
        children:   [ppeTable],
      }] as Parameters<typeof Document>[0]["sections"] : []),
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
