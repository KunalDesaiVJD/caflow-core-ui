/**
 * fsRatiosWriter
 * ────────────────────────────────────────────────────────────────────────────
 * Appends three ratio sheets to a workbook, formatted to match the official
 * `Ratio.xlsx` template (file: `format/Ratio.xlsx`):
 *
 *   "RATIO"          — 11-ratio summary, 4-row block per ratio
 *   "Current Year "  — Detailed CY inputs with SUM/IFERROR formulas
 *                       (NB: the template uses a TRAILING SPACE in this name)
 *   "Previous Year " — Identical structure with PY data (also trailing space)
 *
 * Cross-sheet wiring:
 *   RATIO!E<numRow> = +'Current Year '!E<cyTotalRow>      (numerator amount)
 *   RATIO!E<denRow> = +'Current Year '!G<cyTotalRow>      (denominator amount)
 *   RATIO!F        = IFERROR('Current Year '!H<cyRow>, "N.A.")
 *   RATIO!G        = IFERROR('Previous Year '!H<cyRow>, "N.A.")
 *   RATIO!H        = IFERROR((F-G)/G, "N.A.")              (variance, %)
 *
 * The template uses NO fills — only thin black borders. Header band stretches
 * across rows 6-7 of the RATIO sheet (rowspan 2). Each ratio occupies four
 * rows on the RATIO sheet (numerator / denominator / "Text" comment /
 * spacer), and on the CY/PY sheets uses one row + one spacer for simple
 * ratios, or a multi-row vertically-merged block for DSCR (rows 13-18) and
 * ROCE (rows 32-39).
 */

import type ExcelJS from "exceljs";
import type { Stage7Ratios, RatioInputs } from "./ratioAutoPopulate";
import { getNoteNo } from "./noteNumberRegistry";

// ─── Formatting constants ────────────────────────────────────────────────────

const MONEY_FMT  = '#,##0.00;(#,##0.00);"-"';
const PCT_FMT    = "0.00%";
const RATIO_FMT  = "0.00";

const THIN_BLACK = { style: "thin"   as const, color: { argb: "FF000000" } };
const MED_BLACK  = { style: "medium" as const, color: { argb: "FF000000" } };
const FULL_BDR   = { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK } as ExcelJS.Borders;
const SIDE_BDR   = { left: THIN_BLACK, right: THIN_BLACK } as ExcelJS.Borders;
const TOP_SIDE   = { top: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK } as ExcelJS.Borders;
const BOT_SIDE   = { bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK } as ExcelJS.Borders;
/** Heavier full-perimeter border used by the company-name and ANNEXURE
 *  heading boxes on the CY/PY sheets. Matches the template's bold rule. */
const HEAD_BDR   = { top: MED_BLACK,  bottom: MED_BLACK,  left: MED_BLACK,  right: MED_BLACK }  as ExcelJS.Borders;

const FONT       = "Cambria";

interface Ctx {
  cyYear:      number;
  pyYear:      number;
  companyName: string;
}

// Number of rows per ratio block on the RATIO sheet (num / den / text / spacer)
const RATIO_BLOCK_ROWS = 4;
// First ratio row on the RATIO sheet (after the header band rows 6-7)
const RATIO_FIRST_ROW  = 8;

// ─── Column widths (match template Ratio.xlsx) ───────────────────────────────

/**
 * RATIO summary sheet — A through I.
 * From Ratio.xlsx: A=1.71, B=5.0, C=18.0, D=27.57, E=13.71, F=12.14, G=12.29, H=10, I=1.71
 */
const RAT_COLS: Partial<ExcelJS.Column>[] = [
  { width: 1.71  }, // A spacer
  { width: 5.0   }, // B NO
  { width: 18.0  }, // C PARTICULARS
  { width: 27.57 }, // D NUMERATOR / DENOMINATOR
  { width: 13.71 }, // E Amount (Rs.)
  { width: 12.14 }, // F Current Year ratio
  { width: 12.29 }, // G Previous Year ratio
  { width: 10.0  }, // H Variance
  { width: 1.71  }, // I spacer
];

/**
 * Current Year / Previous Year sheets — A through H.
 * From Ratio.xlsx: A=2.43, B=6.86, C=34.29, D=37.71, E=14.29, F=34.14, G=14.57, H=12.71
 */
const CY_COLS: Partial<ExcelJS.Column>[] = [
  { width: 2.43  }, // A spacer
  { width: 6.86  }, // B NO
  { width: 34.29 }, // C PARTICULARS
  { width: 37.71 }, // D NUMERATOR
  { width: 14.29 }, // E Amount (Rs.)
  { width: 34.14 }, // F DENOMINATOR
  { width: 14.57 }, // G Amount (Rs.)
  { width: 12.71 }, // H Ratio
];

// ─── Layout map ─────────────────────────────────────────────────────────────

interface RatioLayout {
  id:           number;
  /** Display name shown in RATIO sheet col C (title-case with unit suffix) */
  name:         string;
  /** Numerator label shown in RATIO sheet col D (top half) — hardcoded from template */
  numLabel:     string;
  /** Denominator label shown in RATIO sheet col D (bottom half) — hardcoded from template */
  denLabel:     string;
  unit:         "times" | "%";
  /** CY/PY sheet: row that holds the ratio formula (col H) */
  cyRow:        number;
  /** CY/PY sheet: row that holds the numerator total amount (col E) */
  numTotRow:    number;
  /** CY/PY sheet: row that holds the denominator total amount (col G) */
  denTotRow:    number;
}

