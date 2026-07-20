/**
 * corporateFinancialsDocx.ts
 * Big4-style Word (.docx) export for Corporate Financial Statements
 * (Schedule III Division I — Private Limited / Public Limited entities).
 *
 * Sections exported:
 *   Page 1  — Balance Sheet + Signature
 *   Page 2+ — Profit and Loss Statement + Signature
 *   Notes   — Note 1 (Accounting Policies) + Notes 2–N (from stage5_notes)
 *             Fixed Assets Schedule (landscape)
 *   Ratios  — MCA-mandated 11 ratios (CY + PY)
 *
 * Matches the same Big4 colour palette and layout as nceFinancialsDocx.ts.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

import { getActiveFsDivisor, FS_SCALES } from "@/lib/fsUnits";
import { computeAllRatios, computeVariance } from "@/lib/ratioEngine";
import { getNoteNo } from "@/lib/noteNumberRegistry";

// ─── Export-time unit scale ───────────────────────────────────────────────────
let _exportDivisor = 1;
let _exportSuffix  = "(₹)";
let _exportUnit    = "₹";
let _compact       = false;   // true inside buildBSTable / buildPLTable — tighter row spacing
let _rowH          = 0;       // min row height DXA (0 = no minimum); set per-statement

function amountUnitsLabel(): string {
  return `All amounts in ${_exportUnit}`;
}

// ─── Layout (DXA: 1 inch = 1440 DXA) ─────────────────────────────────────────
const A4_W    = 11906;
const A4_H    = 16838;
const MARG_H  = 720;
const MARG_T  = 720;
const MARG_B  = 900;
const TW      = A4_W - MARG_H * 2;  // 10466

// 2026-07-20 (V J Desai — Word export polish, Items 7 & 8 of user's
// checklist):
//   • Item 7: "Note No." column was 400 DXA (~0.28") — far too narrow for
//     the two-word heading, which forced Word to wrap the label
//     letter-by-letter into "N/o/t/e/N/o.". Widened to 900 DXA (~0.63") so
//     the header renders on a single line.
//   • Item 8: CY / PY columns were 1483 DXA (~1.03") — long-form currency
//     headers like "As at 31 Mar 2026" needed ~1.13" and wrapped at the
//     final year. Widened to 1600 DXA (~1.11") in the 4-col table and
//     1620 DXA in the 3-col note table so the header renders on a single
//     line without any inter-word wrap.
//   • CW_DESC absorbs the delta so total width TW = 10466 stays identical
//     (row edge alignment is preserved across every table).
// Main table columns: Particulars | Note No. | CY | PY
const CW_DESC = 6366;
const CW_NOTE = 900;
const CW_CY   = 1600;
const CW_PY   = 1600;

// Note table columns (3-col Pattern B): Particulars | CY | PY
const NW_DESC = 7226;
const NW_CY   = 1620;
const NW_PY   = 1620;

// Consistent right-side padding for every amount cell so the columns read
// as visually straight verticals from the header row through subtotal /
// grand-total rows (Item 6 of user's checklist).
const AMT_PAD_R = 140;


// FA schedule (landscape 11 cols)
const MARG_LS  = 720;
const TW_LS    = A4_H - MARG_LS * 2;  // 15398
const FA_PAR   = 2600;
const FA_UL    =  600;
const FA_GRO   = 1300;
const FA_ADD   = 1200;
const FA_DIS   = 1200;
const FA_GCL   = 1300;
const FA_DA    = 1000;
const FA_DAD   = 1000;
const FA_DADIS = 1000;
const FA_DCL   = 1000;
const FA_NBY   = 1100;
const FA_NBPY  = 1100;
// 2600+600+1300+1200+1200+1300+1000+1000+1000+1000+1100+1100 = 14400 (adjust)
// Actually: let me recompute to sum to TW_LS = 15398
// FA cols: 2600+600+1300+1200+1200+1300+1000+1000+1000+1000+1099+1099 = 15398?
// 2600+600=3200, +1300=4500, +1200=5700, +1200=6900, +1300=8200, +1000=9200, +1000=10200, +1000=11200, +1000=12200, +1099=13299, +1099... no
// Let me do: 11 cols summing to 15398
// 2200+700+1300+1200+1200+1400+1100+1100+1100+1100+1499 = ... let me just use simple widths

// ─── Typography ───────────────────────────────────────────────────────────────
let FONT        = "Arial";
// Issue 4 — NO text below 9pt anywhere in the export. SZ_XS / SZ_SM are kept as
// named tiers but floored at 9pt (18 half-points) so any caller using them
// renders at the 9pt minimum.
const SZ_XS     = 18;   // was 7pt — floored to 9pt
const SZ_SM     = 18;   // was 8pt — floored to 9pt
const SZ_BODY   = 18;   // 9pt
const SZ_HDR    = 20;   // 10pt
const SZ_TITLE  = 24;   // 12pt — Balance Sheet / Profit & Loss header (was 11pt;
                        // user asked for a darker, more prominent statement title)
const SZ_ENTITY = 24;   // 12pt — client name on every page (was 14pt; user
                        // asked the client-name banner to be 12pt and a darker
                        // shade. Color is BLACK + bold below.)

// ─── Colour palette (professional light grey — 50 % lighter than prior slate) ──
const NAVY    = "374151";   // charcoal text / title accent  (kept dark for readability)
// Issue 2 — "Particulars" / column header: muted off-white with a subtle cool
// undertone (per request).
const BG_HDR  = "F2F6F7";   // Particulars / column header — muted cool off-white
// Note HEADING stays a soft grey (sits a notch above the blue header row).
const BG_NOTE_HDR = "D5D9DD"; // note heading — lighter grey
const BG_SECT = "F1F3F5";   // very light grey section
const BG_TOT  = "F8F9FA";   // near-white subtotal
const BG_GRAN = "E8ECEF";   // light grey grand total
const DK_GREY = "6B7280";   // medium grey (muted text)
const BLACK   = "000000";
const WHITE   = "FFFFFF";
// accent left bar  (50 % lighter than prior 4B5563)
const ACCENT  = "A5AAB1";

// ─── Borders ─────────────────────────────────────────────────────────────────
const bNone = { style: BorderStyle.NONE,   size: 0, color: "FFFFFF" };
const bHair = { style: BorderStyle.SINGLE, size: 2, color: "DEE2E6" };
const bThin = { style: BorderStyle.SINGLE, size: 4, color: "CDD1D7" };   // 50 % lighter
const bBold = { style: BorderStyle.SINGLE, size: 8, color: "9BA0A8" };   // 50 % lighter
const bAccL = { style: BorderStyle.SINGLE, size: 18, color: "9BA0A8" };  // left-accent bar

const BDR_NONE  = { top: bNone, bottom: bNone,  left: bNone, right: bNone };
const BDR_ROW   = { top: bNone, bottom: bHair,  left: bNone, right: bNone };
const BDR_SECT  = { top: bThin, bottom: bNone,  left: bNone, right: bNone };
const BDR_SUB   = { top: bThin, bottom: bThin,  left: bNone, right: bNone };
const BDR_GRAND = { top: bBold, bottom: bBold,  left: bNone, right: bNone };

// ─── Amount formatter ─────────────────────────────────────────────────────────
// In "actual" mode (divisor === 1) render whole rupees. In "thousands" / "lakhs"
// mode render EXACTLY 2 decimal places, matching the on-screen FS toolbar — at
// those scales the rounded integer hides ledger-level precision (e.g.
// ₹7,18,540 must read 718.54 in '000s, not 719) and the export must stay
// consistent with what the auditor sees in the browser.
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

/** Format EPS (not scaled by divisor — it's per-share ₹) */
function fmtEps(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2);
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
  indent?: number;
  colSpan?: number;
  /** "Keep with next" — set on note-table rows so an entire note moves to the
   *  next page intact instead of splitting across a page break. Word still
   *  breaks a note larger than one page (keepNext is a soft constraint). */
  keepNext?: boolean;
}

function cell(o: CellOpts): TableCell {
  const {
    w, text,
    sz      = SZ_BODY,
    bold    = false,
    italic  = false,
    color   = BLACK,
    align   = AlignmentType.LEFT,
    bg,
    borders = BDR_ROW,
    padL    = 80,
    padR    = 80,
    indent  = 0,
    colSpan,
    keepNext = false,
  } = o;

  return new TableCell({
    ...(colSpan ? { columnSpan: colSpan } : {}),
    width:   { size: w, type: WidthType.DXA },
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    borders,
    margins: { top: _compact ? 20 : 36, bottom: _compact ? 20 : 36, left: padL + indent * 200, right: padR },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      ...(keepNext ? { keepNext: true, keepLines: true } : {}),
      spacing:   { before: 0, after: 0, line: 260, lineRule: "auto" as any },
      ...(keepNext ? { keepNext: true, keepLines: true } : {}),
      children:  [new TextRun({ text, font: FONT, size: sz, bold, italic, color })],
    })],
  });
}

function ac(
  val: number,
  w: number,
  opts: { bold?: boolean; bg?: string; borders?: Record<string, typeof bNone>; keepNext?: boolean } = {},
): TableCell {
  return cell({
    text:    fmt(val),
    w,
    align:   AlignmentType.RIGHT,
    padL:    20,
    padR:    AMT_PAD_R,
    bold:    opts.bold,
    bg:      opts.bg,
    borders: opts.borders ?? BDR_ROW,
    keepNext: opts.keepNext,
  });
}

function ec(w: number, bg?: string, borders?: Record<string, typeof bNone>): TableCell {
  return cell({ text: "", w, bg, borders: borders ?? BDR_ROW });
}

// ─── Standard row factories ───────────────────────────────────────────────────

function colHeaderRow(cyLabel: string, pyLabel: string): TableRow {
  return new TableRow({
    tableHeader: true,
    height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
    children: [
      cell({ text: "Particulars",    w: CW_DESC, sz: SZ_SM, bold: true, color: BLACK, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      // Single-line "Note No." — the column is now wide enough to hold it
      // without wrapping (see CW_NOTE comment above).
      cell({ text: "Note No.",       w: CW_NOTE, sz: SZ_SM, bold: true, color: BLACK, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
      cell({ text: `${cyLabel}\n${_exportSuffix}`, w: CW_CY, sz: SZ_SM, bold: true, color: BLACK, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: AMT_PAD_R }),
      cell({ text: `${pyLabel}\n${_exportSuffix}`, w: CW_PY, sz: SZ_SM, bold: true, color: BLACK, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: AMT_PAD_R }),
    ],
  });
}

function sectionRow(label: string): TableRow {
  // 2026-07-20 (V J Desai — Word export polish, Items 9 & 10 of user's
  // checklist): BS / P&L section headings ("EQUITY AND LIABILITIES",
  // "ASSETS", "INCOME", "EXPENSES") need to stand out clearly. Made them
  // upright bold (dropped the italic — too decorative for a statutory
  // heading) at SZ_TITLE and kept the same left accent bar so the
  // existing theme palette is untouched. keepNext so the heading is
  // never orphaned above a page break.
  return new TableRow({
    cantSplit: true,
    height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        shading: { fill: BG_SECT, type: ShadingType.CLEAR },
        borders: { top: bThin, bottom: bHair, left: bAccL, right: bNone },
        margins: { top: _compact ? 40 : 80, bottom: _compact ? 40 : 80, left: 140, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          keepNext: true, keepLines: true,
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: label, font: FONT, size: SZ_TITLE, bold: true, color: NAVY })],
        })],
      }),
    ],
  });
}

function parentRow(label: string, indent = 0): TableRow {
  return new TableRow({
    height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        borders: BDR_ROW,
        margins: { top: _compact ? 15 : 30, bottom: _compact ? 15 : 30, left: 100 + indent * 200, right: 80 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0, line: 260, lineRule: "auto" as any },
          children: [new TextRun({ text: label, font: FONT, size: SZ_BODY, bold: true, color: BLACK })],
        })],
      }),
    ],
  });
}

function dataRow(
  label: string,
  noteNo: number | null,
  cy: number,
  py: number,
  indent = 0,
  bg?: string,
): TableRow {
  return new TableRow({
    height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
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

function subTotalRow(label: string, cy: number, py: number): TableRow {
  return new TableRow({
    height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
    children: [
      cell({ text: label, w: CW_DESC, bold: true, bg: BG_TOT, borders: BDR_SUB }),
      ec(CW_NOTE, BG_TOT, BDR_SUB),
      ac(cy, CW_CY, { bold: true, bg: BG_TOT, borders: BDR_SUB }),
      ac(py, CW_PY, { bold: true, bg: BG_TOT, borders: BDR_SUB }),
    ],
  });
}

function grandTotalRow(label: string, cy: number, py: number): TableRow {
  return new TableRow({
    height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
    children: [
      cell({ text: label, w: CW_DESC, bold: true, sz: SZ_HDR, bg: BG_GRAN, borders: BDR_GRAND, padL: 100 }),
      ec(CW_NOTE, BG_GRAN, BDR_GRAND),
      ac(cy, CW_CY, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      ac(py, CW_PY, { bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
    ],
  });
}

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

function titleRows(entityName: string, statementTitle: string, dateLine: string): TableRow[] {
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
            children:  [new TextRun({ text, font: FONT, size: opts.sz ?? SZ_TITLE, bold: opts.bold ?? false, color: opts.color ?? NAVY })],
          })],
        }),
      ],
    });

  return [
    // Entity name with thick top accent bar
    new TableRow({
      children: [
        new TableCell({
          columnSpan: 4,
          width:   { size: TW, type: WidthType.DXA },
          borders: { top: { style: BorderStyle.SINGLE, size: 24, color: ACCENT }, bottom: bNone, left: bNone, right: bNone },
          margins: { top: 60, bottom: 20, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { before: 0, after: 0 },
            children:  [new TextRun({ text: entityName.toUpperCase(), font: FONT, size: SZ_ENTITY, bold: true, color: BLACK })],
          })],
        }),
      ],
    }),
    centerRow(`${statementTitle} ${dateLine}`, { sz: SZ_TITLE, bold: true, color: BLACK, bottom: 10 }),
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
            children:  [new TextRun({ text: amountUnitsLabel(), font: FONT, size: SZ_HDR, bold: true, color: BLACK })],
          })],
        }),
      ],
    }),
  ];
}

