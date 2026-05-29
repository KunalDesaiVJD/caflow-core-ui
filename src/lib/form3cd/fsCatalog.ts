/**
 * fsCatalog — Financial-statement (FS) code catalogue used by the Form 3CD
 * auto-fill engine and the ledger-mapping picker.
 *
 * The codes here MUST match the ones Stage 3 (COA Mapping) writes into
 * audit_engagements.coa_mapping and that PipelineFinancialStatements aggregates.
 * Corporate entities use the BS_* / PL_* codes; non-corporate entities (NCE —
 * Partnership / LLP / Proprietorship / etc.) use the NCE_* codes.
 *
 * This file is intentionally a plain data + helper module (no React, no
 * Supabase) so it can be unit-reasoned about and reused by both the engine
 * and the UI.
 */

export type FsSection = "BS" | "PL" | "OTHER";
/** "credit" = revenue / income / liability / equity (Cr-normal, stored negative).
 *  "debit"  = expense / asset (Dr-normal, stored positive). */
export type FsSide = "credit" | "debit";

export interface FsCodeMeta {
  label: string;
  section: FsSection;
  side: FsSide;
}

/**
 * Catalogue of the FS codes the engine reasons about. Not exhaustive — any
 * code not listed is still usable in the ledger picker (it falls back to
 * `classifyCode`), this map just gives nicer labels + reliable side/section.
 */
export const FS_CODE_CATALOG: Record<string, FsCodeMeta> = {
  // ── Corporate P&L ──────────────────────────────────────────────────────
  PL_REV_OPS: { label: "Revenue from Operations", section: "PL", side: "credit" },
  PL_REV_OI:  { label: "Other Income",            section: "PL", side: "credit" },
  PL_EXP_MAT: { label: "Cost of Materials Consumed", section: "PL", side: "debit" },
  PL_EXP_SIT: { label: "Purchases of Stock-in-Trade", section: "PL", side: "debit" },
  PL_EXP_CII: { label: "Changes in Inventories",  section: "PL", side: "debit" },
  PL_EXP_EMP: { label: "Employee Benefits Expense", section: "PL", side: "debit" },
  PL_EXP_FIN: { label: "Finance Costs",           section: "PL", side: "debit" },
  PL_EXP_DEP: { label: "Depreciation & Amortisation", section: "PL", side: "debit" },
  PL_EXP_OTH: { label: "Other Expenses",          section: "PL", side: "debit" },
  PL_EXP_OEX: { label: "Other Expenses",          section: "PL", side: "debit" },

  // ── Corporate Balance Sheet (subset relevant to 3CD) ───────────────────
  BS_EQ_SC:   { label: "Share Capital",           section: "BS", side: "credit" },
  BS_EQ_RS:   { label: "Reserves & Surplus",      section: "BS", side: "credit" },
  BS_NCL_LTB: { label: "Long-term Borrowings",    section: "BS", side: "credit" },
  BS_NCL_LTP: { label: "Long-term Provisions",    section: "BS", side: "credit" },
  BS_CL_STB:  { label: "Short-term Borrowings",   section: "BS", side: "credit" },
  BS_CL_TP:   { label: "Trade Payables",          section: "BS", side: "credit" },
  BS_CL_OCL:  { label: "Other Current Liabilities", section: "BS", side: "credit" },
  BS_CL_STP:  { label: "Short-term Provisions",   section: "BS", side: "credit" },
  BS_NCA_FA:  { label: "Property, Plant & Equipment", section: "BS", side: "debit" },
  BS_CA_INV:  { label: "Inventories",             section: "BS", side: "debit" },
  BS_CA_TR:   { label: "Trade Receivables",       section: "BS", side: "debit" },
  BS_CA_CCE:  { label: "Cash & Bank",             section: "BS", side: "debit" },
  BS_CA_SLA:  { label: "Short-term Loans & Advances", section: "BS", side: "debit" },
  BS_NCA_LLA: { label: "Long-term Loans & Advances", section: "BS", side: "debit" },

  // ── Non-corporate (NCE) ────────────────────────────────────────────────
  NCE_REV_OPS: { label: "Revenue from Operations", section: "PL", side: "credit" },
  NCE_REV_OTH: { label: "Other Income",            section: "PL", side: "credit" },
  NCE_COGS:    { label: "Cost of Goods Sold",      section: "PL", side: "debit" },
  NCE_OTH_EXP: { label: "Other Expenses",          section: "PL", side: "debit" },
  NCE_PART_REM:{ label: "Partner Remuneration / Interest", section: "PL", side: "debit" },
  NCE_STCK:    { label: "Closing Stock / Inventory", section: "BS", side: "debit" },
  NCE_TR:      { label: "Trade Receivables",       section: "BS", side: "debit" },
  NCE_TP:      { label: "Trade Payables",          section: "BS", side: "credit" },
  NCE_CASH:    { label: "Cash & Bank",             section: "BS", side: "debit" },
  NCE_PPE:     { label: "Fixed Assets",            section: "BS", side: "debit" },
  NCE_CAP:     { label: "Capital Account",         section: "BS", side: "credit" },
  NCE_LTB:     { label: "Long-term Borrowings",    section: "BS", side: "credit" },
  NCE_STB:     { label: "Short-term Borrowings",   section: "BS", side: "credit" },
  NCE_OCL:     { label: "Other Current Liabilities", section: "BS", side: "credit" },
  NCE_STP:     { label: "Provisions",              section: "BS", side: "credit" },
};