/**
 * Row layout matches the template:
 *   Row  9  → Ratio 1 (Current Ratio)         + blank row 10
 *   Row 11  → Ratio 2 (Debt-Equity)           + blank row 12
 *   Rows 13-18  → Ratio 3 (DSCR, merged) — TOTAL on row 18
 *   Row 19  → blank
 *   Row 20  → Ratio 4 (ROE)                   + blank row 21
 *   Row 22  → Ratio 5 (Inventory)             + blank row 23
 *   Row 24  → Ratio 6 (Trade Receivables)     + blank row 25
 *   Row 26  → Ratio 7 (Trade Payable)         + blank row 27
 *   Row 28  → Ratio 8 (Net Capital)           + blank row 29
 *   Row 30  → Ratio 9 (Net Profit)            + blank row 31
 *   Rows 32-39 → Ratio 10 (ROCE, merged) — TOTAL on row 39
 *   Row 40  → blank
 *   Row 41  → Ratio 11 (ROI)
 */
const LAYOUTS: RatioLayout[] = [
  // Names, numLabel, and denLabel are hardcoded verbatim from the Ratio.xlsx template
  // (including any trailing spaces or capitalisation quirks in the template).
  { id: 1,  name: "Current Ratio (In times)",
    numLabel: "Total Current Assets",               denLabel: "Total Current Liabilities",
    unit: "times", cyRow:  9, numTotRow:  9, denTotRow:  9 },
  { id: 2,  name: "Debt-Equity Ratio (In times)",
    numLabel: "Total Debt",                         denLabel: "Shareholder'S Equity",
    unit: "times", cyRow: 11, numTotRow: 11, denTotRow: 11 },
  { id: 3,  name: "Debt Service Coverage Ratio (In Times)",
    numLabel: "Earning Available for Debt Service ", denLabel: "Debt Service",
    unit: "times", cyRow: 18, numTotRow: 18, denTotRow: 18 },
  { id: 4,  name: "Return On Equity Ratio (In % )",
    numLabel: "Net Profit After Tax",               denLabel: "Averages Shareholders Equity",
    unit: "%",     cyRow: 20, numTotRow: 20, denTotRow: 20 },
  { id: 5,  name: "Inventory Turnover Ratio (In Times)",
    numLabel: "Cost Of Goods Sold ",                denLabel: "Average Inventories",
    unit: "times", cyRow: 22, numTotRow: 22, denTotRow: 22 },
  { id: 6,  name: "Trade Receivables Turnover Ratio (In Times)",
    numLabel: "Revenue from Operations",            denLabel: "Average Trade Receivables",
    unit: "times", cyRow: 24, numTotRow: 24, denTotRow: 24 },
  { id: 7,  name: "Trade Payables Turnover Ratio (In Times)",
    numLabel: "Net Credit Purchases",               denLabel: "Average Trade Payables",
    unit: "times", cyRow: 26, numTotRow: 26, denTotRow: 26 },
  { id: 8,  name: "Net Capital Turnover Ratio (In Times)",
    numLabel: "Revenue from Operations",            denLabel: "Working Capital ",
    unit: "times", cyRow: 28, numTotRow: 28, denTotRow: 28 },
  { id: 9,  name: "Net Profit Ratio (In % )",
    numLabel: "Net Profit After Tax",               denLabel: "Revenue from Operations",
    unit: "%",     cyRow: 30, numTotRow: 30, denTotRow: 30 },
  { id: 10, name: "Return On Capital Employed (In % )",
    // "Interst" is the template's spelling — preserved verbatim
    numLabel: "Earnings Before Interst & Taxes",   denLabel: "Capital Employed",
    unit: "%",     cyRow: 39, numTotRow: 39, denTotRow: 39 },
  { id: 11, name: "Return On Investment (In % )",
    numLabel: "Return/ Profit/ Earnings",           denLabel: "Average Investment Fund",
    unit: "%",     cyRow: 41, numTotRow: 41, denTotRow: 41 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function v(inputs: RatioInputs | null, field: keyof RatioInputs): number {
  if (!inputs) return 0;
  const val = inputs[field];
  return typeof val === "number" && Number.isFinite(val) ? val : 0;
}

/**
 * Build an ExcelJS formula value. The `result` field is the cached
 * value Excel displays without recalculating — providing a real number
 * (instead of always 0) means the data appears correctly even on
 * Excel versions / settings that don't honour `fullCalcOnLoad`.
 */
function f(formula: string, result: number | string = 0): ExcelJS.CellFormulaValue {
  return { formula, result } as ExcelJS.CellFormulaValue;
}

/**
 * Compute the numerator, denominator, and ratio for a given ratio ID
 * from raw inputs. This mirrors the formulas in the CY/PY sheets so we
 * can supply pre-evaluated `result` values to every cross-sheet
 * formula in the RATIO sheet — guaranteeing the displayed amount
 * matches the source data even before Excel triggers a recalculation.
 */
function ratioComputed(
  ratioId: number,
  inp:     RatioInputs | null,
): { num: number; den: number; ratio: number } {
  if (!inp) return { num: 0, den: 0, ratio: 0 };
  let num = 0;
  let den = 0;
  switch (ratioId) {
    case 1:  // Current Ratio
      num = v(inp, "current_assets");
      den = v(inp, "current_liabilities");
      break;
    case 2:  // Debt-Equity
      num = v(inp, "total_debt");
      den = v(inp, "shareholders_equity");
      break;
    case 3:  // DSCR — TOTAL = SUM(E14:E17) / SUM(G14:G15)
      num = v(inp, "npat") + v(inp, "non_cash_op_exp")
          + v(inp, "interest") + v(inp, "other_non_cash_adj");
      den = v(inp, "interest_lease") + v(inp, "principal_repayments");
      break;
    case 4:  // Return On Equity
      num = v(inp, "npat");
      den = v(inp, "avg_shareholders_equity");
      break;
    case 5:  // Inventory Turnover (uses revenue_ops as numerator per writeYearSheet)
      num = v(inp, "revenue_ops");
      den = v(inp, "avg_inventories");
      break;
    case 6:  // Trade Receivables Turnover
      num = v(inp, "revenue_ops");
      den = v(inp, "avg_trade_receivables");
      break;
    case 7:  // Trade Payables Turnover
      num = v(inp, "net_credit_purchases");
      den = v(inp, "avg_trade_payables");
      break;
    case 8:  // Net Capital Turnover
      num = v(inp, "revenue_ops");
      den = v(inp, "working_capital");
      break;
    case 9:  // Net Profit Ratio
      num = v(inp, "npat");
      den = v(inp, "revenue_ops");
      break;
    case 10: // Return On Capital Employed — TOTAL = SUM(E33:E38) / SUM(G33:G38)
      num = v(inp, "npbt") + v(inp, "interest");
      den = v(inp, "net_worth") + v(inp, "lt_borrowings");
      break;
    case 11: // Return On Investment
      num = v(inp, "return_profit");
      den = v(inp, "avg_investment_fund");
      break;
  }
  const ratio = den !== 0 ? num / den : 0;
  return { num, den, ratio };
}

function fyStr(yearEnd: number): string {
  return `${yearEnd - 1}-${String(yearEnd).slice(-2)}`;
}

function applyFont(cell: ExcelJS.Cell, opts: { bold?: boolean; italic?: boolean; size?: number } = {}) {
  cell.font = { name: FONT, size: opts.size ?? 10, bold: !!opts.bold, italic: !!opts.italic };
}

/**
 * Iterate every cell within a `<startCol,startRow>:<endCol,endRow>` rect and
 * call the visitor. Used to clear borders on slave cells of a merge so
 * Excel doesn't render internal divider lines between merged cells.
 */
function forEachCellInRange(
  ws: ExcelJS.Worksheet,
  startRow: number, startCol: number,
  endRow:   number, endCol:   number,
  fn: (cell: ExcelJS.Cell) => void,
): void {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      fn(ws.getCell(r, c));
    }
  }
}