// ─── Helper: amount from map ──────────────────────────────────────────────────
function cy(amounts: Record<string, { cy: number; py: number }>, code: string): number {
  return amounts[code]?.cy ?? 0;
}
function py(amounts: Record<string, { cy: number; py: number }>, code: string): number {
  return amounts[code]?.py ?? 0;
}

// ─── BALANCE SHEET ────────────────────────────────────────────────────────────
function buildBSTable(
  amounts: Record<string, { cy: number; py: number }>,
  noteNos: Record<string, number | null | undefined>,
  cyYear: string,
  pyYear: string,
  entityName: string,
): Table {
  const n = (code: string): number | null => noteNos[code] ?? null;
  const g = (code: string) => ({ cy: cy(amounts, code), py: py(amounts, code) });

  // Shareholders' funds
  const sfCy = cy(amounts,"BS_EQ_SC") + cy(amounts,"BS_EQ_RS");
  const sfPy = py(amounts,"BS_EQ_SC") + py(amounts,"BS_EQ_RS");

  // Non-current liabilities
  const nclCy = cy(amounts,"BS_NCL_LTB") + cy(amounts,"BS_NCL_DTL") + cy(amounts,"BS_NCL_OLT") + cy(amounts,"BS_NCL_LTP");
  const nclPy = py(amounts,"BS_NCL_LTB") + py(amounts,"BS_NCL_DTL") + py(amounts,"BS_NCL_OLT") + py(amounts,"BS_NCL_LTP");

  // Current liabilities
  const clCy = cy(amounts,"BS_CL_STB") + cy(amounts,"BS_CL_TP") + cy(amounts,"BS_CL_OCL") + cy(amounts,"BS_CL_STP");
  const clPy = py(amounts,"BS_CL_STB") + py(amounts,"BS_CL_TP") + py(amounts,"BS_CL_OCL") + py(amounts,"BS_CL_STP");

  // Total equity & liabilities
  const totELCy = sfCy + nclCy + clCy;
  const totELPy = sfPy + nclPy + clPy;

  // Non-current assets
  const ncaCy = cy(amounts,"BS_NCA_FA") + cy(amounts,"BS_NCA_INV") + cy(amounts,"BS_NCA_DTA") + cy(amounts,"BS_NCA_LLA") + cy(amounts,"BS_NCA_ONA");
  const ncaPy = py(amounts,"BS_NCA_FA") + py(amounts,"BS_NCA_INV") + py(amounts,"BS_NCA_DTA") + py(amounts,"BS_NCA_LLA") + py(amounts,"BS_NCA_ONA");

  // Current assets
  const caCy = cy(amounts,"BS_CA_CI") + cy(amounts,"BS_CA_INV") + cy(amounts,"BS_CA_TR") + cy(amounts,"BS_CA_CCE") + cy(amounts,"BS_CA_SLA") + cy(amounts,"BS_CA_OCA");
  const caPy = py(amounts,"BS_CA_CI") + py(amounts,"BS_CA_INV") + py(amounts,"BS_CA_TR") + py(amounts,"BS_CA_CCE") + py(amounts,"BS_CA_SLA") + py(amounts,"BS_CA_OCA");

  const totACy = ncaCy + caCy;
  const totAPy = ncaPy + caPy;

  _compact = true;
  // FIT-TO-ONE-PAGE: the Balance Sheet has a FIXED set of Schedule III rows for
  // every corporate client, so the height is deterministic. 250 DXA per row +
  // the tightened spacer/signature below keeps the ENTIRE Balance Sheet AND its
  // signature block on a single A4 page (printable height ≈ 15218 DXA) for all
  // corporate entities — borders, fonts and formatting are unchanged.
  _rowH = 250;
  const rows: TableRow[] = [
    ...titleRows(entityName, "BALANCE SHEET", `AS AT 31 MARCH ${cyYear}`),
    colHeaderRow(`As at 31 Mar ${cyYear}`, `As at 31 Mar ${pyYear}`),

    // ── EQUITY AND LIABILITIES ────────────────────────────────────────────
    sectionRow("EQUITY AND LIABILITIES"),

    parentRow("(1)  Shareholders' Funds"),
    dataRow("        (a)  Share Capital",                     n("BS_EQ_SC"), g("BS_EQ_SC").cy, g("BS_EQ_SC").py),
    dataRow("        (b)  Reserves and Surplus",              n("BS_EQ_RS"), g("BS_EQ_RS").cy, g("BS_EQ_RS").py),
    dataRow("        (c)  Money Received Against Share Warrants", null,      0,                0),

    parentRow("(2)  Non-Current Liabilities"),
    dataRow("        (a)  Long-term Borrowings",              n("BS_NCL_LTB"), g("BS_NCL_LTB").cy, g("BS_NCL_LTB").py),
    dataRow("        (b)  Deferred Tax Liabilities (Net)",    n("BS_NCL_DTL"), g("BS_NCL_DTL").cy, g("BS_NCL_DTL").py),
    dataRow("        (c)  Other Long-term Liabilities",       n("BS_NCL_OLT"), g("BS_NCL_OLT").cy, g("BS_NCL_OLT").py),
    dataRow("        (d)  Long-term Provisions",              n("BS_NCL_LTP"), g("BS_NCL_LTP").cy, g("BS_NCL_LTP").py),

    parentRow("(3)  Current Liabilities"),
    dataRow("        (a)  Short-term Borrowings",             n("BS_CL_STB"), g("BS_CL_STB").cy, g("BS_CL_STB").py),
    dataRow("        (b)  Trade Payables",                    n("BS_CL_TP"),  g("BS_CL_TP").cy,  g("BS_CL_TP").py),
    dataRow("        (c)  Other Current Liabilities",         n("BS_CL_OCL"), g("BS_CL_OCL").cy, g("BS_CL_OCL").py),
    dataRow("        (d)  Short-term Provisions",             n("BS_CL_STP"), g("BS_CL_STP").cy, g("BS_CL_STP").py),

    // Issue 1: intermediate sub-group totals (Total Shareholders' Funds / Total
    // Non-Current Liabilities / Total Current Liabilities) removed to match the
    // on-screen Balance Sheet and free vertical space for the signature block.
    grandTotalRow("TOTAL EQUITY AND LIABILITIES", totELCy, totELPy),

    // ── ASSETS ────────────────────────────────────────────────────────────
    sectionRow("ASSETS"),

    parentRow("(1)  Non-Current Assets"),
    dataRow("        (a)  Fixed Assets",                      n("BS_NCA_FA"),  g("BS_NCA_FA").cy,  g("BS_NCA_FA").py),
    dataRow("        (b)  Non-current Investments",           n("BS_NCA_INV"), g("BS_NCA_INV").cy, g("BS_NCA_INV").py),
    dataRow("        (c)  Deferred Tax Assets (Net)",         n("BS_NCA_DTA"), g("BS_NCA_DTA").cy, g("BS_NCA_DTA").py),
    dataRow("        (d)  Long-term Loans and Advances",      n("BS_NCA_LLA"), g("BS_NCA_LLA").cy, g("BS_NCA_LLA").py),
    dataRow("        (e)  Other Non-current Assets",          n("BS_NCA_ONA"), g("BS_NCA_ONA").cy, g("BS_NCA_ONA").py),

    parentRow("(2)  Current Assets"),
    dataRow("        (a)  Current Investments",               n("BS_CA_CI"),  g("BS_CA_CI").cy,  g("BS_CA_CI").py),
    dataRow("        (b)  Inventories",                       n("BS_CA_INV"), g("BS_CA_INV").cy, g("BS_CA_INV").py),
    dataRow("        (c)  Trade Receivables",                 n("BS_CA_TR"),  g("BS_CA_TR").cy,  g("BS_CA_TR").py),
    dataRow("        (d)  Cash and Cash Equivalents",         n("BS_CA_CCE"), g("BS_CA_CCE").cy, g("BS_CA_CCE").py),
    dataRow("        (e)  Short-term Loans and Advances",     n("BS_CA_SLA"), g("BS_CA_SLA").cy, g("BS_CA_SLA").py),
    dataRow("        (f)  Other Current Assets",              n("BS_CA_OCA"), g("BS_CA_OCA").cy, g("BS_CA_OCA").py),

    // Issue 1: "Total Non-Current Assets" / "Total Current Assets" sub-group
    // totals removed — only the grand "TOTAL ASSETS" is shown.
    grandTotalRow("TOTAL ASSETS", totACy, totAPy),

    // Footnote
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
              new TextRun({ text: "Note 1  ", font: FONT, size: SZ_BODY, bold: true, color: NAVY }),
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

  _compact = false;
  _rowH = 0;
  return new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [CW_DESC, CW_NOTE, CW_CY, CW_PY], rows });
}

// ─── PROFIT AND LOSS ──────────────────────────────────────────────────────────
function buildPLTable(
  amounts: Record<string, { cy: number; py: number }>,
  noteNos: Record<string, number | null | undefined>,
  cyYear: string,
  pyYear: string,
  entityName: string,
): Table {
  const n = (code: string): number | null => noteNos[code] ?? null;
  const g = (code: string) => ({ cy: cy(amounts, code), py: py(amounts, code) });

  // Income totals
  const revOpsCy = g("PL_REV_OPS").cy;  const revOpsPy = g("PL_REV_OPS").py;
  const revOiCy  = g("PL_REV_OI").cy;   const revOiPy  = g("PL_REV_OI").py;
  const totIncCy = revOpsCy + revOiCy;  const totIncPy = revOpsPy + revOiPy;

  // Expense totals
  const matCy = g("PL_EXP_MAT").cy; const matPy = g("PL_EXP_MAT").py;
  const sitCy = g("PL_EXP_SIT").cy; const sitPy = g("PL_EXP_SIT").py;
  const ciiCy = g("PL_EXP_CII").cy; const ciiPy = g("PL_EXP_CII").py;  // can be negative (credit)
  const empCy = g("PL_EXP_EMP").cy; const empPy = g("PL_EXP_EMP").py;
  const finCy = g("PL_EXP_FIN").cy; const finPy = g("PL_EXP_FIN").py;
  const depCy = g("PL_EXP_DEP").cy; const depPy = g("PL_EXP_DEP").py;
  const othCy = g("PL_EXP_OTH").cy; const othPy = g("PL_EXP_OTH").py;
  const totExpCy = matCy + sitCy + ciiCy + empCy + finCy + depCy + othCy;
  const totExpPy = matPy + sitPy + ciiPy + empPy + finPy + depPy + othPy;

  // Profit chain
  const pBEICy = totIncCy - totExpCy;          const pBEIPy = totIncPy - totExpPy;
  const eiCy   = g("PL_EI").cy;               const eiPy   = g("PL_EI").py;   // exceptional
  const pBTCy  = pBEICy + eiCy;               const pBTPy  = pBEIPy + eiPy;
  const taxCurCy = g("PL_TAX_CUR").cy;        const taxCurPy = g("PL_TAX_CUR").py;
  const taxDefCy = g("PL_TAX_DEF").cy;        const taxDefPy = g("PL_TAX_DEF").py;
  const totTaxCy = taxCurCy + taxDefCy;        const totTaxPy = taxCurPy + taxDefPy;
  const patCy    = pBTCy - totTaxCy;           const patPy    = pBTPy - totTaxPy;

  // EPS — raw values, not scaled by divisor
  const epsBasicCy    = amounts["PL_EPS_B"]?.cy ?? 0;
  const epsBasicPy    = amounts["PL_EPS_B"]?.py ?? 0;
  const epsDilutedCy  = amounts["PL_EPS_D"]?.cy ?? 0;
  const epsDilutedPy  = amounts["PL_EPS_D"]?.py ?? 0;

  const epsRow = (label: string, noteNo: number | null, valCy: number, valPy: number): TableRow =>
    new TableRow({
      height: _rowH > 0 ? { value: _rowH, rule: HeightRule.ATLEAST } : undefined,
      children: [
        cell({ text: label, w: CW_DESC, indent: 1 }),
        cell({ text: noteNo ? String(noteNo) : "", w: CW_NOTE, align: AlignmentType.CENTER, bold: true, color: noteNo ? NAVY : BLACK }),
        cell({ text: fmtEps(valCy), w: CW_CY, align: AlignmentType.RIGHT, padR: AMT_PAD_R }),
        cell({ text: fmtEps(valPy), w: CW_PY, align: AlignmentType.RIGHT, padR: AMT_PAD_R }),
      ],
    });

  _compact = true;
  // FIT-TO-ONE-PAGE: fixed Schedule III P&L rows for every corporate client.
  // 320 DXA per row + the tightened spacer/signature keeps the ENTIRE P&L AND
  // its signature block on a single A4 page for all corporate entities.
  _rowH = 320;
  const rows: TableRow[] = [
    ...titleRows(entityName, "STATEMENT OF PROFIT AND LOSS", `FOR THE YEAR ENDED 31 MARCH ${cyYear}`),
    colHeaderRow(`Year ended 31 Mar ${cyYear}`, `Year ended 31 Mar ${pyYear}`),

    // ── INCOME ────────────────────────────────────────────────────────────
    sectionRow("INCOME"),
    dataRow("I.    Revenue from Operations",          n("PL_REV_OPS"), revOpsCy, revOpsPy),
    dataRow("II.   Other Income",                     n("PL_REV_OI"),  revOiCy,  revOiPy),
    subTotalRow("III.  Total Income  (I + II)", totIncCy, totIncPy),

    // ── EXPENSES ──────────────────────────────────────────────────────────
    sectionRow("EXPENSES"),
    dataRow("(a)   Cost of Materials Consumed",                  n("PL_EXP_MAT"), matCy, matPy),
    dataRow("(b)   Purchases of Stock-in-Trade",                 n("PL_EXP_SIT"), sitCy, sitPy),
    dataRow("(c)   Changes in Inventories of FG / WIP / SIT",   n("PL_EXP_CII"), ciiCy, ciiPy),
    dataRow("(d)   Employee Benefits Expense",                   n("PL_EXP_EMP"), empCy, empPy),
    dataRow("(e)   Finance Costs",                               n("PL_EXP_FIN"), finCy, finPy),
    dataRow("(f)   Depreciation and Amortisation Expense",       null,            depCy, depPy),
    dataRow("(g)   Other Expenses",                              n("PL_EXP_OTH"), othCy, othPy),
    subTotalRow("IV.   Total Expenses", totExpCy, totExpPy),

    // ── Profit chain ──────────────────────────────────────────────────────
    dataRow("V.    Profit / (Loss) before Exceptional Items and Tax  (III − IV)", null, pBEICy, pBEIPy),
    dataRow("VI.   Exceptional Items",                            null, eiCy,   eiPy),
    dataRow("VII.  Profit / (Loss) before Tax  (V + VI)",         null, pBTCy,  pBTPy),

    parentRow("VIII. Tax Expense"),
    dataRow("        (1)  Current Tax",                           null, taxCurCy, taxCurPy, 1),
    dataRow("        (2)  Deferred Tax",                          null, taxDefCy, taxDefPy, 1),
    subTotalRow("             Total Tax Expense", totTaxCy, totTaxPy),

    grandTotalRow("IX.   Profit / (Loss) for the Year  (VII − VIII)", patCy, patPy),

    // ── EPS ────────────────────────────────────────────────────────────────
    parentRow("X.    Earnings Per Share (₹)"),
    epsRow("        (1)  Basic EPS",   n("PL_EPS_B"), epsBasicCy,   epsBasicPy),
    epsRow("        (2)  Diluted EPS", n("PL_EPS_D"), epsDilutedCy, epsDilutedPy),

    // Footnote
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
              new TextRun({ text: "Note 1  ", font: FONT, size: SZ_BODY, bold: true, color: NAVY }),
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

  _compact = false;
  _rowH = 0;
  return new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: [CW_DESC, CW_NOTE, CW_CY, CW_PY], rows });
}

