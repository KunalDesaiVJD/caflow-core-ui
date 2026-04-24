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
  /** UDIN — 24-char Unique Document Identification Number — nullable. */
  udin?: string | null;
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

/**
 * A single P&L line item — same shape as BSLineItem. Aliased for clarity at
 * call sites so it's obvious which statement each item belongs to.
 */
export type PLLineItem = BSLineItem;

/**
 * Statement of Profit & Loss data shape (Phase 3 spec).
 *
 * Same keyed-by-line approach as BSRowData — row positions are hard-coded in
 * the writer, caller supplies the values. Amount unit is ₹'000.
 *
 * Phase 3C populates the first 2 income keys below; subsequent sub-phases
 * (3D expenses, 3E tax & PAT) will expand this type.
 */
export interface PLRowData {
  // Income (Phase 3C)
  revFromOps:         PLLineItem;
  otherIncome:        PLLineItem;
  // Expenses (Phase 3D)
  /**
   * Cost of materials consumed — spec emits ONLY the note number in cell F14.
   * Row 14 is deliberately excluded from Total Expenses (row 21 sums G15:G20).
   * If amounts are needed in future, extend writer and data shape together.
   */
  costMaterials:      Pick<PLLineItem, "noteNo">;
  purchasesStock:     PLLineItem;
  changesInventories: PLLineItem;
  employeeBenefits:   PLLineItem;
  financeCosts:       PLLineItem;
  depreciation:       PLLineItem;
  otherExpenses:      PLLineItem;
  // Tax & PAT / EPS (Phase 3E)
  /** Tax expense heading — note number only; F29:F31 merged. */
  taxExpense:   Pick<PLLineItem, "noteNo">;
  /** Current tax — amounts only (no noteNo column written — merged above). */
  currentTax:   Pick<PLLineItem, "cy" | "py">;
  /** Deferred tax — amounts only (no noteNo column written — merged above). */
  deferredTax:  Pick<PLLineItem, "cy" | "py">;
  /** Earnings Per Share — note number for the reference note. */
  eps:          Pick<PLLineItem, "noteNo">;
  /**
   * Share capital reference used in the EPS formula as the DIVISOR.
   * Semantically this should be the number of equity shares outstanding.
   * Per spec, the writer emits the formula `IFERROR(G38/<shareCap.noteNo>,0)`
   * so the caller must pass the share count (not a note reference) in the
   * `noteNo` field.
   */
  shareCap:     Pick<PLLineItem, "noteNo">;
  /**
   * Profit Before Tax — CY/PY values used by the CFS writer at row 9 as the
   * starting point for the operating-activities reconciliation. The PL sheet
   * itself computes PBT via formula in its own row 28; CFS needs the raw
   * numeric value so the caller must pre-compute it.
   */
  pbt:          Pick<PLLineItem, "cy" | "py">;
}

/**
 * A CFS working-capital change — CY only (PY is hardcoded to 0 in writer
 * per spec, as comparatives aren't reconstructed for the prior year's CFS).
 */
export interface CFSChange {
  cy: number;
}

/** Optional CY-only amount (used for income-tax-paid which can be null). */
export interface CFSChangeNullable {
  cy: number | null;
}

/**
 * Cash Flow Statement data shape (Phase 4 spec).
 *
 * Section A — Operating Activities needs 4 working-capital change values
 * and an income-tax-paid figure. All other row values come from cross-
 * references into BSRowData (inventories, trade receivables) and PLRowData
 * (PBT, depreciation), which the CFS writer reads directly alongside its
 * own cfsData argument.
 *
 * Caller still passes raw numbers; the writer emits SUM formulas for the
 * subtotals ("Operating profit before working capital changes", "Cash
 * generated from operations", "Net cash … from operating activities (A)").
 */
export interface CFSRowData {
  // Section A — Operating Activities (Phase 4C)
  tradePayChange:         CFSChange;
  otherCurrLiabChange:    CFSChange;
  otherCurrAssetsChange:  CFSChange;
  incomeTaxPaid:          CFSChangeNullable;
  // Section B — Investing Activities (Phase 4D)
  /**
   * Purchase of property, plant & equipments. Caller supplies the POSITIVE
   * outflow amount; the writer negates it (H29 = −ppePurchases.cy) to show
   * the cash outflow as a negative number in the CFS.
   */
  ppePurchases:           CFSChange;
  // (Section C — Financing Activities rows are caller-editable in Excel
  //  so no keys needed — rows 34-37 ship blank for the user to fill in.)
}

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
 * Statement of Profit & Loss column layout (Phase 3A spec).
 *   A  spacer (2.3)
 *   B  Roman numeral prefix — "I.", "II.", "III." etc. (4.3)
 *   C  sub-label continuation (4.6) — e.g. "Revenue from operations"
 *   D  main label text (27.4)
 *   E  label continuation (14.4)
 *   F  Note No. (9.3)
 *   G  CY amount — "For the year ended 31st March, {cyYear}" (15.6)
 *   H  PY amount — "For the year ended 31st March, {pyYear}" (15.3)
 */
const PL_COLUMNS: Partial<ExcelJS.Column>[] = [
  { width: 2.3  },   // A  spacer
  { width: 4.3  },   // B  Roman numeral prefix
  { width: 4.6  },   // C  sub-label continuation
  { width: 27.4 },   // D  main label text
  { width: 14.4 },   // E  label continuation
  { width: 9.3  },   // F  Note No.
  { width: 15.6 },   // G  CY
  { width: 15.3 },   // H  PY
];

/**
 * Cash Flow Statement column layout (Phase 4A spec).
 *   A  spacer        (3.4)
 *   B  section letter (2.4)  — "A.", "B.", "C."
 *   C  main label    (19.3)  — ALL text content
 *   D  label continuation (14.7)
 *   E  label continuation (12.7)
 *   F  spacer        (3.3)
 *   G  signature col — "For and on behalf of the Board of Directors of" (9.3)
 *   H  CY amount     (14.7)
 *   I  PY amount     (15.4)
 */
const CFS_COLUMNS: Partial<ExcelJS.Column>[] = [
  { width: 3.4  },   // A  spacer
  { width: 2.4  },   // B  section letter
  { width: 19.3 },   // C  main label
  { width: 14.7 },   // D  label continuation
  { width: 12.7 },   // E  label continuation
  { width: 3.3  },   // F  spacer
  { width: 9.3  },   // G  signature column
  { width: 14.7 },   // H  CY
  { width: 15.4 },   // I  PY
];