/**
 * Propagate the MASTER cell's border style to every slave cell in the
 * merged range. This ensures merged regions render with the correct outer
 * perimeter (Excel needs the bottom/right borders to live on the
 * bottom-row / right-column cells, which the master can't provide alone).
 *
 * Internal borders within a merged region are hidden by Excel
 * automatically, so this never produces visible divider lines.
 *
 * If the master has no border set, slaves get an empty border object —
 * preserving the no-border behaviour required by the company name and
 * ANNEXURE heading merges.
 */
function clearSlaveBorders(
  ws: ExcelJS.Worksheet,
  startRow: number, startCol: number,
  endRow:   number, endCol:   number,
): void {
  const master = ws.getCell(startRow, startCol);
  const masterBdr = master.border ?? ({} as ExcelJS.Borders);
  forEachCellInRange(ws, startRow, startCol, endRow, endCol, (cell) => {
    if (cell.row === startRow && cell.col === startCol) return;
    cell.border = masterBdr;
  });
}

// ─── Public entry ────────────────────────────────────────────────────────────

export function writeRatiosSheets(
  wb:   ExcelJS.Workbook,
  ctx:  Ctx,
  data: Stage7Ratios | null,
): void {
  const noteNo = getNoteNo("ratios") ?? 22;

  // Force Excel to recalculate every formula when the file is opened.
  // Without this, cells using cross-sheet formulas (RATIO!E,F,G,H) keep
  // their cached `result: 0` and the MONEY/PCT formats render them as
  // "-" / "0.00", which looks like the data wasn't auto-populated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (wb as any).calcProperties = { ...(wb as any).calcProperties, fullCalcOnLoad: true };

  // Sheet order MUST match the template: RATIO first, then Current Year,
  // then Previous Year. Cross-sheet formulas in RATIO reference the other
  // sheets by name so resolve order doesn't matter — only display order.
  writeRatioSheet(wb, ctx, data, noteNo);
  writeCYSheet(wb, ctx, data, noteNo);
  writePYSheet(wb, ctx, data, noteNo);
}

// ════════════════════════════════════════════════════════════════════════════
// CY / PY sheet writers
// ════════════════════════════════════════════════════════════════════════════

function writeCYSheet(wb: ExcelJS.Workbook, ctx: Ctx, data: Stage7Ratios | null, _noteNo: number): void {
  const ws = wb.addWorksheet("Current Year ", { views: [{ showGridLines: false }] });
  ws.columns = CY_COLS;
  writeYearSheet(ws, ctx.companyName, ctx.cyYear, data?.cy ?? null);
}