// ─── CORPORATE SIGNATURE BLOCK ────────────────────────────────────────────────
export interface CorpSigData {
  firmName?: string;
  firmFRN?: string;
  partnerName?: string;
  membershipNo?: string;
  dir1Name?: string;
  dir1Din?: string;
  dir2Name?: string;
  dir2Din?: string;
  place?: string;
  date?: string;  // "YYYY-MM-DD"
}

function fmtSigDate(d?: string): string {
  if (!d) return "_______________";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// ISSUE 2: signature block rebuilt to EXACTLY mirror the on-screen
// CorporateSignatureBlock (src/components/shared/CorporateSignatureBlock.tsx):
//   row 1  — "As per our Audit Report of even date"
//   row 2  — Left: For <Firm> / Chartered Accountants / Firm's Registration No.
//            Right: For and on behalf of the Board of Directors of <Company>
//   row 3  — Partner column + one column per Director (Name / Director / DIN)
//   row 4  — Place / Date repeated under every column
function buildCorpSignatureTable(sig: CorpSigData, entityName: string): Table {
  const firmName = sig.firmName     || "[Statutory Auditor Name]";
  const frn      = sig.firmFRN      || "[FRN]";
  const partner  = sig.partnerName  || "[Signing Partner / Proprietor]";
  const memNo    = sig.membershipNo || "—";
  const place    = sig.place        || "Ahmedabad";
  const date     = fmtSigDate(sig.date);

  // Partner column + N director columns — matches the on-screen grid.
  const directors: Array<{ name: string; din: string }> = [];
  if (sig.dir1Name) directors.push({ name: sig.dir1Name, din: sig.dir1Din || "" });
  if (sig.dir2Name) directors.push({ name: sig.dir2Name, din: sig.dir2Din || "" });
  if (directors.length === 0) directors.push({ name: "[Director Name]", din: "" });

  const nCols  = 1 + directors.length;
  const colW   = Math.floor(TW / nCols);
  const widths = Array.from({ length: nCols }, (_, i) =>
    i === nCols - 1 ? TW - colW * (nCols - 1) : colW);

  // Issue 3 — the client (Board of Directors) sign area is shifted one page
  // margin (720 DXA ≈ 0.5") to the right of the auditor block.
  const SIG_CLIENT_INDENT = 720;
  type Line = { text: string; bold?: boolean };
  const stack = (
    lines: Line[],
    opts: { top?: number; span?: number; width: number; left?: number },
  ): TableCell =>
    new TableCell({
      ...(opts.span ? { columnSpan: opts.span } : {}),
      width:   { size: opts.width, type: WidthType.DXA },
      borders: BDR_NONE,
      margins: { top: opts.top ?? 0, bottom: 0, left: opts.left ?? 80, right: 80 },
      children: lines.map(l => new Paragraph({
        // 9pt font (SZ_BODY) with comfortable line spacing to match the
        // on-screen signature block layout the user approved.
        spacing:  { before: 0, after: 30 },
        children: [new TextRun({ text: l.text, font: FONT, size: SZ_BODY, bold: l.bold ?? false, color: l.bold ? NAVY : BLACK })],
      })),
    });

  // 2026-07-20 (V J Desai — Word export polish, Item 14): signature block
  // gets a thin top rule so it reads as a distinct section under the BS/P&L
  // table, mirroring an audit-report signature area. Border colour reuses
  // the existing NAVY palette — no theme change.
  const prefaceRow = new TableRow({
    children: [new TableCell({
      columnSpan: nCols,
      width:   { size: TW, type: WidthType.DXA },
      borders: { top: { style: BorderStyle.SINGLE, size: 8, color: NAVY }, bottom: bNone, left: bNone, right: bNone },
      margins: { top: 120, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({
        spacing: { before: 0, after: 0 },
        keepNext: true, keepLines: true,
        children: [new TextRun({ text: "As per our Audit Report of even date", font: FONT, size: SZ_BODY, italic: true, color: DK_GREY })],
      })],
    })],
  });

  const headerRow = new TableRow({
    children: [
      stack(
        [{ text: `For ${firmName}`, bold: true }, { text: "Chartered Accountants" }, { text: `Firm's Registration No.: ${frn}` }],
        { span: 1, width: widths[0] },
      ),
      stack(
        [{ text: "For and on behalf of the Board of Directors of" }, { text: entityName, bold: true }],
        { span: nCols - 1, width: widths.slice(1).reduce((s, w) => s + w, 0), left: 80 + SIG_CLIENT_INDENT },
      ),
    ],
  });

  const sigRow = new TableRow({
    children: [
      stack([{ text: partner, bold: true }, { text: "Partner" }, { text: `Membership No.: ${memNo}` }], { top: 420, width: widths[0] }),
      ...directors.map((d, i) =>
        stack([{ text: d.name, bold: true }, { text: "Director" }, { text: `DIN: ${d.din || "—"}` }], { top: 420, width: widths[i + 1], left: 80 + SIG_CLIENT_INDENT }),
      ),
    ],
  });

  const placeDateRow = new TableRow({
    children: widths.map((w, i) =>
      stack([{ text: `Place: ${place}` }, { text: `Date: ${date}` }], { top: 220, width: w, left: i === 0 ? 80 : 80 + SIG_CLIENT_INDENT }),
    ),
  });

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: widths,
    rows: [prefaceRow, headerRow, sigRow, placeDateRow],
  });
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function makeFooter(entityName: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border:    { top: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 1 } },
        spacing:   { before: 80 },
        children: [
          // Per-page footer banner. Entity name is rendered in BLACK + bold so
          // it reads as a darker, more legible identifier on every page (user
          // ask: client name should appear in a darker shade everywhere).
          // Surrounding chrome (separator pipes, "Page X of Y") stays in muted
          // grey so the eye lands on the name first.
          new TextRun({ text: entityName, font: FONT, size: SZ_XS, color: BLACK, bold: true }),
          new TextRun({ text: `  |  Financial Statements  |  Page `, font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ text: " of ",                  font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SZ_XS, color: DK_GREY }),
        ],
      }),
    ],
  });
}

// ─── RUNNING PAGE HEADER ──────────────────────────────────────────────────────
// Matches the requested CA-firm format:
//   • Client name  — CENTERED, bold, navy.
//   • Subtitle line — LEFT-aligned, bold (e.g. "Notes to Balance Sheet as at
//     31st March, 2026"). Subtitle is optional — Note 1 (Accounting Policies)
//     and the Ratios section get the client name ONLY.
// Repeats on every page of the section it is attached to. NOT used on the
// Balance Sheet / P&L face pages, and there is no footer anywhere.
function makeHeader(entityName: string, subtitle?: string): Header {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: subtitle ? 60 : 40 },
      children:  [new TextRun({ text: entityName, font: FONT, size: SZ_TITLE, bold: true, color: BLACK })],
    }),
  ];
  if (subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing:   { before: 0, after: 40 },
      children:  [new TextRun({ text: subtitle, font: FONT, size: SZ_HDR, bold: true, color: BLACK })],
    }));
  }
  return new Header({ children });
}

// ─── NOTE 1: Accounting Policies ─────────────────────────────────────────────
const CORP_NOTE1_POLICIES = [
  { label: "a) Basis of Preparation",
    text: "These financial statements are prepared in accordance with Generally Accepted Accounting Principles in India (Indian GAAP) under the historical cost convention on an accrual basis. These financial statements comply with the Accounting Standards prescribed by the Companies (Accounting Standards) Rules, 2006 and relevant provisions of the Companies Act, 2013." },
  { label: "b) Use of Estimates",
    text: "The preparation of financial statements requires management to make estimates and assumptions that affect the reported amounts of assets, liabilities, revenues, and expenses. Actual results could differ from those estimates. Any revision to accounting estimates is recognised prospectively." },
  { label: "c) Property, Plant and Equipment",
    text: "Property, Plant and Equipment are stated at cost less accumulated depreciation and impairment losses. Cost includes purchase price, import duties, non-refundable taxes and all directly attributable costs of bringing the asset to its working condition for its intended use." },
  { label: "d) Depreciation",
    text: "Depreciation on tangible assets is provided on the Written Down Value (WDV) method over the useful lives of assets as prescribed in Schedule II to the Companies Act, 2013. Residual value is assumed at 5% of original cost. Depreciation on additions during the year is provided on a pro-rata basis." },
  { label: "e) Intangible Assets",
    text: "Intangible assets are recognised when it is probable that the future economic benefits attributable to the asset will flow to the enterprise and the cost of the asset can be measured reliably. Intangibles are amortised over their estimated useful economic life." },
  { label: "f) Inventories",
    text: "Inventories are valued at cost or net realisable value, whichever is lower. Cost is determined on First-In-First-Out (FIFO) basis and includes all costs of purchase, costs of conversion, and other costs incurred in bringing inventories to their present location and condition." },
  { label: "g) Revenue Recognition",
    text: "Revenue from the sale of goods is recognised when the significant risks and rewards of ownership are transferred to the buyer. Revenue from services is recognised as services are rendered. Dividend income is recognised when the right to receive is established. Interest income is recognised on a time proportion basis." },
  { label: "h) Investments",
    text: "Long-term investments are stated at cost. Provision for diminution in value of investments is made only when such diminution is other than temporary. Current investments are stated at cost or fair value, whichever is lower." },
  { label: "i) Borrowing Costs",
    text: "Borrowing costs that are directly attributable to the acquisition, construction or production of a qualifying asset are capitalised as part of the cost of that asset. Other borrowing costs are recognised as an expense in the period in which they are incurred." },
  { label: "j) Employee Benefits",
    text: "Short-term employee benefits are recognised on an undiscounted basis in the period in which services are rendered. Post-employment benefits (gratuity, provident fund) and long-term employee benefits are provided based on actuarial valuation using the Projected Unit Credit method where applicable." },
  { label: "k) Taxes on Income",
    text: "Current tax is measured at the amount expected to be paid in respect of taxable income for the year in accordance with the Income Tax Act, 1961. Deferred tax is recognised for all timing differences between taxable income and accounting income, subject to the consideration of prudence. Deferred tax assets are recognised only if there is virtual certainty of realisation." },
  { label: "l) Provisions and Contingencies",
    text: "Provisions are recognised when the entity has a present obligation as a result of a past event, it is probable that an outflow of resources will be required to settle the obligation, and a reliable estimate can be made. Contingent liabilities are not recognised but are disclosed in the notes. Contingent assets are neither recognised nor disclosed." },
  { label: "m) Foreign Currency Transactions",
    text: "Foreign currency transactions are recorded at the exchange rate prevailing on the date of the transaction. Monetary assets and liabilities outstanding at the year-end are restated at the closing rate. Exchange differences arising on settlement or restatement are recognised in the Statement of Profit and Loss." },
  { label: "n) Cash and Cash Equivalents",
    text: "For the Cash Flow Statement, cash and cash equivalents include cash on hand, cheques/drafts in hand, and balances with scheduled banks in current accounts and short-term deposits with an original maturity of three months or less." },
];

function buildNote1Section(entityName: string, cyYear: string): Paragraph[] {
  // 2026-07-20 (V J Desai — Word export polish, Item 12 of user's checklist):
  // Long accounting-policy paragraphs now render with JUSTIFIED alignment,
  // 1.15× line spacing, and a consistent policy-to-policy gap — matching a
  // professionally prepared audit-report body. Labels stay LEFT so the
  // heading edge is always visible on the left margin.
  const GAP = 160;  // separation between policies
  const txt = (text: string, bold = false) =>
    new TextRun({ text, font: FONT, size: SZ_BODY, bold, color: BLACK });

  const block = (
    runs: TextRun[],
    opts: { indent?: number; after?: number; keepNext?: boolean; justify?: boolean } = {},
  ): Paragraph =>
    new Paragraph({
      alignment: opts.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      spacing:   { before: 0, after: opts.after ?? 40, line: 300, lineRule: "auto" as any },
      indent:    opts.indent ? { left: opts.indent } : undefined,
      keepLines: true,                       // never split a single paragraph mid-way
      keepNext:  opts.keepNext ?? false,     // allow page breaks BETWEEN policies
      children:  runs,
    });

  return [
    // Note 1 heading — matches the BS/P&L statement titles: centred, bold,
    // SZ_TITLE (12pt), with a top+bottom accent rule instead of the previous
    // 10pt inline heading. Consistent "report-title" look across BS / P&L /
    // Notes as the auditor asked (Item 3 of the checklist).
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 140 },
      border:    {
        top:    { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 },
        bottom: { style: BorderStyle.SINGLE, size: 8,  color: NAVY,   space: 6 },
      },
      keepNext:  true,
      keepLines: true,
      children: [
        new TextRun({ text: "NOTES TO ACCOUNTS", font: FONT, size: SZ_TITLE, bold: true, color: BLACK }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 200 },
      keepNext:  true,
      keepLines: true,
      children: [
        new TextRun({ text: "Note 1 — Significant Accounting Policies", font: FONT, size: SZ_HDR, bold: true, color: NAVY }),
      ],
    }),
    block([txt("1.  Basis of Preparation", true)], { after: 40, keepNext: true }),
    block(
      [txt(`The financial statements of ${entityName} have been prepared in accordance with Schedule III to the Companies Act, 2013 and the applicable Accounting Standards as prescribed under Section 133 of the Companies Act, 2013. The financial statements comply with all material aspects of Indian GAAP.`)],
      { after: GAP, justify: true },
    ),
    block([txt("2.  Significant Accounting Policies", true)], { after: 60, keepNext: true }),
    ...CORP_NOTE1_POLICIES.flatMap((p, i) => [
      // Label LEFT-aligned + keepNext with its body; body JUSTIFIED so it
      // reads as an audit-report paragraph. Body allows page break after it
      // so policies flow naturally across pages.
      block([txt(p.label, true)], { indent: 280, after: 20, keepNext: true }),
      block([txt(p.text)],        { indent: 280, after: GAP, justify: true }),
    ]),
  ];
}

