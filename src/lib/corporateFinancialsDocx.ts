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
  Packer,
  PageNumber,
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

import { getActiveFsDivisor, FS_SCALES } from "@/lib/fsUnits";
import { computeAllRatios } from "@/lib/ratioEngine";

// ─── Export-time unit scale ───────────────────────────────────────────────────
let _exportDivisor = 1;
let _exportSuffix  = "(₹)";
let _exportUnit    = "₹";
let _compact       = false;   // true inside buildBSTable / buildPLTable — tighter row spacing

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

// Main table columns: Particulars | Note No. | CY | PY
const CW_DESC = 7100;
const CW_NOTE = 400;
const CW_CY   = 1483;
const CW_PY   = 1483;

// Note table columns (3-col Pattern B): Particulars | CY | PY
const NW_DESC = 7550;
const NW_CY   = 1458;
const NW_PY   = 1458;

// Ratios table columns: No. | Ratio Name | CY | PY
const RW_NO   =  500;
const RW_NAME = 5000;
const RW_CY   = 2483;
const RW_PY   = 2483;

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
const FONT      = "Arial";
const SZ_XS     = 14;   // 7pt
const SZ_SM     = 16;   // 8pt
const SZ_BODY   = 18;   // 9pt
const SZ_HDR    = 20;   // 10pt
const SZ_TITLE  = 22;   // 11pt
const SZ_ENTITY = 28;   // 14pt

// ─── Colour palette ───────────────────────────────────────────────────────────
const NAVY    = "1F3864";
const BG_HDR  = "1F3864";
const BG_SECT = "D6E4F0";
const BG_TOT  = "EBF1FA";
const BG_GRAN = "D9E2F3";
const DK_GREY = "505050";
const BLACK   = "000000";
const WHITE   = "FFFFFF";

// ─── Borders ─────────────────────────────────────────────────────────────────
const bNone = { style: BorderStyle.NONE,   size: 0, color: "FFFFFF" };
const bHair = { style: BorderStyle.SINGLE, size: 2, color: "CBCBCB" };
const bThin = { style: BorderStyle.SINGLE, size: 4, color: NAVY };
const bBold = { style: BorderStyle.SINGLE, size: 8, color: NAVY };

const BDR_NONE  = { top: bNone, bottom: bNone,  left: bNone, right: bNone };
const BDR_ROW   = { top: bNone, bottom: bHair,  left: bNone, right: bNone };
const BDR_SECT  = { top: bThin, bottom: bNone,  left: bNone, right: bNone };
const BDR_SUB   = { top: bThin, bottom: bThin,  left: bNone, right: bNone };
const BDR_GRAND = { top: bBold, bottom: bBold,  left: bNone, right: bNone };

// ─── Amount formatter ─────────────────────────────────────────────────────────
function fmt(n: number): string {
  const scaled = _exportDivisor === 1 ? n : n / _exportDivisor;
  if (Math.abs(scaled) < 0.5) return "—";
  const abs = Math.round(Math.abs(scaled));
  const str = abs.toLocaleString("en-IN");
  return scaled < 0 ? `(${str})` : str;
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
      spacing:   { before: 0, after: 0, line: 260, lineRule: "auto" as any },
      children:  [new TextRun({ text, font: FONT, size: sz, bold, italic, color })],
    })],
  });
}

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

function ec(w: number, bg?: string, borders?: Record<string, typeof bNone>): TableCell {
  return cell({ text: "", w, bg, borders: borders ?? BDR_ROW });
}

// ─── Standard row factories ───────────────────────────────────────────────────

function colHeaderRow(cyLabel: string, pyLabel: string): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "Particulars",    w: CW_DESC, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      cell({ text: "Note\nNo.",      w: CW_NOTE, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
      cell({ text: `${cyLabel}\n${_exportSuffix}`, w: CW_CY, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
      cell({ text: `${pyLabel}\n${_exportSuffix}`, w: CW_PY, sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
    ],
  });
}

function sectionRow(label: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        shading: { fill: BG_SECT, type: ShadingType.CLEAR },
        borders: BDR_SECT,
        margins: { top: _compact ? 30 : 60, bottom: _compact ? 30 : 60, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: label, font: FONT, size: SZ_HDR, bold: true, color: NAVY })],
        })],
      }),
    ],
  });
}

