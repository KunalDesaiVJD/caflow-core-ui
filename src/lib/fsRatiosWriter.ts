/**
 * fsRatiosWriter
 * ─────────────────────────────────────────────────────────────────────────
 * Phase UI-8 / Phase 7 — Appends 3 ratio sheets to the FS workbook:
 *
 *   "RATIO"           — 11-ratio summary table (matches Excel "RATIO" sheet)
 *   "Current Year "   — Detailed CY inputs with IFERROR/SUM formulas
 *   "Previous Year "  — Identical structure, PY data
 *
 * Sheet names follow Ratio.xlsx exactly (incl. trailing spaces on CY/PY).
 * Cross-sheet formula targets:
 *   RATIO!E8  = 'Current Year '!E9              (Ratio 1 numerator amount)
 *   RATIO!E9  = 'Current Year '!G9              (Ratio 1 denominator amount)
 *   RATIO!F8  = IFERROR('Current Year '!H9,"N.A.")
 *   RATIO!G8  = IFERROR('Previous Year '!H9,"N.A.")
 *   RATIO!H8  = IFERROR((F8-G8)/ABS(G8),"N.A.") (Variance formula)
 *   … and so on for all 11 ratios.
 *
 * SUM formulas for multi-row ratios:
 *   Ratio 3 (DSCR)  Num TOTAL E15 = SUM(E11:E14); Den TOTAL G13 = SUM(G11:G12)
 *   Ratio 10 (ROCE) Num TOTAL E24 = SUM(E22:E23); Den TOTAL G24 = SUM(G22:G23)
 *
 * Input values are pulled from stage7_ratios.cy / .py  RatioInputs objects.
 * When ratiosData is null all input cells default to 0 and formulas still
 * evaluate to "N.A." (division by zero protection).
 */

import type ExcelJS from "exceljs";
import type { Stage7Ratios, RatioInputs } from "./ratioAutoPopulate";
import { getNoteNo } from "./noteNumberRegistry";

// ─── Formatting ───────────────────────────────────────────────────────────────

const MONEY_FMT  = '#,##0.00;(#,##0.00);"-"';
const THIN_BLACK = { style: "thin" as const, color: { argb: "FF000000" } };
const FULL_BDR   = { top: THIN_BLACK, bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK };
const SIDE_BDR   = { left: THIN_BLACK, right: THIN_BLACK };
const TOP_BDR    = { top: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK };
const BOT_BDR    = { bottom: THIN_BLACK, left: THIN_BLACK, right: THIN_BLACK };

const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const SUB_FILL:  ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2FF" } };
const TOT_FILL:  ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };

// ─── Context ──────────────────────────────────────────────────────────────────

interface Ctx {
  cyYear:      number;
  pyYear:      number;
  companyName: string;
}

// ─── Column definitions ───────────────────────────────────────────────────────

/** "Current Year " / "Previous Year " sheets: A-H */
const CY_COLS: Partial<ExcelJS.Column>[] = [
  { width: 2.0  },   // A  spacer
  { width: 5.0  },   // B  NO
  { width: 24.0 },   // C  PARTICULARS
  { width: 29.0 },   // D  NUMERATOR label
  { width: 16.0 },   // E  Amount (Rs.) — numerator
  { width: 29.0 },   // F  DENOMINATOR label
  { width: 16.0 },   // G  Amount (Rs.) — denominator
  { width: 11.0 },   // H  Ratio
];

/** RATIO sheet: A-H */
const RAT_COLS: Partial<ExcelJS.Column>[] = [
  { width: 2.0  },   // A  spacer
  { width: 5.0  },   // B  NO
  { width: 24.0 },   // C  PARTICULARS (ratio name)
  { width: 32.0 },   // D  NUMERATOR / DENOMINATOR label
  { width: 16.0 },   // E  Amount (Rs.)
  { width: 11.0 },   // F  CY Ratio
  { width: 11.0 },   // G  PY Ratio
  { width: 12.0 },   // H  Variance
];

// ─── Row map for "Current Year " / "Previous Year " sheets ───────────────────
//
//  Rows 1-8  = headers + column-header row
//  Row 9     = Ratio 1  (Current Ratio) — 1 row
//  Row 10    = Ratio 2  (Debt-Equity)   — 1 row
//  Rows 11-15 = Ratio 3 (DSCR)         — 5 rows (4 num inputs + num TOTAL; 2 den inputs + den TOTAL + 2 blanks)
//  Row 16    = Ratio 4  (ROE)           — 1 row
//  Row 17    = Ratio 5  (Inventory)     — 1 row
//  Row 18    = Ratio 6  (Trade Rec)     — 1 row
//  Row 19    = Ratio 7  (Trade Pay)     — 1 row
//  Row 20    = Ratio 8  (Net Capital)   — 1 row
//  Row 21    = Ratio 9  (Net Profit)    — 1 row
//  Rows 22-24 = Ratio 10 (ROCE)        — 3 rows (2 inputs + TOTAL each side)
//  Row 25    = Ratio 11 (ROI)           — 1 row