// ─── NOTE TABLE (generic breakup from stage5_notes) ──────────────────────────
function noteTitleRow(colWidths: number[], noteNumber: string, title: string, keepNext = false): TableRow {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  // 2026-06-18 fix (Issue 1 — excessive gap before Particulars row):
  // The previous implementation set a 24pt minimum row height plus 5pt top
  // and 5pt bottom internal padding. With the note title text only ~10pt
  // tall, ~14pt of empty space accumulated INSIDE the title row, then the
  // Particulars header row below contributed another 25pt min height. The
  // visible gap between "Note N — Title" and "Particulars | CY | PY" was
  // ~30pt. Halved the row min height + tightened margins so the title row
  // hugs the text and the Particulars row sits flush below.
  return new TableRow({
    cantSplit: true,
    height: { value: 320, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        columnSpan: colWidths.length,
        width:   { size: totalW, type: WidthType.DXA },
        // Note heading uses a lighter grey (BG_NOTE_HDR) with black bold text.
        shading: { fill: BG_NOTE_HDR, type: ShadingType.CLEAR },
        borders: BDR_NONE,
        margins: { top: 50, bottom: 50, left: 160, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          ...(keepNext ? { keepNext: true, keepLines: true } : {}),
          children: [
            new TextRun({ text: `Note ${noteNumber} — ${title}`, font: FONT, size: SZ_HDR, bold: true, color: BLACK }),
          ],
        })],
      }),
    ],
  });
}

function noteHdr3(cyLabel: string, pyLabel: string, keepNext = false): TableRow {
  // 2026-06-18 fix (Issue 1 + Issue 3 — gap + "subgroups not darker"):
  //   • Row min height dropped 500 → 320 DXA so the column header sits
  //     close to the Note title row above (Issue 1).
  //   • Background shading removed (no BG_HDR fill) — the column header is
  //     now WHITE with bold black text + a thin bottom rule for visual
  //     separation. Matches the user's "subgroups should not be darker"
  //     directive (Issue 3) without losing the header hierarchy.
  return new TableRow({
    tableHeader: true,
    height: { value: 320, rule: HeightRule.ATLEAST },
    children: [
      cell({ text: "Particulars", w: NW_DESC, sz: SZ_SM, bold: true, color: BLACK, borders: BDR_SUB, padL: 160, keepNext }),
      cell({ text: `${cyLabel}\n${_exportSuffix}`, w: NW_CY, sz: SZ_SM, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: AMT_PAD_R, keepNext }),
      cell({ text: `${pyLabel}\n${_exportSuffix}`, w: NW_PY, sz: SZ_SM, bold: true, color: BLACK, borders: BDR_SUB, align: AlignmentType.RIGHT, padR: AMT_PAD_R, keepNext }),
    ],
  });
}

function noteRow3(
  label: string,
  cyVal: number,
  pyVal: number,
  indent = 0,
  style: "data" | "subtotal" | "total" = "data",
): TableRow {
  // Issue 1 — all note rows render on a WHITE background; totals/subtotals stay
  // legible via bold text + their top/bottom rule borders.
  const bg   = undefined;
  const bdr  = style === "total" ? BDR_GRAND : style === "subtotal" ? BDR_SUB : BDR_ROW;
  const bold = style !== "data";
  return new TableRow({
    cantSplit: true,
    children: [
      cell({ text: label, w: NW_DESC, bold, bg, borders: bdr, indent, keepNext: true }),
      ac(cyVal, NW_CY, { bold, bg, borders: bdr, keepNext: true }),
      ac(pyVal, NW_PY, { bold, bg, borders: bdr, keepNext: true }),
    ],
  });
}

interface BreakupRow {
  description?: string;
  amount_cy?: number | string | null;
  amount_py?: number | string | null;
  is_total?: boolean;
  is_sub_total?: boolean;
  [key: string]: any;
}

function buildNoteBreakupTable(
  noteNumber: string,
  title: string,
  breakup: BreakupRow[],
  cyYear: string,
  pyYear: string,
): Table {
  const safeNum = (v: any): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const rows: TableRow[] = [
    noteTitleRow([NW_DESC, NW_CY, NW_PY], noteNumber, title),
    noteHdr3(cyYear, pyYear),
  ];

  let totCy = 0;
  let totPy = 0;

  for (const row of (breakup ?? [])) {
    if (!row) continue;
    const label = String(row.description || row.label || "");
    const cyVal = safeNum(row.amount_cy);
    const pyVal = safeNum(row.amount_py);
    if (!label && cyVal === 0 && pyVal === 0) continue;
    totCy += cyVal;
    totPy += pyVal;
    const style = row.is_total ? "total" : row.is_sub_total ? "subtotal" : "data";
    rows.push(noteRow3(label, cyVal, pyVal, 0, style));
  }

  // Grand total row (only if there are data rows and no "is_total" row)
  const hasExplicitTotal = (breakup ?? []).some(r => r?.is_total);
  if (!hasExplicitTotal && rows.length > 2) {
    rows.push(noteRow3("Total", totCy, totPy, 0, "total"));
  }

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [NW_DESC, NW_CY, NW_PY],
    rows,
  });
}

// ─── FA SCHEDULE (landscape) ─────────────────────────────────────────────────
interface FARow {
  id:           string;
  particulars:  string;
  useful_life?: number | string;
  gross_open:   number;
  additions:    number;
  disposals:    number;
  depn_open:    number;
  depn_add:     number;
  depn_disp:    number;
  net_py?:      number | null;
}