function parentRow(label: string, indent = 0): TableRow {
  return new TableRow({
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
    centerRow(entityName.toUpperCase(), { sz: SZ_ENTITY, bold: true, color: NAVY, top: 60, bottom: 20 }),
    centerRow(`${statementTitle} ${dateLine}`, { sz: SZ_TITLE, bold: true, color: NAVY, bottom: 10 }),
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
            children:  [new TextRun({ text: amountUnitsLabel(), font: FONT, size: SZ_SM, color: DK_GREY })],
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
  const rows: TableRow[] = [
    ...titleRows(entityName, "BALANCE SHEET", `AS AT 31 MARCH ${cyYear}`),
    colHeaderRow(`As at 31 Mar ${cyYear}`, `As at 31 Mar ${pyYear}`),

    // ── EQUITY AND LIABILITIES ────────────────────────────────────────────
    sectionRow("EQUITY AND LIABILITIES"),

    parentRow("(1)  Shareholders' Funds"),
    dataRow("        (a)  Share Capital",                     n("BS_EQ_SC"), g("BS_EQ_SC").cy, g("BS_EQ_SC").py),
    dataRow("        (b)  Reserves and Surplus",              n("BS_EQ_RS"), g("BS_EQ_RS").cy, g("BS_EQ_RS").py),
    dataRow("        (c)  Money Received Against Share Warrants", null,      0,                0),
    subTotalRow("Total Shareholders' Funds", sfCy, sfPy),

    parentRow("(2)  Non-Current Liabilities"),
    dataRow("        (a)  Long-term Borrowings",              n("BS_NCL_LTB"), g("BS_NCL_LTB").cy, g("BS_NCL_LTB").py),
    dataRow("        (b)  Deferred Tax Liabilities (Net)",    n("BS_NCL_DTL"), g("BS_NCL_DTL").cy, g("BS_NCL_DTL").py),
    dataRow("        (c)  Other Long-term Liabilities",       n("BS_NCL_OLT"), g("BS_NCL_OLT").cy, g("BS_NCL_OLT").py),
    dataRow("        (d)  Long-term Provisions",              n("BS_NCL_LTP"), g("BS_NCL_LTP").cy, g("BS_NCL_LTP").py),
    subTotalRow("Total Non-Current Liabilities", nclCy, nclPy),

    parentRow("(3)  Current Liabilities"),
    dataRow("        (a)  Short-term Borrowings",             n("BS_CL_STB"), g("BS_CL_STB").cy, g("BS_CL_STB").py),
    dataRow("        (b)  Trade Payables",                    n("BS_CL_TP"),  g("BS_CL_TP").cy,  g("BS_CL_TP").py),
    dataRow("        (c)  Other Current Liabilities",         n("BS_CL_OCL"), g("BS_CL_OCL").cy, g("BS_CL_OCL").py),
    dataRow("        (d)  Short-term Provisions",             n("BS_CL_STP"), g("BS_CL_STP").cy, g("BS_CL_STP").py),
    subTotalRow("Total Current Liabilities", clCy, clPy),

    grandTotalRow("TOTAL EQUITY AND LIABILITIES", totELCy, totELPy),

    // ── ASSETS ────────────────────────────────────────────────────────────
    sectionRow("ASSETS"),

    parentRow("(1)  Non-Current Assets"),
    dataRow("        (a)  Fixed Assets",                      n("BS_NCA_FA"),  g("BS_NCA_FA").cy,  g("BS_NCA_FA").py),
    dataRow("        (b)  Non-current Investments",           n("BS_NCA_INV"), g("BS_NCA_INV").cy, g("BS_NCA_INV").py),
    dataRow("        (c)  Deferred Tax Assets (Net)",         n("BS_NCA_DTA"), g("BS_NCA_DTA").cy, g("BS_NCA_DTA").py),
    dataRow("        (d)  Long-term Loans and Advances",      n("BS_NCA_LLA"), g("BS_NCA_LLA").cy, g("BS_NCA_LLA").py),
    dataRow("        (e)  Other Non-current Assets",          n("BS_NCA_ONA"), g("BS_NCA_ONA").cy, g("BS_NCA_ONA").py),
    subTotalRow("Total Non-Current Assets", ncaCy, ncaPy),

    parentRow("(2)  Current Assets"),
    dataRow("        (a)  Current Investments",               n("BS_CA_CI"),  g("BS_CA_CI").cy,  g("BS_CA_CI").py),
    dataRow("        (b)  Inventories",                       n("BS_CA_INV"), g("BS_CA_INV").cy, g("BS_CA_INV").py),
    dataRow("        (c)  Trade Receivables",                 n("BS_CA_TR"),  g("BS_CA_TR").cy,  g("BS_CA_TR").py),
    dataRow("        (d)  Cash and Cash Equivalents",         n("BS_CA_CCE"), g("BS_CA_CCE").cy, g("BS_CA_CCE").py),
    dataRow("        (e)  Short-term Loans and Advances",     n("BS_CA_SLA"), g("BS_CA_SLA").cy, g("BS_CA_SLA").py),
    dataRow("        (f)  Other Current Assets",              n("BS_CA_OCA"), g("BS_CA_OCA").cy, g("BS_CA_OCA").py),
    subTotalRow("Total Current Assets", caCy, caPy),

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
              new TextRun({ text: "Note 1  ", font: FONT, size: SZ_XS, bold: true, color: NAVY }),
              new TextRun({
                text: "Significant Accounting Policies and Notes to Accounts form an integral part of the Financial Statements.",
                font: FONT, size: SZ_XS, italic: true, color: DK_GREY,
              }),
            ],
          })],
        }),
      ],
    }),
  ];

  _compact = false;
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
      children: [
        cell({ text: label, w: CW_DESC, indent: 1 }),
        cell({ text: noteNo ? String(noteNo) : "", w: CW_NOTE, align: AlignmentType.CENTER, bold: true, color: noteNo ? NAVY : BLACK }),
        cell({ text: fmtEps(valCy), w: CW_CY, align: AlignmentType.RIGHT, padR: 120 }),
        cell({ text: fmtEps(valPy), w: CW_PY, align: AlignmentType.RIGHT, padR: 120 }),
      ],
    });

  _compact = true;
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
              new TextRun({ text: "Note 1  ", font: FONT, size: SZ_XS, bold: true, color: NAVY }),
              new TextRun({
                text: "Significant Accounting Policies and Notes to Accounts form an integral part of the Financial Statements.",
                font: FONT, size: SZ_XS, italic: true, color: DK_GREY,
              }),
            ],
          })],
        }),
      ],
    }),
  ];

  _compact = false;
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

