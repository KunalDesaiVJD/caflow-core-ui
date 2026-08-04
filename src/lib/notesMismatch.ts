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
import { computeFaceNpat } from "@/lib/plFaceNpat";

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

// Reserves & Surplus has a bespoke schema (NOT a `breakup` array):
//   1. General Reserve              (gen_reserve_*)
//   2. Securities Premium           (share_premium_*)
//   ────  Sub-total [a]
//   Surplus in the Statement of P&L:
//     a. Opening balance            (surplus_opening_*)
//     b. + Profit for the year      (sourced from pl.eps.npat / pl.eps.npat_py)
//     c. + Adjustments for deferred tax (surplus_deferred_adj_*)
//     d. + Excess/(Short) provision for income tax (surplus_excess_short_*)
//   ────  Sub-total [b]
//   Total = Sub-total [a] + Sub-total [b]
//
// Returns the sum of all dedicated component fields. The mismatch detector
// compares this to the stored .cy headline (= BS face value, since the BS
// face uses cyOf for reserves_surplus — there is no breakup array to feed
// the Phase E ncyOf path).
function sumReservesSurplus(
  noteRow: Record<string, any>,
  plData:  any,
  column:  "cy" | "py",
  faceTax?: { cy?: number; py?: number } | null,
): number {
  const v = (k: string) => {
    const n = Number(noteRow?.[`${k}_${column}`] ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  // 2026-08-01 (Mill Power, R&S banner fires even when everything ties):
  // NoteBSLiab's "Add/(Less): Profit for the year" row was moved to a
  // live face NPAT computation in commit 37060da5 (Revenue − formula-
  // aware Expenses − Tax via plFaceNpat.ts). This detector was still
  // reading the STORED pl.eps.npat which autoPopulate writes as a raw
  // COA sum (no CoM formula, no CII overrides applied). Any client
  // whose auditor edits Cost of Materials or overrides a Changes in
  // Inventory sub-cell drifts between the two — Sub-rows sum diverges
  // from Note total by exactly the CoM/CII delta and the panel raises
  // a spurious "note doesn't reconcile" banner.
  //
  // Fix: read profit via computeFaceNpat, which mirrors the same math
  // NoteBSLiab uses to render the row.
  //
  // Also (2026-08-01 pass 2): computeFaceNpat subtracts
  // pl.eps.total_tax_* from PBT, but that field is only stashed on
  // autoPopulate runs that shipped after commit e1b491b2. For any
  // client whose stage5_notes JSONB was persisted before that fix,
  // the tax component is zero and computeFaceNpat returns PBT, not
  // NPAT. Subtract the piped-in face tax (Current + Deferred, same
  // as what NoteBSLiab uses) as a fallback so the banner reconciles
  // on the very first render — no autoPopulate re-run required.
  let profit = computeFaceNpat({ pl: plData } as any, column);
  const epsRow = (plData?.eps ?? {}) as Record<string, any>;
  const storedTaxKey = column === "cy" ? "total_tax_cy" : "total_tax_py";
  const alreadySubtractedTax = Math.abs(Number(epsRow[storedTaxKey] ?? 0));
  if (alreadySubtractedTax < 0.005 && faceTax) {
    const t = Number((column === "cy" ? faceTax.cy : faceTax.py) ?? 0);
    if (Number.isFinite(t)) profit -= t;
  }

  // Issue 3 (today) — Opening balance fallback mirrors NoteBSLiab.tsx:
  //   CY opening: surplus_opening_cy ?? abs(reserves_surplus.py)
  //                 (prior-year R&S closing → carry-forward)
  //   PY opening: surplus_opening_py ?? 0
  // The detector previously only read surplus_opening_<col> directly, so
  // a missing path meant a spurious "Note 3 off by ₹X" banner even when
  // the on-screen numbers balanced.
  const surplusOpening =
    v("surplus_opening") ||
    (column === "cy" ? Math.abs(Number(noteRow?.py ?? 0)) : 0);

  return (
    v("gen_reserve") + v("share_premium") +
    surplusOpening + (Number.isFinite(profit) ? profit : 0) +
    v("surplus_deferred_adj") + v("surplus_excess_short")
  );
}

function isReservesSurplusPopulated(
  noteRow: Record<string, any>,
  plData:  any,
): boolean {
  const fields = [
    "gen_reserve_cy", "share_premium_cy",
    "surplus_opening_cy", "surplus_deferred_adj_cy", "surplus_excess_short_cy",
  ];
  if (fields.some(f => isNonEmptyAmount(noteRow?.[f]))) return true;
  // 2026-08-01 — same rationale as sumReservesSurplus. If we still relied
  // on the stored pl.eps.npat here, a client whose auditor edits CoM /
  // CII to make live NPAT go to zero (but stored NPAT is non-zero, or
  // vice versa) would either skip the check when they shouldn't or run
  // it when they shouldn't. Aligning both helpers on computeFaceNpat
  // keeps the "should we bother checking" gate consistent with the
  // "what does it sum to" number.
  const npat = computeFaceNpat({ pl: plData } as any, "cy");
  return Number.isFinite(npat) && Math.abs(npat) > 0.005;
}

// ─── Public types ──────────────────────────────────────────────────────────────

export interface NoteMismatch {
  /** Note key (e.g. "reserves_surplus", "trade_receivables", "ppe"). Callers
   *  use this to gate specific downstream behaviours (e.g. block Save only
   *  when R&S or Trade Receivables mismatch). */
  noteKey:       string;
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
  // 2026-08-01 — Optional face-side tax total piped from
  // PipelineFinancialStatements (currentTax + deferredTax straight off
  // cyOf / pyOf, the same numbers the P&L face uses to reach XV.
  // Profit / (Loss) for the period). Enables sumReservesSurplus to
  // convert computeFaceNpat's PBT into NPAT even before the tax
  // stashed by autoPopulate (pl.eps.total_tax_*) is present on the
  // stored notes. Without this, on a fresh client the detector shows
  // Sub-rows sum = Opening + PBT (leaves the ₹37,200 kind of gap the
  // auditor keeps seeing on Mill Power).
  faceTax?: { cy?: number; py?: number } | null,
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

    const storedCy = Math.abs(Number(noteRow.cy ?? 0));
    let bsAmount: number;

    if (key === "trade_payables") {
      notesSum = sumTradePayables(noteRow, "cy");
      // "Has user data" if either MSME or Others field has any non-empty value.
      hasUserData = isNonEmptyAmount(noteRow.msme_cy) || isNonEmptyAmount(noteRow.others_cy);
      // Trade Payables BS face IS msme + others (drives the row directly), so
      // notesSum already represents the BS face value when populated.
      bsAmount = hasUserData ? notesSum : storedCy;
    } else if (key === "reserves_surplus") {
      // Reserves & Surplus uses a bespoke field schema (no breakup array).
      // The BS face value comes from cyOf (raw TB sum + auto-credit of net
      // P&L) which is reflected in noteRow.cy.  notesSum is the SUM of the
      // dedicated component fields the auditor fills in (General Reserve,
      // Securities Premium, Surplus opening + profit + adjustments).  A
      // mismatch is real when components don't sum to the BS face value.
      const plData = (notesData as any)?.pl;
      notesSum = sumReservesSurplus(noteRow, plData, "cy", faceTax);
      hasUserData = isReservesSurplusPopulated(noteRow, plData);
      // ALWAYS compare against the stored BS face — overrides Phase E parity
      // because there is no breakup to swap in for the face value.
      bsAmount = storedCy;
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
      // Phase E parity — BS face = breakup sum when populated, else stored .cy
      bsAmount = hasUserData ? notesSum : storedCy;
    }

    // Skip notes where the effective amount is zero — nothing to check
    if (bsAmount === 0) continue;

    // Only flag when the auditor has actually populated some detail.
    if (!hasUserData) continue;

    const diff = bsAmount - notesSum;

    // Tolerance: ignore sub-₹1 rounding differences
    if (Math.abs(diff) < 1) continue;

    mismatches.push({
      noteKey:       key,
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
          noteKey:       "ppe",
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
