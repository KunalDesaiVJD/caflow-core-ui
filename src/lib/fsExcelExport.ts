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
 * BS / PL / CFS data shapes. Phase 1 keeps these deliberately loose — the
 * actual row schemas will be finalised in Phase 2 when the bodies are written.
 * Caller supplies pre-computed numeric totals per line-item code; this module
 * does not recompute from the trial balance.
 */
export interface FSLineItemRow {
  /** Stable machine code — e.g. "BS_EQ_SC", "PL_EXP_FIN". */
  code: string;
  /** Human label — e.g. "Share Capital". */
  name: string;
  /** Indentation depth (0 = top-level heading, 1 = grouping, 2+ = leaf). */
  depth: number;
  /** Schedule III "Note No." reference, if any. */
  noteRef?: number | null;
  /** Current-year amount in INR. */
  cy: number;
  /** Previous-year amount in INR. */
  py: number;
  /** If true, render as bold subtotal with full-row bottom border. */
  isSubtotal?: boolean;
  /** If true, render as a heading row (no amounts, merged Particulars). */
  isHeading?: boolean;
}

export interface BSRowData  { rows: FSLineItemRow[]; }
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
 * the sheet to the workbook. This function writes the header block + body
 * + signature block.
 *
 * Phase 2A status: column widths only — row-writing code is filled in by
 * subsequent sub-phases (2B title block, 2C data rows, 2D totals, …).
 */
function writeBalanceSheet(
  sheet: ExcelJS.Worksheet,
  ctx:   FsExportContext,
  data:  BSRowData,
): void {
  // Phase 2A: column layout has been applied by caller via BS_COLUMNS.
  // Nothing else to write until Phase 2B onwards arrives.
  void sheet; void ctx; void data;
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