interface RatioLayout {
  id:        number;
  name:      string;
  unit:      "times" | "%";
  // CY/PY sheet: row that holds the RATIO formula in col H (and amounts in E, G)
  cyRow:     number;
  // For multi-row ratios, the num total row and den total row differ from cyRow
  numTotRow: number;   // row of E (numerator amount or TOTAL)
  denTotRow: number;   // row of G (denominator amount or TOTAL)
}

const LAYOUTS: RatioLayout[] = [
  { id: 1,  name: "CURRENT RATIO",                    unit: "times", cyRow:  9, numTotRow:  9, denTotRow:  9 },
  { id: 2,  name: "DEBT-EQUITY RATIO",                unit: "times", cyRow: 10, numTotRow: 10, denTotRow: 10 },
  { id: 3,  name: "DEBT SERVICE COVERAGE RATIO",      unit: "times", cyRow: 11, numTotRow: 15, denTotRow: 13 },
  { id: 4,  name: "RETURN ON EQUITY RATIO",           unit: "%",     cyRow: 16, numTotRow: 16, denTotRow: 16 },
  { id: 5,  name: "INVENTORY TURNOVER RATIO",         unit: "times", cyRow: 17, numTotRow: 17, denTotRow: 17 },
  { id: 6,  name: "TRADE RECEIVABLES TURNOVER RATIO", unit: "times", cyRow: 18, numTotRow: 18, denTotRow: 18 },
  { id: 7,  name: "TRADE PAYABLE TURNOVER RATIO",     unit: "times", cyRow: 19, numTotRow: 19, denTotRow: 19 },
  { id: 8,  name: "NET CAPITAL TURNOVER RATIO",       unit: "times", cyRow: 20, numTotRow: 20, denTotRow: 20 },
  { id: 9,  name: "NET PROFIT RATIO",                 unit: "%",     cyRow: 21, numTotRow: 21, denTotRow: 21 },
  { id: 10, name: "RETURN ON CAPITAL EMPLOYED",       unit: "%",     cyRow: 22, numTotRow: 24, denTotRow: 24 },
  { id: 11, name: "RETURN ON INVESTMENT",             unit: "%",     cyRow: 25, numTotRow: 25, denTotRow: 25 },
];

// RATIO sheet: each ratio occupies 2 data rows + 1 commentary row = 3 rows
// Ratio 1 starts at row 8 (7 header rows above)
const RATIO_HDR_ROWS = 7;
function ratioSheetRow(ratioId: number): number {
  return RATIO_HDR_ROWS + 1 + (ratioId - 1) * 3;  // numerator row
}
// denominator row = ratioSheetRow + 1; commentary row = ratioSheetRow + 2

// ─── Helpers ──────────────────────────────────────────────────────────────────

function v(inputs: RatioInputs | null, field: keyof RatioInputs): number {
  if (!inputs) return 0;
  const val = inputs[field];
  return typeof val === "number" && Number.isFinite(val) ? val : 0;
}

function formula(f: string): ExcelJS.CellFormulaValue {
  return { formula: f, result: 0 } as ExcelJS.CellFormulaValue;
}

function pct(unit: "times" | "%"): boolean { return unit === "%"; }

// ─── Ratio formula for CY/PY sheet col H ─────────────────────────────────────
// Multiples by 100 for % ratios so Excel displays the same value as the UI.
function ratioFormula(numCell: string, denCell: string, unit: "times" | "%"): ExcelJS.CellFormulaValue {
  const calc = pct(unit)
    ? `IFERROR(${numCell}/${denCell}*100,"N.A.")`
    : `IFERROR(${numCell}/${denCell},"N.A.")`;
  return formula(calc);
}

function mergeWrite(
  ws: ExcelJS.Worksheet,
  range: string,
  value: string | ExcelJS.CellFormulaValue | number,
  style: Partial<ExcelJS.Style> = {},
) {
  ws.mergeCells(range);
  const cell = ws.getCell(range.split(":")[0]);
  cell.value = value;
  Object.assign(cell, style);
}

function setStyle(cell: ExcelJS.Cell, style: Partial<ExcelJS.Style>) {
  Object.assign(cell, style);
}

// ─── Main writer ─────────────────────────────────────────────────────────────

export function writeRatiosSheets(
  wb:   ExcelJS.Workbook,
  ctx:  Ctx,
  data: Stage7Ratios | null,
): void {
  const noteNo = getNoteNo("ratios") ?? 31;

  writeCYSheet(wb, ctx, data, noteNo);
  writePYSheet(wb, ctx, data, noteNo);
  writeRatioSheet(wb, ctx, data, noteNo);   // RATIO last (cross-refs CY/PY)
}

// ═════════════════════════════════════════════════════════════════════════════
// "Current Year " sheet
// ═════════════════════════════════════════════════════════════════════════════

