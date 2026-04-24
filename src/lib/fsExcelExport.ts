/**
 * fsExcelExport
 * ────────────────────────────────────────────────────────────────────────────
 * Generates the Stage 5 Financial Statements Excel workbook (Balance Sheet +
 * Statement of Profit & Loss + Cash Flow Statement) using ExcelJS for rich
 * formatting support (column widths, merged cells, borders, Indian money
 * format, font styles).
 *
 * DESIGN
 * Single function, pure (except for the returned Blob) — no DB I/O, no React
 * state. Caller must pre-fetch everything the function needs:
 *   • `engagement`   — audit_engagements row (+ optional joined partner + directors)
 *   • `firmSettings` — flattened firm master row (name / registration_no / city)
 *   • `bsData`       — pre-computed Balance Sheet rows (shape = BSRowData)
 *   • `plData`       — pre-computed P&L rows (shape = PLRowData)
 *   • `cfsData`      — pre-computed Cash Flow rows (shape = CFSRowData)
 *
 * Returns a browser-ready `Blob`; the caller can either:
 *   • trigger a file download via `URL.createObjectURL(blob)` + `<a download>`, or
 *   • email it, or
 *   • POST it to a storage endpoint.
 *
 * FIELD-NAME ADAPTATION (CAFlow vs. Phase-1 spec)
 * The Phase 1 spec uses field names that don't exactly match CAFlow's live
 * audit_engagements schema, so the caller is responsible for constructing the
 * `Engagement` and `FirmSettings` objects that match the shapes below. The
 * caller typically does this by joining:
 *   audit_engagements   (engagement row)
 *   └ clients           (client_name)
 *   └ users             (partner.full_name, partner.membership_no via partner_id)
 *   └ mrl_data.header_data  (directors[] via director1Name / director1Din etc.)
 *   └ firms             (FirmSettings row)
 *
 * That normalisation lives in the caller (Phase 3 wiring) so this export
 * module stays focused on rendering and can be tested in isolation.
 *
 * PHASE 1 SCOPE
 * This module currently provides:
 *   1. Type definitions for Engagement / FirmSettings / BSRowData / PLRowData / CFSRowData
 *   2. Shared variable computation (cyYear, pyYear, cyDate, pyDate, companyName,
 *      firmName, firmRegNo, firmCity, partnerName, partnerMemNo, signOffDate,
 *      dir1Name/DIN, dir2Name/DIN)
 *   3. Workbook scaffolding — three worksheets created with the correct
 *      column widths and no-gridlines view, ready to be populated
 *   4. Shared formatting constants (MONEY_FMT, borders, colours)
 *   5. Utility helpers (fmtIndian, buildLeafNames) reused by all 3 sheets
 *   6. Returns a Blob (empty worksheets for now — Phase 2 fills them in)
 *
 * Actual BS / PL / CFS row writing will be added in Phase 2+ by calling
 * the appropriate helpers on each worksheet using bsData / plData / cfsData.
 */

import ExcelJS from "exceljs";
import { format } from "date-fns";

// ═════════════════════════════════════════════════════════════════════════════
//  TYPE DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Shape of the engagement object expected by generateFinancialStatementsXLSX.
 * This is a denormalised view assembled by the caller from:
 *   audit_engagements + clients.name + users (partner) + mrl_data.header_data (directors)
 */
export interface Engagement {
  /** Client legal name — e.g. "SWADESHI LABORATORIES PRIVATE LIMITED". */
  client_name: string;
  /**
   * Last day of the financial year as ISO date (e.g. "2026-03-31"). CAFlow
   * stores `financial_year` as "YYYY-YY" on `audit_engagements`; the caller
   * converts that to `fy_end` before calling.
   */
  fy_end: string;
  /** Auditor's signing date ISO (e.g. "2026-05-12") — nullable. */
  sign_off_date?: string | null;
  /** Engagement partner's name + ICAI membership no. */
  partner?: {
    full_name?: string | null;
    membership_no?: string | null;
  } | null;
  /**
   * Up to 2 directors who sign the financial statements on the client's
   * behalf. Sourced from mrl_data.header_data (director1Name/Din/director2Name/Din).
   */
  directors?: Array<{
    name?: string | null;
    din?: string | null;
  }> | null;
}

/**
 * Firm master data — flattened by the caller from `firms` row.
 *   name            ← firm.display_name || firm.name
 *   registration_no ← firm.icai_firm_reg_no
 *   city            ← firm.address?.city || firm.state || ""
 */
export interface FirmSettings {
  name: string;
  registration_no: string;
  city: string;
}

/**
 * A single balance-sheet line item: the Note No. shown in column D and the
 * CY / PY amounts shown in columns E / F.
 */
export interface BSLineItem {
  noteNo: number | string | null;
  cy:     number;
  py:     number;
}

/**
 * Balance Sheet data shape (Phase 2D spec).
 *
 * The shape is keyed by line-item (instead of an array of rows) because each
 * line's ROW NUMBER in the sheet is hard-coded per the template (e.g. Share
 * Capital always sits on row 12). The writer references each key by name,
 * keeping the row-placement wiring out of caller code.
 *
 * Amount unit is ₹'000 (the header row 5 says "(Amount in Rs. `000)") — the
 * caller is responsible for scaling raw trial-balance numbers before calling.
 */