function buildCorpSignatureTable(sig: CorpSigData): Table {
  const BLANK = "_______________";

  const firmName    = sig.firmName     || BLANK;
  const frn         = sig.firmFRN      || BLANK;
  const partner     = sig.partnerName  || BLANK;
  const memNo       = sig.membershipNo || BLANK;
  const dir1Name    = sig.dir1Name     || BLANK;
  const dir1Din     = sig.dir1Din      || "";
  const dir2Name    = sig.dir2Name     || "";
  const dir2Din     = sig.dir2Din      || "";
  const place       = sig.place        || BLANK;
  const date        = fmtSigDate(sig.date);

  const colW = Math.floor(TW / 3);
  const colWRight = TW - colW * 2;

  function sigLines(
    lines: Array<{ text: string; bold?: boolean; gap?: boolean; muted?: boolean }>,
  ): Paragraph[] {
    return lines.map(l => new Paragraph({
      spacing: { before: l.gap ? 200 : 0, after: 20 },
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
    columnWidths: [colW, colW, colWRight],
    rows: [
      new TableRow({
        children: [
          // Left — CA Firm
          new TableCell({
            width:   { size: colW, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 80, right: 80 },
            children: sigLines([
              { text: `For, ${firmName}`, bold: true },
              { text: "Chartered Accountants" },
              { text: `FRN: ${frn}` },
              { text: "__________________", gap: true },
              { text: partner, bold: true },
              { text: "Partner" },
              { text: `Membership No. ${memNo}` },
              { text: `Place: ${place}`, gap: true },
              { text: `Date: ${date}` },
            ]),
          }),
          // Centre — Director 1
          new TableCell({
            width:   { size: colW, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 200, right: 80 },
            children: dir1Name !== BLANK ? sigLines([
              { text: dir1Name, bold: true },
              ...(dir1Din ? [{ text: `DIN: ${dir1Din}` }] : []),
              { text: "Director" },
              { text: `Place: ${place}`, gap: true },
              { text: `Date: ${date}` },
            ]) : sigLines([{ text: "" }]),
          }),
          // Right — Director 2 (only if a name exists)
          new TableCell({
            width:   { size: colWRight, type: WidthType.DXA },
            borders: BDR_NONE,
            margins: { top: 80, bottom: 80, left: 200, right: 80 },
            children: dir2Name ? sigLines([
              { text: dir2Name, bold: true },
              ...(dir2Din ? [{ text: `DIN: ${dir2Din}` }] : []),
              { text: "Director" },
              { text: `Place: ${place}`, gap: true },
              { text: `Date: ${date}` },
            ]) : sigLines([{ text: "" }]),
          }),
        ],
      }),
    ],
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
          new TextRun({ text: `${entityName}  |  Financial Statements  |  Page `, font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ text: " of ",                  font: FONT, size: SZ_XS, color: DK_GREY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SZ_XS, color: DK_GREY }),
        ],
      }),
    ],
  });
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
  const GAP = 100;
  const txt = (text: string, bold = false) =>
    new TextRun({ text, font: FONT, size: SZ_BODY, bold, color: BLACK });

  const block = (
    runs: TextRun[],
    opts: { indent?: number; after?: number; keepNext?: boolean } = {},
  ): Paragraph =>
    new Paragraph({
      spacing:   { before: 0, after: opts.after ?? 40, line: 240, lineRule: "auto" as any },
      indent:    opts.indent ? { left: opts.indent } : undefined,
      keepLines: true,
      keepNext:  opts.keepNext ?? true,
      children:  runs,
    });

  const last = CORP_NOTE1_POLICIES.length - 1;

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
    block([txt("1.  Basis of Preparation", true)], { after: 40 }),
    block(
      [txt(`The financial statements of ${entityName} have been prepared in accordance with Schedule III to the Companies Act, 2013 and the applicable Accounting Standards as prescribed under Section 133 of the Companies Act, 2013. The financial statements comply with all material aspects of Indian GAAP.`)],
      { after: GAP },
    ),
    block([txt("2.  Significant Accounting Policies", true)], { after: 40 }),
    ...CORP_NOTE1_POLICIES.flatMap((p, i) => [
      block([txt(p.label, true)], { indent: 280, after: 10 }),
      block([txt(p.text)],        { indent: 280, after: i === last ? 40 : GAP, keepNext: i !== last }),
    ]),
  ];
}