function writeCYSheet(
  wb:     ExcelJS.Workbook,
  ctx:    Ctx,
  data:   Stage7Ratios | null,
  noteNo: number,
): void {
  const ws = wb.addWorksheet("Current Year ", { views: [{ showGridLines: false }] });
  ws.columns = CY_COLS;

  const inputs = data?.cy ?? null;
  const { cyYear, pyYear, companyName } = ctx;
  const fyStr = `${cyYear - 1}-${String(cyYear).slice(-2)}`;

  // ── Header rows (1-8) ─────────────────────────────────────────────────────
  // Row 1: Company name
  ws.mergeCells("B1:H1");
  const r1 = ws.getCell("B1");
  r1.value = companyName;
  r1.font  = { bold: true, size: 12 };
  r1.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 18;

  // Row 2: Title
  ws.mergeCells("B2:H2");
  const r2 = ws.getCell("B2");
  r2.value = `ANNEXURE : A (CY ${fyStr})`;
  r2.font  = { bold: true, size: 11 };
  r2.alignment = { horizontal: "center" };
  ws.getRow(2).height = 16;

  // Row 3: Note reference
  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = `Note - ${noteNo} : RATIO`;
  ws.getCell("B3").font  = { bold: true, size: 10 };
  ws.getCell("B3").alignment = { horizontal: "center" };

  // Rows 4-6: spacer / info
  ws.getRow(4).height = 6;
  ws.mergeCells("B5:H5");
  ws.getCell("B5").value = `For the year ended 31st March, ${cyYear}`;
  ws.getCell("B5").font  = { italic: true, size: 9 };
  ws.getRow(6).height = 6;

  // Row 7: Amount unit note
  ws.mergeCells("B7:H7");
  ws.getCell("B7").value = "(Amount in Rs.)";
  ws.getCell("B7").font  = { italic: true, size: 9 };
  ws.getCell("B7").alignment = { horizontal: "right" };

  // Row 8: Column headers
  writeCYColHeaders(ws, 8);

  // ── Data rows ─────────────────────────────────────────────────────────────
  writeR1(ws, inputs, 9);   // Ratio 1
  writeR2(ws, inputs, 10);  // Ratio 2
  writeR3(ws, inputs, 11);  // Ratio 3 (DSCR, 5 rows: 11-15)
  writeR4(ws, inputs, 16);  // Ratio 4
  writeR5(ws, inputs, 17);  // Ratio 5
  writeR6(ws, inputs, 18);  // Ratio 6
  writeR7(ws, inputs, 19);  // Ratio 7
  writeR8(ws, inputs, 20);  // Ratio 8
  writeR9(ws, inputs, 21);  // Ratio 9
  writeR10(ws, inputs, 22); // Ratio 10 (ROCE, 3 rows: 22-24)
  writeR11(ws, inputs, 25); // Ratio 11
}

// ─── Column header row ────────────────────────────────────────────────────────