/** Legacy placeholder layout — now unused since CFS has its own. */
const FS_COLUMNS: Partial<ExcelJS.Column>[] = [
  { width: 2 }, { width: 46 }, { width: 2 }, { width: 2 },
  { width: 2 }, { width: 8 }, { width: 18 }, { width: 18 },
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
    partnerName, partnerMemNo, signOffDate, udinValue,
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

  // Row 68 — UDIN (auditor side only)
  sheet.getCell("B68").value = `UDIN: ${udinValue}`;
  sheet.getCell("B68").font = { size: 9 };

  // Row 69 — Place
  sheet.getCell("B69").value = `Place: ${firmCity}`;
  sheet.getCell("D69").value = `Place: ${firmCity}`;
  sheet.getCell("F69").value = `Place: ${firmCity}`;

  // Row 70 — Date
  sheet.getCell("B70").value = `Date: ${signOffDate}`;
  sheet.getCell("D70").value = `Date: ${signOffDate}`;
  sheet.getCell("F70").value = `Date: ${signOffDate}`;
}

/**
 * Populate the PL (Statement of Profit & Loss) worksheet.
 *
 * Caller must have already applied column widths (PL_COLUMNS) and attached
 * the sheet to the workbook. This function writes:
 *   Phase 3A — merged cells
 *   Phase 3B — header rows 2-7 (company title, statement title, units, column headers)
 *   Phase 3C — Income section rows 9-12 (Revenue from operations, Other income, Total Income)
 * Phase 3D+ (Expenses, Tax, PAT, EPS, signature block) will be appended in later sub-steps.
 */