function buildFATable(
  faRows: FARow[],
  noteNumber: string,
  cyYear: string,
  pyYear: string,
  pyManual?: Record<string, number | null> | null,
  pyRows?: FARow[] | null,
): Table {
  // 12 columns summing to TW_LS = 15398
  // Particulars | UL | GrossOpen | Add | Disp | GrossClos | DepnOpen | DepnAdd | DepnDisp | DepnClos | NetCY | NetPY
  const FA_COLS = [2200, 500, 1200, 1100, 1100, 1300, 1050, 1050, 1050, 1300, 1274, 1274];
  // sum = 2200+500+1200+1100+1100+1300+1050+1050+1050+1300+1274+1274 = 15398 ✓

  // Issue 2 — FA header row at 9pt (SZ_BODY), matching the 9pt data rows.
  const h = (text: string, w: number) =>
    cell({ text, w, sz: SZ_BODY, bold: true, color: BLACK, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER, padL: 30, padR: 30 });

  const hdrRow = new TableRow({
    tableHeader: true,
    height: { value: 480, rule: HeightRule.ATLEAST },
    children: [
      h("Particulars",              FA_COLS[0]),
      h("Useful\nLife",             FA_COLS[1]),
      h("Gross Block\nOpening",     FA_COLS[2]),
      h("Additions",                FA_COLS[3]),
      h("Disposals",                FA_COLS[4]),
      h("Gross Block\nClosing",     FA_COLS[5]),
      h("Depn\nOpening",            FA_COLS[6]),
      h("Depn\nCharged",            FA_COLS[7]),
      h("Depn on\nDisposals",       FA_COLS[8]),
      h("Depn\nClosing",            FA_COLS[9]),
      h(`Net Block\n${cyYear}`,     FA_COLS[10]),
      h(`Net Block\n${pyYear}`,     FA_COLS[11]),
    ],
  });

  const nac = (v: number | null | undefined, w: number, bold = false, bg?: string, bdr = BDR_ROW) =>
    ac(v ?? 0, w, { bold, bg, borders: bdr });

  // Issue 2 — asset names render in Proper (Title) Case, mirroring the
  // on-screen FAGrid (which displays toTitleCase).
  const toProper = (s: string) => (s || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  const dataRows = (faRows ?? []).map(r => {
    const grossClos = (r.gross_open || 0) + (r.additions || 0) - (r.disposals || 0);
    const depnClos  = (r.depn_open  || 0) + (r.depn_add  || 0) - (r.depn_disp || 0);
    const netCy     = grossClos - depnClos;
    const netPy     = r.net_py != null ? r.net_py : (r.gross_open || 0) - (r.depn_open || 0);
    // Issue 3 — Useful Life shows just the number (no "yrs"/"years" suffix).
    const ul        = r.useful_life != null && String(r.useful_life) !== ""
      ? (String(r.useful_life) === "indefinite" ? "∞" : String(r.useful_life))
      : "";
    // 2026-07-20 (V J Desai — Word export polish, Item 13): every FA data
    // row now enforces a 320 DXA minimum height and cantSplit so rows read
    // as equal-height bands and never break across a landscape page.
    return new TableRow({
      cantSplit: true,
      height: { value: 320, rule: HeightRule.ATLEAST },
      children: [
        // Issue 2 — Particulars at 9pt (SZ_BODY), Proper case.
        cell({ text: toProper(r.particulars || ""), w: FA_COLS[0], sz: SZ_BODY }),
        cell({ text: ul,                  w: FA_COLS[1], sz: SZ_BODY, align: AlignmentType.CENTER }),
        nac(r.gross_open, FA_COLS[2]),
        nac(r.additions,  FA_COLS[3]),
        nac(r.disposals,  FA_COLS[4]),
        nac(grossClos,    FA_COLS[5]),
        nac(r.depn_open,  FA_COLS[6]),
        nac(r.depn_add,   FA_COLS[7]),
        nac(r.depn_disp,  FA_COLS[8]),
        nac(depnClos,     FA_COLS[9]),
        nac(netCy,        FA_COLS[10]),
        nac(netPy,        FA_COLS[11]),
      ],
    });
  });

  const sumField = (field: keyof FARow) =>
    (faRows ?? []).reduce((s, r) => s + (Number(r[field]) || 0), 0);
  const sumGrossClos = sumField("gross_open") + sumField("additions") - sumField("disposals");
  const sumDepnClos  = sumField("depn_open")  + sumField("depn_add")  - sumField("depn_disp");
  const sumNetCy     = sumGrossClos - sumDepnClos;
  // Issue 2 — "Total — Current year" Net Block PY must mirror the on-screen FA
  // grid, which sums the DERIVED opening net block Σ(gross_open − depn_open),
  // NOT the per-row net_py override. (Previously this summed net_py, giving a
  // figure that did not match the on-screen total.)
  const sumNetPy     = sumField("gross_open") - sumField("depn_open");

  // ── Issue 1 — totals render WHITE (bold + grand-total rule keeps them legible)
  // 2026-07-20 (V J Desai — Word export polish, Item 15): both FA total rows
  // now cantSplit and match the data-row min height so the CY and PY totals
  // read as clean bands under the ledger rows and can't get chopped between
  // pages.
  const totalCYRow = new TableRow({
    cantSplit: true,
    height: { value: 320, rule: HeightRule.ATLEAST },
    children: [
      cell({ text: "Total — Current year", w: FA_COLS[0],  sz: SZ_BODY, bold: true, borders: BDR_GRAND }),
      cell({ text: "",      w: FA_COLS[1],  sz: SZ_BODY, borders: BDR_GRAND }),
      nac(sumField("gross_open"),    FA_COLS[2], true, undefined, BDR_GRAND),
      nac(sumField("additions"),     FA_COLS[3], true, undefined, BDR_GRAND),
      nac(sumField("disposals"),     FA_COLS[4], true, undefined, BDR_GRAND),
      nac(sumGrossClos,              FA_COLS[5], true, undefined, BDR_GRAND),
      nac(sumField("depn_open"),     FA_COLS[6], true, undefined, BDR_GRAND),
      nac(sumField("depn_add"),      FA_COLS[7], true, undefined, BDR_GRAND),
      nac(sumField("depn_disp"),     FA_COLS[8], true, undefined, BDR_GRAND),
      nac(sumDepnClos,               FA_COLS[9], true, undefined, BDR_GRAND),
      nac(sumNetCy,                  FA_COLS[10], true, undefined, BDR_GRAND),
      nac(sumNetPy,                  FA_COLS[11], true, undefined, BDR_GRAND),
    ],
  });

  // ── Issue 2 — "Total — Previous year" row, replicating the on-screen FAGrid
  // pyCell(): a manual override (fa.py_manual) wins; otherwise the figure is
  // computed from the prior-year engagement's FA rows (pyRows). This row was
  // missing from the export entirely.
  const gc = (r: FARow) => (r.gross_open || 0) + (r.additions || 0) - (r.disposals || 0);
  const dc = (r: FARow) => (r.depn_open  || 0) + (r.depn_add  || 0) - (r.depn_disp  || 0);
  const pySum = (fn: (r: FARow) => number) => (pyRows ?? []).reduce((s, r) => s + fn(r), 0);
  const hasPy = !!(pyRows && pyRows.length > 0);
  const pyComputed: Record<string, number> = {
    gross_open: hasPy ? pySum(r => Number(r.gross_open) || 0) : 0,
    additions:  hasPy ? pySum(r => Number(r.additions)  || 0) : 0,
    disposals:  hasPy ? pySum(r => Number(r.disposals)  || 0) : 0,
    grossClose: hasPy ? pySum(gc) : 0,
    depn_open:  hasPy ? pySum(r => Number(r.depn_open)  || 0) : 0,
    depn_add:   hasPy ? pySum(r => Number(r.depn_add)   || 0) : 0,
    depn_disp:  hasPy ? pySum(r => Number(r.depn_disp)  || 0) : 0,
    depnClose:  hasPy ? pySum(dc) : 0,
    netCY:      hasPy ? pySum(r => gc(r) - dc(r)) : 0,
    netPY:      hasPy ? pySum(r => (Number(r.gross_open) || 0) - (Number(r.depn_open) || 0)) : 0,
  };
  const pyVal = (field: string): number => {
    const m = pyManual?.[field];
    return (m != null) ? Number(m) : (pyComputed[field] ?? 0);
  };
  const totalPYRow = new TableRow({
    cantSplit: true,
    height: { value: 320, rule: HeightRule.ATLEAST },
    children: [
      cell({ text: "Total — Previous year", w: FA_COLS[0], sz: SZ_BODY, bold: true, borders: BDR_SUB }),
      cell({ text: "",      w: FA_COLS[1], sz: SZ_BODY, borders: BDR_SUB }),
      nac(pyVal("gross_open"), FA_COLS[2], true, undefined, BDR_SUB),
      nac(pyVal("additions"),  FA_COLS[3], true, undefined, BDR_SUB),
      nac(pyVal("disposals"),  FA_COLS[4], true, undefined, BDR_SUB),
      nac(pyVal("grossClose"), FA_COLS[5], true, undefined, BDR_SUB),
      nac(pyVal("depn_open"),  FA_COLS[6], true, undefined, BDR_SUB),
      nac(pyVal("depn_add"),   FA_COLS[7], true, undefined, BDR_SUB),
      nac(pyVal("depn_disp"),  FA_COLS[8], true, undefined, BDR_SUB),
      nac(pyVal("depnClose"),  FA_COLS[9], true, undefined, BDR_SUB),
      nac(pyVal("netCY"),      FA_COLS[10], true, undefined, BDR_SUB),
      nac(pyVal("netPY"),      FA_COLS[11], true, undefined, BDR_SUB),
    ],
  });

  return new Table({
    width:        { size: TW_LS, type: WidthType.DXA },
    columnWidths: FA_COLS,
    rows: [
      noteTitleRow(FA_COLS, noteNumber, "Property, Plant and Equipment — Fixed Assets Schedule"),
      hdrRow,
      ...dataRows,
      totalCYRow,
      totalPYRow,
    ],
  });
}

// ─── RATIOS TABLE ─────────────────────────────────────────────────────────────
// Issue 3 — replicate the on-screen "NOTE - n : RATIO" note exactly:
//   NO | PARTICULARS | NUMERATOR / DENOMINATOR | Amount (₹) | CY | PY | Variance
// Each ratio = numerator row + denominator row + a "Text:" commentary row.
// Variance > +25% is shaded amber, < -25% red (same thresholds as the UI).
function ratioPrevFy(fy: string): string {
  const parts = (fy || "").split("-");
  if (parts.length !== 2) return fy;
  const startY = parseInt(parts[0], 10);
  const endRaw = parts[1];
  const prevEnd = endRaw.length === 2 ? String(startY).slice(-2) : String(startY);
  return `${startY - 1}-${prevEnd}`;
}

function buildRatiosTable(
  cyRatios: any,
  pyRatios: any,
  commentary?: Array<{ ratioId: number; text: string }>,
  fy?: string,
  ratioNoteNo?: number | null,
): Table {
  const cyResults = cyRatios ? computeAllRatios(cyRatios) : [];
  const pyResults = pyRatios ? computeAllRatios(pyRatios) : [];
  const pyById = new Map<number, typeof pyResults[number]>();
  for (const r of pyResults) pyById.set(r.id, r);
  const cmtById = new Map<number, string>();
  for (const c of (commentary ?? [])) if (c?.ratioId != null) cmtById.set(c.ratioId, c.text ?? "");

  // 7 columns summing to TW (10466)
  const RW = [460, 1850, 2300, 1900, 1250, 1250, 1456];
  // Issue 1 — the ratio note number continues the FS note sequence (last note + 1),
  // passed in from the caller; falls back to the static registry only if absent.
  const noteNo = ratioNoteNo ?? getNoteNo("ratios") ?? 31;
  const cyLbl  = fy ? `Current Year ${fy}`            : "Current Year";
  const pyLbl  = fy ? `Previous Year ${ratioPrevFy(fy)}` : "Previous Year";

  // Indian-grouped amount with 2 decimals (matches on-screen formatIndian).
  const fmtAmt = (v: number | null | undefined): string =>
    v == null ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Header helpers
  const hc = (t: string, w: number, align: AlignmentType = AlignmentType.CENTER) =>
    cell({ text: t, w, sz: SZ_SM, bold: true, color: BLACK, bg: BG_HDR, borders: BDR_NONE, align });
  // A vertically-merged (rowSpan 2) centred value cell.
  const spanCell = (text: string, w: number, opts: { bold?: boolean; color?: string; bg?: string; align?: AlignmentType } = {}) =>
    new TableCell({
      rowSpan: 2,
      width:   { size: w, type: WidthType.DXA },
      borders: BDR_ROW,
      shading: opts.bg ? { fill: opts.bg, type: ShadingType.CLEAR } : undefined,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 36, bottom: 36, left: 60, right: 60 },
      children: [new Paragraph({
        alignment: opts.align ?? AlignmentType.CENTER,
        spacing:   { before: 0, after: 0 },
        children:  [new TextRun({ text, font: FONT, size: SZ_SM, bold: opts.bold, color: opts.color ?? BLACK })],
      })],
    });

  const rows: TableRow[] = [];

  // Centred title — "NOTE - n : RATIO"
  rows.push(new TableRow({
    cantSplit: true,
    children: [new TableCell({
      columnSpan: 7,
      width:   { size: TW, type: WidthType.DXA },
      shading: { fill: BG_NOTE_HDR, type: ShadingType.CLEAR },
      borders: BDR_NONE,
      margins: { top: 100, bottom: 100, left: 100, right: 100 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing:   { before: 0, after: 0 },
        children:  [new TextRun({ text: `NOTE - ${noteNo} : RATIO`, font: FONT, size: SZ_HDR, bold: true, color: BLACK })],
      })],
    })],
  }));

  // Column header
  rows.push(new TableRow({
    tableHeader: true,
    children: [
      hc("No.", RW[0]),
      hc("Particulars", RW[1], AlignmentType.LEFT),
      hc("Numerator / Denominator", RW[2], AlignmentType.LEFT),
      hc("Amount (₹)", RW[3], AlignmentType.RIGHT),
      hc(cyLbl, RW[4]),
      hc(pyLbl, RW[5]),
      hc("Variance", RW[6]),
    ],
  }));

  const block = (
    no: number | string, name: string,
    numLabel: string, numVal: number | null,
    denLabel: string, denVal: number | null,
    cyDisp: string, pyDisp: string,
    cyComp: number | null, pyComp: number | null,
    cmt: string,
  ) => {
    const vStr = computeVariance(cyComp, pyComp);
    // Numerator row (NO, Particulars, CY, PY, Variance are row-spanned)
    // Issue 1 — Numerator/Denominator labels in BLACK (not grey/blue); the
    // Variance cell is NOT highlighted.
    rows.push(new TableRow({
      children: [
        spanCell(String(no), RW[0], { bold: true, color: NAVY }),
        spanCell(name, RW[1], { bold: true, align: AlignmentType.LEFT }),
        cell({ text: numLabel,        w: RW[2], sz: SZ_SM, color: BLACK, borders: BDR_ROW, padL: 100 }),
        cell({ text: fmtAmt(numVal),  w: RW[3], sz: SZ_SM, align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
        spanCell(cyDisp, RW[4], { bold: true, color: cyComp == null ? DK_GREY : BLACK }),
        spanCell(pyDisp, RW[5], { bold: true, color: pyComp == null ? DK_GREY : BLACK }),
        spanCell(vStr,   RW[6], { bold: true }),
      ],
    }));
    // Denominator row — only the two non-spanned columns
    rows.push(new TableRow({
      children: [
        cell({ text: denLabel,       w: RW[2], sz: SZ_SM, color: BLACK, borders: BDR_ROW, padL: 100 }),
        cell({ text: fmtAmt(denVal), w: RW[3], sz: SZ_SM, align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
      ],
    }));
    // Commentary row (full width)
    rows.push(new TableRow({
      children: [new TableCell({
        columnSpan: 7,
        width:   { size: TW, type: WidthType.DXA },
        shading: { fill: BG_TOT, type: ShadingType.CLEAR },
        borders: BDR_ROW,
        margins: { top: 30, bottom: 30, left: 100, right: 100 },
        // Issue 1 — show ONLY the commentary text (no "Text:" prefix label).
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new TextRun({ text: cmt || "", font: FONT, size: SZ_XS, color: BLACK }),
          ],
        })],
      })],
    }));
  };

  for (const cyR of cyResults) {
    const pyR = pyById.get(cyR.id);
    block(
      cyR.id, cyR.name,
      cyR.numerator.label, cyR.numerator.value,
      cyR.denominator.label, cyR.denominator.value,
      cyR.display, pyR?.display ?? "N.A.",
      cyR.computed, pyR?.computed ?? null,
      cmtById.get(cyR.id) ?? "",
    );
  }

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: RW,
    rows,
  });
}

// ─── Note row extraction helpers ─────────────────────────────────────────────

type NoteRowFmt = "amount" | "eps" | "integer";

interface NoteRow {
  label:   string;
  cy:      number;
  py:      number;
  style:   "data" | "subtotal" | "total" | "heading";
  fmt?:    NoteRowFmt;
  indent?: number;
}