function writeCYColHeaders(ws: ExcelJS.Worksheet, row: number): void {
  const r = ws.getRow(row);
  r.height = 28;

  const hdStyle = (col: number, val: string) => {
    const c = ws.getCell(row, col);
    c.value = val;
    c.font  = { bold: true, size: 9 };
    c.fill  = HEAD_FILL;
    c.border = FULL_BDR as ExcelJS.Borders;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  hdStyle(2, "NO");
  hdStyle(3, "PARTICULARS");
  hdStyle(4, "NUMERATOR");
  hdStyle(5, "Amount (Rs.)");
  hdStyle(6, "DENOMINATOR");
  hdStyle(7, "Amount (Rs.)");
  hdStyle(8, "Ratio");
}

// ─── Per-ratio writers for "Current Year " / "Previous Year " ────────────────

/** Write one simple ratio row (single num + single den on same Excel row). */
function writeSimpleRow(
  ws:        ExcelJS.Worksheet,
  inputs:    RatioInputs | null,
  r:         number,
  no:        string,
  name:      string,
  numLabel:  string,
  numField:  keyof RatioInputs,
  denLabel:  string,
  denField:  keyof RatioInputs,
  unit:      "times" | "%",
  footnote?: string,
): void {
  const row   = ws.getRow(r);
  row.height  = 18;

  const no_c  = ws.getCell(r, 2);
  const nm_c  = ws.getCell(r, 3);
  const nl_c  = ws.getCell(r, 4);
  const na_c  = ws.getCell(r, 5);
  const dl_c  = ws.getCell(r, 6);
  const da_c  = ws.getCell(r, 7);
  const rt_c  = ws.getCell(r, 8);

  no_c.value = no;
  no_c.font  = { bold: true, size: 9 };
  no_c.alignment = { horizontal: "center", vertical: "middle" };
  no_c.border = FULL_BDR as ExcelJS.Borders;

  nm_c.value = footnote ? `${name}\n${footnote}` : name;
  nm_c.font  = { bold: true, size: 9 };
  nm_c.alignment = { wrapText: true, vertical: "middle" };
  nm_c.border = FULL_BDR as ExcelJS.Borders;

  nl_c.value = numLabel;
  nl_c.font  = { size: 9 };
  nl_c.alignment = { vertical: "middle", wrapText: true };
  nl_c.border = FULL_BDR as ExcelJS.Borders;

  na_c.value = v(inputs, numField);
  na_c.numFmt = MONEY_FMT;
  na_c.font   = { size: 9 };
  na_c.alignment = { horizontal: "right", vertical: "middle" };
  na_c.border = FULL_BDR as ExcelJS.Borders;

  dl_c.value = denLabel;
  dl_c.font  = { size: 9 };
  dl_c.alignment = { vertical: "middle", wrapText: true };
  dl_c.border = FULL_BDR as ExcelJS.Borders;

  da_c.value = v(inputs, denField);
  da_c.numFmt = MONEY_FMT;
  da_c.font   = { size: 9 };
  da_c.alignment = { horizontal: "right", vertical: "middle" };
  da_c.border = FULL_BDR as ExcelJS.Borders;

  rt_c.value  = ratioFormula(`E${r}`, `G${r}`, unit);
  rt_c.numFmt = pct(unit) ? '0.00"%"' : '0.00';
  rt_c.font   = { bold: true, size: 9 };
  rt_c.alignment = { horizontal: "center", vertical: "middle" };
  rt_c.border = FULL_BDR as ExcelJS.Borders;
}

// Ratio 1 — Current Ratio
function writeR1(ws: ExcelJS.Worksheet, inp: RatioInputs | null, startRow: number): void {
  writeSimpleRow(ws, inp, startRow, "1", "CURRENT RATIO",
    "Total Current Assets",      "current_assets",
    "Total Current Liabilities", "current_liabilities",
    "times");
}

// Ratio 2 — Debt-Equity Ratio
function writeR2(ws: ExcelJS.Worksheet, inp: RatioInputs | null, startRow: number): void {
  writeSimpleRow(ws, inp, startRow, "2", "DEBT-EQUITY RATIO",
    "Total Debt",           "total_debt",
    "Shareholder's Equity", "shareholders_equity",
    "times");
}

// Ratio 3 — DSCR (5 rows: rows startRow..startRow+4)
// Row layout:
//   +0: NPAT (num)          | Interest & Lease Payment (den)
//   +1: Non Cash Op Exp     | Principal Repayments
//   +2: Interest            | TOTAL DEN  = SUM(G+0:G+1)
//   +3: Other Non Cash Adj  | (blank)
//   +4: TOTAL NUM = SUM(E+0:E+3) | (blank) | Ratio = IFERROR(E+4/G+2,"N.A.")
function writeR3(ws: ExcelJS.Worksheet, inp: RatioInputs | null, startRow: number): void {
  const r = startRow;
  const ht = 16;

  type RowDef = [
    numLabel: string, numField: keyof RatioInputs | null,
    denLabel: string, denField: keyof RatioInputs | null
  ];

  const rows: RowDef[] = [
    ["Net Profit After Taxes",      "npat",              "Interest & Lease Payment", "interest_lease"],
    ["Non Cash Operating Expenses", "non_cash_op_exp",   "Principal Repayments",     "principal_repayments"],
    ["Interest",                    "interest",          "TOTAL",                    null],
    ["Other Non Cash Adjustment",   "other_non_cash_adj",null,                       null],
    ["TOTAL",                       null,                null,                       null],
  ];

  rows.forEach(([nl, nf, dl, df], i) => {
    const ri = r + i;
    ws.getRow(ri).height = ht;

    // NO and PARTICULARS only on first sub-row
    if (i === 0) {
      const no_c = ws.getCell(ri, 2);
      no_c.value = "3";
      no_c.font  = { bold: true, size: 9 };
      no_c.alignment = { horizontal: "center", vertical: "middle" };
      no_c.border = TOP_BDR as ExcelJS.Borders;

      const nm_c = ws.getCell(ri, 3);
      nm_c.value = "DEBT SERVICE COVERAGE RATIO";
      nm_c.font  = { bold: true, size: 9 };
      nm_c.alignment = { vertical: "top", wrapText: true };
      nm_c.border = TOP_BDR as ExcelJS.Borders;
    } else if (i < 4) {
      ws.getCell(ri, 2).border = SIDE_BDR as ExcelJS.Borders;
      ws.getCell(ri, 3).border = SIDE_BDR as ExcelJS.Borders;
    } else {
      // last row: close borders
      ws.getCell(ri, 2).border = BOT_BDR as ExcelJS.Borders;
      ws.getCell(ri, 3).border = BOT_BDR as ExcelJS.Borders;
    }

    // Numerator label
    const nl_c = ws.getCell(ri, 4);
    const isNumTot = nf === null;
    nl_c.value = nl;
    nl_c.font  = { bold: isNumTot, size: 9 };
    nl_c.fill  = isNumTot ? TOT_FILL : undefined as any;
    nl_c.alignment = { vertical: "middle", wrapText: true };
    nl_c.border = FULL_BDR as ExcelJS.Borders;

    // Numerator amount
    const na_c = ws.getCell(ri, 5);
    if (nf !== null) {
      na_c.value  = v(inp, nf);
      na_c.numFmt = MONEY_FMT;
    } else {
      // TOTAL = SUM(E(r)..E(r+3))
      na_c.value  = formula(`SUM(E${r}:E${r + 3})`);
      na_c.numFmt = MONEY_FMT;
      na_c.font   = { bold: true, size: 9 };
      na_c.fill   = TOT_FILL;
    }
    na_c.alignment = { horizontal: "right", vertical: "middle" };
    na_c.border = FULL_BDR as ExcelJS.Borders;

    // Denominator label
    const dl_c = ws.getCell(ri, 6);
    if (dl) {
      const isDenTot = df === null && dl === "TOTAL";
      dl_c.value = dl;
      dl_c.font  = { bold: isDenTot, size: 9 };
      dl_c.fill  = isDenTot ? TOT_FILL : undefined as any;
    }
    dl_c.alignment = { vertical: "middle", wrapText: true };
    dl_c.border = FULL_BDR as ExcelJS.Borders;

    // Denominator amount
    const da_c = ws.getCell(ri, 7);
    if (df !== null) {
      da_c.value  = v(inp, df);
      da_c.numFmt = MONEY_FMT;
    } else if (dl === "TOTAL") {
      // TOTAL den = SUM(G(r)..G(r+1))
      da_c.value  = formula(`SUM(G${r}:G${r + 1})`);
      da_c.numFmt = MONEY_FMT;
      da_c.font   = { bold: true, size: 9 };
      da_c.fill   = TOT_FILL;
    }
    da_c.alignment = { horizontal: "right", vertical: "middle" };
    da_c.border = FULL_BDR as ExcelJS.Borders;

    // Ratio formula — only on the TOTAL row (last row)
    if (i === 4) {
      const rt_c = ws.getCell(ri, 8);
      // numTotRow = r+4 (col E), denTotRow = r+2 (col G)
      rt_c.value  = formula(`IFERROR(E${r + 4}/G${r + 2},"N.A.")`);
      rt_c.font   = { bold: true, size: 9 };
      rt_c.alignment = { horizontal: "center", vertical: "middle" };
      rt_c.border = FULL_BDR as ExcelJS.Borders;
    } else {
      ws.getCell(ri, 8).border = FULL_BDR as ExcelJS.Borders;
    }
  });
}

// Ratios 4-9: simple single-row each
function writeR4(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "4", "RETURN ON EQUITY RATIO",
    "Net Profit After Tax", "npat",
    "Average Shareholders Equity", "avg_shareholders_equity", "%");
}
function writeR5(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "5", "INVENTORY TURNOVER RATIO",
    "Cost Of Goods Sold (Revenue from Ops)", "revenue_ops",
    "Average Inventories", "avg_inventories", "times");
}
function writeR6(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "6", "TRADE RECEIVABLES TURNOVER RATIO",
    "Revenue from Operations", "revenue_ops",
    "Average Trade Receivables", "avg_trade_receivables", "times");
}
function writeR7(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "7",
    "TRADE PAYABLE TURNOVER RATIO\n>> Net Credit Purchase includes RM + Stock-in-trade purchase",
    "Net Credit Purchases", "net_credit_purchases",
    "Average Trade Payables", "avg_trade_payables", "times");
}
function writeR8(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "8", "NET CAPITAL TURNOVER RATIO",
    "Revenue from Operations", "revenue_ops",
    "Working Capital", "working_capital", "times");
}
function writeR9(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "9", "NET PROFIT RATIO",
    "Net Profit After Tax", "npat",
    "Revenue from Operations", "revenue_ops", "%");
}

