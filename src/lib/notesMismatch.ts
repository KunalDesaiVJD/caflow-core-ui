/**
 * notesMismatch — Notes vs BS/PL mismatch detection helper
 *
 * Compares the headline total stored in stage5_notes (which is what appears
 * on the face of the Balance Sheet / P&L) against the sum of the breakup
 * sub-rows inside each note.  A non-zero difference means the note detail
 * does not reconcile with its own declared total, which the auditor must fix.
 *
 * Design:
 *   • bsAmount  = stage5_notes[section][key].cy  (the BS/PL face total)
 *   • notesSum  = Σ breakup[i].amount_cy          (sum of note sub-rows)
 *   • A mismatch is reported when |bsAmount − notesSum| ≥ ₹1 AND the note
 *     has at least one breakup row with a non-null amount_cy.
 *   • PPE (FA grid), eps, ratios are excluded — they have bespoke structures.
 */

import type { Stage5Notes } from "@/lib/notesAutoPopulate";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface NoteMismatch {
  noteNo:        number;
  label:         string;
  bsAmount:      number;   // stage5_notes[section][key].cy
  notesSum:      number;   // Σ breakup[*].amount_cy
  difference:    number;   // bsAmount − notesSum
  subTabKey:     "bs_liab" | "bs_asset" | "pl" | "fa";
  sectionAnchor: string;   // e.g. "note-3"
}

// ─── Internal mapping types ────────────────────────────────────────────────────

interface MismatchEntry {
  section: "bs_liab" | "bs_asset" | "pl";
  subTab:  "bs_liab" | "bs_asset" | "pl" | "fa";
  label:   string;
}

// ─── Corporate key → section + sub-tab + label ────────────────────────────────

const CORP_ENTRIES: Readonly<Record<string, MismatchEntry>> = {
  share_capital:        { section: "bs_liab", subTab: "bs_liab", label: "Share capital" },
  reserves_surplus:     { section: "bs_liab", subTab: "bs_liab", label: "Reserves and surplus" },
  lt_borrowings:        { section: "bs_liab", subTab: "bs_liab", label: "Long-term borrowings" },
  deferred_tax_liab:    { section: "bs_liab", subTab: "bs_liab", label: "Deferred tax liabilities (Net)" },
  other_lt_liab:        { section: "bs_liab", subTab: "bs_liab", label: "Other long-term liabilities" },
  lt_provisions:        { section: "bs_liab", subTab: "bs_liab", label: "Long-term provisions" },
  st_borrowings:        { section: "bs_liab", subTab: "bs_liab", label: "Short-term borrowings" },
  trade_payables:       { section: "bs_liab", subTab: "bs_liab", label: "Trade payables" },
  other_current_liab:   { section: "bs_liab", subTab: "bs_liab", label: "Other current liabilities" },
  st_provisions:        { section: "bs_liab", subTab: "bs_liab", label: "Short-term provisions" },
  // ppe → FA grid (bespoke structure) — excluded
  nc_investments:       { section: "bs_asset", subTab: "bs_asset", label: "Non-current investments" },
  deferred_tax_assets:  { section: "bs_asset", subTab: "bs_asset", label: "Deferred tax assets (Net)" },
  lt_loans_advances:    { section: "bs_asset", subTab: "bs_asset", label: "Long-term loans and advances" },
  other_nc_assets:      { section: "bs_asset", subTab: "bs_asset", label: "Other non-current assets" },
  current_investments:  { section: "bs_asset", subTab: "bs_asset", label: "Current investments" },
  inventories:          { section: "bs_asset", subTab: "bs_asset", label: "Inventories" },
  trade_receivables:    { section: "bs_asset", subTab: "bs_asset", label: "Trade receivables" },
  cash_bank:            { section: "bs_asset", subTab: "bs_asset", label: "Cash and bank equivalents" },
  st_loans_advances:    { section: "bs_asset", subTab: "bs_asset", label: "Short-term loans and advances" },
  other_current_assets: { section: "bs_asset", subTab: "bs_asset", label: "Other current assets" },
  revenue_from_ops:     { section: "pl",       subTab: "pl",       label: "Revenue from operations" },
  other_income:         { section: "pl",       subTab: "pl",       label: "Other income" },
  cost_materials:       { section: "pl",       subTab: "pl",       label: "Cost of materials consumed" },
  purchases_stock:      { section: "pl",       subTab: "pl",       label: "Purchases of stock-in-trade" },
  changes_inventories:  { section: "pl",       subTab: "pl",       label: "Changes in inventories" },
  employee_benefits:    { section: "pl",       subTab: "pl",       label: "Employee benefits expense" },
  finance_costs:        { section: "pl",       subTab: "pl",       label: "Finance costs" },
  depreciation:         { section: "pl",       subTab: "pl",       label: "Depreciation" },
  other_expenses:       { section: "pl",       subTab: "pl",       label: "Other expenses" },
  // eps, ratios → computed values / no breakup — excluded
};

// ─── NCE key → section + sub-tab + label ──────────────────────────────────────