function extractNoteRows(
  renderType: string,
  noteData: any,
  amounts: Record<string, { cy: number; py: number }>,
  fsCode: string,
  stage5Notes: any,
  expandSubGroups: boolean = false,
  collapsedGroups: Set<string> = new Set(),
): NoteRow[] {
  const totCy = amounts[fsCode]?.cy ?? 0;
  const totPy = amounts[fsCode]?.py ?? 0;
  const n = (v: any): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

  switch (renderType) {

    case "breakup": {
      const breakup: any[] = noteData?.breakup ?? [];
      if (!breakup.length) return [];

      // ── Pass 1: bucket all member rows by their group id (preserving order) ──
      const membersByGroup = new Map<string, any[]>();
      for (const r of breakup) {
        if (!r?.subgroup_id) continue;
        const bucket = membersByGroup.get(r.subgroup_id) ?? [];
        bucket.push(r);
        membersByGroup.set(r.subgroup_id, bucket);
      }

      // Pre-compute group totals from members
      const groupTotals = new Map<string, { cy: number; py: number }>();
      for (const [gid, members] of membersByGroup) {
        groupTotals.set(gid, {
          cy: members.reduce((s, m) => s + n(m.amount_cy), 0),
          py: members.reduce((s, m) => s + n(m.amount_py), 0),
        });
      }

      const rows: NoteRow[] = [];

      // ── Pass 2: iterate in array order, SKIP member rows at their position;
      //            emit members immediately after their group header — this
      //            mirrors exactly how the UI ListTable groups sub-rows ──────
      for (const r of breakup) {
        if (!r) continue;
        // Members are deferred — rendered right after their group header
        if (r.subgroup_id) continue;

        const label = String(r.description || r.label || "");

        if (r.is_group && r.id) {
          // GROUP header
          const gt = groupTotals.get(r.id) ?? { cy: n(r.amount_cy), py: n(r.amount_py) };
          if (gt.cy === 0 && gt.py === 0) continue;
          rows.push({ label, cy: gt.cy, py: gt.py, style: "subtotal" });
          // Issue 2 — COLLAPSED by default: show only the sub-group name +
          // total. Individual ledgers are emitted only when the export is run
          // with "Expand sub-groups" turned on AND this specific group was
          // NOT individually collapsed in the editor at Lock Preview time
          // (collapsedGroups carries the per-group ListTable state from
          // localStorage so the export mirrors what the locked preview shows).
          if (expandSubGroups && !collapsedGroups.has(r.id)) {
            // Emit members in their original relative order, indented
            for (const m of membersByGroup.get(r.id) ?? []) {
              const cyVal = n(m.amount_cy);
              const pyVal = n(m.amount_py);
              if (cyVal === 0 && pyVal === 0) continue;
              rows.push({
                label: String(m.description || m.label || ""),
                cy: cyVal, py: pyVal,
                style: "data", indent: 1,
              });
            }
          }
        } else {
          // Regular standalone row
          const cyVal = n(r.amount_cy);
          const pyVal = n(r.amount_py);
          if (cyVal === 0 && pyVal === 0) continue;
          const style: NoteRow["style"] = r.is_total ? "total" : r.is_sub_total ? "subtotal" : "data";
          rows.push({ label, cy: cyVal, py: pyVal, style });
        }
      }

      const hasExplicitTotal = breakup.some(r => r?.is_total);
      if (!hasExplicitTotal && rows.length > 0) {
        rows.push({ label: "Total", cy: totCy, py: totPy, style: "total" });
      }
      return rows;
    }

    case "shareCapital": {
      const authCy = n(noteData?.authorised_cy);
      const authPy = n(noteData?.authorised_py);
      return [
        { label: "Authorised Capital",                       cy: authCy, py: authPy, style: "data" },
        { label: "Issued, Subscribed and Paid-up Capital",   cy: totCy,  py: totPy,  style: "total" },
      ];
    }

    case "reserves": {
      // Issue 2(b) — ALWAYS emit every predefined line (matching the on-screen
      // Note structure), even when the value is blank / zero. Never hide rows.
      const genResCy   = n(noteData?.gen_reserve_cy);
      const genResPy   = n(noteData?.gen_reserve_py);
      const spCy       = n(noteData?.share_premium_cy);
      const spPy       = n(noteData?.share_premium_py);
      const npatCy     = n(stage5Notes?.pl?.eps?.npat);
      const npatPy     = n(stage5Notes?.pl?.eps?.npat_py);
      const deferCy    = n(noteData?.surplus_deferred_adj_cy);
      const deferPy    = n(noteData?.surplus_deferred_adj_py);
      const excessCy   = n(noteData?.surplus_excess_short_cy);
      const excessPy   = n(noteData?.surplus_excess_short_py);
      // Opening balance (CY) carries forward the prior-year closing of
      // Reserves & Surplus (= totPy face value) unless explicitly entered —
      // identical to the on-screen carry-forward rule.
      const surpOpenCy = (noteData?.surplus_opening_cy != null && noteData?.surplus_opening_cy !== "")
        ? n(noteData.surplus_opening_cy) : totPy;
      const surpOpenPy = (noteData?.surplus_opening_py != null && noteData?.surplus_opening_py !== "")
        ? n(noteData.surplus_opening_py) : 0;
      const subtotalACy = genResCy + spCy;
      const subtotalAPy = genResPy + spPy;
      const subtotalBCy = surpOpenCy + npatCy + deferCy + excessCy;
      const subtotalBPy = surpOpenPy + npatPy + deferPy + excessPy;
      return [
        { label: "1. General Reserve",                                       cy: genResCy,   py: genResPy,   style: "data" },
        { label: "2. Securities Premium",                                    cy: spCy,       py: spPy,       style: "data" },
        { label: "Sub-total [a]",                                            cy: subtotalACy, py: subtotalAPy, style: "subtotal" },
        { label: "Surplus in the Statement of Profit and Loss",              cy: 0,          py: 0,          style: "heading" },
        { label: "Opening balance",                                          cy: surpOpenCy, py: surpOpenPy, style: "data", indent: 1 },
        { label: "Add/(Less): Profit for the year",                          cy: npatCy,     py: npatPy,     style: "data", indent: 1 },
        { label: "Add/(Less): Adjustments for deferred tax",                 cy: deferCy,    py: deferPy,    style: "data", indent: 1 },
        { label: "Add/(Less): Excess/(Short) provision for income tax",      cy: excessCy,   py: excessPy,   style: "data", indent: 1 },
        { label: "Sub-total [b]",                                            cy: subtotalBCy, py: subtotalBPy, style: "subtotal" },
        { label: "Total — Reserves and Surplus (per BS)",                    cy: totCy,      py: totPy,      style: "total" },
      ];
    }

    case "dtFixed": {
      const deprExCy = n(noteData?.depr_excess_cy);
      const deprExPy = n(noteData?.depr_excess_py);
      const rows: NoteRow[] = [
        { label: "Excess of depreciation in books over IT Act", cy: deprExCy, py: deprExPy, style: "data" },
      ];
      for (const r of (noteData?.breakup ?? [])) {
        if (!r) continue;
        const label = String(r.description || r.label || "");
        const cyVal = n(r.amount_cy);
        const pyVal = n(r.amount_py);
        if (!label && cyVal === 0 && pyVal === 0) continue;
        rows.push({ label, cy: cyVal, py: pyVal, style: r.is_sub_total ? "subtotal" : "data" });
      }
      rows.push({ label: "Total", cy: totCy, py: totPy, style: "total" });
      return rows;
    }

    case "dtAsset": {
      const deprExCy = n(noteData?.depr_excess_cy);
      const deprExPy = n(noteData?.depr_excess_py);
      return [
        { label: "Excess of depreciation in IT Act over books", cy: deprExCy, py: deprExPy, style: "data" },
        { label: "Total", cy: totCy, py: totPy, style: "total" },
      ];
    }

    case "tradePayables": {
      const msmeCy = n(noteData?.msme_cy);
      const msmePy = n(noteData?.msme_py);
      const othCy  = noteData?.others_cy != null ? n(noteData.others_cy) : (totCy - msmeCy);
      const othPy  = noteData?.others_py != null ? n(noteData.others_py) : (totPy - msmePy);
      return [
        { label: "Due to Micro, Small and Medium Enterprises (MSME)", cy: msmeCy, py: msmePy, style: "data" },
        { label: "Due to others",                                      cy: othCy,  py: othPy,  style: "data" },
        { label: "Total",                                              cy: totCy,  py: totPy,  style: "total" },
      ];
    }

    case "tradeReceivables": {
      const gt6mCy = n(noteData?.gt6m_cy);
      const gt6mPy = n(noteData?.gt6m_py);
      const othCy  = noteData?.other_cy != null ? n(noteData.other_cy) : (totCy - gt6mCy);
      const othPy  = noteData?.other_py != null ? n(noteData.other_py) : (totPy - gt6mPy);
      return [
        { label: "Outstanding for more than 6 months", cy: gt6mCy, py: gt6mPy, style: "data" },
        { label: "Other receivables",                  cy: othCy,  py: othPy,  style: "data" },
        { label: "Total",                              cy: totCy,  py: totPy,  style: "total" },
      ];
    }

    case "costMaterials": {
      const openCy = n(noteData?.opening_cy);
      const openPy = n(noteData?.opening_py);
      const purCy  = n(noteData?.purchases_cy);
      const purPy  = n(noteData?.purchases_py);
      const closCy = n(noteData?.closing_cy);
      const closPy = n(noteData?.closing_py);
      return [
        { label: "Opening Stock of Raw Materials",       cy: openCy, py: openPy, style: "data" },
        { label: "Add: Purchases",                       cy: purCy,  py: purPy,  style: "data" },
        { label: "Less: Closing Stock of Raw Materials", cy: closCy, py: closPy, style: "data" },
        { label: "Cost of Materials Consumed",           cy: totCy,  py: totPy,  style: "total" },
      ];
    }

    case "changesInventory": {
      const fgClosCy  = n(noteData?.fg_close_cy);  const fgClosPy  = n(noteData?.fg_close_py);
      const wipClosCy = n(noteData?.wip_close_cy); const wipClosPy = n(noteData?.wip_close_py);
      const sitClosCy = n(noteData?.sit_close_cy); const sitClosPy = n(noteData?.sit_close_py);
      const fgOpenCy  = n(noteData?.fg_open_cy);   const fgOpenPy  = n(noteData?.fg_open_py);
      const wipOpenCy = n(noteData?.wip_open_cy);  const wipOpenPy = n(noteData?.wip_open_py);
      const sitOpenCy = n(noteData?.sit_open_cy);  const sitOpenPy = n(noteData?.sit_open_py);
      return [
        { label: "Closing Stock — Finished Goods",            cy: fgClosCy,  py: fgClosPy,  style: "data" },
        { label: "Closing Stock — Work-in-Progress",          cy: wipClosCy, py: wipClosPy, style: "data" },
        { label: "Closing Stock — Stock-in-Trade",            cy: sitClosCy, py: sitClosPy, style: "data" },
        { label: "Less: Opening Stock — Finished Goods",      cy: fgOpenCy,  py: fgOpenPy,  style: "data" },
        { label: "Less: Opening Stock — Work-in-Progress",    cy: wipOpenCy, py: wipOpenPy, style: "data" },
        { label: "Less: Opening Stock — Stock-in-Trade",      cy: sitOpenCy, py: sitOpenPy, style: "data" },
        { label: "Net Change in Inventories",                 cy: totCy,     py: totPy,     style: "total" },
      ];
    }

    case "eps": {
      const npatCy  = n(noteData?.npat);
      const npatPy  = n(noteData?.npat_py);
      const nomCy   = n(noteData?.nominal_value)    || 10;
      const nomPy   = n(noteData?.nominal_value_py) || nomCy;
      const wavgCy  = n(noteData?.weighted_avg_shares);
      const wavgPy  = n(noteData?.weighted_avg_shares_py);
      const basicCy = n(noteData?.basic);
      const basicPy = n(noteData?.basic_py);
      const dilCy   = n(noteData?.diluted) || basicCy;
      const dilPy   = n(noteData?.diluted_py);
      return [
        { label: "Net Profit After Tax (₹)",           cy: npatCy,  py: npatPy,  style: "data" },
        { label: "Nominal Value per Share (₹)",         cy: nomCy,   py: nomPy,   style: "data",  fmt: "eps" },
        { label: "Weighted Avg. No. of Equity Shares",  cy: wavgCy,  py: wavgPy,  style: "data",  fmt: "integer" },
        { label: "Basic EPS (₹)",                       cy: basicCy, py: basicPy, style: "total", fmt: "eps" },
        { label: "Diluted EPS (₹)",                     cy: dilCy,   py: dilPy,   style: "total", fmt: "eps" },
      ];
    }

    default:
      return [];
  }
}

// ─── Note 2 — Share Capital (multi-table) ────────────────────────────────────
// Issue 2(a): export the FULL Share Capital note exactly as entered on screen:
//   • Main amounts table  — (a) Authorised + (b) Issued/subscribed/paid-up + Total
//   • (a) Reconciliation of number of shares outstanding  (No. + Amount, CY+PY)
//   • (b) Particulars of shareholders holding more than 5%
//   • (c) Promoters' shareholding (with % change + total)
function buildShareCapitalNote(
  noteNumber: string,
  title: string,
  noteData: any,
  totCy: number,
  totPy: number,
  cyYearNum: number,
  pyYearNum: number,
): (Table | Paragraph)[] {
  const num = (v: any): number => {
    if (v == null || v === "") return 0;
    const x = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(x) ? x : 0;
  };
  const fmtShares = (v: number) => (v === 0 ? "—" : Math.round(Math.abs(v)).toLocaleString("en-IN"));
  const fmtPct    = (v: number) => (v === 0 ? "—" : `${v.toFixed(2)}%`);
  const fmtPctChg = (v: number) => (v === 0 ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

  const cyDateLbl = `As on 31.03.${cyYearNum}`;
  const pyDateLbl = `As on 31.03.${pyYearNum}`;
  const cyLbl     = `FY ${cyYearNum - 1}-${String(cyYearNum).slice(-2)}`;
  const pyLbl     = `FY ${pyYearNum - 1}-${String(pyYearNum).slice(-2)}`;

  // Header cell for grouped sub-table headers (rowSpan / colSpan aware).
  // 2026-06-18 fix (Issue 2 — "No. of Shares" / "Amount" alignment):
  //   default alignment switched to RIGHT so column headers align with the
  //   right-aligned numeric data underneath them. Auditor reading the
  //   Reconciliation / Promoters / 5% holders tables now sees the heading
  //   directly above its column total.
  // 2026-06-18 fix (Issue 3 — "subgroups should not be darker"):
  //   the shading was BG_HDR (#F2F6F7 — light grey). Removed entirely so
  //   the sub-table headers render on a WHITE background. Bold text + the
  //   table's natural row borders preserve visual hierarchy.
  const hCell = (text: string, w: number, opts: { colSpan?: number; rowSpan?: number; align?: AlignmentType } = {}): TableCell =>
    new TableCell({
      ...(opts.colSpan ? { columnSpan: opts.colSpan } : {}),
      ...(opts.rowSpan ? { rowSpan: opts.rowSpan } : {}),
      width:   { size: w, type: WidthType.DXA },
      borders: { top: bNone, bottom: bThin, left: bNone, right: bNone },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: opts.align ?? AlignmentType.RIGHT,
        spacing:   { before: 0, after: 0 },
        children:  [new TextRun({ text, font: FONT, size: SZ_XS, bold: true, color: BLACK })],
      })],
    });

  // Full-width bold label row inside the main 3-col table.
  // 2026-06-18 fix (Issue 3 — "subgroups should not be darker"): removed the
  // BG_TOT shading. The sub-group labels ("(a) Authorised shares", "(b)
  // Issued, subscribed and fully paid up shares") now render on WHITE with
  // bold black text and a thin bottom rule (BDR_ROW) for hierarchy.
  const labelRow3 = (text: string): TableRow => new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        columnSpan: 3,
        width:   { size: TW, type: WidthType.DXA },
        borders: BDR_ROW,
        margins: { top: 36, bottom: 36, left: 120, right: 80 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text, font: FONT, size: SZ_SM, bold: true, color: BLACK })],
        })],
      }),
    ],
  });

  const subHeading = (text: string): Paragraph => new Paragraph({
    spacing:  { before: 200, after: 60 },
    keepNext: true,
    children: [new TextRun({ text, font: FONT, size: SZ_SM, bold: true, color: NAVY })],
  });

  const out: (Table | Paragraph)[] = [];

  // ── 1. Main amounts table ──────────────────────────────────────────────────
  const authCy   = num(noteData?.authorised_cy);
  const authPy   = num(noteData?.authorised_py);
  const authText = String(noteData?.authorised_text || "").trim() || "Equity shares of face value ₹10 each";
  const issText  = String(noteData?.issued_text || "").trim() || "Equity shares of face value ₹10 each, fully paid up";

  out.push(new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [NW_DESC, NW_CY, NW_PY],
    rows: [
      noteTitleRow([NW_DESC, NW_CY, NW_PY], noteNumber, title),
      noteHdr3(cyDateLbl, pyDateLbl),
      labelRow3("(a) Authorised shares"),
      noteRow3(authText, authCy, authPy, 1, "data"),
      labelRow3("(b) Issued, subscribed and fully paid up shares"),
      noteRow3(issText, totCy, totPy, 1, "data"),
      noteRow3("Total", totCy, totPy, 0, "total"),
    ],
  }));

  // ── 2. (a) Reconciliation of number of shares outstanding ───────────────────
  const RC = [3666, 1700, 1700, 1700, 1700];
  const openCyNum = num(noteData?.recon_open_cy_num);
  const moveCyNum = num(noteData?.recon_move_cy_num);
  const openPyNum = num(noteData?.recon_open_py_num);
  const movePyNum = num(noteData?.recon_move_py_num);
  const openCyAmt = num(noteData?.recon_open_cy_amt);
  const moveCyAmt = num(noteData?.recon_move_cy_amt);
  const openPyAmt = num(noteData?.recon_open_py_amt);
  const movePyAmt = num(noteData?.recon_move_py_amt);
  const closeCyNum = openCyNum + moveCyNum;
  const closePyNum = openPyNum + movePyNum;
  const closeCyAmt = openCyAmt + moveCyAmt;
  const closePyAmt = openPyAmt + movePyAmt;

  const reconRow = (label: string, cyN: number, cyA: number, pyN: number, pyA: number, style: "data" | "total" = "data"): TableRow => {
    const bg   = undefined; // Issue 1 — white rows
    const bdr  = style === "total" ? BDR_GRAND : BDR_ROW;
    const bold = style === "total";
    return new TableRow({
      children: [
        cell({ text: label, w: RC[0], bold, bg, borders: bdr, padL: 120 }),
        cell({ text: fmtShares(cyN), w: RC[1], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold, bg, borders: bdr }),
        cell({ text: fmt(cyA),       w: RC[2], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold, bg, borders: bdr }),
        cell({ text: fmtShares(pyN), w: RC[3], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold, bg, borders: bdr }),
        cell({ text: fmt(pyA),       w: RC[4], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold, bg, borders: bdr }),
      ],
    });
  };

  out.push(subHeading("(a) Reconciliation of number of shares outstanding"));
  out.push(new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: RC,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hCell("Particulars", RC[0], { rowSpan: 2, align: AlignmentType.LEFT }),
          hCell(cyLbl, RC[1] + RC[2], { colSpan: 2 }),
          hCell(pyLbl, RC[3] + RC[4], { colSpan: 2 }),
        ],
      }),
      new TableRow({
        tableHeader: true,
        children: [
          hCell("No. of Shares", RC[1]),
          hCell("Amount", RC[2]),
          hCell("No. of Shares", RC[3]),
          hCell("Amount", RC[4]),
        ],
      }),
      reconRow("Opening balance at the beginning of the year", openCyNum, openCyAmt, openPyNum, openPyAmt),
      reconRow("Add/(Less): Movement during the year",         moveCyNum, moveCyAmt, movePyNum, movePyAmt),
      reconRow("Outstanding at the end of the year",           closeCyNum, closeCyAmt, closePyNum, closePyAmt, "total"),
    ],
  }));

  // ── 3. (b) Shareholders holding more than 5% ────────────────────────────────
  const SH = [3666, 1700, 1700, 1700, 1700];
  const shareholders: any[] = Array.isArray(noteData?.shareholders) ? noteData.shareholders : [];
  const shRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        hCell("Name of shareholder", SH[0], { rowSpan: 2, align: AlignmentType.LEFT }),
        hCell(cyDateLbl, SH[1] + SH[2], { colSpan: 2 }),
        hCell(pyDateLbl, SH[3] + SH[4], { colSpan: 2 }),
      ],
    }),
    new TableRow({
      tableHeader: true,
      children: [
        hCell("No. of Shares", SH[1]),
        hCell("% of Holding", SH[2]),
        hCell("No. of Shares", SH[3]),
        hCell("% of Holding", SH[4]),
      ],
    }),
  ];
  if (shareholders.length === 0) {
    shRows.push(new TableRow({
      children: [cell({ text: "No shareholders holding more than 5% of shares.", w: TW, colSpan: 5, italic: true, color: DK_GREY, borders: BDR_ROW, padL: 120 })],
    }));
  } else {
    for (const r of shareholders) {
      shRows.push(new TableRow({
        children: [
          cell({ text: String(r?.name || "—"), w: SH[0], borders: BDR_ROW, padL: 120 }),
          cell({ text: fmtShares(num(r?.cy_shares)), w: SH[1], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtPct(num(r?.cy_pct)),       w: SH[2], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtShares(num(r?.py_shares)), w: SH[3], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtPct(num(r?.py_pct)),       w: SH[4], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
        ],
      }));
    }
  }
  out.push(subHeading("(b) Particulars of shareholders holding more than 5% shares"));
  out.push(new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: SH, rows: shRows }));

  // ── 4. (c) Promoters' shareholding ──────────────────────────────────────────
  const PR = [2966, 1500, 1500, 1500, 1500, 1500];
  const promoters: any[] = Array.isArray(noteData?.promoters_list) ? noteData.promoters_list : [];
  const prRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        hCell("Promoter name", PR[0], { rowSpan: 2, align: AlignmentType.LEFT }),
        hCell(cyDateLbl, PR[1] + PR[2], { colSpan: 2 }),
        hCell(pyDateLbl, PR[3] + PR[4], { colSpan: 2 }),
        hCell("% Change", PR[5], { rowSpan: 2 }),
      ],
    }),
    new TableRow({
      tableHeader: true,
      children: [
        hCell("No. of Shares", PR[1]),
        hCell("%", PR[2]),
        hCell("No. of Shares", PR[3]),
        hCell("%", PR[4]),
      ],
    }),
  ];
  if (promoters.length === 0) {
    prRows.push(new TableRow({
      children: [cell({ text: "No promoter shareholding recorded.", w: TW, colSpan: 6, italic: true, color: DK_GREY, borders: BDR_ROW, padL: 120 })],
    }));
  } else {
    let tCyS = 0, tCyP = 0, tPyS = 0, tPyP = 0;
    for (const r of promoters) {
      const cyS = num(r?.cy_shares), cyP = num(r?.cy_pct), pyS = num(r?.py_shares), pyP = num(r?.py_pct);
      tCyS += cyS; tCyP += cyP; tPyS += pyS; tPyP += pyP;
      prRows.push(new TableRow({
        children: [
          cell({ text: String(r?.name || "—"), w: PR[0], borders: BDR_ROW, padL: 120 }),
          cell({ text: fmtShares(cyS), w: PR[1], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtPct(cyP),    w: PR[2], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtShares(pyS), w: PR[3], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtPct(pyP),    w: PR[4], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
          cell({ text: fmtPctChg(cyP - pyP), w: PR[5], align: AlignmentType.RIGHT, padR: AMT_PAD_R, borders: BDR_ROW }),
        ],
      }));
    }
    prRows.push(new TableRow({
      children: [
        cell({ text: "Total", w: PR[0], bold: true, borders: BDR_GRAND, padL: 120 }),
        cell({ text: fmtShares(tCyS), w: PR[1], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold: true, borders: BDR_GRAND }),
        cell({ text: fmtPct(tCyP),    w: PR[2], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold: true, borders: BDR_GRAND }),
        cell({ text: fmtShares(tPyS), w: PR[3], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold: true, borders: BDR_GRAND }),
        cell({ text: fmtPct(tPyP),    w: PR[4], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold: true, borders: BDR_GRAND }),
        cell({ text: fmtPctChg(tCyP - tPyP), w: PR[5], align: AlignmentType.RIGHT, padR: AMT_PAD_R, bold: true, borders: BDR_GRAND }),
      ],
    }));
  }
  out.push(subHeading("(c) Promoters' shareholding"));
  out.push(new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: PR, rows: prRows }));

  return out;
}