// Ratio 10 — ROCE (3 rows: startRow..startRow+2)
// Row layout:
//   +0: NPBT (num)          | Net Worth (den)
//   +1: Interest (num)      | LT Borrowings (den)
//   +2: TOTAL NUM           | TOTAL DEN      | Ratio
function writeR10(ws: ExcelJS.Worksheet, inp: RatioInputs | null, startRow: number): void {
  const r  = startRow;
  const ht = 16;

  type RowDef = [string, keyof RatioInputs | null, string, keyof RatioInputs | null];
  const rows: RowDef[] = [
    ["Net Profit Before Tax", "npbt",     "Net Worth",           "net_worth"],
    ["Interest",              "interest", "Long-Term Borrowings", "lt_borrowings"],
    ["TOTAL",                 null,       "TOTAL",               null],
  ];

  rows.forEach(([nl, nf, dl, df], i) => {
    const ri = r + i;
    ws.getRow(ri).height = ht;

    // NO and PARTICULARS
    if (i === 0) {
      const no_c = ws.getCell(ri, 2);
      no_c.value = "10";
      no_c.font  = { bold: true, size: 9 };
      no_c.alignment = { horizontal: "center", vertical: "middle" };
      no_c.border = TOP_BDR as ExcelJS.Borders;
      const nm_c = ws.getCell(ri, 3);
      nm_c.value = "RETURN ON CAPITAL EMPLOYED";
      nm_c.font  = { bold: true, size: 9 };
      nm_c.alignment = { vertical: "top", wrapText: true };
      nm_c.border = TOP_BDR as ExcelJS.Borders;
    } else if (i === 1) {
      ws.getCell(ri, 2).border = SIDE_BDR as ExcelJS.Borders;
      ws.getCell(ri, 3).border = SIDE_BDR as ExcelJS.Borders;
    } else {
      ws.getCell(ri, 2).border = BOT_BDR as ExcelJS.Borders;
      ws.getCell(ri, 3).border = BOT_BDR as ExcelJS.Borders;
    }

    const isTotal = nf === null;

    // Num label
    const nl_c = ws.getCell(ri, 4);
    nl_c.value = nl;
    nl_c.font  = { bold: isTotal, size: 9 };
    nl_c.fill  = isTotal ? TOT_FILL : undefined as any;
    nl_c.alignment = { vertical: "middle" };
    nl_c.border = FULL_BDR as ExcelJS.Borders;

    // Num amount
    const na_c = ws.getCell(ri, 5);
    if (nf !== null) {
      na_c.value = v(inp, nf);
    } else {
      na_c.value = formula(`SUM(E${r}:E${r + 1})`);
      na_c.font  = { bold: true, size: 9 };
      na_c.fill  = TOT_FILL;
    }
    na_c.numFmt = MONEY_FMT;
    na_c.alignment = { horizontal: "right", vertical: "middle" };
    na_c.border = FULL_BDR as ExcelJS.Borders;

    // Den label
    const dl_c = ws.getCell(ri, 6);
    dl_c.value = dl;
    dl_c.font  = { bold: isTotal, size: 9 };
    dl_c.fill  = isTotal ? TOT_FILL : undefined as any;
    dl_c.alignment = { vertical: "middle" };
    dl_c.border = FULL_BDR as ExcelJS.Borders;

    // Den amount
    const da_c = ws.getCell(ri, 7);
    if (df !== null) {
      da_c.value = v(inp, df);
    } else {
      da_c.value = formula(`SUM(G${r}:G${r + 1})`);
      da_c.font  = { bold: true, size: 9 };
      da_c.fill  = TOT_FILL;
    }
    da_c.numFmt = MONEY_FMT;
    da_c.alignment = { horizontal: "right", vertical: "middle" };
    da_c.border = FULL_BDR as ExcelJS.Borders;

    // Ratio (TOTAL row only)
    if (isTotal) {
      const rt_c = ws.getCell(ri, 8);
      rt_c.value  = formula(`IFERROR(E${r + 2}/G${r + 2}*100,"N.A.")`);
      rt_c.font   = { bold: true, size: 9 };
      rt_c.alignment = { horizontal: "center", vertical: "middle" };
      rt_c.border = FULL_BDR as ExcelJS.Borders;
    } else {
      ws.getCell(ri, 8).border = FULL_BDR as ExcelJS.Borders;
    }
  });
}