export interface BSRowData {
  // (1) Shareholders' funds
  shareCap:       BSLineItem;
  reserves:       BSLineItem;
  // (2) Share application money pending allotment — hardcoded 0/0 in writer
  // (3) Non-Current liabilities
  ltBorrowings:   BSLineItem;
  // (b) Deferred tax liabilities (Net) — hardcoded 0/0, no note no, in writer
  otherLtLiab:    BSLineItem;
  ltProvisions:   BSLineItem;
  // (4) Current liabilities
  stBorrowings:   BSLineItem;
  /** Trade payables parent — note no. only (D25:D27 merged); amounts on rows 26/27. */
  tradePayables:  Pick<BSLineItem, "noteNo">;
  /** Trade payables sub-row (i) — Micro and Small Enterprises — no noteNo. */
  tradePayMSME:   Pick<BSLineItem, "cy" | "py">;
  /** Trade payables sub-row (ii) — Others — no noteNo. */
  tradePayOthers: Pick<BSLineItem, "cy" | "py">;
  otherCurrLiab:  BSLineItem;
  stProvisions:   BSLineItem;

  // II ASSETS — (1) Non-Current Assets
  ppe:              BSLineItem;
  ncInvestments:    BSLineItem;
  dtAssets:         BSLineItem;
  ltLoans:          BSLineItem;
  otherNcAssets:    BSLineItem;
  // II ASSETS — (2) Current Assets
  currInvestments:  BSLineItem;
  inventories:      BSLineItem;
  tradeRec:         BSLineItem;
  cashBank:         BSLineItem;
  stLoans:          BSLineItem;
  otherCurrAssets:  BSLineItem;
  // Footer
  /** Significant accounting policies note-no reference (no amounts). */
  sigPolicies:      Pick<BSLineItem, "noteNo">;
}

/** P&L and CFS data — still loose pending their own sub-phase specs. */
export interface FSLineItemRow {
  code:         string;
  name:         string;
  depth:        number;
  noteRef?:     number | null;
  cy:           number;
  py:           number;
  isSubtotal?:  boolean;
  isHeading?:   boolean;
}

export interface PLRowData  { rows: FSLineItemRow[]; }
export interface CFSRowData { rows: FSLineItemRow[]; }

// ═════════════════════════════════════════════════════════════════════════════
//  SHARED FORMATTING CONSTANTS (re-used across all 3 worksheets)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Indian accounting money format.
 *   • Positive numbers → "1,23,456.78"
 *   • Negative numbers → "(1,23,456.78)" (parentheses, not minus sign)
 *   • Zero → "-"
 */
const MONEY_FMT = '#,##0.00;(#,##0.00);"-"';

const THIN_BLACK = { style: "thin" as const, color: { argb: "FF000000" } };

/** Every cell in a BS/PL data row gets this border — matches NCE reference layout. */
const FULL_BORDER = {
  top:    THIN_BLACK,
  bottom: THIN_BLACK,
  left:   THIN_BLACK,
  right:  THIN_BLACK,
};

/**
 * Balance Sheet column layout (Phase 2A spec).
 *   A  spacer  (2.3) — always empty
 *   B  spacer  (2.6) — always empty in data rows
 *   C  label   (40.6) — ALL text content (section headings, line-item names, totals)
 *   D  Note No (7.1)
 *   E  CY      (16.0) — "As at 31st March, {cyYear}"
 *   F  PY      (16.0) — "As at 31st March, {pyYear}"
 *   G  spacer  (9.1)  — always empty
 */
const BS_COLUMNS: Partial<ExcelJS.Column>[] = [
  { width: 2.3  },   // A  spacer
  { width: 2.6  },   // B  spacer
  { width: 40.6 },   // C  Particulars
  { width: 7.1  },   // D  Note
  { width: 16.0 },   // E  CY
  { width: 16.0 },   // F  PY
  { width: 9.1  },   // G  spacer
];

/**
 * Legacy common FS column layout (Phase 1 placeholder — still used by P&L
 * and CFS until their per-sheet specs arrive). Will be replaced with
 * PL_COLUMNS / CFS_COLUMNS in subsequent phase sub-steps.
 */
const FS_COLUMNS: Partial<ExcelJS.Column>[] = [
  { width: 2 },   // A  spacer
  { width: 46 },  // B  Particulars
  { width: 2 },   // C
  { width: 2 },   // D
  { width: 2 },   // E
  { width: 8 },   // F  Note
  { width: 18 },  // G  CY
  { width: 18 },  // H  PY
];

// ═════════════════════════════════════════════════════════════════════════════
//  SMALL PURE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Indian currency formatter — delegates actual rendering to Excel's MONEY_FMT,
 * but we still need a JS-side fallback when writing strings (e.g. in header
 * rows) instead of typed numeric cells.
 */