function buildNoteTableFromRows(
  noteNumber: string,
  title: string,
  rows: NoteRow[],
  cyYear: string,
  pyYear: string,
): Table {
  const fmtVal = (v: number, fmtType?: NoteRowFmt): string => {
    if (fmtType === "eps")     return fmtEps(v);
    if (fmtType === "integer") {
      if (!Number.isFinite(v) || v === 0) return "—";
      return Math.round(Math.abs(v)).toLocaleString("en-IN");
    }
    return fmt(v);
  };

  // Issue 3 — keep the WHOLE note on one page: every row "keeps with next"
  // except the last, so Word moves the entire note to the next page when it
  // doesn't fit (no manual blank lines, no oversized top margin).
  const tableRows: TableRow[] = [
    noteTitleRow([NW_DESC, NW_CY, NW_PY], noteNumber, title, true),
    noteHdr3(cyYear, pyYear, true),
  ];

  const lastIdx = rows.length - 1;
  rows.forEach((row, idx) => {
    const kn = idx < lastIdx; // all but the final row keep with next
    // Heading-only row (e.g. "Surplus in the Statement of Profit and Loss") —
    // italic label spanning the row with blank value cells.
    if (row.style === "heading") {
      tableRows.push(new TableRow({
        cantSplit: true,
        height: { value: 320, rule: HeightRule.ATLEAST },
        children: [
          cell({ text: row.label, w: NW_DESC, italic: true, color: DK_GREY, borders: BDR_ROW, padL: 160, keepNext: kn }),
          cell({ text: "", w: NW_CY, borders: BDR_ROW, keepNext: kn }),
          cell({ text: "", w: NW_PY, borders: BDR_ROW, keepNext: kn }),
        ],
      }));
      return;
    }
    // Issue 1 — every note row is WHITE (no zebra striping, no subtotal/total
    // shading). Totals stay legible via bold text + their rule borders.
    const bg   = undefined;
    const bdr  = row.style === "total" ? BDR_GRAND : row.style === "subtotal" ? BDR_SUB : BDR_ROW;
    const bold = row.style !== "data";
    tableRows.push(new TableRow({
      cantSplit: true,
      height: { value: 340, rule: HeightRule.ATLEAST },
      children: [
        cell({ text: row.label,               w: NW_DESC, bold, bg, borders: bdr, indent: row.indent ?? 0, padL: row.indent ? 80 : 160, keepNext: kn }),
        cell({ text: fmtVal(row.cy, row.fmt), w: NW_CY, align: AlignmentType.RIGHT, padL: 20, padR: 140, bold, bg, borders: bdr, keepNext: kn }),
        cell({ text: fmtVal(row.py, row.fmt), w: NW_PY, align: AlignmentType.RIGHT, padL: 20, padR: 140, bold, bg, borders: bdr, keepNext: kn }),
      ],
    }));
  });

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: [NW_DESC, NW_CY, NW_PY],
    rows:         tableRows,
  });
}

// ─── Note metadata — dataKey matches actual stage5_notes JSONB keys ───────────
type NoteRenderType =
  | "breakup" | "shareCapital" | "reserves" | "dtFixed" | "dtAsset"
  | "tradePayables" | "tradeReceivables" | "costMaterials" | "changesInventory" | "eps";

const CORP_NOTE_META: Array<{
  dataKey:     string;
  fsCode:      string;
  section:     "bs_liab" | "bs_asset" | "pl";
  title:       string;
  renderType:  NoteRenderType;
  isFA?:       boolean;
}> = [
  { dataKey: "share_capital",        fsCode: "BS_EQ_SC",    section: "bs_liab",  title: "Share Capital",                                 renderType: "shareCapital" },
  { dataKey: "reserves_surplus",     fsCode: "BS_EQ_RS",    section: "bs_liab",  title: "Reserves and Surplus",                          renderType: "reserves" },
  { dataKey: "lt_borrowings",        fsCode: "BS_NCL_LTB",  section: "bs_liab",  title: "Long-term Borrowings",                          renderType: "breakup" },
  { dataKey: "deferred_tax_liab",    fsCode: "BS_NCL_DTL",  section: "bs_liab",  title: "Deferred Tax Liabilities (Net)",                renderType: "dtFixed" },
  { dataKey: "other_lt_liabilities", fsCode: "BS_NCL_OLT",  section: "bs_liab",  title: "Other Long-term Liabilities",                   renderType: "breakup" },
  { dataKey: "lt_provisions",        fsCode: "BS_NCL_LTP",  section: "bs_liab",  title: "Long-term Provisions",                          renderType: "breakup" },
  { dataKey: "st_borrowings",        fsCode: "BS_CL_STB",   section: "bs_liab",  title: "Short-term Borrowings",                         renderType: "breakup" },
  { dataKey: "trade_payables",       fsCode: "BS_CL_TP",    section: "bs_liab",  title: "Trade Payables",                                renderType: "tradePayables" },
  { dataKey: "other_curr_liab",      fsCode: "BS_CL_OCL",   section: "bs_liab",  title: "Other Current Liabilities",                     renderType: "breakup" },
  { dataKey: "st_provisions",        fsCode: "BS_CL_STP",   section: "bs_liab",  title: "Short-term Provisions",                         renderType: "breakup" },
  { dataKey: "ppe",                  fsCode: "BS_NCA_FA",   section: "bs_asset", title: "Property, Plant and Equipment",                 renderType: "breakup", isFA: true },
  { dataKey: "nc_investments",       fsCode: "BS_NCA_INV",  section: "bs_asset", title: "Non-current Investments",                       renderType: "breakup" },
  { dataKey: "deferred_tax_asset",   fsCode: "BS_NCA_DTA",  section: "bs_asset", title: "Deferred Tax Assets (Net)",                     renderType: "dtAsset" },
  { dataKey: "lt_loans",             fsCode: "BS_NCA_LLA",  section: "bs_asset", title: "Long-term Loans and Advances",                  renderType: "breakup" },
  { dataKey: "other_nc_assets",      fsCode: "BS_NCA_ONA",  section: "bs_asset", title: "Other Non-current Assets",                      renderType: "breakup" },
  { dataKey: "curr_investments",     fsCode: "BS_CA_CI",    section: "bs_asset", title: "Current Investments",                           renderType: "breakup" },
  { dataKey: "inventories",          fsCode: "BS_CA_INV",   section: "bs_asset", title: "Inventories",                                   renderType: "breakup" },
  { dataKey: "trade_receivables",    fsCode: "BS_CA_TR",    section: "bs_asset", title: "Trade Receivables",                             renderType: "tradeReceivables" },
  { dataKey: "cash_bank",            fsCode: "BS_CA_CCE",   section: "bs_asset", title: "Cash and Bank Balances",                        renderType: "breakup" },
  { dataKey: "st_loans",             fsCode: "BS_CA_SLA",   section: "bs_asset", title: "Short-term Loans and Advances",                 renderType: "breakup" },
  { dataKey: "other_curr_assets",    fsCode: "BS_CA_OCA",   section: "bs_asset", title: "Other Current Assets",                          renderType: "breakup" },
  { dataKey: "revenue_from_ops",     fsCode: "PL_REV_OPS",  section: "pl",       title: "Revenue from Operations",                       renderType: "breakup" },
  { dataKey: "other_income",         fsCode: "PL_REV_OI",   section: "pl",       title: "Other Income",                                  renderType: "breakup" },
  { dataKey: "cost_materials",       fsCode: "PL_EXP_MAT",  section: "pl",       title: "Cost of Materials Consumed",                    renderType: "costMaterials" },
  { dataKey: "purchases_stock",      fsCode: "PL_EXP_SIT",  section: "pl",       title: "Purchases of Stock-in-Trade",                   renderType: "breakup" },
  { dataKey: "changes_inventory",    fsCode: "PL_EXP_CII",  section: "pl",       title: "Changes in Inventories of FG / WIP / SIT",     renderType: "changesInventory" },
  { dataKey: "employee_benefits",    fsCode: "PL_EXP_EMP",  section: "pl",       title: "Employee Benefits Expense",                     renderType: "breakup" },
  { dataKey: "finance_costs",        fsCode: "PL_EXP_FIN",  section: "pl",       title: "Finance Costs",                                 renderType: "breakup" },
  { dataKey: "other_expenses",       fsCode: "PL_EXP_OTH",  section: "pl",       title: "Other Expenses",                                renderType: "breakup" },
  { dataKey: "eps",                  fsCode: "PL_EPS_B",    section: "pl",       title: "Earnings Per Share",                            renderType: "eps" },
];