/** Revenue-from-operations (turnover) codes, by entity type. */
export const TURNOVER_CODES = {
  corporate: ["PL_REV_OPS"],
  nce: ["NCE_REV_OPS"],
};

/** Other-income codes, by entity type. */
export const OTHER_INCOME_CODES = {
  corporate: ["PL_REV_OI"],
  nce: ["NCE_REV_OTH"],
};

/** Cost-of-goods-sold / direct-cost codes, by entity type. */
export const COGS_CODES = {
  corporate: ["PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII"],
  nce: ["NCE_COGS"],
};

/** All P&L expense codes (for net-profit + clause 44 total expenditure). */
export const EXPENSE_CODES = {
  corporate: [
    "PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII", "PL_EXP_EMP",
    "PL_EXP_FIN", "PL_EXP_DEP", "PL_EXP_OTH", "PL_EXP_OEX",
  ],
  nce: ["NCE_COGS", "NCE_OTH_EXP", "NCE_PART_REM"],
};

/** Closing-inventory code(s), by entity type. */
export const INVENTORY_CODES = {
  corporate: ["BS_CA_INV"],
  nce: ["NCE_STCK"],
};

/** Depreciation expense code, by entity type. */
export const DEPRECIATION_CODES = {
  corporate: ["PL_EXP_DEP"],
  // NCE folds depreciation into other expenses; there is no dedicated code, so
  // depreciation is resolved by ledger keyword in the engine for NCE.
  nce: [] as string[],
};

/** Human label for a code (falls back to the raw code). */
export function fsCodeLabel(code: string | null | undefined): string {
  if (!code) return "Unmapped";
  return FS_CODE_CATALOG[code]?.label ?? code;
}

/** Best-effort BS / PL / OTHER classification for any code. */
export function classifyCode(code: string | null | undefined): FsSection {
  if (!code) return "OTHER";
  const meta = FS_CODE_CATALOG[code];
  if (meta) return meta.section;
  if (code.startsWith("BS_")) return "BS";
  if (code.startsWith("PL_")) return "PL";
  // NCE_* — guess from common revenue/expense tokens, else treat as BS.
  if (/REV|INC|COGS|EXP|PROF|PART_REM|TAX/.test(code)) return "PL";
  if (code.startsWith("NCE_")) return "BS";
  return "OTHER";
}

/** Side (credit/debit) for any code; falls back to section-based guess. */
export function classifySide(code: string | null | undefined): FsSide {
  if (!code) return "debit";
  const meta = FS_CODE_CATALOG[code];
  if (meta) return meta.side;
  const sec = classifyCode(code);
  if (sec === "PL") return /EXP|COGS|PART_REM|TAX/.test(code) ? "debit" : "credit";
  if (sec === "BS") return /BS_NCA|BS_CA|NCE_TR|NCE_CASH|NCE_PPE|NCE_STCK/.test(code) ? "debit" : "credit";
  return "debit";
}