// Ratio 11 — Return On Investment
function writeR11(ws: ExcelJS.Worksheet, inp: RatioInputs | null, r: number): void {
  writeSimpleRow(ws, inp, r, "11", "RETURN ON INVESTMENT\nOpening + Closing Investments / 2",
    "Return / Profit / Earning", "return_profit",
    "Average Investment Fund",   "avg_investment_fund", "%");
}

// ═════════════════════════════════════════════════════════════════════════════
// "Previous Year " sheet  (identical structure, PY inputs)
// ═════════════════════════════════════════════════════════════════════════════

function writePYSheet(
  wb:     ExcelJS.Workbook,
  ctx:    Ctx,
  data:   Stage7Ratios | null,
  noteNo: number,
): void {
  const ws = wb.addWorksheet("Previous Year ", { views: [{ showGridLines: false }] });
  ws.columns = CY_COLS;

  const inputs = data?.py ?? null;
  const { cyYear, companyName } = ctx;
  const pyYear = cyYear - 1;
  const pyStr  = `${pyYear - 1}-${String(pyYear).slice(-2)}`;

  // ── Header rows (1-8) ─────────────────────────────────────────────────────
  ws.mergeCells("B1:H1");
  const r1 = ws.getCell("B1");
  r1.value = companyName;
  r1.font  = { bold: true, size: 12 };
  r1.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 18;

  ws.mergeCells("B2:H2");
  const r2 = ws.getCell("B2");
  r2.value = `ANNEXURE : A (PY ${pyStr})`;
  r2.font  = { bold: true, size: 11 };
  r2.alignment = { horizontal: "center" };

  ws.mergeCells("B3:H3");
  ws.getCell("B3").value = `Note - ${noteNo} : RATIO (Previous Year)`;
  ws.getCell("B3").font  = { bold: true, size: 10 };
  ws.getCell("B3").alignment = { horizontal: "center" };

  ws.getRow(4).height = 6;
  ws.mergeCells("B5:H5");
  ws.getCell("B5").value = `For the year ended 31st March, ${pyYear}`;
  ws.getCell("B5").font  = { italic: true, size: 9 };
  ws.getRow(6).height = 6;

  ws.mergeCells("B7:H7");
  ws.getCell("B7").value = "(Amount in Rs.)";
  ws.getCell("B7").font  = { italic: true, size: 9 };
  ws.getCell("B7").alignment = { horizontal: "right" };

  writeCYColHeaders(ws, 8);

  // ── Data rows — same helpers as CY, bound to PY inputs ───────────────────
  writeR1(ws, inputs, 9);
  writeR2(ws, inputs, 10);
  writeR3(ws, inputs, 11);
  writeR4(ws, inputs, 16);
  writeR5(ws, inputs, 17);
  writeR6(ws, inputs, 18);
  writeR7(ws, inputs, 19);
  writeR8(ws, inputs, 20);
  writeR9(ws, inputs, 21);
  writeR10(ws, inputs, 22);
  writeR11(ws, inputs, 25);
}