// ─── PUBLIC API ───────────────────────────────────────────────────────────────
export interface CorpDocxParams {
  engagement: any;
  /** Pre-processed amounts — all positive face values. Same as corpAmounts in PipelineFinancialStatements. */
  amounts: Record<string, { cy: number; py: number }>;
  /** FS code → display note number. Same as corpNoteNos in PipelineFinancialStatements. */
  noteNumbers: Record<string, number | null | undefined>;
  cyYear: number;
  pyYear: number;
  /** Signature block data */
  signature: CorpSigData;
  /** Font name for the export (default "Arial") */
  font?: string;
  /** stage5_notes JSONB from audit_engagements.stage5_notes */
  stage5Notes?: {
    bs_liab?: Record<string, { breakup?: BreakupRow[]; [k: string]: any }>;
    bs_asset?: Record<string, { breakup?: BreakupRow[]; [k: string]: any }>;
    pl?:       Record<string, { breakup?: BreakupRow[]; [k: string]: any }>;
    fa?:       { rows?: FARow[]; py_manual?: Record<string, number | null> | null };
  } | null;
  /** stage7_ratios CY and PY inputs (+ optional per-ratio commentary) */
  ratios?: { cy: any; py: any; commentary?: Array<{ ratioId: number; text: string }> } | null;
  /** When true, breakup notes list every ledger inside each sub-group.
   *  When false (default), only the sub-group name + total are exported. */
  expandSubGroups?: boolean;
  /** Prior-year engagement's FA rows — used to compute the FA "Total —
   *  Previous year" row exactly as the on-screen grid does (pyComputed). */
  faPyRows?: FARow[] | null;
  /** Corporate Lock Preview parity with NCE: when true, notes whose CY and
   *  PY totals both collapse to near-zero are skipped from the export. The
   *  on-screen locked preview already hides them; this keeps the DOCX in
   *  sync. Mirrors NCE's `hideBlankNoteRows`. */
  hideBlankNoteRows?: boolean;
  /** Corporate Lock Preview parity with NCE: keys (note numbers as strings)
   *  of notes the auditor had collapsed in the editor at lock-time. These
   *  notes are dropped from the export — the locked preview drops them too. */
  collapsedNotes?: Set<string>;
  /** Corporate Lock Preview parity with NCE: per-group ListTable IDs that
   *  the auditor had collapsed at lock-time. Collapsed groups emit only the
   *  group header + total in the export, suppressing member rows. */
  collapsedGroups?: Set<string>;
}

export async function generateCorporateFinancialsDocx(params: CorpDocxParams): Promise<void> {
  const {
    engagement,
    amounts,
    noteNumbers,
    cyYear,
    pyYear,
    signature,
    stage5Notes,
    ratios,
  } = params;
  const expandSubGroups = params.expandSubGroups ?? false;

  // Apply selected font
  FONT = params.font ?? "Arial";

  // Sync unit scale
  _exportDivisor = getActiveFsDivisor();
  const scaleMeta  = FS_SCALES.find(s => s.divisor === _exportDivisor) ?? FS_SCALES[0];
  _exportSuffix    = scaleMeta.suffix;
  _exportUnit      = scaleMeta.suffix.replace(/^\(|\)$/g, "");

  const entityName = engagement?.clients?.name ?? "Entity Name";
  const fy         = engagement?.financial_year ?? `${cyYear - 1}-${String(cyYear).slice(-2)}`;
  const cyLabel    = String(cyYear);
  const pyLabel    = String(pyYear);

  // Page 1: Balance Sheet
  const bsTable  = buildBSTable(amounts, noteNumbers, cyLabel, pyLabel, entityName);

  // Page 2: P&L
  const plTable  = buildPLTable(amounts, noteNumbers, cyLabel, pyLabel, entityName);

  // Signature (built fresh for each page — can't reuse Table instances)
  const sigBlock = () => buildCorpSignatureTable(signature, entityName);

  // Note 1: Accounting Policies
  const note1Paras = buildNote1Section(entityName, cyLabel);

  // Notes 2–N: from stage5_notes (sorted by note number ascending)
  // 2026-06-18 fix (Issue 4 — blank pages): the inter-note spacer used
  // `before: 720` (36pt) — combined with keepNext:true, Word frequently
  // pushed the next note onto a fresh page even when there was room on
  // the current one, then left the bottom of the previous page blank.
  // Dropped the gap to 200 DXA (10pt) and removed keepNext so notes flow
  // continuously and the renderer can fill each page before breaking.
  // 2026-07-20 (V J Desai — Word export polish, Items 4 & 17): inter-note
  // spacer trimmed from 10pt to 6pt so notes read as a compact continuous
  // series without excessive vertical air between them, matching how
  // audit-report notes flow. keepLines/keepNext on note title rows still
  // prevent bad splits — this only tightens *good* layouts.
  const spacer = () => new Paragraph({ spacing: { before: 120, after: 0 }, children: [] });
  // Issue 1 — each numbered note must START ON A NEW PAGE so it is never
  // rendered in continuation of the previous note (e.g. Note 2 — Share
  // Capital must not flow directly after Note 1 — Accounting Policies).
  const pageBreak = () => new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] });

  const faRows = stage5Notes?.fa?.rows ?? [];
  let faRenderedAsNote = false;

  // Collect notes with their numbers + which statement they belong to.
  const pendingNotes: Array<{ noteNo: number; section: "bs" | "pl"; elements: (Table | Paragraph)[] }> = [];

  // Corporate Lock Preview parity with NCE — pull the three preview-related
  // filters out of params with sane defaults. `collapsedNotes` is keyed by
  // noteNo (as String) which matches what NoteCard writes to localStorage.
  const hideBlankNoteRows = params.hideBlankNoteRows ?? false;
  const collapsedNotes    = params.collapsedNotes    ?? new Set<string>();
  const collapsedGroups   = params.collapsedGroups   ?? new Set<string>();

  for (const meta of CORP_NOTE_META) {
    const noteNo = noteNumbers[meta.fsCode];
    if (!noteNo) continue;

    if (meta.isFA) {
      faRenderedAsNote = true;
      continue;  // rendered in separate landscape section below
    }

    const sectionData = (stage5Notes as any)?.[meta.section];
    const noteData    = sectionData?.[meta.dataKey];
    const stmt: "bs" | "pl" = meta.section === "pl" ? "pl" : "bs";

    const totCy = amounts[meta.fsCode]?.cy ?? 0;
    const totPy = amounts[meta.fsCode]?.py ?? 0;

    // Lock Preview filter — drop notes the auditor had collapsed in the
    // editor at lock-time. Mirrors the on-screen popup behaviour.
    if (collapsedNotes.has(String(noteNo))) continue;

    // Lock Preview filter — drop notes whose CY and PY totals are both
    // essentially zero. Mirrors NCE's `hideBlankNoteRows` semantics so
    // the locked export matches the locked preview's hideEmpty behaviour.
    if (hideBlankNoteRows && Math.abs(totCy) < 1 && Math.abs(totPy) < 1) continue;

    // Issue 2(a) — Share Capital is a multi-table note (main amounts +
    // reconciliation of shares + shareholders >5% + promoters), so it gets a
    // dedicated builder rather than the single-table NoteRow path.
    if (meta.renderType === "shareCapital") {
      const els = buildShareCapitalNote(String(noteNo), meta.title, noteData, totCy, totPy, cyYear, pyYear);
      if (els.length > 0) pendingNotes.push({ noteNo, section: stmt, elements: els });
      continue;
    }

    const rows = extractNoteRows(meta.renderType, noteData, amounts, meta.fsCode, stage5Notes, expandSubGroups, collapsedGroups);
    if (rows.length === 0) continue;

    // Issue 5 — every note's amount columns are headed "As on 31.03.YYYY"
    // (both BS and P&L notes), instead of "As at 31 Mar …" / "Year ended 31 Mar …".
    const cyFull  = `As on 31.03.${cyLabel}`;
    const pyFull  = `As on 31.03.${pyLabel}`;

    pendingNotes.push({
      noteNo,
      section: stmt,
      elements: [buildNoteTableFromRows(String(noteNo), meta.title, rows, cyFull, pyFull)],
    });
  }

  // Issues 1 & 2 — split notes by statement so each set lives in its own
  // section with its own repeating page header. Sort ascending first.
  pendingNotes.sort((a, b) => a.noteNo - b.noteNo);
  const bsNotes = pendingNotes.filter(p => p.section === "bs");
  const plNotes = pendingNotes.filter(p => p.section === "pl");

  // BS-notes section body: starts with Note 2 (Note 1 lives in its own section
  // above so the "Notes to Balance Sheet …" running header DOES NOT appear on
  // the Accounting Policies pages). Subsequent BS notes flow continuously.
  const bsNotesChildren: (Table | Paragraph)[] = [];
  bsNotes.forEach((item, idx) => {
    if (idx === 0) bsNotesChildren.push(...item.elements);
    else           bsNotesChildren.push(spacer(), ...item.elements);
  });
  // P&L-notes section body: the section break already starts a fresh page.
  const plNotesChildren: (Table | Paragraph)[] = [];
  plNotes.forEach((item, idx) => {
    if (idx === 0) plNotesChildren.push(...item.elements);
    else           plNotesChildren.push(spacer(), ...item.elements);
  });

  // Ratios
  const hasRatios = ratios && (ratios.cy || ratios.py);

  // Repeating heading lines for the notes sections.
  const bsNotesSubtitle = `Notes to Balance Sheet as at 31st March, ${cyYear}`;
  const plNotesSubtitle = `Notes Profit & Loss A/c. for Accounting year ${pyYear} - ${cyYear}`;

  // Border sits close to the page edge so the running-header client name
  // (positioned in the top margin) renders INSIDE the visible page rectangle.
  const _pgBdr = {
    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
    pageBorderTop:    { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 6 },
    pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 6 },
    pageBorderLeft:   { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 6 },
    pageBorderRight:  { style: BorderStyle.SINGLE, size: 12, color: BG_HDR, space: 6 },
  };
  const portraitProps = {
    size:    { width: A4_W, height: A4_H },
    margin:  { top: MARG_T, right: MARG_H, bottom: MARG_B, left: MARG_H, header: 280, footer: 280 },
    borders: _pgBdr,
  };
  const landscapeProps = {
    size:    { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE },
    margin:  { top: MARG_T, right: MARG_LS, bottom: MARG_B, left: MARG_LS, header: 280, footer: 280 },
    borders: _pgBdr,
  };

  // Running header ONLY on schedule/notes sections (never on the BS/P&L faces);
  // no footer anywhere.
  const hdr = (subtitle?: string) => ({ headers: { default: makeHeader(entityName, subtitle) } });
  // 2026-07-20 (V J Desai — Word export polish, Item 14): tighter breathing
  // room between the last BS/P&L row and the signature block. Was 8pt,
  // dropped to ~5pt — enough separation for readability without leaving a
  // conspicuous gap on the printed page.
  const sigSpacer = () => new Paragraph({ spacing: { before: 100 }, children: [] });

  // Build sections
  const sections: any[] = [
    // Balance Sheet face — NO running header, NO footer.
    { properties: { page: portraitProps }, children: [bsTable, sigSpacer(), sigBlock()] },
    // P&L face — NO running header, NO footer.
    { properties: { page: portraitProps }, children: [plTable, sigSpacer(), sigBlock()] },
    // Note 1 (Accounting Policies) — own section with client-name header only;
    // the "Notes to Balance Sheet …" subtitle is intentionally NOT shown here.
    { properties: { page: portraitProps }, ...hdr(), children: [...note1Paras] },
    // Notes to Balance Sheet (Notes 2..N)
    { properties: { page: portraitProps }, ...hdr(bsNotesSubtitle), children: bsNotesChildren },
  ];

  // Notes Profit & Loss — CONTINUOUS section break (no forced new page) so the
  // P&L notes flow on the same page where BS notes end. An inline bold heading
  // ("Notes Profit & Loss A/c. for Accounting year YYYY - YYYY") introduces the
  // P&L notes at the transition point. On subsequent pages the section's own
  // running header takes over.
  //
  // 2026-06-18 fix (Issue 4 — blank pages): a section consisting of only an
  // inline heading + an empty body left a near-blank page with just the
  // running header. Guard on plNotesChildren.length so the section is added
  // ONLY when there is actual P&L-note content to render. The earlier
  // `plNotes.length > 0` check passed even when the underlying note rows
  // resolved to empty arrays (e.g. revenue mapped but no breakup data).
  if (plNotes.length > 0 && plNotesChildren.length > 0) {
    const inlinePlHeading = new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing:   { before: 200, after: 100 },
      keepNext:  true,
      keepLines: true,
      children:  [new TextRun({ text: plNotesSubtitle, font: FONT, size: SZ_HDR, bold: true, color: BLACK })],
    });
    sections.push({
      properties: { type: SectionType.CONTINUOUS, page: portraitProps },
      ...hdr(plNotesSubtitle),
      children:   [inlinePlHeading, ...plNotesChildren],
    });
  }

  // FA schedule (landscape) — a Balance Sheet schedule, so it carries the BS
  // schedule heading.
  if (faRows.length > 0) {
    const faNoteNo = noteNumbers["BS_NCA_FA"];
    sections.push({
      properties: { page: landscapeProps },
      ...hdr(bsNotesSubtitle),
      children:   [buildFATable(faRows, faNoteNo ? String(faNoteNo) : "—", cyLabel, pyLabel, stage5Notes?.fa?.py_manual ?? null, params.faPyRows ?? null)],
    });
  }

  // Financial Ratios on their OWN page, AFTER every note — client name header only.
  if (hasRatios) {
    const maxNoteNo = Object.values(noteNumbers)
      .map(v => (typeof v === "number" ? v : 0))
      .reduce((m, v) => Math.max(m, v), 0);
    const ratioNoteNo = maxNoteNo > 0 ? maxNoteNo + 1 : null;
    sections.push({
      properties: { page: portraitProps },
      ...hdr(),
      children:   [buildRatiosTable(ratios!.cy, ratios!.py, (ratios as any)?.commentary, fy, ratioNoteNo)],
    });
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SZ_BODY } },
      },
    },
    sections,
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
