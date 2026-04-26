/**
 * fsNotesWriter
 * ─────────────────────────────────────────────────────────────────────────
 * Phase UI-6 / Phase 5 — Adds the 4 notes sheets to the existing Schedule III
 * workbook produced by fsExcelExport.ts:
 *   "Note BS-Liab"  — Notes 3-12 (BS Liabilities side)
 *   "Note BS-Asset" — Notes 13-22 (BS Assets side; PPE/Intangibles in FA sheet)
 *   "Note PL"       — Notes 23-30 (P&L break-ups + EPS)
 *   "FA"            — AS-10 PPE movement schedule
 *
 * Layout / column widths / cross-sheet formula targets mirror
 * `C:\Users\Admin\OneDrive\Desktop\FS NOTES.xlsx` (the template the user
 * provided). Headers, merges, SUM formulas, and the key cross-sheet links
 * called out in the Phase 5 spec are reproduced verbatim:
 *
 *   Note BS-Liab  A5  → 'BS'!D12          (Note 3 row reference)
 *   Note BS-Liab  H5  → 'CFS'!H4          (year header)
 *   Note BS-Liab  G49 → 'PL'!G38          (Profit for the year CY)
 *   Note BS-Liab  H49 → 'PL'!H38          (Profit for the year PY)
 *   Note BS-Asset A1  → 'BS'!B2           (company name)
 *   Note BS-Asset G7  → 'BS'!E7           (year header CY)
 *   Note BS-Asset G48 → 'Note PL'!F39     (Inventories - Finished goods CY)
 *   Note BS-Asset H48 → 'Note PL'!G39     (Inventories - Finished goods PY)
 *   Note PL       G5  → 'BS'!E5           (year header)
 *   Note PL       F117 → 'PL'!G38         (NPAT CY)
 *   Note PL       G117 → 'PL'!H38         (NPAT PY)
 *   FA            M5  → 'BS'!E5           (year header)
 *
 * Values are pulled from `notes.bs_liab.*.cy/py`, `notes.bs_asset.*.cy/py`,
 * `notes.pl.*.cy/py`, and `notes.fa.rows[]`. When a key is absent the cell
 * is written as 0 so the SUM formulas still evaluate.
 */

import type ExcelJS from "exceljs";
import type { Stage5Notes, FARow } from "./notesAutoPopulate";
import { getNoteNo } from "./noteNumberRegistry";

const MONEY_FMT = '#,##0.00;(#,##0.00);"-"';

interface Ctx {
  cyYear:      number;
  pyYear:      number;
  companyName: string;
}

/**
 * Add the 4 notes sheets to the workbook. Safe to pass `notes = null` —
 * the sheets are still created with the template structure, all amounts
 * default to 0, and the SUM formulas evaluate to 0 across the board so
 * the auditor can fill values directly in Excel afterwards.
 */
export function writeNotesSheets(
  wb:    ExcelJS.Workbook,
  ctx:   Ctx,
  notes: Stage5Notes | null,
): void {
  writeNoteBSLiab(wb, ctx, notes);
  writeNoteBSAsset(wb, ctx, notes);
  writeNotePL(wb, ctx, notes);
  writeFA(wb, ctx, notes);
}

// ═════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════

/** Get nested value at dot path; coerces to Number with default 0. */
function num(notes: Stage5Notes | null, path: string): number {
  if (!notes) return 0;
  const v = path.split(".").reduce<any>((c, k) => c == null ? c : c[k], notes);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
/** Same as num() but returns "" when value missing — for text cells. */
function txt(notes: Stage5Notes | null, path: string, fallback = ""): string {
  if (!notes) return fallback;
  const v = path.split(".").reduce<any>((c, k) => c == null ? c : c[k], notes);
  return v == null || v === "" ? fallback : String(v);
}

/** Set a cell value + format + bold flag in one call. */
function setCell(
  sheet: ExcelJS.Worksheet,
  addr:  string,
  value: any,
  opts: { bold?: boolean; size?: number; align?: "left" | "right" | "center"; numFmt?: string; fillColor?: string } = {},
): void {
  const cell = sheet.getCell(addr);
  cell.value = value;
  if (opts.bold || opts.size) {
    cell.font = { ...(cell.font || {}), bold: !!opts.bold, size: opts.size ?? 10 };
  }
  if (opts.align) cell.alignment = { ...(cell.alignment || {}), horizontal: opts.align };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.fillColor) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fillColor } };
  }
}

/**
 * Write a "Note N — Title" header bar across the standard 8-column layout
 * (cols A-H). Returns the next free row index.
 */