// ═════════════════════════════════════════════════════════════════════════════
// "RATIO" sheet  (summary with cross-sheet formulas)
// ═════════════════════════════════════════════════════════════════════════════

function writeRatioSheet(
  wb:     ExcelJS.Workbook,
  ctx:    Ctx,
  data:   Stage7Ratios | null,
  noteNo: number,
): void {
  const ws = wb.addWorksheet("RATIO", { views: [{ showGridLines: false }] });
  ws.columns = RAT_COLS;

  const { cyYear, companyName } = ctx;
  const pyYear = cyYear - 1;
  const cyStr  = `${cyYear - 1}-${String(cyYear).slice(-2)}`;
  const pyStr  = `${pyYear - 1}-${String(pyYear).slice(-2)}`;

  // ── Header rows (1-7) ─────────────────────────────────────────────────────
  ws.mergeCells("B1:H1");
  const r1 = ws.getCell("B1");
  r1.value = companyName;
  r1.font  = { bold: true, size: 12 };
  r1.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 18;

  ws.mergeCells("B2:H2");
  const r2 = ws.getCell("B2");
  r2.value = `NOTE - ${noteNo} : RATIO`;
  r2.font  = { bold: true, size: 12 };
  r2.alignment = { horizontal: "center" };
  ws.getRow(2).height = 16;

  ws.getRow(3).height = 6;

  ws.mergeCells("B4:H4");
  ws.getCell("B4").value = `For the year ended 31st March, ${cyYear}`;
  ws.getCell("B4").font  = { italic: true, size: 9 };

  ws.mergeCells("B5:H5");
  ws.getCell("B5").value = "(Amount in Rs.)";
  ws.getCell("B5").font  = { italic: true, size: 9 };
  ws.getCell("B5").alignment = { horizontal: "right" };

  ws.getRow(6).height = 6;

  // Row 7: Column headers
  writeRatioColHeaders(ws, 7, cyStr, pyStr);

  // ── Data rows ─────────────────────────────────────────────────────────────
  LAYOUTS.forEach((lay) => {
    const numSheetRow = ratioSheetRow(lay.id);    // RATIO sheet row for numerator
    const denSheetRow = numSheetRow + 1;          // RATIO sheet row for denominator
    const cmtSheetRow = numSheetRow + 2;          // RATIO sheet text/commentary row

    const cmt = data?.commentary.find(c => c.ratioId === lay.id)?.text ?? "";

    writeRatioDataRows(
      ws, lay, numSheetRow, denSheetRow, cmtSheetRow, cmt,
    );
  });
}

// ─── RATIO sheet column headers ───────────────────────────────────────────────