const NCE_ENTRIES: Readonly<Record<string, MismatchEntry>> = {
  owners_capital:        { section: "bs_liab", subTab: "bs_liab", label: "Owner's capital" },
  lt_borrowings:         { section: "bs_liab", subTab: "bs_liab", label: "Long-term borrowings" },
  other_lt_liab:         { section: "bs_liab", subTab: "bs_liab", label: "Other long-term liabilities" },
  lt_provisions:         { section: "bs_liab", subTab: "bs_liab", label: "Long-term provisions" },
  st_borrowings:         { section: "bs_liab", subTab: "bs_liab", label: "Short-term borrowings" },
  trade_payables:        { section: "bs_liab", subTab: "bs_liab", label: "Trade payables" },
  other_current_liab:    { section: "bs_liab", subTab: "bs_liab", label: "Other current liabilities" },
  st_provisions:         { section: "bs_liab", subTab: "bs_liab", label: "Short-term provisions" },
  // ppe → FA grid — excluded
  nc_investments:        { section: "bs_asset", subTab: "bs_asset", label: "Non-current investments" },
  deferred_tax_assets:   { section: "bs_asset", subTab: "bs_asset", label: "Deferred tax assets (Net)" },
  lt_loans_advances:     { section: "bs_asset", subTab: "bs_asset", label: "Long-term loans and advances" },
  other_nc_assets:       { section: "bs_asset", subTab: "bs_asset", label: "Other non-current assets" },
  current_investments:   { section: "bs_asset", subTab: "bs_asset", label: "Current investments" },
  inventories:           { section: "bs_asset", subTab: "bs_asset", label: "Inventories" },
  trade_receivables:     { section: "bs_asset", subTab: "bs_asset", label: "Trade receivables" },
  cash_bank:             { section: "bs_asset", subTab: "bs_asset", label: "Cash and bank equivalents" },
  st_loans_advances:     { section: "bs_asset", subTab: "bs_asset", label: "Short-term loans and advances" },
  other_current_assets:  { section: "bs_asset", subTab: "bs_asset", label: "Other current assets" },
  nce_revenue_from_ops:  { section: "pl",       subTab: "pl",       label: "Revenue from operations" },
  nce_other_income:      { section: "pl",       subTab: "pl",       label: "Other income" },
  nce_cost_goods:        { section: "pl",       subTab: "pl",       label: "Cost of goods sold" },
  nce_employee_benefits: { section: "pl",       subTab: "pl",       label: "Employee benefits expense" },
  nce_finance_costs:     { section: "pl",       subTab: "pl",       label: "Finance costs" },
  nce_depreciation:      { section: "pl",       subTab: "pl",       label: "Depreciation" },
  nce_other_expenses:    { section: "pl",       subTab: "pl",       label: "Other expenses" },
};

// ─── detectMismatches ─────────────────────────────────────────────────────────

/**
 * Compare every note's headline total (stage5_notes[section][key].cy) against
 * the sum of its breakup sub-rows.  Return the array of mismatches.
 *
 * @param _bsData   Reserved — pass null; future: computedAmounts override
 * @param _plData   Reserved — pass null; future: computedAmounts override
 * @param notesData stage5_notes JSONB loaded from audit_engagements
 * @param registry  Map<noteKey, dynamicNoteNo> from useDynamicNoteRegistry
 * @param isNce     True for non-corporate entities
 */
export function detectMismatches(
  _bsData:   unknown,
  _plData:   unknown,
  notesData: Stage5Notes | null | undefined,
  registry:  Map<string, number>,
  isNce:     boolean,
): NoteMismatch[] {
  const mismatches: NoteMismatch[] = [];
  if (!notesData) return mismatches;

  const entries = isNce ? NCE_ENTRIES : CORP_ENTRIES;

  for (const [key, meta] of Object.entries(entries)) {
    const noteNo = registry.get(key);
    // Skip notes that have no assigned number (zero-suppressed)
    if (noteNo === undefined) continue;

    const sectionData = notesData[meta.section] as Record<string, any> | undefined;
    if (!sectionData) continue;

    const noteRow = sectionData[key];
    if (!noteRow) continue;

    const bsAmount = Number(noteRow.cy ?? 0);

    // Skip notes where the headline total is zero — nothing to check
    if (bsAmount === 0) continue;

    // Build notesSum from breakup rows
    const breakup: any[] = Array.isArray(noteRow.breakup) ? noteRow.breakup : [];

    // Only flag mismatches when there is at least one populated breakup row.
    // If no rows exist yet, the auditor hasn't filled in the detail — not an error.
    const populatedRows = breakup.filter(r => r != null && r.amount_cy != null);
    if (populatedRows.length === 0) continue;

    const notesSum = populatedRows.reduce((s: number, r: any) => s + Number(r.amount_cy ?? 0), 0);
    const diff = bsAmount - notesSum;

    // Tolerance: ignore sub-₹1 rounding differences
    if (Math.abs(diff) < 1) continue;

    mismatches.push({
      noteNo,
      label:         meta.label,
      bsAmount,
      notesSum,
      difference:    diff,
      subTabKey:     meta.subTab,
      sectionAnchor: `note-${noteNo}`,
    });
  }

  // Sort by note number for consistent display
  mismatches.sort((a, b) => a.noteNo - b.noteNo);
  return mismatches;
}