function writeProfitAndLoss(
  sheet: ExcelJS.Worksheet,
  ctx:   FsExportContext,
  data:  PLRowData,
): void {
  const { cyYear, pyYear, companyName } = ctx;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 3A — Merged cells (apply BEFORE writing any row data)
  // ───────────────────────────────────────────────────────────────────────
  sheet.mergeCells("B2:H2");    // Company name
  sheet.mergeCells("B4:H4");    // Statement title
  sheet.mergeCells("G5:H5");    // "(Amount in Rs. `000)" — note: G5:H5 for PL (not E5:F5 like BS)
  sheet.mergeCells("B6:E7");    // "Particulars" header (2-row)
  sheet.mergeCells("F6:F7");    // "Note No." header (2-row)
  sheet.mergeCells("G6:G7");    // CY header (2-row)
  sheet.mergeCells("H6:H7");    // PY header (2-row)
  sheet.mergeCells("C16:E16"); // "Changes in inventories..." label (Phase 3D)
  sheet.mergeCells("C28:E28"); // "Profit before tax (VII-VIII)" (Phase 3E)
  sheet.mergeCells("F29:F31"); // Tax expense Note No. (3-row, Phase 3E)

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 3B — Header rows (2–7)
  // ───────────────────────────────────────────────────────────────────────

  // Row 2 — Company name
  sheet.getCell("B2").value = companyName;
  sheet.getCell("B2").font = { bold: true, size: 12 };
  sheet.getCell("B2").alignment = { horizontal: "center" };
  sheet.getRow(2).height = 18.0;

  // Row 4 — Statement title
  sheet.getCell("B4").value = `Statement of Profit & Loss Account for the year ended as on 31st March, ${cyYear}`;
  sheet.getCell("B4").font = { bold: true, size: 11 };
  sheet.getCell("B4").alignment = { horizontal: "center" };
  sheet.getRow(4).height = 15.0;

  // Row 5 — "(Amount in Rs. `000)" — merge is G5:H5 (not E5:F5 like BS)
  sheet.getCell("G5").value = "(Amount in Rs. `000)";
  sheet.getCell("G5").font = { bold: true, size: 10 };
  sheet.getCell("G5").alignment = { horizontal: "center" };
  sheet.getRow(5).height = 15.75;

  // Row 6 — Column headers (all 2-row merges already applied in 3A)
  sheet.getCell("B6").value = "Particulars";
  sheet.getCell("B6").font = { bold: true, size: 10 };
  sheet.getCell("B6").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("F6").value = "Note No.";
  sheet.getCell("F6").font = { bold: true, size: 10 };
  sheet.getCell("F6").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("G6").value = `For the year ended 31st March, ${cyYear}`;
  sheet.getCell("G6").font = { bold: true, size: 10 };
  sheet.getCell("G6").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("H6").value = `For the year ended 31st March, ${pyYear}`;
  sheet.getCell("H6").font = { bold: true, size: 10 };
  sheet.getCell("H6").alignment = { horizontal: "center", wrapText: true };
  sheet.getRow(6).height = 22.15;
  sheet.getRow(7).height = 16.5;
  sheet.getRow(8).height = 1.5;   // tiny spacer before income section

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 3C — Income section (rows 9–12)
  // ───────────────────────────────────────────────────────────────────────

  // Row 9 — I. Revenue from operations
  sheet.getCell("B9").value = "I.";
  sheet.getCell("B9").font = { bold: true, size: 9 };
  sheet.getCell("B9").alignment = { horizontal: "center" };
  sheet.getCell("C9").value = "Revenue from operations";
  sheet.getCell("C9").font = { bold: false, size: 9 };
  sheet.getCell("C9").alignment = { horizontal: "left" };
  sheet.getCell("F9").value = data.revFromOps.noteNo;
  sheet.getCell("F9").alignment = { horizontal: "center" };
  sheet.getCell("G9").value = data.revFromOps.cy;
  sheet.getCell("G9").alignment = { horizontal: "right" };
  sheet.getCell("H9").value = data.revFromOps.py;
  sheet.getCell("H9").alignment = { horizontal: "right" };

  // Row 10 — II. Other income  (size 10)
  sheet.getCell("B10").value = "II.";
  sheet.getCell("B10").font = { bold: true, size: 10 };
  sheet.getCell("B10").alignment = { horizontal: "center" };
  sheet.getCell("C10").value = "Other income";
  sheet.getCell("C10").font = { bold: false, size: 10 };
  sheet.getCell("C10").alignment = { horizontal: "left" };
  sheet.getCell("F10").value = data.otherIncome.noteNo;
  sheet.getCell("F10").alignment = { horizontal: "center" };
  sheet.getCell("G10").value = data.otherIncome.cy;
  sheet.getCell("G10").alignment = { horizontal: "right" };
  sheet.getCell("H10").value = data.otherIncome.py;
  sheet.getCell("H10").alignment = { horizontal: "right" };

  // Row 11 — III. Total Income (I+II)  bold + SUM formula
  sheet.getCell("B11").value = "III.";
  sheet.getCell("B11").font = { bold: true, size: 10 };
  sheet.getCell("B11").alignment = { horizontal: "center" };
  sheet.getCell("C11").value = "Total Income (I+II)";
  sheet.getCell("C11").font = { bold: true, size: 10 };
  sheet.getCell("G11").value = { formula: "SUM(G9:G10)" };
  sheet.getCell("G11").font = { bold: true, size: 10 };
  sheet.getCell("G11").alignment = { horizontal: "right" };
  sheet.getCell("H11").value = { formula: "SUM(H9:H10)" };
  sheet.getCell("H11").font = { bold: true, size: 10 };
  sheet.getCell("H11").alignment = { horizontal: "right" };

  // Row 12 — spacer
  sheet.getRow(12).height = 9.95;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 3D — Expenses section (rows 13–22)
  // ───────────────────────────────────────────────────────────────────────

  // Row 13 — IV. Expenses
  sheet.getCell("B13").value = "IV.";
  sheet.getCell("B13").font = { bold: true, size: 10 };
  sheet.getCell("B13").alignment = { horizontal: "center" };
  sheet.getCell("C13").value = "Expenses";
  sheet.getCell("C13").font = { bold: true, size: 10 };

  // Row 14 — Cost of materials consumed  (only note no., no amounts per spec)
  sheet.getCell("C14").value = "Cost of materials consumed";
  sheet.getCell("C14").font = { bold: false, size: 9 };
  sheet.getCell("F14").value = data.costMaterials.noteNo;
  sheet.getCell("F14").alignment = { horizontal: "center" };

  // Row 15 — Purchases of Stock-in-Trade
  sheet.getCell("C15").value = "Purchases of Stock-in-Trade";
  sheet.getCell("C15").font = { bold: false, size: 9 };
  sheet.getCell("F15").value = data.purchasesStock.noteNo;
  sheet.getCell("F15").alignment = { horizontal: "center" };
  sheet.getCell("G15").value = data.purchasesStock.cy;
  sheet.getCell("G15").alignment = { horizontal: "right" };
  sheet.getCell("H15").value = data.purchasesStock.py;
  sheet.getCell("H15").alignment = { horizontal: "right" };
  sheet.getRow(15).height = 15.0;

  // Row 16 — Changes in inventories  (C16:E16 merged, wrapText)
  sheet.getCell("C16").value = "Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade";
  sheet.getCell("C16").font = { bold: false, size: 9 };
  sheet.getCell("C16").alignment = { wrapText: true };
  sheet.getCell("F16").value = data.changesInventories.noteNo;
  sheet.getCell("F16").alignment = { horizontal: "center" };
  sheet.getCell("G16").value = data.changesInventories.cy;
  sheet.getCell("G16").alignment = { horizontal: "right" };
  sheet.getCell("H16").value = data.changesInventories.py;
  sheet.getCell("H16").alignment = { horizontal: "right" };
  sheet.getRow(16).height = 25.5;

  // Row 17 — Employee benefits expense
  sheet.getCell("C17").value = "Employee benefits expense";
  sheet.getCell("C17").font = { bold: false, size: 9 };
  sheet.getCell("C17").alignment = { horizontal: "left" };
  sheet.getCell("F17").value = data.employeeBenefits.noteNo;
  sheet.getCell("F17").alignment = { horizontal: "center" };
  sheet.getCell("G17").value = data.employeeBenefits.cy;
  sheet.getCell("G17").alignment = { horizontal: "right" };
  sheet.getCell("H17").value = data.employeeBenefits.py;
  sheet.getCell("H17").alignment = { horizontal: "right" };

  // Row 18 — Finance Costs
  sheet.getCell("C18").value = "Finance Costs";
  sheet.getCell("C18").font = { bold: false, size: 9 };
  sheet.getCell("C18").alignment = { horizontal: "left" };
  sheet.getCell("F18").value = data.financeCosts.noteNo;
  sheet.getCell("F18").alignment = { horizontal: "center" };
  sheet.getCell("G18").value = data.financeCosts.cy;
  sheet.getCell("G18").alignment = { horizontal: "right" };
  sheet.getCell("H18").value = data.financeCosts.py;
  sheet.getCell("H18").alignment = { horizontal: "right" };

  // Row 19 — Depreciation & Amortisation Expenses
  //          CRITICAL: trailing space after "Expenses " — exact from Excel
  sheet.getCell("C19").value = "Depreciation & Amortisation Expenses ";
  sheet.getCell("C19").font = { bold: false, size: 10 };
  sheet.getCell("F19").value = data.depreciation.noteNo;
  sheet.getCell("F19").alignment = { horizontal: "center" };
  sheet.getCell("G19").value = data.depreciation.cy;
  sheet.getCell("G19").alignment = { horizontal: "right" };
  sheet.getCell("H19").value = data.depreciation.py;
  sheet.getCell("H19").alignment = { horizontal: "right" };

  // Row 20 — Other expenses  (size 10)
  sheet.getCell("C20").value = "Other expenses";
  sheet.getCell("C20").font = { bold: false, size: 10 };
  sheet.getCell("C20").alignment = { horizontal: "left" };
  sheet.getCell("F20").value = data.otherExpenses.noteNo;
  sheet.getCell("F20").alignment = { horizontal: "center" };
  sheet.getCell("G20").value = data.otherExpenses.cy;
  sheet.getCell("G20").alignment = { horizontal: "right" };
  sheet.getCell("H20").value = data.otherExpenses.py;
  sheet.getCell("H20").alignment = { horizontal: "right" };

  // Row 21 — Total Expenses  bold + SUM(G15:G20) formula
  //          Note: SUM range intentionally EXCLUDES row 14 (Cost of materials
  //          consumed) per spec — that row shows only a note-number reference.
  sheet.getCell("C21").value = "Total Expenses";
  sheet.getCell("C21").font = { bold: true, size: 10 };
  sheet.getCell("G21").value = { formula: "SUM(G15:G20)" };
  sheet.getCell("G21").font = { bold: true, size: 10 };
  sheet.getCell("G21").alignment = { horizontal: "right" };
  sheet.getCell("H21").value = { formula: "SUM(H15:H20)" };
  sheet.getCell("H21").font = { bold: true, size: 10 };
  sheet.getCell("H21").alignment = { horizontal: "right" };

  // Row 22 — spacer
  sheet.getRow(22).height = 9.95;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 3E — PBT, Tax, PAT & EPS (rows 23–44)
  // ───────────────────────────────────────────────────────────────────────

  // Row 23 — V. Profit before exceptional items (G11-G21)
  sheet.getCell("B23").value = "V.";
  sheet.getCell("B23").font = { bold: true, size: 9 };
  sheet.getCell("B23").alignment = { horizontal: "center" };
  sheet.getCell("C23").value = "Profit before exceptional and extraordinary items and tax";
  sheet.getCell("C23").font = { bold: true, size: 9 };
  sheet.getCell("G23").value = { formula: "G11-G21" };
  sheet.getCell("G23").alignment = { horizontal: "right" };
  sheet.getCell("H23").value = { formula: "H11-H21" };
  sheet.getCell("H23").alignment = { horizontal: "right" };

  // Row 24 — "(III-IV)" on its own row
  sheet.getCell("C24").value = "(III-IV)";
  sheet.getCell("C24").font = { bold: true, size: 9 };

  // Row 25 — VI. Exceptional items
  sheet.getCell("B25").value = "VI.";
  sheet.getCell("B25").font = { bold: true, size: 9 };
  sheet.getCell("B25").alignment = { horizontal: "center" };
  sheet.getCell("C25").value = "Exceptional items";
  sheet.getCell("C25").font = { bold: false, size: 9 };

  // Row 26 — VII. Profit before extraordinary items and tax (V-VI)
  sheet.getCell("B26").value = "VII.";
  sheet.getCell("B26").font = { bold: true, size: 9 };
  sheet.getCell("B26").alignment = { horizontal: "center" };
  sheet.getCell("C26").value = "Profit before extraordinary items and tax (V-VI)";
  sheet.getCell("C26").font = { bold: true, size: 9 };

  // Row 27 — VIII. Extraordinary items (hardcoded 0/0)
  sheet.getCell("B27").value = "VIII.";
  sheet.getCell("B27").font = { bold: true, size: 9 };
  sheet.getCell("B27").alignment = { horizontal: "center" };
  sheet.getCell("C27").value = "Extraordinary items";
  sheet.getCell("C27").font = { bold: false, size: 9 };
  sheet.getCell("G27").value = 0;
  sheet.getCell("G27").alignment = { horizontal: "right" };
  sheet.getCell("H27").value = 0;
  sheet.getCell("H27").alignment = { horizontal: "right" };

  // Row 28 — IX. Profit before tax (VII-VIII)  (C28:E28 merged, height 12.0)
  sheet.getCell("B28").value = "IX.";
  sheet.getCell("B28").font = { bold: true, size: 9 };
  sheet.getCell("B28").alignment = { horizontal: "center" };
  sheet.getCell("C28").value = "Profit before tax (VII-VIII)";
  sheet.getCell("C28").font = { bold: true, size: 9 };
  sheet.getCell("C28").alignment = { wrapText: true };
  sheet.getCell("G28").value = { formula: "G23-G27" };
  sheet.getCell("G28").font = { bold: true, size: 9 };
  sheet.getCell("G28").alignment = { horizontal: "right" };
  sheet.getCell("H28").value = { formula: "H23-H27" };
  sheet.getCell("H28").font = { bold: true, size: 9 };
  sheet.getCell("H28").alignment = { horizontal: "right" };
  sheet.getRow(28).height = 12.0;

  // Row 29 — X. Tax expense:  (F29:F31 merged — set noteNo on F29 only)
  sheet.getCell("B29").value = "X.";
  sheet.getCell("B29").font = { bold: true, size: 9 };
  sheet.getCell("B29").alignment = { horizontal: "center" };
  sheet.getCell("C29").value = "Tax expense:";
  sheet.getCell("C29").font = { bold: true, size: 9 };
  sheet.getCell("F29").value = data.taxExpense.noteNo; // covers F29:F31 via merge
  sheet.getCell("F29").alignment = { horizontal: "center" };

  // Row 30 — (1) Current tax  (3 leading spaces, size 10)
  sheet.getCell("C30").value = "   (1) Current tax";
  sheet.getCell("C30").font = { bold: false, size: 10 };
  sheet.getCell("G30").value = data.currentTax.cy ?? 0;
  sheet.getCell("G30").alignment = { horizontal: "right" };
  sheet.getCell("H30").value = data.currentTax.py ?? 0;
  sheet.getCell("H30").alignment = { horizontal: "right" };

  // Row 31 — (2) Deferred tax  (3 leading spaces, size 9)
  sheet.getCell("C31").value = "   (2) Deferred tax";
  sheet.getCell("C31").font = { bold: false, size: 9 };
  sheet.getCell("G31").value = data.deferredTax.cy ?? 0;
  sheet.getCell("G31").alignment = { horizontal: "right" };
  sheet.getCell("H31").value = data.deferredTax.py ?? 0;
  sheet.getCell("H31").alignment = { horizontal: "right" };

  // Row 32 — XI. Profit from continuing operations
  //          CRITICAL: trailing space after "operations " — exact from Excel
  sheet.getCell("B32").value = "XI.";
  sheet.getCell("B32").font = { bold: true, size: 9 };
  sheet.getCell("B32").alignment = { horizontal: "center" };
  sheet.getCell("C32").value = "Profit (loss) for period from continuing operations ";
  sheet.getCell("C32").font = { bold: true, size: 9 };

  // Row 33 — "(VII-VIII)" on its own row
  sheet.getCell("C33").value = "(VII-VIII)";
  sheet.getCell("C33").font = { bold: true, size: 9 };

  // Row 34 — XII. Discontinuing operations
  sheet.getCell("B34").value = "XII.";
  sheet.getCell("B34").font = { bold: true, size: 9 };
  sheet.getCell("B34").alignment = { horizontal: "center" };
  sheet.getCell("C34").value = "Profit (loss) for period from discontinuing operations";
  sheet.getCell("C34").font = { bold: false, size: 9 };

  // Row 35 — XIII.
  sheet.getCell("B35").value = "XIII.";
  sheet.getCell("B35").font = { bold: true, size: 9 };
  sheet.getCell("B35").alignment = { horizontal: "center" };
  sheet.getCell("C35").value = "Tax expense of discontinuing operations";
  sheet.getCell("C35").font = { bold: false, size: 9 };

  // Row 36 — XIV.
  sheet.getCell("B36").value = "XIV.";
  sheet.getCell("B36").font = { bold: true, size: 9 };
  sheet.getCell("B36").alignment = { horizontal: "center" };
  sheet.getCell("C36").value = "Profit (loss) from discontinuing operations (after tax)";
  sheet.getCell("C36").font = { bold: true, size: 9 };

  // Row 37 — "(XII-XIII)" on its own row
  sheet.getCell("C37").value = "(XII-XIII)";
  sheet.getCell("C37").font = { bold: true, size: 9 };

  // Row 38 — XV. Profit / (Loss) for the period  (asymmetric CY vs PY formula per spec)
  sheet.getCell("B38").value = "XV.";
  sheet.getCell("B38").font = { bold: true, size: 9 };
  sheet.getCell("B38").alignment = { horizontal: "center" };
  sheet.getCell("C38").value = "Profit / (Loss) for the period (XI+XIV)";
  sheet.getCell("C38").font = { bold: true, size: 9 };
  sheet.getCell("G38").value = { formula: "G28-G30+G31" };
  sheet.getCell("G38").font = { bold: true, size: 9 };
  sheet.getCell("G38").alignment = { horizontal: "right" };
  sheet.getCell("H38").value = { formula: "H28-SUM(H30:H31)" };
  sheet.getCell("H38").font = { bold: true, size: 9 };
  sheet.getCell("H38").alignment = { horizontal: "right" };

  // Row 39 — spacer
  sheet.getRow(39).height = 5.1;

  // Row 40 — Earnings per  equity share ;
  //          CRITICAL: double space in "per  equity", trailing " ;"
  sheet.getCell("C40").value = "Earnings per  equity share ;";
  sheet.getCell("C40").font = { bold: true, size: 9 };
  sheet.getCell("F40").value = data.eps.noteNo;
  sheet.getCell("F40").alignment = { horizontal: "center" };

  // Row 41 — (1) Basic
  //          EPS = G38 / shareCap.noteNo (per spec, shareCap.noteNo is the
  //          share count used as divisor — not a note-ref here).
  sheet.getCell("C41").value = "(1) Basic";
  sheet.getCell("C41").font = { bold: false, size: 9 };
  sheet.getCell("G41").value = { formula: `IFERROR(G38/${data.shareCap.noteNo},0)` };
  sheet.getCell("G41").alignment = { horizontal: "right" };
  sheet.getCell("H41").value = { formula: `IFERROR(H38/${data.shareCap.noteNo},0)` };
  sheet.getCell("H41").alignment = { horizontal: "right" };

  // Row 42 — (2) Diluted
  sheet.getCell("C42").value = "(2) Diluted";
  sheet.getCell("C42").font = { bold: false, size: 9 };

  // Row 44 — Accompanying notes
  sheet.getCell("C44").value = "The accompanying notes form an integral part of the financial statements.";
  sheet.getCell("C44").font = { bold: false, size: 9 };

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 3F — PL Signature Block (rows 46–58)
  //  3-column layout (different from BS's 3-column layout):
  //    C — Auditor side (Firm / Partner)
  //    F — Director 1
  //    H — Director 2
  // ───────────────────────────────────────────────────────────────────────
  const {
    firmName, firmRegNo, firmCity,
    partnerName, partnerMemNo, signOffDate, udinValue,
    dir1Name, dir1DIN, dir2Name, dir2DIN,
  } = ctx;

  // Row 46 — "As per our Audit Report of even date " (trailing space per spec)
  sheet.getCell("C46").value = "As per our Audit Report of even date ";

  // Row 48 — Firm header / Board header
  sheet.getCell("C48").value = `For ${firmName}`;
  sheet.getCell("C48").font = { bold: true, size: 9 };
  sheet.getCell("F48").value = "For and on behalf of the Board of Directors of ";

  // Row 49 — Chartered Accountants / Company name
  sheet.getCell("C49").value = "Chartered Accountants";
  sheet.getCell("F49").value = companyName;
  sheet.getCell("F49").font = { bold: true, size: 9 };

  // Row 50 — Firm registration number
  sheet.getCell("C50").value = `Firm's Registration No.: ${firmRegNo}`;

  // Row 54 — Signatory names
  sheet.getCell("C54").value = partnerName;
  sheet.getCell("C54").font = { bold: true, size: 9 };
  sheet.getCell("F54").value = dir1Name;
  sheet.getCell("F54").font = { bold: true, size: 9 };
  sheet.getCell("H54").value = dir2Name;
  sheet.getCell("H54").font = { bold: true, size: 9 };

  // Row 55 — Roles
  sheet.getCell("C55").value = "Partner";
  sheet.getCell("F55").value = "Director";
  sheet.getCell("H55").value = "Director";

  // Row 56 — Membership No. / DINs
  sheet.getCell("C56").value = `Membership No.: ${partnerMemNo}`;
  sheet.getCell("F56").value = `DIN: ${dir1DIN}`;
  sheet.getCell("H56").value = `DIN: ${dir2DIN}`;

  // Row 57 — Place (same value written in all three columns)
  sheet.getCell("C57").value = `Place: ${firmCity}`;
  sheet.getCell("F57").value = `Place: ${firmCity}`;
  sheet.getCell("H57").value = `Place: ${firmCity}`;

  // Row 58 — Date (same sign-off date in all three columns)
  sheet.getCell("C58").value = `Date: ${signOffDate}`;
  sheet.getCell("F58").value = `Date: ${signOffDate}`;
  sheet.getCell("H58").value = `Date: ${signOffDate}`;

  // Row 59 — UDIN (auditor side only, under the Date line)
  sheet.getCell("C59").value = `UDIN: ${udinValue}`;
  sheet.getCell("C59").font = { size: 9 };
}