function writePYSheet(wb: ExcelJS.Workbook, ctx: Ctx, data: Stage7Ratios | null, _noteNo: number): void {
  const ws = wb.addWorksheet("Previous Year ", { views: [{ showGridLines: false }] });
  ws.columns = CY_COLS;
  writeYearSheet(ws, ctx.companyName, ctx.pyYear, data?.py ?? null);
}

function writeYearSheet(ws: ExcelJS.Worksheet, companyName: string, yearEnd: number, inp: RatioInputs | null): void {
  // ── Row 2-3: Company name (merged) — bold heading box per template ───────
  ws.mergeCells("B2:H3");
  const c = ws.getCell("B2");
  c.value = companyName;
  applyFont(c, { bold: true, size: 12 });
  c.alignment = { horizontal: "center", vertical: "middle" };
  c.border = HEAD_BDR;                       // medium-weight perimeter
  clearSlaveBorders(ws, 2, 2, 3, 8);          // propagate so bottom/right edges render

  // ── Row 5-6: ANNEXURE heading (merged) — bold heading box per template ───
  // Template wording at B5: "ANNEXURE : A (YYYY-YYYY)" — full year span.
  ws.mergeCells("B5:H6");
  const t = ws.getCell("B5");
  t.value = `ANNEXURE : A (${yearEnd - 1}-${yearEnd})`;
  applyFont(t, { bold: true, size: 11 });
  t.alignment = { horizontal: "center", vertical: "middle" };
  t.border = HEAD_BDR;                        // medium-weight perimeter
  clearSlaveBorders(ws, 5, 2, 6, 8);          // propagate to render bottom/right edges

  // ── Row 8: Header band ────────────────────────────────────────────────────
  const r8 = ws.getRow(8);
  r8.height = 30;
  const hd = (col: number, val: string) => {
    const cell = ws.getCell(8, col);
    cell.value = val;
    applyFont(cell, { bold: true, size: 10 });
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = FULL_BDR;
  };
  hd(2, "NO");
  hd(3, "PARTICULARS");
  hd(4, "NUMERATOR");
  hd(5, "Amount (Rs.)");
  hd(6, "DENOMINATOR");
  hd(7, "Amount (Rs.)");
  hd(8, `Ratio for F.Y.${fyStr(yearEnd)}`);

  // ── Data rows ─────────────────────────────────────────────────────────────
  writeSimpleYearRow(ws,  9, "1", "CURRENT RATIO",
    "Total Current Assets",      v(inp, "current_assets"),
    "Total Current Liabilities", v(inp, "current_liabilities"),
    "times");

  writeSimpleYearRow(ws, 11, "2", "DEBT-EQUITY RATIO",
    "Total Debt",           v(inp, "total_debt"),
    "Shareholder's Equity", v(inp, "shareholders_equity"),
    "times");

  writeDscrBlock(ws, inp); // rows 13..18

  writeSimpleYearRow(ws, 20, "4", "RETURN ON EQUITY RATIO",
    "Net Profit After Tax",        v(inp, "npat"),
    "Average Shareholders Equity", v(inp, "avg_shareholders_equity"),
    "%");
  // Template cross-ref: ROE numerator (NPAT) = DSCR detail row E14
  ws.getCell(20, 5).value = f("+E14");

  writeSimpleYearRow(ws, 22, "5", "INVENTORY TURNOVER RATIO",
    "REVENUE FROM OPERATIONS", v(inp, "revenue_ops"),
    "Average Inventories",     v(inp, "avg_inventories"),
    "times");

  // Note: "TRADE RECEIVALES" (missing 'B') is the exact spelling in the template (C24)
  writeSimpleYearRow(ws, 24, "6", "TRADE RECEIVALES TURNOVER RATIO",
    "Revenue from Operations",   v(inp, "revenue_ops"),
    "Average Trade Receivables", v(inp, "avg_trade_receivables"),
    "times");

  writeSimpleYearRow(ws, 26, "7", "TRADE PAYABLE TURNOVER RATIO",
    "Net Credit Purchases",   v(inp, "net_credit_purchases"),
    "Average Trade Payables", v(inp, "avg_trade_payables"),
    "times");
  // Footnote off the print area in col I — matches template's I26 cell
  const fn = ws.getCell("I26");
  fn.value = ">> Net Credit Purchase will include both RM Purchase and Stock-in trade purchase";
  applyFont(fn, { italic: true, size: 8 });
  fn.alignment = { wrapText: true, vertical: "middle" };

  writeSimpleYearRow(ws, 28, "8", "NET CAPITAL TURNOVER RATIO",
    "Revenue from Operations", v(inp, "revenue_ops"),
    "Working Capital",         v(inp, "working_capital"),
    "times");

  writeSimpleYearRow(ws, 30, "9", "NET PROFIT RATIO",
    "Net Profit After Tax",    v(inp, "npat"),
    "Revenue from Operations", v(inp, "revenue_ops"),
    "%");
  // Template cross-refs: Net Profit num = ROE num (E20 = NPAT); den = Inventory num (E22 = Revenue)
  ws.getCell(30, 5).value = f("+E20");
  ws.getCell(30, 7).value = f("+E22");

  writeRoceBlock(ws, inp); // rows 32..39

  writeSimpleYearRow(ws, 41, "11", "RETURN ON INVESTMENT",
    "Return / Profit / Earning", v(inp, "return_profit"),
    "Average Investment Fund",   v(inp, "avg_investment_fund"),
    "%");

  // ── Spacer rows: extend vertical column lines through the gaps ──────────
  // Without this, the CY/PY table looks broken: each ratio block has a
  // bordered top and bottom but the columns don't visually connect to
  // the next block. Template shows continuous vertical rules.
  const spacerRows = [10, 12, 19, 21, 23, 25, 27, 29, 31, 40];
  for (const r of spacerRows) {
    ws.getRow(r).height = 6;
    for (let col = 2; col <= 8; col++) {
      ws.getCell(r, col).border = SIDE_BDR;
    }
  }
}