function writeNoteBlockHeader(
  sheet: ExcelJS.Worksheet,
  row:   number,
  noteNo: number,
  title:  string,
  bsCellRef?: string,           // e.g. "BS!D12" — note number formula
  yearHdrRef?: string,          // e.g. "CFS!H4" — year header formula
): void {
  if (bsCellRef) {
    setCell(sheet, `A${row}`, { formula: `+${bsCellRef}` }, { bold: true });
  } else {
    setCell(sheet, `A${row}`, noteNo, { bold: true });
  }
  setCell(sheet, `B${row}`, title, { bold: true });
  if (yearHdrRef) {
    setCell(sheet, `H${row}`, { formula: `+${yearHdrRef}` }, { bold: true, align: "center" });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// "Note BS-Liab" — Notes 3-12
// ═════════════════════════════════════════════════════════════════════════

function writeNoteBSLiab(wb: ExcelJS.Workbook, ctx: Ctx, notes: Stage5Notes | null): void {
  const sheet = wb.addWorksheet("Note BS-Liab", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 4.2 },   // A
    { width: 29.9 },  // B
    { width: 8.4 },   // C
    { width: 8.9 },   // D
    { width: 11.4 },  // E
    { width: 10.4 },  // F
    { width: 10.9 },  // G  CY
    { width: 11.1 },  // H  PY
  ];

  // Top header — link to BS!B2 for company name
  setCell(sheet, "A2", { formula: "BS!B2" }, { bold: true, size: 12, align: "center" });
  sheet.mergeCells("A2:H2");
  setCell(sheet, "A4", `Schedules to Balance Sheet as at 31st March, ${ctx.cyYear}`,
    { bold: true, size: 11, align: "center" });
  sheet.mergeCells("A4:H4");

  // ── Note 3 — Share capital (rows 5-12) ─────────────────────────────────
  writeNoteBlockHeader(sheet, 5, getNoteNo("share_capital")!, "Share capital", "BS!D12", "CFS!H4");
  setCell(sheet, "B6", "Particulars", { bold: true });
  setCell(sheet, "G6", `As at 31st March, ${ctx.cyYear}`, { bold: true, align: "center" });
  setCell(sheet, "H6", `As at 31st March, ${ctx.pyYear}`, { bold: true, align: "center" });
  setCell(sheet, "B7", "Authorised shares", { bold: true });
  setCell(sheet, "B8", txt(notes, "bs_liab.share_capital.authorised_text",
    "___ equity shares of face value of Rs.__ each"));
  setCell(sheet, "G8", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H8", 0, { numFmt: MONEY_FMT, align: "right" });

  setCell(sheet, "B10", "Issued, subscribed and fully paid up shares", { bold: true });
  setCell(sheet, "B11", "___ equity shares of face value of Rs.__ each");
  setCell(sheet, "G11", num(notes, "bs_liab.share_capital.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H11", num(notes, "bs_liab.share_capital.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B12", "Total", { bold: true });
  setCell(sheet, "G12", { formula: "SUM(G11)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H12", { formula: "SUM(H11)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // (a) Reconciliation
  setCell(sheet, "A14", "(a)", { bold: true });
  setCell(sheet, "B14", "Reconciliation of the shares outstanding at the beginning and end of the year", { bold: true });
  setCell(sheet, "B16", "Particulars", { bold: true });
  setCell(sheet, "G16", { formula: "+G6" }, { bold: true });
  setCell(sheet, "H16", { formula: "+H6" }, { bold: true });
  setCell(sheet, "B17", "Equity shares");
  setCell(sheet, "G17", "Number", { bold: true, align: "right" });
  setCell(sheet, "H17", "Amount", { bold: true, align: "right" });
  setCell(sheet, "B18", "Opening balance at the beginning of the year");
  setCell(sheet, "G18", num(notes, "bs_liab.share_capital.recon_open_cy_num"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H18", num(notes, "bs_liab.share_capital.recon_open_cy_amt"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B19", "Movement during the year");
  setCell(sheet, "G19", num(notes, "bs_liab.share_capital.recon_move_cy_num"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H19", num(notes, "bs_liab.share_capital.recon_move_cy_amt"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B21", "Outstanding at the end of the year", { bold: true });
  setCell(sheet, "G21", { formula: "SUM(G18:G20)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H21", { formula: "SUM(H18:H20)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // (b) >5% shareholders
  setCell(sheet, "A23", "(b)", { bold: true });
  setCell(sheet, "B23", "Particulars of shareholders holding more than 5% shares", { bold: true });
  setCell(sheet, "B24", "Shareholders Name", { bold: true });
  setCell(sheet, "E24", { formula: "+G16" }, { bold: true });
  setCell(sheet, "G24", { formula: "+H16" }, { bold: true });
  setCell(sheet, "E25", "No. of shares", { align: "right" });
  setCell(sheet, "F25", "% of holding", { align: "right" });
  setCell(sheet, "G25", "No. of shares", { align: "right" });
  setCell(sheet, "H25", "% of holding", { align: "right" });

  // (c) Promoters
  setCell(sheet, "A32", "(c)", { bold: true });
  setCell(sheet, "B32", "Promoters Shareholding", { bold: true });
  setCell(sheet, "B33", "Promoter name", { bold: true });
  setCell(sheet, "D33", `As at March 31, ${ctx.cyYear}`, { bold: true, align: "center" });
  setCell(sheet, "F33", `As at March 31, ${ctx.pyYear}`, { bold: true, align: "center" });
  setCell(sheet, "H33", "% Change during the year", { bold: true, align: "center" });
  setCell(sheet, "B38", "Total", { bold: true });
  setCell(sheet, "D38", { formula: "SUM(D35:D37)" }, { bold: true, numFmt: MONEY_FMT });
  setCell(sheet, "G38", { formula: "SUM(G35:G37)" }, { bold: true, numFmt: MONEY_FMT });
  setCell(sheet, "H38", { formula: "SUM(H35:H37)" }, { bold: true, numFmt: MONEY_FMT });

  // ── Note 4 — Reserves and surplus (rows 40-54) ─────────────────────────
  writeNoteBlockHeader(sheet, 40, getNoteNo("reserves_surplus")!, "Reserves and surplus", "BS!D13", "+H5");
  setCell(sheet, "B41", "Particulars", { bold: true });
  setCell(sheet, "G41", { formula: "+G16" }, { bold: true });
  setCell(sheet, "H41", { formula: "+H16" }, { bold: true });
  setCell(sheet, "B42", "1. General Reserve");
  setCell(sheet, "G42", num(notes, "bs_liab.reserves_surplus.gen_reserve_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H42", num(notes, "bs_liab.reserves_surplus.gen_reserve_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B43", "2. Share Premium");
  setCell(sheet, "G43", num(notes, "bs_liab.reserves_surplus.share_premium_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H43", num(notes, "bs_liab.reserves_surplus.share_premium_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "F45", "[a]", { bold: true });
  setCell(sheet, "G45", { formula: "SUM(G42:G44)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H45", { formula: "SUM(H42:H44)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B47", "Surplus in the Statement of Profit and Loss", { bold: true });
  setCell(sheet, "B48", "Opening balance");
  setCell(sheet, "G48", { formula: "H54" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H48", num(notes, "bs_liab.reserves_surplus.surplus_opening_py"), { numFmt: MONEY_FMT, align: "right" });

  // ★ KEY CROSS-SHEET LINK — Note BS-Liab row 49 G/H ← PL!G38/H38 ────────
  setCell(sheet, "B49", "Add/(Less) : Profit for the year");
  setCell(sheet, "G49", { formula: "PL!G38" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H49", { formula: "PL!H38" }, { numFmt: MONEY_FMT, align: "right" });

  setCell(sheet, "B50", "Add/(Less) : Adj. for Deferred tax");
  setCell(sheet, "G50", num(notes, "bs_liab.reserves_surplus.surplus_deferred_adj_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H50", num(notes, "bs_liab.reserves_surplus.surplus_deferred_adj_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B51", "Add/(Less) : Excess/short provi. for Income tax");
  setCell(sheet, "G51", num(notes, "bs_liab.reserves_surplus.surplus_excess_short_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H51", num(notes, "bs_liab.reserves_surplus.surplus_excess_short_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "F52", "[b]", { bold: true });
  setCell(sheet, "G52", { formula: "SUM(G48:G51)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H52", { formula: "SUM(H48:H51)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B54", "Total", { bold: true });
  setCell(sheet, "F54", "[a] + [b]", { bold: true });
  setCell(sheet, "G54", { formula: "+G45+G52" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H54", { formula: "+H45+H52" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 5 — Long-term borrowings (rows 60-70) ─────────────────────────
  writeNoteBlockHeader(sheet, 60, getNoteNo("lt_borrowings")!, "Long-term borrowings", "BS!D18");
  setCell(sheet, "B61", "Particulars", { bold: true });
  setCell(sheet, "G61", { formula: "+G41" }, { bold: true });
  setCell(sheet, "H61", { formula: "+H41" }, { bold: true });
  setCell(sheet, "B62", "(A) Secured Loans", { bold: true });
  setCell(sheet, "B63", "b) Term loans");
  setCell(sheet, "B64", "(i) from banks");
  setCell(sheet, "G64", num(notes, "bs_liab.lt_borrowings.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H64", num(notes, "bs_liab.lt_borrowings.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B66", "(B) Unsecured", { bold: true });
  setCell(sheet, "B67", "a) Loans and advances from related parties & Others");
  setCell(sheet, "G67", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H67", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B68", "b) From Directors");
  setCell(sheet, "G68", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H68", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B70", "Total", { bold: true });
  setCell(sheet, "G70", { formula: "SUM(G63:G69)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H70", { formula: "SUM(H63:H69)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 6 — Other long-term liabilities (rows 72-79) ──────────────────
  writeNoteBlockHeader(sheet, 72, getNoteNo("other_lt_liab")!, "Other long term liabilities", "BS!D20");
  setCell(sheet, "B73", "Particulars", { bold: true });
  setCell(sheet, "G73", { formula: "+G61" }, { bold: true });
  setCell(sheet, "H73", { formula: "+H61" }, { bold: true });
  setCell(sheet, "B75", "(a) Trade payables");
  setCell(sheet, "G75", num(notes, "bs_liab.other_lt_liabilities.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H75", num(notes, "bs_liab.other_lt_liabilities.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B76", "(b) Rent deposit");
  setCell(sheet, "G76", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H76", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B77", "(c) Others (specify nature)");
  setCell(sheet, "G77", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H77", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B79", "Total", { bold: true });
  setCell(sheet, "G79", { formula: "SUM(G75:G78)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H79", { formula: "SUM(H75:H78)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 7 — Long-term provisions (rows 81-87) ─────────────────────────
  writeNoteBlockHeader(sheet, 81, getNoteNo("lt_provisions")!, "Long-term provisions", "BS!D21");
  setCell(sheet, "B82", "Particulars", { bold: true });
  setCell(sheet, "G82", { formula: "+G73" }, { bold: true });
  setCell(sheet, "H82", { formula: "+H73" }, { bold: true });
  setCell(sheet, "B84", "(a) Provision for employee benefits");
  setCell(sheet, "G84", num(notes, "bs_liab.lt_provisions.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H84", num(notes, "bs_liab.lt_provisions.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B85", "(b) Others (specify nature)");
  setCell(sheet, "G85", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H85", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B87", "Total", { bold: true });
  setCell(sheet, "G87", { formula: "SUM(G84:G86)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H87", { formula: "SUM(H84:H86)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 8 — Short-term borrowings (rows 89-100) ───────────────────────
  writeNoteBlockHeader(sheet, 89, getNoteNo("st_borrowings")!, "Short-term borrowings", "BS!D24");
  setCell(sheet, "B90", "Particulars", { bold: true });
  setCell(sheet, "G90", { formula: "+G82" }, { bold: true });
  setCell(sheet, "H90", { formula: "+H82" }, { bold: true });
  setCell(sheet, "B91", "(A) Secured", { bold: true });
  setCell(sheet, "B92", "(a) OD");
  setCell(sheet, "G92", num(notes, "bs_liab.st_borrowings.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H92", num(notes, "bs_liab.st_borrowings.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B93", "(b) CC");
  setCell(sheet, "B94", "(c) Term loan");
  setCell(sheet, "B96", "(B) Unsecured", { bold: true });
  setCell(sheet, "B97", "(a) Loans and advances from related parties");
  setCell(sheet, "G97", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H97", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B98", "(b) Other loans and advances (specify nature)");
  setCell(sheet, "G98", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H98", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B100", "Total", { bold: true });
  setCell(sheet, "G100", { formula: "SUM(G92:G99)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H100", { formula: "SUM(H92:H99)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 9 — Trade Payables (rows 102-108) + ageing schedules ──────────
  writeNoteBlockHeader(sheet, 102, getNoteNo("trade_payables")!, "Trade Payables", "BS!D25");
  setCell(sheet, "B103", "Particulars", { bold: true });
  setCell(sheet, "G103", { formula: "+G90" }, { bold: true });
  setCell(sheet, "H103", { formula: "+H90" }, { bold: true });
  setCell(sheet, "B105", "Total outstanding dues of micro and small enterprises (MSME)");
  setCell(sheet, "G105", num(notes, "bs_liab.trade_payables.msme_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H105", num(notes, "bs_liab.trade_payables.msme_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B106", "Total outstanding dues of creditors other than MSME");
  setCell(sheet, "G106", num(notes, "bs_liab.trade_payables.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H106", num(notes, "bs_liab.trade_payables.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B108", "Total", { bold: true });
  setCell(sheet, "G108", { formula: "SUM(G105:G107)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H108", { formula: "SUM(H105:H107)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // Trade Payables ageing — CY (rows 115-121)
  setCell(sheet, "B115", `Trade Payables ageing schedule as on 31.03.${ctx.cyYear}`, { bold: true });
  setCell(sheet, "B116", "Particulars", { bold: true });
  setCell(sheet, "D116", "Outstanding for following periods from due date of payment", { bold: true, align: "center" });
  setCell(sheet, "H116", "Total", { bold: true, align: "center" });
  setCell(sheet, "D117", "Less than 1 year", { bold: true, align: "center" });
  setCell(sheet, "E117", "1-2 years", { bold: true, align: "center" });
  setCell(sheet, "F117", "2-3 years", { bold: true, align: "center" });
  setCell(sheet, "G117", "More than 3 years", { bold: true, align: "center" });
  const tpAgeCy: any = (notes?.bs_liab as any)?.trade_payables?.ageing_cy || {};
  const writeTpAgeRow = (rowIdx: number, key: string, label: string, defaultD = 0) => {
    setCell(sheet, `B${rowIdx}`, label);
    setCell(sheet, `D${rowIdx}`, defaultD || Number(tpAgeCy[key]?.lt1 || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `E${rowIdx}`, Number(tpAgeCy[key]?.["1_2"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `F${rowIdx}`, Number(tpAgeCy[key]?.["2_3"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `G${rowIdx}`, Number(tpAgeCy[key]?.gt3 || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `H${rowIdx}`, { formula: `SUM(D${rowIdx}:G${rowIdx})` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  };
  setCell(sheet, "D118", { formula: "G105" }, { numFmt: MONEY_FMT, align: "right" });
  writeTpAgeRow(118, "msme",        "(i) MSME",                       num(notes, "bs_liab.trade_payables.msme_cy"));
  setCell(sheet, "D119", { formula: "G106" }, { numFmt: MONEY_FMT, align: "right" });
  writeTpAgeRow(119, "others",      "(ii) Others",                    num(notes, "bs_liab.trade_payables.cy"));
  writeTpAgeRow(120, "disp_msme",   "(iii) Disputed dues – MSME");
  writeTpAgeRow(121, "disp_others", "(iv) Disputed dues - Others");

  // Trade Payables ageing — PY (rows 124-130)
  setCell(sheet, "B124", `Trade Payables ageing schedule as on 31.03.${ctx.pyYear}`, { bold: true });
  setCell(sheet, "B125", "Particulars", { bold: true });
  setCell(sheet, "D125", "Outstanding for following periods from due date of payment", { bold: true, align: "center" });
  setCell(sheet, "H125", "Total", { bold: true, align: "center" });
  setCell(sheet, "D126", "Less than 1 year", { bold: true, align: "center" });
  setCell(sheet, "E126", "1-2 years", { bold: true, align: "center" });
  setCell(sheet, "F126", "2-3 years", { bold: true, align: "center" });
  setCell(sheet, "G126", "More than 3 years", { bold: true, align: "center" });
  const tpAgePy: any = (notes?.bs_liab as any)?.trade_payables?.ageing_py || {};
  const writeTpAgePyRow = (rowIdx: number, key: string, label: string, defaultD = 0) => {
    setCell(sheet, `B${rowIdx}`, label);
    setCell(sheet, `D${rowIdx}`, defaultD || Number(tpAgePy[key]?.lt1 || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `E${rowIdx}`, Number(tpAgePy[key]?.["1_2"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `F${rowIdx}`, Number(tpAgePy[key]?.["2_3"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `G${rowIdx}`, Number(tpAgePy[key]?.gt3 || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `H${rowIdx}`, { formula: `SUM(D${rowIdx}:G${rowIdx})` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  };
  setCell(sheet, "D127", { formula: "+H105" }, { numFmt: MONEY_FMT, align: "right" });
  writeTpAgePyRow(127, "msme",        "(i) MSME", num(notes, "bs_liab.trade_payables.msme_py"));
  setCell(sheet, "D128", { formula: "+H106" }, { numFmt: MONEY_FMT, align: "right" });
  writeTpAgePyRow(128, "others",      "(ii) Others", num(notes, "bs_liab.trade_payables.py"));
  writeTpAgePyRow(129, "disp_msme",   "(iii) Disputed dues – MSME");
  writeTpAgePyRow(130, "disp_others", "(iv) Disputed dues - Others");

  setCell(sheet, "B133", "Notes :- (The ageing requirement shall not apply to)", { bold: true, size: 9 });
  setCell(sheet, "B134", txt(notes, "bs_liab.trade_payables.note_1",
    "1. There are no \"Unbilled\" and \"Not due\" trade payables."), { size: 9 });
  setCell(sheet, "B135", txt(notes, "bs_liab.trade_payables.note_2",
    "2. As declared and certified by the management, the Company does not have any dues outstanding to MSME beyond agreed credit period."), { size: 9 });

  // ── Note 10 — Other current liabilities (rows 137-147) ─────────────────
  writeNoteBlockHeader(sheet, 137, getNoteNo("other_current_liab")!, "Other current liabilities", "BS!D28");
  setCell(sheet, "B138", "Particulars", { bold: true });
  setCell(sheet, "G138", { formula: "+G103" }, { bold: true });
  setCell(sheet, "H138", { formula: "+H103" }, { bold: true });
  setCell(sheet, "B140", "Current maturities of finance lease obligations");
  setCell(sheet, "G140", num(notes, "bs_liab.other_curr_liab.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H140", num(notes, "bs_liab.other_curr_liab.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B141", "Interest accrued but not due on borrowings");
  setCell(sheet, "G141", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H141", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B142", "Interest accrued and due on borrowings");
  setCell(sheet, "G142", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H142", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B143", "Statutory Dues payable");
  setCell(sheet, "G143", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H143", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B144", "Advance from customer");
  setCell(sheet, "G144", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H144", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B145", "Provision for taxation (net of advance tax)");
  setCell(sheet, "G145", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H145", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B147", "Total", { bold: true });
  setCell(sheet, "G147", { formula: "SUM(G140:G146)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H147", { formula: "SUM(H140:H145)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 11 — Short-term provisions (rows 149-159) ─────────────────────
  writeNoteBlockHeader(sheet, 149, getNoteNo("st_provisions")!, "Short-term provisions", "BS!D29");
  setCell(sheet, "B150", "Particulars", { bold: true });
  setCell(sheet, "G150", { formula: "+G138" }, { bold: true });
  setCell(sheet, "H150", { formula: "+H138" }, { bold: true });
  setCell(sheet, "B152", "(a) Provision for employee benefits");
  setCell(sheet, "G152", num(notes, "bs_liab.st_provisions.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H152", num(notes, "bs_liab.st_provisions.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B153", "(b) Provision for income tax");
  setCell(sheet, "G153", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H153", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B154", "(c) Provision for expenses");
  setCell(sheet, "G154", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H154", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B159", "Total", { bold: true });
  setCell(sheet, "G159", { formula: "SUM(G152:G158)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H159", { formula: "SUM(H152:H158)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 4 — Deferred tax liabilities (Net) (rows 163-172) ────────────────
  // Placed here (after Note 10) to avoid shifting all row references above.
  // The note number (4 per Schedule III) is still correct in the header.
  writeNoteBlockHeader(sheet, 163, getNoteNo("deferred_tax_liab")!, "Deferred tax liabilities (Net)", "BS!D19");
  setCell(sheet, "B164", "Particulars", { bold: true });
  setCell(sheet, "G164", { formula: "+G61" }, { bold: true });
  setCell(sheet, "H164", { formula: "+H61" }, { bold: true });
  setCell(sheet, "B166", "Excess of depreciation allowable under IT Act over accounts");
  setCell(sheet, "G166", num(notes, "bs_liab.deferred_tax_liab.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H166", num(notes, "bs_liab.deferred_tax_liab.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B167", "(b) Others (specify nature)");
  setCell(sheet, "G167", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H167", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B169", "Total", { bold: true });
  setCell(sheet, "G169", { formula: "SUM(G165:G168)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H169", { formula: "SUM(H165:H168)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  setCell(sheet, "A172", "(This space has been intentionally left blank)", { align: "center", size: 9 });
  sheet.mergeCells("A172:H172");
}

// ═════════════════════════════════════════════════════════════════════════
// "Note BS-Asset" — Notes 12-21 (PPE/Intangibles in FA sheet)
// ═════════════════════════════════════════════════════════════════════════

function writeNoteBSAsset(wb: ExcelJS.Workbook, ctx: Ctx, notes: Stage5Notes | null): void {
  const sheet = wb.addWorksheet("Note BS-Asset", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 4.4 },  { width: 29.6 }, { width: 7.6 },  { width: 8.6 },
    { width: 11 },   { width: 10 },   { width: 10.3 }, { width: 10.7 },
  ];

  setCell(sheet, "A1", { formula: "BS!B2" }, { bold: true, size: 12, align: "center" });
  sheet.mergeCells("A1:H1");
  setCell(sheet, "A3", `Schedules to Balance Sheet as at 31st March, ${ctx.cyYear}`,
    { bold: true, size: 11, align: "center" });
  sheet.mergeCells("A3:H3");

  // ── Note 12 — Non-current investments (rows 5-12) ──────────────────────
  writeNoteBlockHeader(sheet, 5, getNoteNo("nc_investments")!, "Non-current investments", "BS!D40", "+BS!E5");
  setCell(sheet, "B6", "Particulars", { bold: true });
  setCell(sheet, "G6", "As at", { bold: true, align: "center" });
  setCell(sheet, "H6", "As at", { bold: true, align: "center" });
  setCell(sheet, "B7", "(Also disclose aggregate amount of Quoted and Unquoted)");
  setCell(sheet, "G7", { formula: "+BS!E7" }, { bold: true, align: "center" });
  setCell(sheet, "H7", { formula: "+BS!F7" }, { bold: true, align: "center" });
  setCell(sheet, "B8", "(a) Investment property");
  setCell(sheet, "G8", num(notes, "bs_asset.nc_investments.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H8", num(notes, "bs_asset.nc_investments.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B9", "(b) Investments in Equity Instruments");
  setCell(sheet, "G9", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H9", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B10", "(c) Other non-current investments (specify nature)");
  setCell(sheet, "G10", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H10", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B12", "Total", { bold: true });
  setCell(sheet, "G12", { formula: "SUM(G8:G11)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H12", { formula: "SUM(H8:H11)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 13 — Deferred tax assets (rows 14-19) ─────────────────────────
  writeNoteBlockHeader(sheet, 14, getNoteNo("deferred_tax_assets")!, "Deferred tax assets", "BS!D41");
  setCell(sheet, "H14", "(Amount in `)", { align: "center", size: 9 });
  setCell(sheet, "B15", "Particulars", { bold: true });
  setCell(sheet, "G15", { formula: "+'Note BS-Liab'!G6" }, { bold: true });
  setCell(sheet, "H15", { formula: "+'Note BS-Liab'!H6" }, { bold: true });
  setCell(sheet, "B17", "Excess of depreciation on fixed assets in accounts over IT Act");
  setCell(sheet, "G17", num(notes, "bs_asset.deferred_tax_asset.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H17", num(notes, "bs_asset.deferred_tax_asset.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B19", "Total", { bold: true });
  setCell(sheet, "G19", { formula: "SUM(G16:G17)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H19", { formula: "SUM(H16:H17)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 14 — Long-term loans and advances (rows 21-27) ────────────────
  writeNoteBlockHeader(sheet, 21, getNoteNo("lt_loans_advances")!, "Long-term loans and advances", "BS!D42");
  setCell(sheet, "B22", "Particulars", { bold: true });
  setCell(sheet, "G22", { formula: "+G15" }, { bold: true });
  setCell(sheet, "H22", { formula: "+H15" }, { bold: true });
  setCell(sheet, "B23", "(b) Capital Advances");
  setCell(sheet, "G23", num(notes, "bs_asset.lt_loans.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H23", num(notes, "bs_asset.lt_loans.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B24", "(c) Loans and advances to related parties (giving particulars)");
  setCell(sheet, "G24", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H24", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B25", "(d) Other loans and advances (specify nature)");
  setCell(sheet, "G25", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H25", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B27", "Total", { bold: true });
  setCell(sheet, "G27", { formula: "SUM(G23:G26)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H27", { formula: "SUM(H23:H26)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 15 — Other non-current assets (rows 30-35) ────────────────────
  writeNoteBlockHeader(sheet, 30, getNoteNo("other_nc_assets")!, "Other non-current assets", "BS!D43");
  setCell(sheet, "B31", "Particulars", { bold: true });
  setCell(sheet, "G31", { formula: "+G22" }, { bold: true });
  setCell(sheet, "H31", { formula: "+H22" }, { bold: true });
  setCell(sheet, "B32", "Security Deposits");
  setCell(sheet, "G32", num(notes, "bs_asset.other_nc_assets.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H32", num(notes, "bs_asset.other_nc_assets.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B33", "Others");
  setCell(sheet, "G33", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H33", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B35", "Total", { bold: true });
  setCell(sheet, "G35", { formula: "SUM(G32:G33)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H35", { formula: "SUM(H32:H33)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 16 — Current Investment (rows 37-44) ──────────────────────────
  writeNoteBlockHeader(sheet, 37, getNoteNo("current_investments")!, "Current Investment", "BS!D46");
  setCell(sheet, "B38", "Particulars", { bold: true });
  setCell(sheet, "G38", "As at", { bold: true, align: "center" });
  setCell(sheet, "H38", "As at", { bold: true, align: "center" });
  setCell(sheet, "B39", "(Also disclose aggregate amount of Quoted and Unquoted)");
  setCell(sheet, "G39", { formula: "+G7" }, { bold: true });
  setCell(sheet, "H39", { formula: "+H7" }, { bold: true });
  setCell(sheet, "B41", "(a) Investments in Equity Instruments");
  setCell(sheet, "G41", num(notes, "bs_asset.curr_investments.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H41", num(notes, "bs_asset.curr_investments.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B42", "(b) Other investments (specify nature)");
  setCell(sheet, "G42", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H42", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B44", "Total", { bold: true });
  setCell(sheet, "G44", { formula: "SUM(G38:G42)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H44", { formula: "SUM(H38:H42)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 17 — Inventories (rows 46-50) ─────────────────────────────────
  writeNoteBlockHeader(sheet, 46, getNoteNo("inventories")!, "Inventories", "BS!D47");
  setCell(sheet, "B47", "Particulars", { bold: true });
  setCell(sheet, "G47", { formula: "+G31" }, { bold: true });
  setCell(sheet, "H47", { formula: "+H31" }, { bold: true });
  // ★ KEY CROSS-SHEET LINK — Note BS-Asset row 48 G/H ← 'Note PL'!F39/G39
  setCell(sheet, "B48", "Stock-in-trade");
  setCell(sheet, "G48", { formula: "'Note PL'!F39" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H48", { formula: "'Note PL'!G39" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B50", "Total", { bold: true });
  setCell(sheet, "G50", { formula: "SUM(G45:G48)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H50", { formula: "SUM(H45:H48)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "I50", "Mode of valuation shall be stated", { size: 8, align: "left" });

  // ── Note 18 — Trade Receivables (rows 57-78) + ageing ──────────────────
  writeNoteBlockHeader(sheet, 57, getNoteNo("trade_receivables")!, "Trade Receivables", "BS!D48");
  setCell(sheet, "H57", "(Amount in `)", { align: "center", size: 9 });
  setCell(sheet, "B58", "Particulars", { bold: true });
  setCell(sheet, "G58", { formula: "+G47" }, { bold: true });
  setCell(sheet, "H58", { formula: "+H47" }, { bold: true });
  setCell(sheet, "B59", "Outstanding for a period exceeding six months from due date of payment");
  setCell(sheet, "G59", num(notes, "bs_asset.trade_receivables.gt6m_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H59", num(notes, "bs_asset.trade_receivables.gt6m_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B60", "Other receivables");
  setCell(sheet, "G60", num(notes, "bs_asset.trade_receivables.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H60", num(notes, "bs_asset.trade_receivables.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B62", "Total", { bold: true });
  setCell(sheet, "G62", { formula: "SUM(G57:G60)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H62", { formula: "SUM(H57:H60)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // Trade Receivables ageing — CY (rows 64-70)
  setCell(sheet, "B64", `Trade Receivables ageing schedule as on 31.03.${ctx.cyYear}`, { bold: true });
  setCell(sheet, "B65", "Particulars", { bold: true });
  setCell(sheet, "C65", "Outstanding for following periods from due date of payment", { bold: true, align: "center" });
  setCell(sheet, "H65", "Total", { bold: true, align: "center" });
  setCell(sheet, "C66", "< 6 months", { bold: true, align: "center" });
  setCell(sheet, "D66", "6 months-1 year", { bold: true, align: "center" });
  setCell(sheet, "E66", "1-2 years", { bold: true, align: "center" });
  setCell(sheet, "F66", "2-3 years", { bold: true, align: "center" });
  setCell(sheet, "G66", "> 3 years", { bold: true, align: "center" });

  const trAgeCy: any = (notes?.bs_asset as any)?.trade_receivables?.ageing_cy || {};
  const writeTrAgeRow = (rowIdx: number, key: string, label: string, defaultC = 0) => {
    setCell(sheet, `B${rowIdx}`, label);
    setCell(sheet, `C${rowIdx}`, defaultC || Number(trAgeCy[key]?.lt6m || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `D${rowIdx}`, Number(trAgeCy[key]?.["6m_1y"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `E${rowIdx}`, Number(trAgeCy[key]?.["1_2"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `F${rowIdx}`, Number(trAgeCy[key]?.["2_3"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `G${rowIdx}`, Number(trAgeCy[key]?.gt3 || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `H${rowIdx}`, { formula: `SUM(C${rowIdx}:G${rowIdx})` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  };
  writeTrAgeRow(67, "undisp_good",     "    Undisputed Trade receivables – considered good", num(notes, "bs_asset.trade_receivables.cy"));
  writeTrAgeRow(68, "undisp_doubtful", "    Undisputed Trade Receivables – considered doubtful");
  writeTrAgeRow(69, "disp_good",       "    Disputed Trade Receivables considered good");
  writeTrAgeRow(70, "disp_doubtful",   "    Disputed Trade Receivables considered doubtful");

  // Trade Receivables ageing — PY (rows 72-78)
  setCell(sheet, "B72", `Trade Receivables ageing schedule as on 31.03.${ctx.pyYear}`, { bold: true });
  setCell(sheet, "B73", "Particulars", { bold: true });
  setCell(sheet, "C73", "Outstanding for following periods from due date of payment", { bold: true, align: "center" });
  setCell(sheet, "H73", "Total", { bold: true, align: "center" });
  setCell(sheet, "C74", "< 6 months", { bold: true, align: "center" });
  setCell(sheet, "D74", "6 months-1 year", { bold: true, align: "center" });
  setCell(sheet, "E74", "1-2 years", { bold: true, align: "center" });
  setCell(sheet, "F74", "2-3 years", { bold: true, align: "center" });
  setCell(sheet, "G74", "> 3 years", { bold: true, align: "center" });
  const trAgePy: any = (notes?.bs_asset as any)?.trade_receivables?.ageing_py || {};
  const writeTrAgePyRow = (rowIdx: number, key: string, label: string, defaultC = 0) => {
    setCell(sheet, `B${rowIdx}`, label);
    setCell(sheet, `C${rowIdx}`, defaultC || Number(trAgePy[key]?.lt6m || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `D${rowIdx}`, Number(trAgePy[key]?.["6m_1y"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `E${rowIdx}`, Number(trAgePy[key]?.["1_2"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `F${rowIdx}`, Number(trAgePy[key]?.["2_3"] || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `G${rowIdx}`, Number(trAgePy[key]?.gt3 || 0), { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `H${rowIdx}`, { formula: `SUM(C${rowIdx}:G${rowIdx})` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  };
  writeTrAgePyRow(75, "undisp_good",     "    Undisputed Trade receivables – considered good", num(notes, "bs_asset.trade_receivables.py"));
  writeTrAgePyRow(76, "undisp_doubtful", "    Undisputed Trade Receivables – considered doubtful");
  writeTrAgePyRow(77, "disp_good",       "    Disputed Trade Receivables considered good");
  writeTrAgePyRow(78, "disp_doubtful",   "    Disputed Trade Receivables considered doubtful");

  setCell(sheet, "B80", "Note:", { bold: true });
  setCell(sheet, "B81", "There are no \"Unbilled\" and \"Not due\" trade receivables.", { size: 9 });

  // ── Note 19 — Cash and bank equivalents (rows 83-92) ───────────────────
  writeNoteBlockHeader(sheet, 83, getNoteNo("cash_bank")!, "Cash and bank equivalents", "BS!D49");
  setCell(sheet, "B84", "Particulars", { bold: true });
  setCell(sheet, "G84", { formula: "+G58" }, { bold: true });
  setCell(sheet, "H84", { formula: "+H58" }, { bold: true });
  setCell(sheet, "B85", "Cash and cash equivalents", { bold: true });
  setCell(sheet, "B86", "Balances with banks - Current accounts");
  setCell(sheet, "G86", num(notes, "bs_asset.cash_bank.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H86", num(notes, "bs_asset.cash_bank.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B87", "Cash on hand");
  setCell(sheet, "G87", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H87", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B89", "Other bank balances", { bold: true });
  setCell(sheet, "B90", "Deposits with original maturity period of more than 12 months");
  setCell(sheet, "G90", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H90", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B92", "Total", { bold: true });
  setCell(sheet, "G92", { formula: "SUM(G86:G90)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H92", { formula: "SUM(H86:H90)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 20 — Short-term loans and advances (rows 94-100) ──────────────
  writeNoteBlockHeader(sheet, 94, getNoteNo("st_loans_advances")!, "Short-term loans and advances", "BS!D50");
  setCell(sheet, "B95", "Particulars", { bold: true });
  setCell(sheet, "G95", { formula: "+G84" }, { bold: true });
  setCell(sheet, "H95", { formula: "+H84" }, { bold: true });
  setCell(sheet, "B96", "Unsecured, considered good");
  setCell(sheet, "G96", num(notes, "bs_asset.st_loans.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H96", num(notes, "bs_asset.st_loans.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B97", "(a) Loans and advances to related parties (giving particulars)");
  setCell(sheet, "G97", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H97", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B98", "(b) Others (specify nature)");
  setCell(sheet, "G98", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H98", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B100", "Total", { bold: true });
  setCell(sheet, "G100", { formula: "SUM(G96:G99)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H100", { formula: "SUM(H96:H99)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 21 — Other current assets (rows 107-116) ──────────────────────
  writeNoteBlockHeader(sheet, 107, getNoteNo("other_current_assets")!, "Other current assets", "BS!D51");
  setCell(sheet, "B108", "Particulars", { bold: true });
  setCell(sheet, "G108", "As at", { bold: true, align: "center" });
  setCell(sheet, "H108", "As at", { bold: true, align: "center" });
  setCell(sheet, "G109", { formula: "+G7" }, { bold: true });
  setCell(sheet, "H109", { formula: "+H7" }, { bold: true });
  setCell(sheet, "B110", "Advance Income-tax (net of provisons for tax)");
  setCell(sheet, "G110", num(notes, "bs_asset.other_curr_assets.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H110", num(notes, "bs_asset.other_curr_assets.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B111", "TDS Receivable");
  setCell(sheet, "G111", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H111", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B112", "TCS Receivable");
  setCell(sheet, "G112", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H112", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B113", "GST Receivable");
  setCell(sheet, "G113", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H113", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B114", "Prepaid expenses");
  setCell(sheet, "G114", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H114", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B116", "Total", { bold: true });
  setCell(sheet, "G116", { formula: "SUM(G110:G114)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H116", { formula: "SUM(H110:H114)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  setCell(sheet, "A120", "(This space has been intentionally left blank)", { align: "center", size: 9 });
  sheet.mergeCells("A120:H120");
}

// ═════════════════════════════════════════════════════════════════════════
// "Note PL" — Notes 22-30 (P&L break-ups + EPS)
// Column layout differs: F = CY, G = PY (NOT G/H like BS notes)
// ═════════════════════════════════════════════════════════════════════════

function writeNotePL(wb: ExcelJS.Workbook, ctx: Ctx, notes: Stage5Notes | null): void {
  const sheet = wb.addWorksheet("Note PL", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 5 },     { width: 15 },    { width: 13.9 },  { width: 12 },
    { width: 8.7 },   { width: 17 },    { width: 17 },    { width: 20.7 },
  ];

  setCell(sheet, "A1", { formula: "BS!B2" }, { bold: true, size: 12, align: "center" });
  sheet.mergeCells("A1:H1");
  setCell(sheet, "A3", `Schedules to Profit & Loss A/c. for the Financial year ${ctx.cyYear - 1}-${String(ctx.cyYear).slice(-2)}`,
    { bold: true, size: 11, align: "center" });
  sheet.mergeCells("A3:H3");

  // ── Note 22 — Revenue from operations (rows 5-11) ──────────────────────
  setCell(sheet, "A5", { formula: "PL!F9" }, { bold: true });
  setCell(sheet, "B5", "Revenue from operations", { bold: true });
  setCell(sheet, "G5", { formula: "+BS!E5" }, { bold: true, align: "center" });
  setCell(sheet, "B6", "Particulars", { bold: true });
  setCell(sheet, "F6", `For the year ended 31 March ${ctx.cyYear}`, { bold: true, align: "center" });
  setCell(sheet, "G6", `For the year ended 31 March ${ctx.pyYear}`, { bold: true, align: "center" });
  setCell(sheet, "B7", "Sale of products (Net off sales return)");
  setCell(sheet, "F7", num(notes, "pl.revenue_from_ops.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G7", num(notes, "pl.revenue_from_ops.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B8", "Sale of services");
  setCell(sheet, "F8", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G8", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B9", "Commission income");
  setCell(sheet, "F9", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G9", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B11", "Total", { bold: true });
  setCell(sheet, "F11", { formula: "SUM(F7:F10)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G11", { formula: "SUM(G7:G10)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 23 — Other Income (rows 13-19) ────────────────────────────────
  setCell(sheet, "A13", { formula: "PL!F10" }, { bold: true });
  setCell(sheet, "B13", "Other Income", { bold: true });
  setCell(sheet, "B14", "Particulars", { bold: true });
  setCell(sheet, "F14", { formula: "+F6" }, { bold: true });
  setCell(sheet, "G14", { formula: "+G6" }, { bold: true });
  setCell(sheet, "B15", "Interest income");
  setCell(sheet, "F15", num(notes, "pl.other_income.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G15", num(notes, "pl.other_income.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B16", "Gain on Forex fluctuation (Net)");
  setCell(sheet, "F16", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G16", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B17", "Miscellaneous income");
  setCell(sheet, "F17", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G17", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B19", "Total", { bold: true });
  setCell(sheet, "F19", { formula: "SUM(F15:F18)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G19", { formula: "SUM(G15:G18)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 24 — Cost of materials consumed (rows 21-28) ──────────────────
  setCell(sheet, "A21", { formula: "PL!F10" }, { bold: true });
  setCell(sheet, "B21", "Cost of materials consumed", { bold: true });
  setCell(sheet, "B22", "Particulars", { bold: true });
  setCell(sheet, "F22", { formula: "+F14" }, { bold: true });
  setCell(sheet, "G22", { formula: "+G14" }, { bold: true });
  setCell(sheet, "B23", "Raw Material Consumed", { bold: true });
  setCell(sheet, "B24", "  Opening Stock");
  setCell(sheet, "F24", num(notes, "pl.cost_materials.opening_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G24", num(notes, "pl.cost_materials.opening_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B25", "  Purchases");
  setCell(sheet, "F25", num(notes, "pl.cost_materials.purchases_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G25", num(notes, "pl.cost_materials.purchases_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B26", "  Less: Closing Stock");
  setCell(sheet, "F26", num(notes, "pl.cost_materials.closing_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G26", num(notes, "pl.cost_materials.closing_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B28", "Total", { bold: true });
  setCell(sheet, "F28", { formula: "+F24+F25-F26" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G28", { formula: "+G24+G25-G26" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 25 — Purchase of stock-in-trade (rows 30-34) ──────────────────
  setCell(sheet, "A30", { formula: "PL!F15" }, { bold: true });
  setCell(sheet, "B30", "Purchase of stock-in-trade", { bold: true });
  setCell(sheet, "B31", "Particulars", { bold: true });
  setCell(sheet, "F31", { formula: "+F14" }, { bold: true });
  setCell(sheet, "G31", { formula: "+G14" }, { bold: true });
  setCell(sheet, "B32", "Traded goods");
  setCell(sheet, "F32", num(notes, "pl.purchases_stock.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G32", num(notes, "pl.purchases_stock.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B34", "Total", { bold: true });
  setCell(sheet, "F34", { formula: "SUM(F32:F33)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G34", { formula: "SUM(G32:G33)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 26 — Changes in inventories (rows 36-47) ──────────────────────
  setCell(sheet, "A36", { formula: "PL!F16" }, { bold: true });
  setCell(sheet, "B36", "Changes in inventories", { bold: true });
  setCell(sheet, "B37", "Particulars", { bold: true });
  setCell(sheet, "F37", { formula: "+F31" }, { bold: true });
  setCell(sheet, "G37", { formula: "+G31" }, { bold: true });
  setCell(sheet, "B38", "Inventories at the end of the year", { bold: true });
  setCell(sheet, "B39", "Finished goods");
  setCell(sheet, "F39", num(notes, "pl.changes_inventory.fg_close_cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G39", num(notes, "pl.changes_inventory.fg_close_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "F41", { formula: "SUM(F39:F40)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G41", { formula: "SUM(G39:G40)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B42", "Inventories at the beginning of the year", { bold: true });
  setCell(sheet, "B43", "Finished goods");
  setCell(sheet, "F43", { formula: "G39" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G43", num(notes, "pl.changes_inventory.fg_open_py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "F45", { formula: "SUM(F43:F44)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G45", { formula: "SUM(G43:G44)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B47", "Net (increase)/decrease in inventory", { bold: true });
  setCell(sheet, "F47", { formula: "F45-F41" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G47", { formula: "G45-G41" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 27 — Employee benefits expense (rows 49-56) ───────────────────
  setCell(sheet, "A49", { formula: "PL!F17" }, { bold: true });
  setCell(sheet, "B49", "Employee benefits expense", { bold: true });
  setCell(sheet, "B50", "Particulars", { bold: true });
  setCell(sheet, "F50", { formula: "+F37" }, { bold: true });
  setCell(sheet, "G50", { formula: "+G37" }, { bold: true });
  setCell(sheet, "B51", "Salaries and wages");
  setCell(sheet, "F51", num(notes, "pl.employee_benefits.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G51", num(notes, "pl.employee_benefits.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B52", "Remuneration to directors");
  setCell(sheet, "F52", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G52", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B53", "Contribution to provident and other funds");
  setCell(sheet, "F53", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G53", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B54", "Staff welfare expense");
  setCell(sheet, "F54", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G54", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B56", "Total", { bold: true });
  setCell(sheet, "F56", { formula: "SUM(F51:F55)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G56", { formula: "SUM(G51:G55)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 28 — Finance Cost (rows 63-70) ────────────────────────────────
  setCell(sheet, "A63", { formula: "PL!F18" }, { bold: true });
  setCell(sheet, "B63", "Finance Cost", { bold: true });
  setCell(sheet, "G63", { formula: "+G5" }, { bold: true });
  setCell(sheet, "B64", "Particulars", { bold: true });
  setCell(sheet, "F64", { formula: "+F50" }, { bold: true });
  setCell(sheet, "G64", { formula: "+G50" }, { bold: true });
  setCell(sheet, "B65", "Interest Paid to Bank");
  setCell(sheet, "F65", num(notes, "pl.finance_costs.cy"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G65", num(notes, "pl.finance_costs.py"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B66", "Interest Paid to Other");
  setCell(sheet, "F66", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G66", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B67", "Other Borrowing Cost");
  setCell(sheet, "B68", "Interest on short payment of advance Income-Tax");
  setCell(sheet, "F68", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G68", 0, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B70", "Total", { bold: true });
  setCell(sheet, "F70", { formula: "SUM(F65:F68)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G70", { formula: "SUM(G65:G68)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 29 — Other expenses (rows 72-112; 37 standard items) ──────────
  setCell(sheet, "A72", { formula: "PL!F20" }, { bold: true });
  setCell(sheet, "B72", "Other expenses", { bold: true });
  setCell(sheet, "B73", "Particulars", { bold: true });
  setCell(sheet, "F73", { formula: "+F64" }, { bold: true });
  setCell(sheet, "G73", { formula: "+G64" }, { bold: true });

  const otherExpenses: { label: string; row: number }[] = [
    { row: 75,  label: "Advertisement Expenses" },
    { row: 76,  label: "Bad Debts" },
    { row: 77,  label: "Commission and Incentive Expenses" },
    { row: 78,  label: "Design and Development Service Expense" },
    { row: 79,  label: "Donation Expenses" },
    { row: 80,  label: "Electrical Expenses" },
    { row: 81,  label: "Electricity Expenses" },
    { row: 82,  label: "Entertainment Expenses" },
    { row: 83,  label: "Exhibition and Meeting Expense" },
    { row: 84,  label: "Freight & Transportation Expenses" },
    { row: 85,  label: "Insurance Expenses" },
    { row: 86,  label: "Interest, Late Fees, penalty on Statutory Dues" },
    { row: 87,  label: "Job Work Charges" },
    { row: 88,  label: "Kasar and Vatav" },
    { row: 89,  label: "Legal & Professional Expenses" },
    { row: 90,  label: "Office Expenses" },
    { row: 91,  label: "Other Membership, Licence/Certification and Subscription" },
    { row: 92,  label: "Petrol Expenses" },
    { row: 93,  label: "Postage and Courier Expenses" },
    { row: 94,  label: "Rates and Taxes" },
    { row: 95,  label: "Remuneration to Auditors" },
    { row: 96,  label: "Rent Expenses" },
    { row: 97,  label: "Repairs and Maintenance" },
    { row: 98,  label: "    Repairs to Buildings" },
    { row: 99,  label: "    Repairs of Machinery" },
    { row: 100, label: "    Repairs of Others" },
    { row: 101, label: "ROC Compliance Fees" },
    { row: 102, label: "Security and Safety Charges" },
    { row: 103, label: "Stationery and Printing Expenses" },
    { row: 104, label: "Sundry Balance Written off" },
    { row: 105, label: "Tea and Refreshment Expenses" },
    { row: 106, label: "Telephone Expenses" },
    { row: 107, label: "Travelling Expenses" },
    { row: 108, label: "   - Domestic" },
    { row: 109, label: "   - Foreign" },
    { row: 110, label: "Warranty Expense" },
  ];
  // Pull amounts from notes.pl.other_expenses.breakup if present
  const oeBreakup: any[] = (notes?.pl as any)?.other_expenses?.breakup || [];
  const oeMap: Record<string, { cy: number; py: number }> = {};
  for (const r of oeBreakup) {
    if (r?.description) {
      oeMap[String(r.description).trim().toLowerCase()] =
        { cy: Number(r.amount_cy || 0), py: Number(r.amount_py || 0) };
    }
  }
  for (const e of otherExpenses) {
    setCell(sheet, `B${e.row}`, e.label);
    const m = oeMap[e.label.trim().toLowerCase()];
    setCell(sheet, `F${e.row}`, m?.cy ?? 0, { numFmt: MONEY_FMT, align: "right" });
    setCell(sheet, `G${e.row}`, m?.py ?? 0, { numFmt: MONEY_FMT, align: "right" });
  }
  setCell(sheet, "B112", "Total", { bold: true });
  setCell(sheet, "F112", { formula: "SUM(F75:F111)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G112", { formula: "SUM(G75:G111)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  // ── Note 30 — Earnings per share (rows 114-122) ────────────────────────
  setCell(sheet, "A114", { formula: "PL!F40" }, { bold: true });
  setCell(sheet, "B114", "Earnings per share", { bold: true });
  setCell(sheet, "B115", "Particulars", { bold: true });
  setCell(sheet, "F115", { formula: "+F73" }, { bold: true });
  setCell(sheet, "G115", { formula: "+G73" }, { bold: true });
  // ★ KEY CROSS-SHEET LINK — Note PL row 117 F/G ← PL!G38/H38 ────────────
  setCell(sheet, "B117", "Net Profit After Tax attributable to shareholders");
  setCell(sheet, "F117", { formula: "PL!G38" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G117", { formula: "PL!H38" }, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H117", "As per P&L", { size: 9, align: "left" });
  setCell(sheet, "B118", "Nominal value per share (in Rs.)");
  setCell(sheet, "F118", num(notes, "pl.eps.nominal_value") || 10, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G118", num(notes, "pl.eps.nominal_value_py") || 10, { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B119", "Weighted average number of equity shares outstanding");
  setCell(sheet, "F119", num(notes, "pl.eps.weighted_avg_shares"), { numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G119", num(notes, "pl.eps.weighted_avg_shares_py"), { numFmt: MONEY_FMT, align: "right" });
  // EPS = NPAT × 100 / Weighted Avg Shares — per FS NOTES.xlsx template.
  setCell(sheet, "B120", "Basic earnings per share (in Rs.)");
  setCell(sheet, "F120", { formula: "IFERROR((F117*100/F119),0)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G120", { formula: "IFERROR((G117*100/G119),0)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "B121", "Diluted earnings per share (in Rs.)");
  setCell(sheet, "F121", { formula: "IFERROR((F117*100/F119),0)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G121", { formula: "IFERROR((G117*100/G119),0)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  setCell(sheet, "A127", "(This space has been intentionally left blank)", { align: "center", size: 9 });
  sheet.mergeCells("A127:H127");
}

// ═════════════════════════════════════════════════════════════════════════
// "FA" — Property, Plant & Equipment movement schedule (AS-10)
// 13-col grid: A=ref, B=particulars, C=useful life, D-G=Gross, H-K=Depn, L-M=Net
// ═════════════════════════════════════════════════════════════════════════

function writeFA(wb: ExcelJS.Workbook, ctx: Ctx, notes: Stage5Notes | null): void {
  const sheet = wb.addWorksheet("FA", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 6.6 },   // A
    { width: 18.1 },  // B  Particulars
    { width: 10 },    // C  Useful life
    { width: 9.6 },   // D  Gross open
    { width: 10 },    // E  Additions
    { width: 10.7 },  // F  Disposals
    { width: 10 },    // G  Gross close
    { width: 10 },    // H  Depn open
    { width: 10.6 },  // I  Depn add
    { width: 8.3 },   // J  Depn disp
    { width: 9.6 },   // K  Depn close
    { width: 9.6 },   // L  Net CY
    { width: 10.9 },  // M  Net PY
  ];

  setCell(sheet, "A2", { formula: "BS!B2" }, { bold: true, size: 12, align: "center" });
  sheet.mergeCells("A2:M2");
  setCell(sheet, "A4", { formula: "BS!D37" }, { bold: true });
  setCell(sheet, "B4", "Property, Plant and Equipment and Intangible Assets", { bold: true });

  setCell(sheet, "B5", `For the year ${ctx.cyYear - 1}-${String(ctx.cyYear).slice(-2)}`, { bold: true });
  // ★ KEY CROSS-SHEET LINK — FA row 5 M column ← BS!E5 (year header) ─────
  setCell(sheet, "M5", { formula: "+BS!E5" }, { bold: true, align: "center" });

  // Header rows
  setCell(sheet, "B6", "Particulars", { bold: true });
  setCell(sheet, "C6", "Useful life (years)", { bold: true, align: "center" });
  setCell(sheet, "D6", "Gross block", { bold: true, align: "center" });
  setCell(sheet, "H6", "Accumulated depreciation", { bold: true, align: "center" });
  setCell(sheet, "L6", "Net block", { bold: true, align: "center" });

  setCell(sheet, "D7", `As at 1 April ${ctx.cyYear - 1}`, { bold: true, align: "center", size: 9 });
  setCell(sheet, "E7", "Additions during the year", { bold: true, align: "center", size: 9 });
  setCell(sheet, "F7", "Disposals during the year", { bold: true, align: "center", size: 9 });
  setCell(sheet, "G7", { formula: "+'Note BS-Liab'!G6" }, { bold: true, align: "center" });
  setCell(sheet, "H7", `As at 1 April ${ctx.cyYear - 1}`, { bold: true, align: "center", size: 9 });
  setCell(sheet, "I7", "Additions during the year", { bold: true, align: "center", size: 9 });
  setCell(sheet, "J7", "Disposals during the year", { bold: true, align: "center", size: 9 });
  setCell(sheet, "K7", { formula: "+G7" }, { bold: true, align: "center" });
  setCell(sheet, "L7", { formula: "+K7" }, { bold: true, align: "center" });
  setCell(sheet, "M7", `As at 31 March ${ctx.pyYear}`, { bold: true, align: "center", size: 9 });

  setCell(sheet, "B9", "Property, Plant and Equipment", { bold: true });

  // Rows 10-21: asset rows. Pull from notes.fa.rows; pad/truncate as needed.
  const faRows: FARow[] = (notes?.fa?.rows && Array.isArray(notes.fa.rows))
    ? notes.fa.rows
    : [];
  const ROW_BASE = 10;
  const MAX_ROWS = 12;     // rows 10-21 inclusive in template
  for (let i = 0; i < MAX_ROWS; i++) {
    const r = ROW_BASE + i;
    const fr = faRows[i];
    if (fr) {
      setCell(sheet, `B${r}`, fr.particulars || "");
      setCell(sheet, `C${r}`, fr.useful_life ?? "", { align: "center" });
      setCell(sheet, `D${r}`, Number(fr.gross_open || 0), { numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `E${r}`, Number(fr.additions  || 0), { numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `F${r}`, Number(fr.disposals  || 0), { numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `G${r}`, { formula: `D${r}+E${r}-F${r}` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `H${r}`, Number(fr.depn_open  || 0), { numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `I${r}`, Number(fr.depn_add   || 0), { numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `J${r}`, Number(fr.depn_disp  || 0), { numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `K${r}`, { formula: `H${r}+I${r}-J${r}` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `L${r}`, { formula: `+G${r}-K${r}` }, { bold: true, numFmt: MONEY_FMT, align: "right" });
      setCell(sheet, `M${r}`, { formula: `D${r}-H${r}` },  { bold: true, numFmt: MONEY_FMT, align: "right" });
    }
  }

  setCell(sheet, "B22", "Total - Current year", { bold: true });
  setCell(sheet, "D22", { formula: "SUM(D10:D21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "E22", { formula: "SUM(E10:E21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "F22", { formula: "SUM(F10:F21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "G22", { formula: "SUM(G10:G21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "H22", { formula: "SUM(H10:H21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "I22", { formula: "SUM(I10:I21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "J22", { formula: "SUM(J10:J21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "K22", { formula: "SUM(K10:K21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "L22", { formula: "SUM(L10:L21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });
  setCell(sheet, "M22", { formula: "SUM(M10:M21)" }, { bold: true, numFmt: MONEY_FMT, align: "right" });

  setCell(sheet, "B23", "Total - Previous year", { italic: true } as any);
  for (const c of ["D","E","F","G","H","I","J","K","L","M"]) {
    setCell(sheet, `${c}23`, 0, { numFmt: MONEY_FMT, align: "right" });
  }

  setCell(sheet, "B25", "Notes:", { bold: true });
  setCell(sheet, "B26", "1. The Company has not revalued its Property, Plant & Equipment during the year.", { size: 9 });
}
