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
 *
 * Bug 3 — Trade Payables specialisation:
 *   trade_payables stores its sub-totals in dedicated fields msme_cy /
 *   others_cy (NOT in a breakup array).  Auto-populate may also create
 *   breakup rows that overlap with the ageing matrix → double-counting →
 *   false mismatch panel entries.  We sum trade_payables explicitly via
 *   the dedicated msme_cy / others_cy fields instead of the generic
 *   breakup reducer.
 */

import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { getFAGridNetBlockTotal } from "@/lib/notesAutoPopulate";

// ─── Bug 3 — Strict empty-amount check ────────────────────────────────────────
// null / undefined / "" / whitespace strings are NOT populated.
// Numeric 0 IS populated (auditor may explicitly enter zero).
function isNonEmptyAmount(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

// ─── Bug 3 — Specialised summers for notes with bespoke storage shape ─────────
// Trade Payables splits into MSME + Others on dedicated paths, not breakup[].
function sumTradePayables(noteRow: Record<string, any>, column: "cy" | "py"): number {
  const m = Number(noteRow?.[`msme_${column}`]);
  const o = Number(noteRow?.[`others_${column}`]);
  return (Number.isFinite(m) ? m : 0) + (Number.isFinite(o) ? o : 0);
}

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

    // ── Bug 3 — Bespoke per-key sum logic ─────────────────────────────────────
    // Some notes (Trade Payables, etc.) store their detail in dedicated fields
    // rather than a breakup[] array.  The generic reducer would either miss
    // the data or double-count from overlapping ageing rows.
    let notesSum: number;
    let hasUserData: boolean;

    if (key === "trade_payables") {
      notesSum = sumTradePayables(noteRow, "cy");
      // "Has user data" if either MSME or Others field has any non-empty value.
      hasUserData = isNonEmptyAmount(noteRow.msme_cy) || isNonEmptyAmount(noteRow.others_cy);
    } else {
      // Generic path: reduce over breakup[].amount_cy with strict empty-check
      // and explicit numeric coercion.
      const breakup: any[] = Array.isArray(noteRow.breakup) ? noteRow.breakup : [];
      const populatedRows = breakup.filter(r => r != null && isNonEmptyAmount(r.amount_cy));
      hasUserData = populatedRows.length > 0;
      notesSum = populatedRows.reduce((s: number, r: any) => {
        const n = Number(r.amount_cy);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }

    // ── Phase E parity — bsAmount must reflect what the auditor SEES on the
    // BS / P&L face and on the "Total per BS" row of the note. After the
    // Phase E migration both surfaces use the BREAKUP SUM when populated,
    // falling back to the stored .cy headline only when the breakup is empty.
    // Reading the raw stored .cy here produces false-positive mismatches every
    // time the auditor manually adds/edits a breakup row (KWIKTEAM Note 11
    // Other Income: stored .cy=7,948, breakup sum=12,948 — both surfaces
    // correctly displayed 12,948 but the panel kept flagging a "20,896 diff").
    //
    // New rule: bsAmount = breakup sum when populated, else absolute stored
    // .cy. The mismatch panel then only fires when there is a real schema-
    // level inconsistency (e.g. a sub-row with non-numeric data that drops
    // out of notesSum but contributes to .cy elsewhere) — never on routine
    // manual edits.
    const storedCy = Math.abs(Number(noteRow.cy ?? 0));
    const bsAmount = hasUserData ? notesSum : storedCy;

    // Skip notes where the effective amount is zero — nothing to check
    if (bsAmount === 0) continue;

    // Only flag when the auditor has actually populated some detail.
    if (!hasUserData) continue;

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

  // ── Bug 6 — PPE / FA grid mismatch ─────────────────────────────────────────
  // The FA grid lives at notesData.fa.rows (not in bs_asset.ppe.breakup[])
  // so it is excluded from the generic loop above.  Compare the FA grid's
  // computed Net Block total against the BS face value (cyOf BS_NCA_FA).
  // The BS face is fed by the same FA total (Bug 6 in PipelineFinancialStatements),
  // so a mismatch here only appears when fsDisplayData was computed with
  // raw TB and the FA grid was edited subsequently — i.e. a stale-render
  // safety check.  The headline total to compare against is
  // notesData.bs_asset.ppe.cy (manually edited) when present, falling back
  // to nothing (no mismatch when the grid is empty).
  const ppeNoteNo = registry.get("ppe");
  if (ppeNoteNo !== undefined) {
    const faTotalCy = getFAGridNetBlockTotal(notesData, "cy");
    const ppeNoteRow = (notesData?.bs_asset as Record<string, any> | undefined)?.ppe;
    const ppeHeadline = Number(ppeNoteRow?.cy ?? 0);
    if (faTotalCy != null && ppeHeadline !== 0) {
      const diff = ppeHeadline - faTotalCy;
      if (Math.abs(diff) >= 1) {
        mismatches.push({
          noteNo:        ppeNoteNo,
          label:         "PPE & Intangible Assets",
          bsAmount:      ppeHeadline,
          notesSum:      faTotalCy,
          difference:    diff,
          subTabKey:     "fa",
          sectionAnchor: `note-${ppeNoteNo}`,
        });
      }
    }
  }

  // Sort by note number for consistent display
  mismatches.sort((a, b) => a.noteNo - b.noteNo);
  return mismatches;
}