/** One simple ratio row + blank spacer underneath. */
function writeSimpleYearRow(
  ws:        ExcelJS.Worksheet,
  r:         number,
  no:        string,
  name:      string,
  numLabel:  string,
  numAmt:    number,
  denLabel:  string,
  denAmt:    number,
  unit:      "times" | "%",
): void {
  ws.getRow(r).height = 18;

  const setCell = (col: number, value: any, opts: { bold?: boolean; align?: ExcelJS.Alignment["horizontal"]; numFmt?: string } = {}) => {
    const cell = ws.getCell(r, col);
    cell.value = value;
    applyFont(cell, { bold: opts.bold, size: 10 });
    cell.alignment = { horizontal: opts.align ?? "left", vertical: "middle", wrapText: true };
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    cell.border = FULL_BDR;
  };

  setCell(2, no,        { bold: true,  align: "center" });
  setCell(3, name,      { bold: true,  align: "left"   });
  setCell(4, numLabel,  { align: "left"   });
  setCell(5, numAmt,    { align: "right", numFmt: MONEY_FMT });
  setCell(6, denLabel,  { align: "left"   });
  setCell(7, denAmt,    { align: "right", numFmt: MONEY_FMT });

  // Ratio = num/den. % ratios are stored as raw decimal (template behaviour).
  setCell(8, f(`IFERROR(E${r}/G${r}${unit === "%" ? "" : ""},"N.A.")`),
    { bold: true, align: "center", numFmt: unit === "%" ? PCT_FMT : RATIO_FMT });
}

/** DSCR ratio — rows 13..18 (B13:B18 / C13:C18 merged). */
function writeDscrBlock(ws: ExcelJS.Worksheet, inp: RatioInputs | null): void {
  const r0 = 13;
  // Merge NO + PARTICULARS for the whole block
  ws.mergeCells(`B${r0}:B${r0 + 5}`);
  ws.mergeCells(`C${r0}:C${r0 + 5}`);

  const noC = ws.getCell(r0, 2);
  noC.value = "3";
  applyFont(noC, { bold: true, size: 10 });
  noC.alignment = { horizontal: "center", vertical: "middle" };
  noC.border = FULL_BDR;

  const nmC = ws.getCell(r0, 3);
  nmC.value = "DEBT SERVICE COVERAGE RATIO";
  applyFont(nmC, { bold: true, size: 10 });
  nmC.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  nmC.border = FULL_BDR;

  clearSlaveBorders(ws, r0, 2, r0 + 5, 2);
  clearSlaveBorders(ws, r0, 3, r0 + 5, 3);

  // Header row (r0): NUM and DEN section labels in cols D, F
  // Trailing spaces on both labels are verbatim from the template
  setLabel(ws, r0, 4, "EARNING AVAILABLE FOR DEBT SERVICE ", { bold: true, italic: true });
  setLabel(ws, r0, 6, "DEBT SERVICE ",                       { bold: true, italic: true });
  emptyAmt(ws, r0, 5);
  emptyAmt(ws, r0, 7);
  // Ratio cell on TOTAL row only
  ws.getCell(r0, 8).border = FULL_BDR;

  // Detail rows
  // r0+1: Net Profit After Taxes      | Interest & Lease Payment
  // r0+2: Non Cash Operating Expenses | Principal Repayments
  // r0+3: Interest                    | (blank)
  // r0+4: Other Non Cash Adjustment   | (blank)
  // r0+5: TOTAL = SUM(E14:E17) / SUM(G14:G15)
  setDetail(ws, r0 + 1, "Net Profit After Taxes",      v(inp, "npat"),                "Interest & Lease Payment", v(inp, "interest_lease"));
  setDetail(ws, r0 + 2, "Non Cash Operating Expenses", v(inp, "non_cash_op_exp"),     "Principal Repayments",     v(inp, "principal_repayments"));
  setDetail(ws, r0 + 3, "Interest",                    v(inp, "interest"),            "",                          null);
  setDetail(ws, r0 + 4, "Other Non Cash Adjustment",   v(inp, "other_non_cash_adj"),  "",                          null);

  // TOTAL row
  setLabel(ws, r0 + 5, 4, "TOTAL", { bold: true });
  const numTot = ws.getCell(r0 + 5, 5);
  numTot.value = f(`SUM(E${r0 + 1}:E${r0 + 4})`);
  numTot.numFmt = MONEY_FMT;
  applyFont(numTot, { bold: true, size: 10 });
  numTot.alignment = { horizontal: "right", vertical: "middle" };
  numTot.border = FULL_BDR;

  setLabel(ws, r0 + 5, 6, "TOTAL", { bold: true });
  const denTot = ws.getCell(r0 + 5, 7);
  denTot.value = f(`SUM(G${r0 + 1}:G${r0 + 2})`);
  denTot.numFmt = MONEY_FMT;
  applyFont(denTot, { bold: true, size: 10 });
  denTot.alignment = { horizontal: "right", vertical: "middle" };
  denTot.border = FULL_BDR;

  const ratioCell = ws.getCell(r0 + 5, 8);
  ratioCell.value = f(`IFERROR(E${r0 + 5}/G${r0 + 5},"N.A.")`);
  ratioCell.numFmt = RATIO_FMT;
  applyFont(ratioCell, { bold: true, size: 10 });
  ratioCell.alignment = { horizontal: "center", vertical: "middle" };
  ratioCell.border = FULL_BDR;
}