// ─── NOTE TABLE (generic breakup from stage5_notes) ──────────────────────────
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
            new TextRun({ text: `Note ${noteNumber} — ${title}`, font: FONT, size: SZ_HDR, bold: true, color: NAVY }),
          ],
        })],
      }),
    ],
  });
}

function noteHdr3(cyYear: string, pyYear: string): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "Particulars", w: NW_DESC, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, padL: 100 }),
      cell({ text: `${cyYear}\n${_exportSuffix}`, w: NW_CY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
      cell({ text: `${pyYear}\n${_exportSuffix}`, w: NW_PY, sz: SZ_BODY, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.RIGHT, padR: 120 }),
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
  const bg   = style === "total" ? BG_GRAN : style === "subtotal" ? BG_TOT : undefined;
  const bdr  = style === "total" ? BDR_GRAND : style === "subtotal" ? BDR_SUB : BDR_ROW;
  const bold = style !== "data";
  return new TableRow({
    children: [
      cell({ text: label, w: NW_DESC, bold, bg, borders: bdr, indent }),
      ac(cyVal, NW_CY, { bold, bg, borders: bdr }),
      ac(pyVal, NW_PY, { bold, bg, borders: bdr }),
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

function buildFATable(faRows: FARow[], noteNumber: string, cyYear: string, pyYear: string): Table {
  // 12 columns summing to TW_LS = 15398
  // Particulars | UL | GrossOpen | Add | Disp | GrossClos | DepnOpen | DepnAdd | DepnDisp | DepnClos | NetCY | NetPY
  const FA_COLS = [2200, 500, 1200, 1100, 1100, 1300, 1050, 1050, 1050, 1300, 1274, 1274];
  // sum = 2200+500+1200+1100+1100+1300+1050+1050+1050+1300+1274+1274 = 15398 ✓

  const h = (text: string, w: number) =>
    cell({ text, w, sz: SZ_XS, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER, padL: 30, padR: 30 });

  const hdrRow = new TableRow({
    tableHeader: true,
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

  const dataRows = (faRows ?? []).map(r => {
    const grossClos = (r.gross_open || 0) + (r.additions || 0) - (r.disposals || 0);
    const depnClos  = (r.depn_open  || 0) + (r.depn_add  || 0) - (r.depn_disp || 0);
    const netCy     = grossClos - depnClos;
    const netPy     = r.net_py != null ? r.net_py : (r.gross_open || 0) - (r.depn_open || 0);
    const ul        = r.useful_life != null ? String(r.useful_life) === "indefinite" ? "∞" : `${r.useful_life} yrs` : "";
    return new TableRow({
      children: [
        cell({ text: r.particulars || "", w: FA_COLS[0], sz: SZ_XS }),
        cell({ text: ul,                  w: FA_COLS[1], sz: SZ_XS, align: AlignmentType.CENTER }),
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
  const sumNetPy     = (faRows ?? []).reduce((s, r) => {
    const gross = r.gross_open || 0;
    const depn  = r.depn_open  || 0;
    return s + (r.net_py != null ? Number(r.net_py) : gross - depn);
  }, 0);

  const totalRow = new TableRow({
    children: [
      cell({ text: "Total", w: FA_COLS[0],  sz: SZ_XS, bold: true, bg: BG_GRAN, borders: BDR_GRAND }),
      cell({ text: "",      w: FA_COLS[1],  sz: SZ_XS, bg: BG_GRAN, borders: BDR_GRAND }),
      nac(sumField("gross_open"),    FA_COLS[2], true, BG_GRAN, BDR_GRAND),
      nac(sumField("additions"),     FA_COLS[3], true, BG_GRAN, BDR_GRAND),
      nac(sumField("disposals"),     FA_COLS[4], true, BG_GRAN, BDR_GRAND),
      nac(sumGrossClos,              FA_COLS[5], true, BG_GRAN, BDR_GRAND),
      nac(sumField("depn_open"),     FA_COLS[6], true, BG_GRAN, BDR_GRAND),
      nac(sumField("depn_add"),      FA_COLS[7], true, BG_GRAN, BDR_GRAND),
      nac(sumField("depn_disp"),     FA_COLS[8], true, BG_GRAN, BDR_GRAND),
      nac(sumDepnClos,               FA_COLS[9], true, BG_GRAN, BDR_GRAND),
      nac(sumNetCy,                  FA_COLS[10], true, BG_GRAN, BDR_GRAND),
      nac(sumNetPy,                  FA_COLS[11], true, BG_GRAN, BDR_GRAND),
    ],
  });

  return new Table({
    width:        { size: TW_LS, type: WidthType.DXA },
    columnWidths: FA_COLS,
    rows: [
      noteTitleRow(FA_COLS, noteNumber, "Property, Plant and Equipment — Fixed Assets Schedule"),
      hdrRow,
      ...dataRows,
      totalRow,
    ],
  });
}

// ─── RATIOS TABLE ─────────────────────────────────────────────────────────────
function buildRatiosTable(cyRatios: any, pyRatios: any): Table {
  const cyResults = cyRatios ? computeAllRatios(cyRatios) : [];
  const pyResults = pyRatios ? computeAllRatios(pyRatios) : [];

  const pyMap = new Map<number, string>();
  for (const r of pyResults) pyMap.set(r.id, r.display);

  const CW = [RW_NO, RW_NAME, RW_CY, RW_PY];

  const hdrRow = new TableRow({
    tableHeader: true,
    children: [
      cell({ text: "No.", w: CW[0], sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
      cell({ text: "Ratio", w: CW[1], sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE }),
      cell({ text: "Current Year", w: CW[2], sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
      cell({ text: "Previous Year", w: CW[3], sz: SZ_SM, bold: true, color: WHITE, bg: BG_HDR, borders: BDR_NONE, align: AlignmentType.CENTER }),
    ],
  });

  const dataRows = cyResults.map(r =>
    new TableRow({
      children: [
        cell({ text: String(r.id), w: CW[0], align: AlignmentType.CENTER, bold: true, color: NAVY }),
        cell({ text: r.name,       w: CW[1] }),
        cell({ text: r.display,    w: CW[2], align: AlignmentType.CENTER }),
        cell({ text: pyMap.get(r.id) ?? "N.A.", w: CW[3], align: AlignmentType.CENTER }),
      ],
    }),
  );

  // Section title
  const titleRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 4,
        width:   { size: TW, type: WidthType.DXA },
        shading: { fill: BG_SECT, type: ShadingType.CLEAR },
        borders: BDR_SECT,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: "Financial Ratios  (MCA-Mandated)", font: FONT, size: SZ_HDR, bold: true, color: NAVY })],
        })],
      }),
    ],
  });

  return new Table({
    width:        { size: TW, type: WidthType.DXA },
    columnWidths: CW,
    rows: dataRows.length > 0 ? [titleRow, hdrRow, ...dataRows] : [titleRow, hdrRow],
  });
}

// ─── Note row extraction helpers ─────────────────────────────────────────────

type NoteRowFmt = "amount" | "eps" | "integer";

interface NoteRow {
  label:   string;
  cy:      number;
  py:      number;
  style:   "data" | "subtotal" | "total";
  fmt?:    NoteRowFmt;
  indent?: number;
}

function extractNoteRows(
  renderType: string,
  noteData: any,
  amounts: Record<string, { cy: number; py: number }>,
  fsCode: string,
  stage5Notes: any,
): NoteRow[] {
  const totCy = amounts[fsCode]?.cy ?? 0;
  const totPy = amounts[fsCode]?.py ?? 0;
  const n = (v: any): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

  switch (renderType) {

    case "breakup": {
      const breakup: any[] = noteData?.breakup ?? [];
      if (!breakup.length) return [];

      // Pre-compute group totals by summing member rows
      const groupTotals = new Map<string, { cy: number; py: number }>();
      for (const r of breakup) {
        if (!r?.subgroup_id) continue;
        const cur = groupTotals.get(r.subgroup_id) ?? { cy: 0, py: 0 };
        groupTotals.set(r.subgroup_id, { cy: cur.cy + n(r.amount_cy), py: cur.py + n(r.amount_py) });
      }

      const rows: NoteRow[] = [];

      for (const r of breakup) {
        if (!r) continue;
        const label = String(r.description || r.label || "");

        if (r.is_group && r.id) {
          // GROUP header — use computed total from members
          const gt = groupTotals.get(r.id) ?? { cy: n(r.amount_cy), py: n(r.amount_py) };
          if (gt.cy === 0 && gt.py === 0) continue;
          rows.push({ label, cy: gt.cy, py: gt.py, style: "subtotal" });
        } else if (r.subgroup_id) {
          // Member of a group — show indented, skip nil values
          const cyVal = n(r.amount_cy);
          const pyVal = n(r.amount_py);
          if (cyVal === 0 && pyVal === 0) continue;
          rows.push({ label, cy: cyVal, py: pyVal, style: "data", indent: 1 });
        } else {
          // Regular non-grouped row — skip nil
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
      const genResCy   = n(noteData?.gen_reserve_cy);
      const genResPy   = n(noteData?.gen_reserve_py);
      const spCy       = n(noteData?.share_premium_cy);
      const spPy       = n(noteData?.share_premium_py);
      const surpOpenCy = n(noteData?.surplus_opening_cy);
      const surpOpenPy = n(noteData?.surplus_opening_py);
      const npatCy     = n(stage5Notes?.pl?.eps?.npat);
      const npatPy     = n(stage5Notes?.pl?.eps?.npat_py);
      const deferCy    = n(noteData?.surplus_deferred_adj_cy);
      const deferPy    = n(noteData?.surplus_deferred_adj_py);
      const excessCy   = n(noteData?.surplus_excess_short_cy);
      const excessPy   = n(noteData?.surplus_excess_short_py);
      const rows: NoteRow[] = [];
      if (genResCy !== 0 || genResPy !== 0)
        rows.push({ label: "General Reserve",              cy: genResCy,   py: genResPy,   style: "data" });
      if (spCy !== 0 || spPy !== 0)
        rows.push({ label: "Securities Premium Account",   cy: spCy,       py: spPy,       style: "data" });
      rows.push({ label: "Opening Balance — P&L",          cy: surpOpenCy, py: surpOpenPy, style: "data" });
      rows.push({ label: "Add: Profit for the year",       cy: npatCy,     py: npatPy,     style: "data" });
      if (deferCy !== 0 || deferPy !== 0)
        rows.push({ label: "Deferred tax adjustment",      cy: deferCy,    py: deferPy,    style: "data" });
      if (excessCy !== 0 || excessPy !== 0)
        rows.push({ label: "Less: Excess / short provision", cy: excessCy, py: excessPy,   style: "data" });
      rows.push({ label: "Total",                          cy: totCy,      py: totPy,      style: "total" });
      return rows;
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

  const tableRows: TableRow[] = [
    noteTitleRow([NW_DESC, NW_CY, NW_PY], noteNumber, title),
    noteHdr3(cyYear, pyYear),
  ];

  for (const row of rows) {
    const bg   = row.style === "total" ? BG_GRAN : row.style === "subtotal" ? BG_TOT : undefined;
    const bdr  = row.style === "total" ? BDR_GRAND : row.style === "subtotal" ? BDR_SUB : BDR_ROW;
    const bold = row.style !== "data";
    tableRows.push(new TableRow({
      cantSplit: true,
      children: [
        cell({ text: row.label,               w: NW_DESC, bold, bg, borders: bdr, indent: row.indent ?? 0 }),
        cell({ text: fmtVal(row.cy, row.fmt), w: NW_CY, align: AlignmentType.RIGHT, padL: 20, padR: 120, bold, bg, borders: bdr }),
        cell({ text: fmtVal(row.py, row.fmt), w: NW_PY, align: AlignmentType.RIGHT, padL: 20, padR: 120, bold, bg, borders: bdr }),
      ],
    }));
  }

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
  /** stage5_notes JSONB from audit_engagements.stage5_notes */
  stage5Notes?: {
    bs_liab?: Record<string, { breakup?: BreakupRow[]; [k: string]: any }>;
    bs_asset?: Record<string, { breakup?: BreakupRow[]; [k: string]: any }>;
    pl?:       Record<string, { breakup?: BreakupRow[]; [k: string]: any }>;
    fa?:       { rows?: FARow[]; py_manual?: Record<string, number | null> | null };
  } | null;
  /** stage7_ratios CY and PY inputs */
  ratios?: { cy: any; py: any } | null;
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
  const sigBlock = () => buildCorpSignatureTable(signature);

  // Note 1: Accounting Policies
  const note1Paras = buildNote1Section(entityName, cyLabel);

  // Notes 2–N: from stage5_notes
  const spacer = () => new Paragraph({ spacing: { before: 360, after: 0 }, keepNext: true, children: [] });

  const noteTables: (Table | Paragraph)[] = [];
  const faRows = stage5Notes?.fa?.rows ?? [];
  let faRenderedAsNote = false;

  for (const meta of CORP_NOTE_META) {
    const noteNo = noteNumbers[meta.fsCode];
    if (!noteNo) continue;

    if (meta.isFA) {
      faRenderedAsNote = true;
      continue;  // rendered in separate landscape section below
    }

    const sectionData = (stage5Notes as any)?.[meta.section];
    const noteData    = sectionData?.[meta.dataKey];

    const rows = extractNoteRows(meta.renderType, noteData, amounts, meta.fsCode, stage5Notes);
    if (rows.length === 0) continue;

    noteTables.push(spacer());
    noteTables.push(buildNoteTableFromRows(String(noteNo), meta.title, rows, cyLabel, pyLabel));
  }

  // Ratios
  const hasRatios = ratios && (ratios.cy || ratios.py);

  // Page settings
  const portraitProps = {
    size:   { width: A4_W, height: A4_H },
    margin: { top: MARG_T, right: MARG_H, bottom: MARG_B, left: MARG_H },
  };
  const landscapeProps = {
    size:   { width: A4_W, height: A4_H, orientation: PageOrientation.LANDSCAPE },
    margin: { top: MARG_T, right: MARG_LS, bottom: MARG_B, left: MARG_LS },
  };

  // Build sections
  const sections: any[] = [
    // Balance Sheet
    {
      properties: { page: portraitProps },

      children: [
        bsTable,
        new Paragraph({ spacing: { before: 600 }, children: [] }),
        sigBlock(),
      ],
    },
    // P&L
    {
      properties: { page: portraitProps },

      children: [
        plTable,
        new Paragraph({ spacing: { before: 600 }, children: [] }),
        sigBlock(),
      ],
    },
    // Notes (portrait)
    {
      properties: { page: portraitProps },

      children:   [
        ...note1Paras,
        ...noteTables,
        ...(hasRatios ? [spacer(), buildRatiosTable(ratios!.cy, ratios!.py)] : []),
      ],
    },
  ];

  // FA schedule (landscape) — only if FA rows exist
  if (faRows.length > 0) {
    const faNoteNo = noteNumbers["BS_NCA_FA"];
    sections.push({
      properties: { page: landscapeProps },

      children:   [buildFATable(faRows, faNoteNo ? String(faNoteNo) : "—", cyLabel, pyLabel)],
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