/**
 * Populate the CFS (Cash Flow Statement) worksheet.
 *
 * The CFS is the only sheet that cross-references OTHER statements' amounts:
 *   - Row 9  "Net profit before tax"       ← plData.pbt
 *   - Row 11 "Depreciation expense"        ← plData.depreciation
 *   - Row 20 "Inventories"                 ← bsData.inventories (PY − CY)
 *   - Row 21 "Trade receivables"           ← bsData.tradeRec    (PY − CY)
 * So this writer takes `bsData` and `plData` as additional arguments in
 * addition to its own `cfsData`. Phase 4A-4C covers the columns, merges,
 * header rows, and Section A (Operating activities). Phase 4D+ will append
 * Sections B (Investing), C (Financing), and the AS-3 reconciliation note.
 */
function writeCashFlow(
  sheet:   ExcelJS.Worksheet,
  ctx:     FsExportContext,
  data:    CFSRowData,
  bsData:  BSRowData,
  plData:  PLRowData,
): void {
  const { cyYear, pyYear, companyName } = ctx;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 4A — Merged cells (apply BEFORE writing any row data)
  // ───────────────────────────────────────────────────────────────────────
  sheet.mergeCells("B1:I1");     // Company name
  sheet.mergeCells("B3:I3");     // Statement title
  sheet.mergeCells("H4:I4");     // "(Amount in Rs. `000)"
  sheet.mergeCells("B5:G6");     // "Particulars" header (2-row)
  sheet.mergeCells("H5:H6");     // CY header (2-row)
  sheet.mergeCells("I5:I6");     // PY header (2-row)
  sheet.mergeCells("C46:I46");   // AS-3 note text (populated in Phase 4D)

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 4B — Header rows (1–6)
  // ───────────────────────────────────────────────────────────────────────

  // Row 1 — Company name (B1:I1 merged)
  sheet.getCell("B1").value = companyName;
  sheet.getCell("B1").font = { bold: true, size: 12 };
  sheet.getCell("B1").alignment = { horizontal: "center" };
  sheet.getRow(1).height = 19.5;

  // Row 2 — spacer
  sheet.getRow(2).height = 6;

  // Row 3 — Statement title
  //         CRITICAL: square brackets around the date — "[31 March <cyYear>]"
  sheet.getCell("B3").value = `Cash Flow Statement for the year ended [31 March ${cyYear}]`;
  sheet.getCell("B3").font = { bold: true, size: 11 };
  sheet.getCell("B3").alignment = { horizontal: "center" };
  sheet.getRow(3).height = 15.75;

  // Row 4 — "(Amount in Rs. `000)"  (H4:I4 merged — right side, not left like BS)
  sheet.getCell("H4").value = "(Amount in Rs. `000)";
  sheet.getCell("H4").font = { bold: true, size: 10 };
  sheet.getCell("H4").alignment = { horizontal: "center" };

  // Row 5-6 — Column headers (2-row merges applied in 4A)
  sheet.getCell("B5").value = "Particulars";
  sheet.getCell("B5").font = { bold: true, size: 10 };
  sheet.getCell("B5").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("H5").value = `As at 31st March, ${cyYear}`;
  sheet.getCell("H5").font = { bold: true, size: 10 };
  sheet.getCell("H5").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("I5").value = `As at 31st March, ${pyYear}`;
  sheet.getCell("I5").font = { bold: true, size: 10 };
  sheet.getCell("I5").alignment = { horizontal: "center", wrapText: true };
  sheet.getRow(5).height = 15.75;
  sheet.getRow(6).height = 12.0;
  sheet.getRow(7).height = 5.1;   // spacer before Section A

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 4C — Section A: Operating Activities (rows 8–27)
  // ───────────────────────────────────────────────────────────────────────

  // Row 8 — A. Cash flows from operating activities
  sheet.getCell("B8").value = "A.";
  sheet.getCell("B8").font = { bold: true, size: 10 };
  sheet.getCell("C8").value = "Cash flows from operating activities";
  sheet.getCell("C8").font = { bold: true, size: 10 };

  // Row 9 — Net profit before tax  (cross-referenced from PL row 28 → plData.pbt)
  sheet.getCell("C9").value = "Net profit before tax";
  sheet.getCell("C9").font = { bold: true, size: 10 };
  sheet.getCell("H9").value = plData.pbt.cy;
  sheet.getCell("H9").font = { bold: true, size: 10 };
  sheet.getCell("H9").alignment = { horizontal: "right" };
  sheet.getCell("I9").value = plData.pbt.py;
  sheet.getCell("I9").font = { bold: true, size: 10 };
  sheet.getCell("I9").alignment = { horizontal: "right" };

  // Row 10 — Adjustments for:  (label only, no amounts)
  sheet.getCell("C10").value = "Adjustments for:";
  sheet.getCell("C10").font = { bold: false, size: 9 };

  // Row 11 — Depreciation expense  (cross-referenced from PL row 19)
  sheet.getCell("C11").value = "Depreciation expense";
  sheet.getCell("C11").font = { bold: false, size: 9 };
  sheet.getCell("H11").value = plData.depreciation.cy;
  sheet.getCell("H11").alignment = { horizontal: "right" };
  sheet.getCell("I11").value = plData.depreciation.py;
  sheet.getCell("I11").alignment = { horizontal: "right" };

  // Row 12 — Interest income  (label-only, caller can edit the sheet manually)
  sheet.getCell("C12").value = "Interest income";
  sheet.getCell("C12").font = { bold: false, size: 9 };

  // Row 13 — Profit on sale of assets  (label-only)
  sheet.getCell("C13").value = "Profit on sale of assets";
  sheet.getCell("C13").font = { bold: false, size: 9 };

  // Row 14 — Interest expense  (label-only)
  sheet.getCell("C14").value = "Interest expense";
  sheet.getCell("C14").font = { bold: false, size: 9 };

  // Row 15 — spacer
  sheet.getRow(15).height = 3;

  // Row 16 — Operating profit before working capital changes  SUM(H9:H14)
  sheet.getCell("C16").value = "Operating profit before working capital changes";
  sheet.getCell("C16").font = { bold: true, size: 9 };
  sheet.getCell("H16").value = { formula: "SUM(H9:H14)" };
  sheet.getCell("H16").font = { bold: true, size: 9 };
  sheet.getCell("H16").alignment = { horizontal: "right" };
  sheet.getCell("I16").value = { formula: "SUM(I9:I14)" };
  sheet.getCell("I16").font = { bold: true, size: 9 };
  sheet.getCell("I16").alignment = { horizontal: "right" };

  // Row 17 — Changes in working capital:  (label only)
  sheet.getCell("C17").value = "Changes in working capital:";
  sheet.getCell("C17").font = { bold: true, size: 9 };

  // Row 18 — Trade payables  (CY from cfsData; PY hardcoded 0)
  sheet.getCell("C18").value = "Trade payables";
  sheet.getCell("C18").font = { bold: false, size: 9 };
  sheet.getCell("H18").value = data.tradePayChange.cy;
  sheet.getCell("H18").alignment = { horizontal: "right" };
  sheet.getCell("I18").value = 0;
  sheet.getCell("I18").alignment = { horizontal: "right" };

  // Row 19 — Other current liabilities  (size 10 per spec)
  sheet.getCell("C19").value = "Other current liabilities";
  sheet.getCell("C19").font = { bold: false, size: 10 };
  sheet.getCell("H19").value = data.otherCurrLiabChange.cy;
  sheet.getCell("H19").alignment = { horizontal: "right" };
  sheet.getCell("I19").value = 0;
  sheet.getCell("I19").alignment = { horizontal: "right" };

  // Row 20 — Inventories  (PY − CY: decrease in inventory = positive cash)
  sheet.getCell("C20").value = "Inventories";
  sheet.getCell("C20").font = { bold: false, size: 9 };
  sheet.getCell("H20").value = bsData.inventories.py - bsData.inventories.cy;
  sheet.getCell("H20").alignment = { horizontal: "right" };
  sheet.getCell("I20").value = 0;
  sheet.getCell("I20").alignment = { horizontal: "right" };

  // Row 21 — Trade receivables  (PY − CY)
  sheet.getCell("C21").value = "Trade receivables";
  sheet.getCell("C21").font = { bold: false, size: 9 };
  sheet.getCell("H21").value = bsData.tradeRec.py - bsData.tradeRec.cy;
  sheet.getCell("H21").alignment = { horizontal: "right" };
  sheet.getCell("I21").value = 0;
  sheet.getCell("I21").alignment = { horizontal: "right" };

  // Row 22 — Short term provision  (label-only)
  sheet.getCell("C22").value = "Short term provision";
  sheet.getCell("C22").font = { bold: false, size: 9 };

  // Row 23 — Other current assets  (size 10 per spec)
  sheet.getCell("C23").value = "Other current assets";
  sheet.getCell("C23").font = { bold: false, size: 10 };
  sheet.getCell("H23").value = data.otherCurrAssetsChange.cy;
  sheet.getCell("H23").alignment = { horizontal: "right" };
  sheet.getCell("I23").value = 0;
  sheet.getCell("I23").alignment = { horizontal: "right" };

  // Row 24 — Cash generated from operations  SUM(H16:H23)
  sheet.getCell("C24").value = "Cash generated from operations";
  sheet.getCell("C24").font = { bold: true, size: 9 };
  sheet.getCell("H24").value = { formula: "SUM(H16:H23)" };
  sheet.getCell("H24").font = { bold: true, size: 9 };
  sheet.getCell("H24").alignment = { horizontal: "right" };
  sheet.getCell("I24").value = { formula: "SUM(I16:I23)" };
  sheet.getCell("I24").font = { bold: true, size: 9 };
  sheet.getCell("I24").alignment = { horizontal: "right" };

  // Row 25 — Income tax paid  (size 10, null-coalescing per spec)
  sheet.getCell("C25").value = "Income tax paid";
  sheet.getCell("C25").font = { bold: false, size: 10 };
  sheet.getCell("H25").value = data.incomeTaxPaid.cy ?? 0;
  sheet.getCell("H25").alignment = { horizontal: "right" };
  sheet.getCell("I25").value = 0;
  sheet.getCell("I25").alignment = { horizontal: "right" };

  // Row 26 — Net cash generated from operating activities (A)
  sheet.getCell("C26").value = "Net cash generated from operating activities (A)";
  sheet.getCell("C26").font = { bold: true, size: 9 };
  sheet.getCell("H26").value = { formula: "H24+H25" };
  sheet.getCell("H26").font = { bold: true, size: 9 };
  sheet.getCell("H26").alignment = { horizontal: "right" };
  sheet.getCell("I26").value = { formula: "I24+I25" };
  sheet.getCell("I26").font = { bold: true, size: 9 };
  sheet.getCell("I26").alignment = { horizontal: "right" };

  // Row 27 — spacer
  sheet.getRow(27).height = 5.1;

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 4D — Sections B & C + Closing Balances (rows 28–42)
  // ───────────────────────────────────────────────────────────────────────

  // Row 28 — B. Cash flows from investing activities
  sheet.getCell("B28").value = "B.";
  sheet.getCell("B28").font = { bold: true, size: 10 };
  sheet.getCell("C28").value = "Cash flows from investing activities";
  sheet.getCell("C28").font = { bold: true, size: 10 };

  // Row 29 — Purchase of property, plant & equipments
  //          CRITICAL: "equipments" with lowercase s — exact from Excel
  //          H29 = −ppePurchases.cy (cash outflow rendered as negative)
  sheet.getCell("C29").value = "Purchase of property, plant & equipments";
  sheet.getCell("C29").font = { bold: false, size: 9 };
  sheet.getCell("H29").value = -(data.ppePurchases.cy);
  sheet.getCell("H29").alignment = { horizontal: "right" };
  sheet.getCell("I29").value = 0;
  sheet.getCell("I29").alignment = { horizontal: "right" };

  // Row 30 — Interest Income  (label-only — caller fills in Excel manually)
  sheet.getCell("C30").value = "Interest Income";
  sheet.getCell("C30").font = { bold: false, size: 9 };

  // Row 31 — Net cash used in investing activities (B)
  sheet.getCell("C31").value = "Net cash used in investing activities (B)";
  sheet.getCell("C31").font = { bold: true, size: 9 };
  sheet.getCell("H31").value = { formula: "SUM(H29:H30)" };
  sheet.getCell("H31").font = { bold: true, size: 9 };
  sheet.getCell("H31").alignment = { horizontal: "right" };
  sheet.getCell("I31").value = { formula: "SUM(I29:I30)" };
  sheet.getCell("I31").font = { bold: true, size: 9 };
  sheet.getCell("I31").alignment = { horizontal: "right" };

  // Row 32 — spacer
  sheet.getRow(32).height = 5.1;

  // Row 33 — C. Cash flows from financing activities
  sheet.getCell("B33").value = "C.";
  sheet.getCell("B33").font = { bold: true, size: 10 };
  sheet.getCell("C33").value = "Cash flows from financing activities";
  sheet.getCell("C33").font = { bold: true, size: 10 };

  // Row 34 — Proceeds from issue of share capital  (hardcoded 0/0, user edits)
  sheet.getCell("C34").value = "Proceeds from issue of share capital";
  sheet.getCell("C34").font = { bold: false, size: 9 };
  sheet.getCell("H34").value = 0;
  sheet.getCell("H34").alignment = { horizontal: "right" };
  sheet.getCell("I34").value = 0;
  sheet.getCell("I34").alignment = { horizontal: "right" };

  // Row 35 — Proceeds / Repayment of long-term Borrowings  (label-only)
  sheet.getCell("C35").value = "Proceeds / Repayment of long-term Borrowings";
  sheet.getCell("C35").font = { bold: false, size: 9 };

  // Row 36 — Payment of Other Loan term Liabilities
  //          CRITICAL: capital O (Other), lowercase t (term), capital L (Liabilities)
  sheet.getCell("C36").value = "Payment of Other Loan term Liabilities";
  sheet.getCell("C36").font = { bold: false, size: 9 };

  // Row 37 — Interest Paid  (label-only)
  sheet.getCell("C37").value = "Interest Paid";
  sheet.getCell("C37").font = { bold: false, size: 9 };

  // Row 38 — Net cash used in financing activities (C)
  sheet.getCell("C38").value = "Net cash used in financing activities (C)";
  sheet.getCell("C38").font = { bold: true, size: 9 };
  sheet.getCell("H38").value = { formula: "SUM(H34:H37)" };
  sheet.getCell("H38").font = { bold: true, size: 9 };
  sheet.getCell("H38").alignment = { horizontal: "right" };
  sheet.getCell("I38").value = { formula: "SUM(I34:I37)" };
  sheet.getCell("I38").font = { bold: true, size: 9 };
  sheet.getCell("I38").alignment = { horizontal: "right" };

  // Row 39 — spacer
  sheet.getRow(39).height = 5.1;

  // Row 40 — Net increase in cash (A+B+C)
  sheet.getCell("C40").value = "Net increase in cash and cash equivalents (A+B+C)";
  sheet.getCell("C40").font = { bold: true, size: 9 };
  sheet.getCell("H40").value = { formula: "H26+H31+H38" };
  sheet.getCell("H40").alignment = { horizontal: "right" };
  sheet.getCell("I40").value = { formula: "I26+I31+I38" };
  sheet.getCell("I40").alignment = { horizontal: "right" };

  // Row 41 — Cash and cash equivalents at the beginning of period
  //          H41 = I42 (PY closing becomes CY opening)
  sheet.getCell("C41").value = "Cash and cash equivalents at the beginning of period";
  sheet.getCell("C41").font = { bold: false, size: 9 };
  sheet.getCell("H41").value = { formula: "I42" };
  sheet.getCell("H41").alignment = { horizontal: "right" };
  sheet.getCell("I41").value = 0;
  sheet.getCell("I41").alignment = { horizontal: "right" };

  // Row 42 — Cash and cash equivalents at the end of period
  //          H42 MUST equal BS row 49 col E (Cash and bank equivalents CY).
  //          Caller should validate this equality pre-export — writer emits
  //          SUM(H40:H41) which is the logical CFS closing.
  sheet.getCell("C42").value = "Cash and cash equivalents at the end of period";
  sheet.getCell("C42").font = { bold: true, size: 9 };
  sheet.getCell("H42").value = { formula: "SUM(H40:H41)" };
  sheet.getCell("H42").font = { bold: true, size: 9 };
  sheet.getCell("H42").alignment = { horizontal: "right" };
  sheet.getCell("I42").value = { formula: "SUM(I40:I41)" };
  sheet.getCell("I42").font = { bold: true, size: 9 };
  sheet.getCell("I42").alignment = { horizontal: "right" };

  // ───────────────────────────────────────────────────────────────────────
  //  Phase 4E — Notes & Signature Block (rows 45–60)
  //  3-column signature layout: C (Auditor side), G (Dir 1), I (Dir 2)
  // ───────────────────────────────────────────────────────────────────────
  const {
    firmName, firmRegNo, firmCity,
    partnerName, partnerMemNo, signOffDate, udinValue,
    dir1Name, dir1DIN, dir2Name, dir2DIN,
  } = ctx;

  // Row 45 — Notes to cash flow statement
  sheet.getCell("C45").value = "Notes to cash flow statement";
  sheet.getCell("C45").font = { bold: true, size: 9 };

  // Row 46 — AS-3 note  (C46:I46 already merged in Phase 4A)
  //          CRITICAL: DOUBLE SPACE between "3" and "on" in the AS-3 reference
  sheet.getCell("C46").value =
    "The above cash flow statement has been prepared in accordance with the 'Indirect method'" +
    " as set out in Accounting Standard - 3  on 'Cash Flow Statements'.";
  sheet.getCell("C46").font = { bold: false, size: 9 };
  sheet.getCell("C46").alignment = { horizontal: "justify", wrapText: true };
  sheet.getRow(46).height = 24.0;

  // Row 47 — Accompanying notes  (DOUBLE SPACE after "The")
  sheet.getCell("C47").value = "The  accompanying notes form an integral part of the financial statements.";
  sheet.getCell("C47").font = { bold: false, size: 9 };

  // Row 49 — Audit report reference line
  sheet.getCell("C49").value = "This is the Cash Flow Statement referred to in our report of even date";
  sheet.getCell("C49").font = { bold: false, size: 9 };

  // Row 51 — Firm header / Board header
  sheet.getCell("C51").value = `For ${firmName}`;
  sheet.getCell("C51").font = { bold: true, size: 9 };
  sheet.getCell("G51").value = "For and on behalf of the Board of Directors of ";

  // Row 52 — Chartered Accountants / Company name
  sheet.getCell("C52").value = "Chartered Accountants";
  sheet.getCell("G52").value = companyName;
  sheet.getCell("G52").font = { bold: true, size: 9 };

  // Row 53 — Firm registration number
  sheet.getCell("C53").value = `Firm's Registration No.: ${firmRegNo}`;

  // Row 56 — Signatory names
  sheet.getCell("C56").value = partnerName;
  sheet.getCell("C56").font = { bold: true, size: 9 };
  sheet.getCell("G56").value = dir1Name;
  sheet.getCell("G56").font = { bold: true, size: 9 };
  sheet.getCell("I56").value = dir2Name;
  sheet.getCell("I56").font = { bold: true, size: 9 };

  // Row 57 — Roles
  sheet.getCell("C57").value = "Partner";
  sheet.getCell("G57").value = "Director";
  sheet.getCell("I57").value = "Director";

  // Row 58 — Membership No. / DINs
  sheet.getCell("C58").value = `Membership No.: ${partnerMemNo}`;
  sheet.getCell("G58").value = `DIN: ${dir1DIN}`;
  sheet.getCell("I58").value = `DIN: ${dir2DIN}`;

  // Row 59 — Place (same value written in all three columns)
  sheet.getCell("C59").value = `Place: ${firmCity}`;
  sheet.getCell("G59").value = `Place: ${firmCity}`;
  sheet.getCell("I59").value = `Place: ${firmCity}`;

  // Row 60 — Date (same sign-off date in all three columns)
  sheet.getCell("C60").value = `Date: ${signOffDate}`;
  sheet.getCell("G60").value = `Date: ${signOffDate}`;
  sheet.getCell("I60").value = `Date: ${signOffDate}`;

  // Row 61 — UDIN (auditor side only, under the Date line)
  sheet.getCell("C61").value = `UDIN: ${udinValue}`;
  sheet.getCell("C61").font = { size: 9 };
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
  const udinValue   = engagement.udin && String(engagement.udin).trim()
    ? String(engagement.udin).trim()
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
    partnerName, partnerMemNo, signOffDate, udinValue,
    dir1Name, dir1DIN, dir2Name, dir2DIN,
  };

  // ── Workbook ─────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "CAFlow";
  wb.created = new Date();
  wb.company = firmName;

  // ── Worksheet: BS (Balance Sheet) — Phase 2A-2F applied ─────────────────
  const bs = wb.addWorksheet("BS", { views: [{ showGridLines: false }] });
  bs.columns = BS_COLUMNS;
  writeBalanceSheet(bs, ctx, bsData);

  // ── Worksheet: PL (Statement of Profit & Loss) — Phase 3A-3C applied ────
  const pl = wb.addWorksheet("PL", { views: [{ showGridLines: false }] });
  pl.columns = PL_COLUMNS;
  writeProfitAndLoss(pl, ctx, plData);

  // ── Worksheet: CFS (Cash Flow Statement) — Phase 4A-4C applied ──────────
  const cfs = wb.addWorksheet("CFS", { views: [{ showGridLines: false }] });
  cfs.columns = CFS_COLUMNS;
  writeCashFlow(cfs, ctx, cfsData, bsData, plData);

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
  /** UDIN string; DASH when not yet generated. */
  udinValue:    string;
  dir1Name:     string;
  dir1DIN:      string;
  dir2Name:     string;
  dir2DIN:      string;
}

// Re-exports so Phase 2/3/4 helpers can share the same formatting primitives.
export {
  MONEY_FMT,
  THIN_BLACK,
  FULL_BORDER,
  BS_COLUMNS,
  PL_COLUMNS,
  CFS_COLUMNS,
  FS_COLUMNS,
  DASH,
};