/** ROCE ratio — rows 32..39 (B32:B39 / C32:C39 merged). */
function writeRoceBlock(ws: ExcelJS.Worksheet, inp: RatioInputs | null): void {
  const r0 = 32;
  ws.mergeCells(`B${r0}:B${r0 + 7}`);
  ws.mergeCells(`C${r0}:C${r0 + 7}`);

  const noC = ws.getCell(r0, 2);
  noC.value = "10";
  applyFont(noC, { bold: true, size: 10 });
  noC.alignment = { horizontal: "center", vertical: "middle" };
  noC.border = FULL_BDR;

  const nmC = ws.getCell(r0, 3);
  nmC.value = "RETURN ON CAPITAL EMPLOYED";
  applyFont(nmC, { bold: true, size: 10 });
  nmC.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  nmC.border = FULL_BDR;

  clearSlaveBorders(ws, r0, 2, r0 + 7, 2);
  clearSlaveBorders(ws, r0, 3, r0 + 7, 3);

  // "INTERST" is the template's spelling — preserved verbatim
  setLabel(ws, r0, 4, "EARNINGS BEFORE INTERST AND TAXES", { bold: true, italic: true });
  setLabel(ws, r0, 6, "CAPITAL EMPLOYED",                  { bold: true, italic: true });
  emptyAmt(ws, r0, 5);
  emptyAmt(ws, r0, 7);
  ws.getCell(r0, 8).border = FULL_BDR;

  // Detail rows
  // r0+1: NET PROFIT BEFORE TAX | NET WORTH
  // r0+2: INTEREST              | LONG-TERM BORROWINGS
  // r0+3..r0+6: blank reserved rows
  // r0+7: TOTAL = SUM(E33:E38) / SUM(G33:G38)
  setDetail(ws, r0 + 1, "Net Profit Before Tax", v(inp, "npbt"),     "Net Worth",            v(inp, "net_worth"));
  setDetail(ws, r0 + 2, "Interest",              v(inp, "interest"), "Long-Term Borrowings", v(inp, "lt_borrowings"));
  // Template cross-ref: ROCE Interest (E34) = DSCR Interest row E16
  ws.getCell(r0 + 2, 5).value = f("E16");
  for (let i = 3; i <= 6; i++) setDetail(ws, r0 + i, "", null, "", null);

  setLabel(ws, r0 + 7, 4, "TOTAL", { bold: true });
  const numTot = ws.getCell(r0 + 7, 5);
  numTot.value = f(`SUM(E${r0 + 1}:E${r0 + 6})`);
  numTot.numFmt = MONEY_FMT;
  applyFont(numTot, { bold: true, size: 10 });
  numTot.alignment = { horizontal: "right", vertical: "middle" };
  numTot.border = FULL_BDR;

  setLabel(ws, r0 + 7, 6, "TOTAL", { bold: true });
  const denTot = ws.getCell(r0 + 7, 7);
  denTot.value = f(`SUM(G${r0 + 1}:G${r0 + 6})`);
  denTot.numFmt = MONEY_FMT;
  applyFont(denTot, { bold: true, size: 10 });
  denTot.alignment = { horizontal: "right", vertical: "middle" };
  denTot.border = FULL_BDR;

  const ratioCell = ws.getCell(r0 + 7, 8);
  ratioCell.value = f(`IFERROR(E${r0 + 7}/G${r0 + 7},"N.A.")`);
  ratioCell.numFmt = PCT_FMT;
  applyFont(ratioCell, { bold: true, size: 10 });
  ratioCell.alignment = { horizontal: "center", vertical: "middle" };
  ratioCell.border = FULL_BDR;
}

function setLabel(ws: ExcelJS.Worksheet, r: number, c: number, val: string, opts: { bold?: boolean; italic?: boolean } = {}): void {
  const cell = ws.getCell(r, c);
  cell.value = val;
  applyFont(cell, { bold: !!opts.bold, italic: !!opts.italic, size: 10 });
  cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  cell.border = FULL_BDR;
}

function emptyAmt(ws: ExcelJS.Worksheet, r: number, c: number): void {
  const cell = ws.getCell(r, c);
  cell.border = FULL_BDR;
}