function writeRatioColHeaders(ws: ExcelJS.Worksheet, row: number, cyStr: string, pyStr: string): void {
  ws.getRow(row).height = 30;

  const hd = (col: number, val: string) => {
    const c = ws.getCell(row, col);
    c.value = val;
    c.font  = { bold: true, size: 9 };
    c.fill  = HEAD_FILL;
    c.border = FULL_BDR as ExcelJS.Borders;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  hd(2, "NO");
  hd(3, "PARTICULARS");
  hd(4, "NUMERATOR / DENOMINATOR");
  hd(5, "Amount (Rs.)");
  hd(6, `CY ${cyStr}`);
  hd(7, `PY ${pyStr}`);
  hd(8, "Variance");
}

// ─── Write one ratio's rows in the RATIO sheet ────────────────────────────────

function writeRatioDataRows(
  ws:          ExcelJS.Worksheet,
  lay:         RatioLayout,
  numRow:      number,
  denRow:      number,
  cmtRow:      number,
  commentary:  string,
): void {
  ws.getRow(numRow).height = 16;
  ws.getRow(denRow).height = 16;
  ws.getRow(cmtRow).height = 22;

  // ── Numerator row ─────────────────────────────────────────────────────────
  const cySheet = "Current Year ";
  const pySheet = "Previous Year ";

  // Column B (NO) — rowspan 2
  const no_c = ws.getCell(numRow, 2);
  no_c.value = lay.id;
  no_c.font  = { bold: true, size: 9 };
  no_c.alignment = { horizontal: "center", vertical: "middle" };
  no_c.border = TOP_BDR as ExcelJS.Borders;

  // Column C (PARTICULARS) — rowspan 2
  const nm_c = ws.getCell(numRow, 3);
  nm_c.value = lay.name;
  nm_c.font  = { bold: true, size: 9 };
  nm_c.alignment = { vertical: "middle", wrapText: true };
  nm_c.border = TOP_BDR as ExcelJS.Borders;

  // Column D (NUMERATOR label) — cross-sheet ref to CY col D
  const numl_c = ws.getCell(numRow, 4);
  numl_c.value = formula(`'${cySheet}'!D${lay.cyRow}`);
  numl_c.font  = { size: 9 };
  numl_c.alignment = { vertical: "middle", wrapText: true };
  numl_c.border = FULL_BDR as ExcelJS.Borders;

  // Column E (Amount Rs.) — cross-sheet ref to CY col E (num total row)
  const numa_c = ws.getCell(numRow, 5);
  numa_c.value  = formula(`'${cySheet}'!E${lay.numTotRow}`);
  numa_c.numFmt = MONEY_FMT;
  numa_c.font   = { size: 9 };
  numa_c.alignment = { horizontal: "right", vertical: "middle" };
  numa_c.border = FULL_BDR as ExcelJS.Borders;

  // Column F (CY Ratio) — spans num+den rows; ref to CY col H
  const cyr_c = ws.getCell(numRow, 6);
  cyr_c.value  = formula(`IFERROR('${cySheet}'!H${lay.numTotRow},"N.A.")`);
  cyr_c.font   = { bold: true, size: 9 };
  cyr_c.fill   = SUB_FILL;
  cyr_c.alignment = { horizontal: "center", vertical: "middle" };
  cyr_c.border = TOP_BDR as ExcelJS.Borders;

  // Column G (PY Ratio) — ref to PY col H
  const pyr_c = ws.getCell(numRow, 7);
  pyr_c.value  = formula(`IFERROR('${pySheet}'!H${lay.numTotRow},"N.A.")`);
  pyr_c.font   = { bold: true, size: 9 };
  pyr_c.fill   = SUB_FILL;
  pyr_c.alignment = { horizontal: "center", vertical: "middle" };
  pyr_c.border = TOP_BDR as ExcelJS.Borders;

  // Column H (Variance) — (CY-PY)/ABS(PY)
  const var_c = ws.getCell(numRow, 8);
  var_c.value  = formula(`IFERROR((F${numRow}-G${numRow})/ABS(G${numRow}),"N.A.")`);
  var_c.numFmt = '0.00"%"';
  var_c.font   = { size: 9 };
  var_c.alignment = { horizontal: "center", vertical: "middle" };
  var_c.border = TOP_BDR as ExcelJS.Borders;

  // ── Denominator row ───────────────────────────────────────────────────────
  ws.getCell(denRow, 2).border = BOT_BDR as ExcelJS.Borders;
  ws.getCell(denRow, 3).border = BOT_BDR as ExcelJS.Borders;

  // Column D (DENOMINATOR label)
  const denl_c = ws.getCell(denRow, 4);
  denl_c.value  = formula(`'${cySheet}'!F${lay.cyRow}`);
  denl_c.font   = { size: 9 };
  denl_c.alignment = { vertical: "middle", wrapText: true };
  denl_c.border = FULL_BDR as ExcelJS.Borders;

  // Column E (Amount Rs. — denominator)
  const dena_c = ws.getCell(denRow, 5);
  dena_c.value  = formula(`'${cySheet}'!G${lay.denTotRow}`);
  dena_c.numFmt = MONEY_FMT;
  dena_c.font   = { size: 9 };
  dena_c.alignment = { horizontal: "right", vertical: "middle" };
  dena_c.border = FULL_BDR as ExcelJS.Borders;

  // Columns F/G/H — close the borders on den row
  ws.getCell(denRow, 6).border = BOT_BDR as ExcelJS.Borders;
  ws.getCell(denRow, 7).border = BOT_BDR as ExcelJS.Borders;
  ws.getCell(denRow, 8).border = BOT_BDR as ExcelJS.Borders;

  // ── Commentary row ────────────────────────────────────────────────────────
  ws.mergeCells(cmtRow, 2, cmtRow, 8);
  const cmt_c = ws.getCell(cmtRow, 2);
  cmt_c.value = commentary ? `Text: ${commentary}` : "";
  cmt_c.font  = { italic: true, size: 9, color: { argb: "FF444444" } };
  cmt_c.alignment = { vertical: "middle", wrapText: true };
  ws.getRow(cmtRow).height = commentary ? 30 : 16;
}