export function fmtIndian(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  if (n === 0) return "-";
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

/** "____________" placeholder for missing signature-block fields. */
const DASH = "____________";

// ═════════════════════════════════════════════════════════════════════════════
//  WORKSHEET WRITERS — one per statement, populated incrementally across
//  Phase 2 sub-steps (2A column layout, 2B header rows, 2C data rows, …)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Populate the BS (Balance Sheet) worksheet.
 *
 * Caller must have already applied column widths (BS_COLUMNS) and attached
 * the sheet to the workbook. This function writes:
 *   Phase 2B — merged cells
 *   Phase 2C — header rows 2-7 (company title, statement title, units, column headers)
 *   Phase 2D — Equity & Liabilities section rows 8-31
 * Phase 2E+ (Assets, signature block) will be appended here in later sub-steps.
 */
function writeBalanceSheet(
  sheet: ExcelJS.Worksheet,
  ctx:   FsExportContext,
  data:  BSRowData,
): void {
  const { cyYear, pyYear, companyName } = ctx;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 2B — Merged cells (apply BEFORE writing any row data)
  // ───────────────────────────────────────────────────────────────────────
  sheet.mergeCells("B2:F2");    // Company name row
  sheet.mergeCells("B4:F4");    // Balance Sheet title row
  sheet.mergeCells("E5:F5");    // "(Amount in Rs. `000)"
  sheet.mergeCells("B6:C7");    // "Particulars" header (2-row merge)
  sheet.mergeCells("D6:D7");    // "Note No." header (2-row merge)
  sheet.mergeCells("D25:D27");  // Trade Payables note no. (3-row merge)
  sheet.mergeCells("B26:C26"); // "(i) Micro and Small Enterprises"
  sheet.mergeCells("B27:C27"); // "(ii) Others"

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 2C — Header rows (2–7)
  // ───────────────────────────────────────────────────────────────────────

  // Row 2 — Company name
  sheet.getCell("B2").value = companyName;
  sheet.getCell("B2").font = { bold: true, size: 12 };
  sheet.getCell("B2").alignment = { horizontal: "center" };
  sheet.getRow(2).height = 22.5;

  // Row 3 — spacer
  sheet.getRow(3).height = 6;

  // Row 4 — "Balance Sheet as at 31st March, {cyYear}"
  sheet.getCell("B4").value = `Balance Sheet as at 31st March, ${cyYear}`;
  sheet.getCell("B4").font = { bold: true, size: 10 };
  sheet.getCell("B4").alignment = { horizontal: "center" };
  sheet.getRow(4).height = 13.5;

  // Row 5 — "(Amount in Rs. `000)"
  sheet.getCell("E5").value = "(Amount in Rs. `000)";
  sheet.getCell("E5").font = { bold: true, size: 10 };
  sheet.getCell("E5").alignment = { horizontal: "center" };
  sheet.getRow(5).height = 15.75;

  // Row 6 — Column headers (part 1)
  sheet.getCell("B6").value = "Particulars";
  sheet.getCell("B6").font = { bold: true, size: 10 };
  sheet.getCell("B6").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("D6").value = "Note No.";
  sheet.getCell("D6").font = { bold: true, size: 10 };
  sheet.getCell("D6").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("E6").value = "As at ";
  sheet.getCell("E6").font = { bold: true, size: 8 };
  sheet.getCell("E6").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("F6").value = "As at ";
  sheet.getCell("F6").font = { bold: true, size: 8 };
  sheet.getCell("F6").alignment = { horizontal: "center", wrapText: true };
  sheet.getRow(6).height = 13.5;

  // Row 7 — Column headers (part 2) — the dated rows under the two "As at" labels
  sheet.getCell("E7").value = `31st March, ${cyYear}`;
  sheet.getCell("E7").font = { bold: true, size: 8 };
  sheet.getCell("F7").value = `31st March, ${pyYear}`;
  sheet.getCell("F7").font = { bold: true, size: 8 };
  sheet.getRow(7).height = 15.0;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 2D — Equity & Liabilities section (rows 8–31)
  // ───────────────────────────────────────────────────────────────────────

  // Row 8 — spacer
  sheet.getRow(8).height = 6;

  // Row 9 — "I EQUITY AND LIABILITIES " (trailing space intentional)
  sheet.getCell("B9").value = "I EQUITY AND LIABILITIES ";
  sheet.getCell("B9").font = { bold: true, size: 10 };
  sheet.getRow(9).height = 12.75;

  // Row 10 — spacer
  sheet.getRow(10).height = 6;

  // Row 11 — "(1) Shareholders' funds"
  sheet.getCell("B11").value = "(1) Shareholders' funds";
  sheet.getCell("B11").font = { bold: true, size: 9 };

  // Row 12 — "(a) Share capital"
  sheet.getCell("B12").value = "(a) Share capital";
  sheet.getCell("B12").font = { bold: false, size: 9 };
  sheet.getCell("D12").value = data.shareCap.noteNo;
  sheet.getCell("D12").alignment = { horizontal: "center" };
  sheet.getCell("E12").value = data.shareCap.cy;
  sheet.getCell("E12").alignment = { horizontal: "right" };
  sheet.getCell("F12").value = data.shareCap.py;
  sheet.getCell("F12").alignment = { horizontal: "right" };

  // Row 13 — "(b) Reserves and surplus"
  sheet.getCell("B13").value = "(b) Reserves and surplus";
  sheet.getCell("B13").font = { bold: false, size: 9 };
  sheet.getCell("D13").value = data.reserves.noteNo;
  sheet.getCell("D13").alignment = { horizontal: "center" };
  sheet.getCell("E13").value = data.reserves.cy;
  sheet.getCell("E13").alignment = { horizontal: "right" };
  sheet.getCell("F13").value = data.reserves.py;
  sheet.getCell("F13").alignment = { horizontal: "right" };

  // Row 14 — spacer
  sheet.getRow(14).height = 8.1;

  // Row 15 — "(2) Share application money pending allotment" (hardcoded zeros)
  sheet.getCell("B15").value = "(2) Share application money pending allotment";
  sheet.getCell("B15").font = { bold: true, size: 9 };
  sheet.getCell("E15").value = 0;
  sheet.getCell("E15").font = { bold: true, size: 9 };
  sheet.getCell("E15").alignment = { horizontal: "right" };
  sheet.getCell("F15").value = 0;
  sheet.getCell("F15").font = { bold: true, size: 9 };
  sheet.getCell("F15").alignment = { horizontal: "right" };

  // Row 16 — spacer
  sheet.getRow(16).height = 8.1;

  // Row 17 — "(3) Non-Current liabilities"  (size 10 per spec)
  sheet.getCell("B17").value = "(3) Non-Current liabilities";
  sheet.getCell("B17").font = { bold: true, size: 10 };
  sheet.getRow(17).height = 12.75;

  // Row 18 — "(a) Long-term borrowings"
  sheet.getCell("B18").value = "(a) Long-term borrowings";
  sheet.getCell("B18").font = { bold: false, size: 9 };
  sheet.getCell("D18").value = data.ltBorrowings.noteNo;
  sheet.getCell("D18").alignment = { horizontal: "center" };
  sheet.getCell("E18").value = data.ltBorrowings.cy;
  sheet.getCell("E18").alignment = { horizontal: "right" };
  sheet.getCell("F18").value = data.ltBorrowings.py;
  sheet.getCell("F18").alignment = { horizontal: "right" };

  // Row 19 — "(b) Deferred tax liabilities (Net)"  (no note no, hardcoded zeros)
  sheet.getCell("B19").value = "(b) Deferred tax liabilities (Net)";
  sheet.getCell("B19").font = { bold: false, size: 9 };
  sheet.getCell("E19").value = 0;
  sheet.getCell("E19").alignment = { horizontal: "right" };
  sheet.getCell("F19").value = 0;
  sheet.getCell("F19").alignment = { horizontal: "right" };

  // Row 20 — "(c) Other Long term liabilities"  (capital L, lowercase t — exact)
  sheet.getCell("B20").value = "(c) Other Long term liabilities";
  sheet.getCell("B20").font = { bold: false, size: 9 };
  sheet.getCell("D20").value = data.otherLtLiab.noteNo;
  sheet.getCell("D20").alignment = { horizontal: "center" };
  sheet.getCell("E20").value = data.otherLtLiab.cy;
  sheet.getCell("E20").alignment = { horizontal: "right" };
  sheet.getCell("F20").value = data.otherLtLiab.py;
  sheet.getCell("F20").alignment = { horizontal: "right" };

  // Row 21 — "(d) Long-term provisions"
  sheet.getCell("B21").value = "(d) Long-term provisions";
  sheet.getCell("B21").font = { bold: false, size: 9 };
  sheet.getCell("D21").value = data.ltProvisions.noteNo;
  sheet.getCell("D21").alignment = { horizontal: "center" };
  sheet.getCell("E21").value = data.ltProvisions.cy;
  sheet.getCell("E21").alignment = { horizontal: "right" };
  sheet.getCell("F21").value = data.ltProvisions.py;
  sheet.getCell("F21").alignment = { horizontal: "right" };

  // Row 22 — spacer
  sheet.getRow(22).height = 8.1;

  // Row 23 — "(4) Current liabilities"  (size 10 per spec)
  sheet.getCell("B23").value = "(4) Current liabilities";
  sheet.getCell("B23").font = { bold: true, size: 10 };
  sheet.getCell("B23").alignment = { horizontal: "left" };
  sheet.getRow(23).height = 12.75;

  // Row 24 — "(a) Short-term borrowings"
  sheet.getCell("B24").value = "(a) Short-term borrowings";
  sheet.getCell("B24").font = { bold: false, size: 9 };
  sheet.getCell("D24").value = data.stBorrowings.noteNo;
  sheet.getCell("D24").alignment = { horizontal: "center" };
  sheet.getCell("E24").value = data.stBorrowings.cy;
  sheet.getCell("E24").alignment = { horizontal: "right" };
  sheet.getCell("F24").value = data.stBorrowings.py;
  sheet.getCell("F24").alignment = { horizontal: "right" };

  // Row 25 — "(b) Trade payables"  (D25:D27 merged — set noteNo on D25 only)
  sheet.getCell("B25").value = "(b) Trade payables";
  sheet.getCell("B25").font = { bold: false, size: 9 };
  sheet.getCell("D25").value = data.tradePayables.noteNo; // covers D25:D27 via merge
  sheet.getCell("D25").alignment = { horizontal: "center" };

  // Row 26 — "(i) Micro and Small Enterprises"  (B26:C26 merged)
  sheet.getCell("B26").value = "(i) Micro and Small Enterprises";
  sheet.getCell("B26").font = { bold: false, size: 9 };
  sheet.getCell("B26").alignment = { horizontal: "left", wrapText: true };
  sheet.getCell("E26").value = data.tradePayMSME.cy;
  sheet.getCell("E26").alignment = { horizontal: "right" };
  sheet.getCell("F26").value = data.tradePayMSME.py;
  sheet.getCell("F26").alignment = { horizontal: "right" };
  sheet.getRow(26).height = 12.0;

  // Row 27 — "(ii) Others"  (B27:C27 merged, justified alignment per spec)
  sheet.getCell("B27").value = "(ii) Others";
  sheet.getCell("B27").font = { bold: false, size: 9 };
  sheet.getCell("B27").alignment = { horizontal: "justify", wrapText: true };
  sheet.getCell("E27").value = data.tradePayOthers.cy;
  sheet.getCell("E27").alignment = { horizontal: "right" };
  sheet.getCell("F27").value = data.tradePayOthers.py;
  sheet.getCell("F27").alignment = { horizontal: "right" };
  sheet.getRow(27).height = 12.0;

  // Row 28 — "(c) Other current liabilities"  (size 10 per spec, NOT bold)
  sheet.getCell("B28").value = "(c) Other current liabilities";
  sheet.getCell("B28").font = { bold: false, size: 10 };
  sheet.getCell("D28").value = data.otherCurrLiab.noteNo;
  sheet.getCell("D28").alignment = { horizontal: "center" };
  sheet.getCell("E28").value = data.otherCurrLiab.cy;
  sheet.getCell("E28").alignment = { horizontal: "right" };
  sheet.getCell("F28").value = data.otherCurrLiab.py;
  sheet.getCell("F28").alignment = { horizontal: "right" };

  // Row 29 — "(d) Short-term provisions"
  sheet.getCell("B29").value = "(d) Short-term provisions";
  sheet.getCell("B29").font = { bold: false, size: 9 };
  sheet.getCell("D29").value = data.stProvisions.noteNo;
  sheet.getCell("D29").alignment = { horizontal: "center" };
  sheet.getCell("E29").value = data.stProvisions.cy;
  sheet.getCell("E29").alignment = { horizontal: "right" };
  sheet.getCell("F29").value = data.stProvisions.py;
  sheet.getCell("F29").alignment = { horizontal: "right" };

  // Row 30 — spacer
  sheet.getRow(30).height = 8.1;

  // Row 31 — "TOTAL EQUITY AND LIABILITIES" in col C + SUM formulas
  sheet.getCell("C31").value = "TOTAL EQUITY AND LIABILITIES";
  sheet.getCell("C31").font = { bold: true, size: 10 };
  sheet.getCell("C31").alignment = { horizontal: "center" };
  sheet.getCell("E31").value = { formula: "SUM(E10:E30)" };
  sheet.getCell("E31").font = { bold: true, size: 10 };
  sheet.getCell("E31").alignment = { horizontal: "right" };
  sheet.getCell("F31").value = { formula: "SUM(F10:F30)" };
  sheet.getCell("F31").font = { bold: true, size: 10 };
  sheet.getCell("F31").alignment = { horizontal: "right" };
  sheet.getRow(31).height = 12.0;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 2E — Assets section (rows 32–55)
  // ───────────────────────────────────────────────────────────────────────

  // Row 32 — spacer
  sheet.getRow(32).height = 6;

  // Row 33 — "II ASSETS"
  sheet.getCell("B33").value = "II ASSETS";
  sheet.getCell("B33").font = { bold: true, size: 10 };
  sheet.getCell("B33").alignment = { horizontal: "left" };
  sheet.getRow(33).height = 12.75;

  // Row 34 — spacer
  sheet.getRow(34).height = 8.1;

  // Row 35 — "(1) Non-Current Assets"
  sheet.getCell("B35").value = "(1) Non-Current Assets";
  sheet.getCell("B35").font = { bold: true, size: 10 };
  sheet.getCell("B35").alignment = { horizontal: "left" };

  // Row 36 — "(a) Property, Plant & Equipment and Intangible Assets"  (size 10)
  sheet.getCell("B36").value = "(a) Property, Plant & Equipment and Intangible Assets";
  sheet.getCell("B36").font = { bold: false, size: 10 };

  // Row 37 — "(i)Property, plant and equipment and Intangible Assets"
  //          CRITICAL: NO space between "(i)" and "Property" — exact from Excel
  sheet.getCell("B37").value = "(i)Property, plant and equipment and Intangible Assets";
  sheet.getCell("B37").font = { bold: false, size: 9 };
  sheet.getCell("B37").alignment = { indent: 1, horizontal: "left" };
  sheet.getCell("D37").value = data.ppe.noteNo;
  sheet.getCell("D37").alignment = { horizontal: "center" };
  sheet.getCell("E37").value = data.ppe.cy;
  sheet.getCell("E37").alignment = { horizontal: "right" };
  sheet.getCell("F37").value = data.ppe.py;
  sheet.getCell("F37").alignment = { horizontal: "right" };

  // Row 38 — "(ii) Intangible assets"  (indent 1)
  sheet.getCell("B38").value = "(ii) Intangible assets";
  sheet.getCell("B38").font = { bold: false, size: 9 };
  sheet.getCell("B38").alignment = { indent: 1, horizontal: "left" };

  // Row 39 — "(iii) Capital work-in-Progress"  (capital P in Progress)
  sheet.getCell("B39").value = "(iii) Capital work-in-Progress";
  sheet.getCell("B39").font = { bold: false, size: 9 };
  sheet.getCell("B39").alignment = { indent: 1, horizontal: "left" };

  // Row 40 — "(b) Non-current investments"  (size 10)
  sheet.getCell("B40").value = "(b) Non-current investments";
  sheet.getCell("B40").font = { bold: false, size: 10 };
  sheet.getCell("D40").value = data.ncInvestments.noteNo;
  sheet.getCell("D40").alignment = { horizontal: "center" };
  sheet.getCell("E40").value = data.ncInvestments.cy;
  sheet.getCell("E40").alignment = { horizontal: "right" };
  sheet.getCell("F40").value = data.ncInvestments.py;
  sheet.getCell("F40").alignment = { horizontal: "right" };

  // Row 41 — "(c) Deferred tax assets (Net)"  (size 10)
  sheet.getCell("B41").value = "(c) Deferred tax assets (Net)";
  sheet.getCell("B41").font = { bold: false, size: 10 };
  sheet.getCell("D41").value = data.dtAssets.noteNo;
  sheet.getCell("D41").alignment = { horizontal: "center" };
  sheet.getCell("E41").value = data.dtAssets.cy;
  sheet.getCell("E41").alignment = { horizontal: "right" };
  sheet.getCell("F41").value = data.dtAssets.py;
  sheet.getCell("F41").alignment = { horizontal: "right" };

  // Row 42 — "(d) Long-term loans and advances"
  sheet.getCell("B42").value = "(d) Long-term loans and advances";
  sheet.getCell("B42").font = { bold: false, size: 9 };
  sheet.getCell("D42").value = data.ltLoans.noteNo;
  sheet.getCell("D42").alignment = { horizontal: "center" };
  sheet.getCell("E42").value = data.ltLoans.cy;
  sheet.getCell("E42").alignment = { horizontal: "right" };
  sheet.getCell("F42").value = data.ltLoans.py;
  sheet.getCell("F42").alignment = { horizontal: "right" };

  // Row 43 — "(e) Other non-current Assets"  (size 10, capital A in Assets)
  sheet.getCell("B43").value = "(e) Other non-current Assets";
  sheet.getCell("B43").font = { bold: false, size: 10 };
  sheet.getCell("D43").value = data.otherNcAssets.noteNo;
  sheet.getCell("D43").alignment = { horizontal: "center" };
  sheet.getCell("E43").value = data.otherNcAssets.cy;
  sheet.getCell("E43").alignment = { horizontal: "right" };
  sheet.getCell("F43").value = data.otherNcAssets.py;
  sheet.getCell("F43").alignment = { horizontal: "right" };

  // Row 44 — spacer
  sheet.getRow(44).height = 8.1;

  // Row 45 — "(2) Current assets"
  sheet.getCell("B45").value = "(2) Current assets";
  sheet.getCell("B45").font = { bold: true, size: 10 };
  sheet.getCell("B45").alignment = { horizontal: "left" };

  // Row 46 — "(a) Current investments"
  sheet.getCell("B46").value = "(a) Current investments";
  sheet.getCell("B46").font = { bold: false, size: 9 };
  sheet.getCell("D46").value = data.currInvestments.noteNo;
  sheet.getCell("D46").alignment = { horizontal: "center" };
  sheet.getCell("E46").value = data.currInvestments.cy;
  sheet.getCell("E46").alignment = { horizontal: "right" };
  sheet.getCell("F46").value = data.currInvestments.py;
  sheet.getCell("F46").alignment = { horizontal: "right" };

  // Row 47 — "(b) Inventories"
  sheet.getCell("B47").value = "(b) Inventories";
  sheet.getCell("B47").font = { bold: false, size: 9 };
  sheet.getCell("D47").value = data.inventories.noteNo;
  sheet.getCell("D47").alignment = { horizontal: "center" };
  sheet.getCell("E47").value = data.inventories.cy;
  sheet.getCell("E47").alignment = { horizontal: "right" };
  sheet.getCell("F47").value = data.inventories.py;
  sheet.getCell("F47").alignment = { horizontal: "right" };

  // Row 48 — "(c) Trade receivables"
  sheet.getCell("B48").value = "(c) Trade receivables";
  sheet.getCell("B48").font = { bold: false, size: 9 };
  sheet.getCell("D48").value = data.tradeRec.noteNo;
  sheet.getCell("D48").alignment = { horizontal: "center" };
  sheet.getCell("E48").value = data.tradeRec.cy;
  sheet.getCell("E48").alignment = { horizontal: "right" };
  sheet.getCell("F48").value = data.tradeRec.py;
  sheet.getCell("F48").alignment = { horizontal: "right" };

  // Row 49 — "(d) Cash and bank equivalents"
  //          CRITICAL: NOT "Cash and Cash Equivalents" — exact from Excel
  sheet.getCell("B49").value = "(d) Cash and bank equivalents";
  sheet.getCell("B49").font = { bold: false, size: 9 };
  sheet.getCell("D49").value = data.cashBank.noteNo;
  sheet.getCell("D49").alignment = { horizontal: "center" };
  sheet.getCell("E49").value = data.cashBank.cy;
  sheet.getCell("E49").alignment = { horizontal: "right" };
  sheet.getCell("F49").value = data.cashBank.py;
  sheet.getCell("F49").alignment = { horizontal: "right" };

  // Row 50 — "(e) Short-term loans and advances"
  sheet.getCell("B50").value = "(e) Short-term loans and advances";
  sheet.getCell("B50").font = { bold: false, size: 9 };
  sheet.getCell("D50").value = data.stLoans.noteNo;
  sheet.getCell("D50").alignment = { horizontal: "center" };
  sheet.getCell("E50").value = data.stLoans.cy;
  sheet.getCell("E50").alignment = { horizontal: "right" };
  sheet.getCell("F50").value = data.stLoans.py;
  sheet.getCell("F50").alignment = { horizontal: "right" };

  // Row 51 — "(f) Other current assets"
  sheet.getCell("B51").value = "(f) Other current assets";
  sheet.getCell("B51").font = { bold: false, size: 9 };
  sheet.getCell("D51").value = data.otherCurrAssets.noteNo;
  sheet.getCell("D51").alignment = { horizontal: "center" };
  sheet.getCell("E51").value = data.otherCurrAssets.cy;
  sheet.getCell("E51").alignment = { horizontal: "right" };
  sheet.getCell("F51").value = data.otherCurrAssets.py;
  sheet.getCell("F51").alignment = { horizontal: "right" };

  // Row 52 — spacer
  sheet.getRow(52).height = 8.1;

  // Row 53 — "TOTAL ASSETS" in col C + SUM formulas
  sheet.getCell("C53").value = "TOTAL ASSETS";
  sheet.getCell("C53").font = { bold: true, size: 10 };
  sheet.getCell("C53").alignment = { horizontal: "center" };
  sheet.getCell("E53").value = { formula: "SUM(E35:E52)" };
  sheet.getCell("E53").font = { bold: true, size: 10 };
  sheet.getCell("E53").alignment = { horizontal: "right" };
  sheet.getCell("F53").value = { formula: "SUM(F35:F52)" };
  sheet.getCell("F53").font = { bold: true, size: 10 };
  sheet.getCell("F53").alignment = { horizontal: "right" };
  sheet.getRow(53).height = 12.0;

  // Row 54 — "Significant accounting policies and estimates"
  sheet.getCell("B54").value = "Significant accounting policies and estimates";
  sheet.getCell("B54").font = { bold: true, size: 9 };
  sheet.getCell("D54").value = data.sigPolicies.noteNo;
  sheet.getCell("D54").alignment = { horizontal: "center" };

  // Row 55 — "The accompanying notes..."
  sheet.getCell("B55").value = "The accompanying notes form an integral part of the financial statements.";
  sheet.getCell("B55").font = { bold: true, size: 9 };

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 2F — BS Signature Block (rows 57–70)
  // ───────────────────────────────────────────────────────────────────────
  const {
    firmName, firmRegNo, firmCity,
    partnerName, partnerMemNo, signOffDate,
    dir1Name, dir1DIN, dir2Name, dir2DIN,
  } = ctx;

  // Row 57
  sheet.getCell("B57").value = "As per our Audit Report of even date ";
  sheet.getCell("B57").font = { bold: false, size: 9 };

  // Row 59
  sheet.getCell("B59").value = `For ${firmName}`;
  sheet.getCell("B59").font = { bold: true, size: 9 };
  sheet.getCell("D59").value = "For and on behalf of the Board of Directors of ";
  sheet.getCell("D59").font = { bold: false, size: 9 };

  // Row 60
  sheet.getCell("B60").value = "Chartered Accountants";
  sheet.getCell("B60").font = { bold: false, size: 9 };
  sheet.getCell("D60").value = ctx.companyName;
  sheet.getCell("D60").font = { bold: true, size: 9 };

  // Row 61
  sheet.getCell("B61").value = `Firm's Registration No.: ${firmRegNo}`;
  sheet.getCell("B61").font = { bold: false, size: 9 };

  // Row 65 — signatory names
  sheet.getCell("B65").value = partnerName;
  sheet.getCell("B65").font = { bold: true, size: 9 };
  sheet.getCell("D65").value = dir1Name;
  sheet.getCell("D65").font = { bold: true, size: 9 };
  sheet.getCell("F65").value = dir2Name;
  sheet.getCell("F65").font = { bold: true, size: 9 };

  // Row 66 — roles
  sheet.getCell("B66").value = "Partner";
  sheet.getCell("D66").value = "Director";
  sheet.getCell("F66").value = "Director";

  // Row 67 — membership no & DINs
  sheet.getCell("B67").value = `Membership No.: ${partnerMemNo}`;
  sheet.getCell("D67").value = `DIN: ${dir1DIN}`;
  sheet.getCell("F67").value = `DIN: ${dir2DIN}`;

  // Row 69 — Place
  sheet.getCell("B69").value = `Place: ${firmCity}`;
  sheet.getCell("D69").value = `Place: ${firmCity}`;
  sheet.getCell("F69").value = `Place: ${firmCity}`;

  // Row 70 — Date
  sheet.getCell("B70").value = `Date: ${signOffDate}`;
  sheet.getCell("D70").value = `Date: ${signOffDate}`;
  sheet.getCell("F70").value = `Date: ${signOffDate}`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT FUNCTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the full BS + P&L + CFS workbook for a single engagement.
 *
 * @param engagement   Engagement (with partner + directors joined in)
 * @param firmSettings Flattened firm master
 * @param bsData       Pre-computed Balance Sheet rows
 * @param plData       Pre-computed Statement of P&L rows
 * @param cfsData      Pre-computed Cash Flow Statement rows
 * @returns            Blob containing the .xlsx file, ready for download
 */
export async function generateFinancialStatementsXLSX(
  engagement:   Engagement,
  firmSettings: FirmSettings,
  bsData:       BSRowData,
  plData:       PLRowData,
  cfsData:      CFSRowData,
): Promise<Blob> {
  // ── Shared variables (per Phase 1 spec — define ONCE, use in all 3 sheets) ──
  const cyYear      = new Date(engagement.fy_end).getFullYear();
  const pyYear      = cyYear - 1;
  const cyDate      = `31st March, ${cyYear}`;
  const pyDate      = `31st March, ${pyYear}`;
  const companyName = engagement.client_name;
  const firmName    = firmSettings.name;
  const firmRegNo   = firmSettings.registration_no;
  const firmCity    = firmSettings.city;
  const partnerName = engagement.partner?.full_name     ?? DASH;
  const partnerMemNo= engagement.partner?.membership_no ?? DASH;
  const signOffDate = engagement.sign_off_date
    ? format(new Date(engagement.sign_off_date), "dd.MM.yyyy")
    : DASH;
  const dir1Name    = engagement.directors?.[0]?.name ?? DASH;
  const dir1DIN     = engagement.directors?.[0]?.din  ?? DASH;
  const dir2Name    = engagement.directors?.[1]?.name ?? DASH;
  const dir2DIN     = engagement.directors?.[1]?.din  ?? DASH;

  // Bundle into a single context object so later-phase helpers can pass it
  // around without re-destructuring 15 variables at every call site.
  const ctx: FsExportContext = {
    cyYear, pyYear, cyDate, pyDate,
    companyName, firmName, firmRegNo, firmCity,
    partnerName, partnerMemNo, signOffDate,
    dir1Name, dir1DIN, dir2Name, dir2DIN,
  };

  // ── Workbook ─────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "CAFlow";
  wb.created = new Date();
  wb.company = firmName;

  // ── Worksheet: BS (Balance Sheet) — Phase 2A applied ────────────────────
  // Sheet name is "BS" per Phase 2A spec (not "Balance Sheet").
  const bs = wb.addWorksheet("BS", { views: [{ showGridLines: false }] });
  bs.columns = BS_COLUMNS;
  writeBalanceSheet(bs, ctx, bsData);

  // ── Worksheets: P&L and CFS — still on legacy layout until their specs
  //     arrive in later sub-phases.
  const pl  = wb.addWorksheet("Statement of Profit & Loss", { views: [{ showGridLines: false }] });
  const cfs = wb.addWorksheet("Cash Flow Statement",        { views: [{ showGridLines: false }] });
  for (const sheet of [pl, cfs]) {
    sheet.columns = FS_COLUMNS;
  }
  void plData; void cfsData; // populated in later sub-phases

  // ── Serialise to a Blob ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  INTERNAL: Context object shared with Phase 2+ worksheet-writer helpers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Snapshot of the shared variables computed from engagement + firm + directors.
 * Phase 2+ helpers (writeBalanceSheet, writeStatementOfPL, writeCashFlow,
 * writeSignatureBlock) take this as their second argument so they never need
 * to re-derive the Year or format the sign-off date.
 */
export interface FsExportContext {
  cyYear:       number;
  pyYear:       number;
  cyDate:       string;
  pyDate:       string;
  companyName:  string;
  firmName:     string;
  firmRegNo:    string;
  firmCity:     string;
  partnerName:  string;
  partnerMemNo: string;
  signOffDate:  string;
  dir1Name:     string;
  dir1DIN:      string;
  dir2Name:     string;
  dir2DIN:      string;
}

// Re-exports so Phase 2 helpers can share the same formatting primitives.
export {
  MONEY_FMT,
  THIN_BLACK,
  FULL_BORDER,
  BS_COLUMNS,
  FS_COLUMNS,
  DASH,
};