function setDetail(ws: ExcelJS.Worksheet, r: number, numLabel: string, numAmt: number | null, denLabel: string, denAmt: number | null): void {
  ws.getRow(r).height = 16;

  // Cols B/C are merged in the parent block — leave them with just side borders
  ws.getCell(r, 2).border = SIDE_BDR;
  ws.getCell(r, 3).border = SIDE_BDR;

  setLabel(ws, r, 4, numLabel);
  const eC = ws.getCell(r, 5);
  if (numAmt !== null) {
    eC.value = numAmt;
    eC.numFmt = MONEY_FMT;
    applyFont(eC, { size: 10 });
    eC.alignment = { horizontal: "right", vertical: "middle" };
  }
  eC.border = FULL_BDR;

  setLabel(ws, r, 6, denLabel);
  const gC = ws.getCell(r, 7);
  if (denAmt !== null) {
    gC.value = denAmt;
    gC.numFmt = MONEY_FMT;
    applyFont(gC, { size: 10 });
    gC.alignment = { horizontal: "right", vertical: "middle" };
  }
  gC.border = FULL_BDR;

  // H column placeholder border so the right column closes properly
  ws.getCell(r, 8).border = FULL_BDR;
}

// ════════════════════════════════════════════════════════════════════════════
// RATIO summary sheet
// ════════════════════════════════════════════════════════════════════════════

function writeRatioSheet(wb: ExcelJS.Workbook, ctx: Ctx, data: Stage7Ratios | null, noteNo: number): void {
  const ws = wb.addWorksheet("RATIO", { views: [{ showGridLines: false }] });
  ws.columns = RAT_COLS;

  const { cyYear, pyYear, companyName } = ctx;

  // ── Row 2: Company name (merged B2:H2) ──────────────────────────────────
  ws.mergeCells("B2:H2");
  const cn = ws.getCell("B2");
  cn.value = companyName;
  applyFont(cn, { bold: true, size: 12 });
  cn.alignment = { horizontal: "center", vertical: "middle" };
  clearSlaveBorders(ws, 2, 2, 2, 8);
  ws.getRow(2).height = 22.5;

  ws.getRow(3).height = 9;

  // ── Row 4: NOTE - NN : RATIO (bold + underline per template) ────────────
  const nt = ws.getCell("B4");
  nt.value = `NOTE - ${noteNo} : RATIO`;
  nt.font = { name: FONT, size: 11, bold: true, underline: true };
  nt.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(4).height = 15.75;

  ws.getRow(5).height = 5.25;

  // ── Rows 6-7: Header band (rowspan-2 merges) ────────────────────────────
  ws.mergeCells("B6:B7"); ws.mergeCells("C6:C7");
  ws.mergeCells("E6:E7"); ws.mergeCells("F6:F7");
  ws.mergeCells("G6:G7"); ws.mergeCells("H6:H7");

  const hd = (cellRef: string, val: string) => {
    const c = ws.getCell(cellRef);
    c.value = val;
    applyFont(c, { bold: true, size: 10 });
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = FULL_BDR;
  };
  hd("B6", "NO");
  hd("C6", "PARTICULARS");
  // D6 / D7 are NOT merged — they hold "NUMERATOR" / "DENOMINATOR" stacked
  hd("D6", "NUMERATOR");
  hd("D7", "DENOMINATOR");
  hd("E6", "Amount (Rs.)");
  hd("F6", `Current Year ${fyStr(cyYear)}`);
  hd("G6", `Previous Year ${fyStr(pyYear)}`);
  hd("H6", "Variance");

  // Clear slave-cell borders so merged ranges render as one box (no
  // internal divider line between row 6 and row 7).
  for (const colIdx of [2, 3, 5, 6, 7, 8]) {
    clearSlaveBorders(ws, 6, colIdx, 7, colIdx);
  }

  ws.getRow(6).height = 20.25;
  ws.getRow(7).height = 20.25;

  // ── Ratio data blocks ───────────────────────────────────────────────────
  LAYOUTS.forEach((lay) => {
    const numRow = RATIO_FIRST_ROW + (lay.id - 1) * RATIO_BLOCK_ROWS; // num + den + text + spacer
    const denRow = numRow + 1;
    const txtRow = numRow + 2;
    const spcRow = numRow + 3;

    const cmt = data?.commentary?.find((c) => c.ratioId === lay.id)?.text ?? "";

    // Pre-compute CY/PY numerator/denominator/ratio so the cross-sheet
    // formulas have a correct cached `result` and display real values
    // immediately — even before Excel triggers recalculation.
    const cyComp = ratioComputed(lay.id, data?.cy ?? null);
    const pyComp = ratioComputed(lay.id, data?.py ?? null);

    writeRatioBlock(ws, lay, numRow, denRow, txtRow, spcRow, cmt, cyComp, pyComp);
  });
}

/** Write one ratio's 4-row block on the RATIO sheet. */
function writeRatioBlock(
  ws:    ExcelJS.Worksheet,
  lay:   RatioLayout,
  numR:  number,
  denR:  number,
  txtR:  number,
  spcR:  number,
  cmt:   string,
  cyComp: { num: number; den: number; ratio: number },
  pyComp: { num: number; den: number; ratio: number },
): void {
  ws.getRow(numR).height = 16;
  ws.getRow(denR).height = 16;
  ws.getRow(txtR).height = 18;
  ws.getRow(spcR).height = 5;

  const cySheet = "Current Year ";
  const pySheet = "Previous Year ";

  // ── Col B (NO) & C (PARTICULARS) — merged across num + den rows ─────────
  ws.mergeCells(`B${numR}:B${denR}`);
  ws.mergeCells(`C${numR}:C${denR}`);

  const noC = ws.getCell(numR, 2);
  noC.value = lay.id;
  applyFont(noC, { bold: true, size: 10 });
  noC.alignment = { horizontal: "center", vertical: "middle" };
  noC.border = FULL_BDR;

  const nmC = ws.getCell(numR, 3);
  nmC.value = lay.name;
  applyFont(nmC, { bold: true, size: 10 });
  nmC.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  nmC.border = FULL_BDR;

  clearSlaveBorders(ws, numR, 2, denR, 2);
  clearSlaveBorders(ws, numR, 3, denR, 3);

  // ── Col D (numerator label) — top half ──────────────────────────────────
  // Use literal text from the template (via lay.numLabel) — not a formula
  const numLbl = ws.getCell(numR, 4);
  numLbl.value = lay.numLabel;
  applyFont(numLbl, { size: 10 });
  numLbl.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  numLbl.border = FULL_BDR;

  // ── Col D (denominator label) — bottom half ─────────────────────────────
  const denLbl = ws.getCell(denR, 4);
  denLbl.value = lay.denLabel;
  applyFont(denLbl, { size: 10 });
  denLbl.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  denLbl.border = FULL_BDR;

  // ── Col E (numerator amount) — top half ─────────────────────────────────
  // Pre-computed `cyComp.num` is supplied as the formula's cached result,
  // so the value renders correctly even when Excel doesn't recalculate
  // cross-sheet refs on open.
  const numAmt = ws.getCell(numR, 5);
  numAmt.value = f(`'${cySheet}'!E${lay.numTotRow}`, cyComp.num);
  numAmt.numFmt = MONEY_FMT;
  applyFont(numAmt, { size: 10 });
  numAmt.alignment = { horizontal: "right", vertical: "middle" };
  numAmt.border = FULL_BDR;

  // ── Col E (denominator amount) — bottom half ────────────────────────────
  const denAmt = ws.getCell(denR, 5);
  denAmt.value = f(`'${cySheet}'!G${lay.denTotRow}`, cyComp.den);
  denAmt.numFmt = MONEY_FMT;
  applyFont(denAmt, { size: 10 });
  denAmt.alignment = { horizontal: "right", vertical: "middle" };
  denAmt.border = FULL_BDR;

  // ── Col F (CY ratio) — merged across num + den rows ─────────────────────
  ws.mergeCells(`F${numR}:F${denR}`);
  const cyR = ws.getCell(numR, 6);
  cyR.value = f(`IFERROR('${cySheet}'!H${lay.cyRow},"N.A.")`, cyComp.ratio);
  cyR.numFmt = lay.unit === "%" ? PCT_FMT : RATIO_FMT;
  applyFont(cyR, { bold: true, size: 10 });
  cyR.alignment = { horizontal: "center", vertical: "middle" };
  cyR.border = FULL_BDR;
  clearSlaveBorders(ws, numR, 6, denR, 6);

  // ── Col G (PY ratio) — merged across num + den rows ─────────────────────
  ws.mergeCells(`G${numR}:G${denR}`);
  const pyR = ws.getCell(numR, 7);
  pyR.value = f(`IFERROR('${pySheet}'!H${lay.cyRow},"N.A.")`, pyComp.ratio);
  pyR.numFmt = lay.unit === "%" ? PCT_FMT : RATIO_FMT;
  applyFont(pyR, { bold: true, size: 10 });
  pyR.alignment = { horizontal: "center", vertical: "middle" };
  pyR.border = FULL_BDR;
  clearSlaveBorders(ws, numR, 7, denR, 7);

  // ── Col H (Variance) — merged across num + den rows ─────────────────────
  // Template formula: (F-G)/G  (no ABS, no IFERROR)
  // We wrap in IFERROR for safety — template's lack of guard renders #DIV/0
  // when PY=0 which is jarring to auditors.
  ws.mergeCells(`H${numR}:H${denR}`);
  const vR = ws.getCell(numR, 8);
  const variance = pyComp.ratio !== 0 ? (cyComp.ratio - pyComp.ratio) / pyComp.ratio : 0;
  vR.value = f(`IFERROR((F${numR}-G${numR})/G${numR},"N.A.")`, variance);
  vR.numFmt = PCT_FMT;
  applyFont(vR, { size: 10 });
  vR.alignment = { horizontal: "center", vertical: "middle" };
  vR.border = FULL_BDR;
  clearSlaveBorders(ws, numR, 8, denR, 8);

  // ── Text/commentary row — full-width merge ──────────────────────────────
  ws.mergeCells(`B${txtR}:H${txtR}`);
  const txtC = ws.getCell(txtR, 2);
  txtC.value = cmt || "Text";
  applyFont(txtC, { italic: true, size: 9 });
  txtC.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  txtC.border = FULL_BDR;
  clearSlaveBorders(ws, txtR, 2, txtR, 8);

  // ── Spacer row — NO borders (template shows a clean gap between blocks) ──
  // Explicitly clear so neighbouring cells' borders don't bleed into this row.
  for (let col = 2; col <= 8; col++) {
    ws.getCell(spcR, col).border = {} as ExcelJS.Borders;
  }
}

// Re-exports — keep backward-compatible names if any external callers rely
// on the legacy helpers. None do at the time of this rewrite, but TypeScript
// `unused` warnings would otherwise fire on the imports above.
export { TOP_SIDE as _TOP_SIDE, BOT_SIDE as _BOT_SIDE };
