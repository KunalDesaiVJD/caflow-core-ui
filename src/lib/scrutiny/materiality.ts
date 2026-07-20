/**
 * Engagement materiality — proposal, and resolution of materiality-relative rule thresholds.
 *
 * Flat rupee thresholds are why a ₹1,000 creditor balance is raised at a ₹100 crore company and a
 * ₹35,000 dormant balance is missed at a small firm. Scaling them to the engagement fixes both
 * ends, but the scale itself is a professional judgement (SA 320), so the engine never picks it:
 * this module only PROPOSES, and a human approves or edits the numbers in the judgment register
 * before any run consumes them.
 *
 * Pure and dependency-free so it is unit-testable without a database.
 */

/** Figures the proposal is derived from, read off the trial balance. */
export interface MaterialityBasis {
  turnover?: number | null;
  totalAssets?: number | null;
  profitBeforeTax?: number | null;
}

import type { MaterialityValues } from "./detectionEngine";

export interface MaterialityProposal extends MaterialityValues {
  basis: MaterialityBasis;
  /** Which benchmark drove the number, so the reviewer can sanity-check the choice. */
  benchmark: "turnover" | "total_assets" | "profit_before_tax" | "floor";
  benchmarkPct: number;
  /** Plain-English explanation shown next to the input the auditor edits. */
  rationale: string;
}

/** Percentages follow common SA 320 practice for owner-managed entities. */
const TURNOVER_PCT = 0.5;
const ASSETS_PCT = 1.0;
const PBT_PCT = 5.0;
/** Haircut from overall to performance materiality. Conservative end of the 50–75% range. */
const PERFORMANCE_RATIO = 0.6;
/** Clearly-trivial cut-off as a share of overall materiality. */
const TRIVIAL_RATIO = 0.05;
/** Never propose below this — a threshold of a few hundred rupees is not reviewable. */
const ABSOLUTE_FLOOR = 25_000;

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? Math.abs(x) : 0;
};

/**
 * Round to a figure an auditor would actually write down (2 significant figures).
 * Pure rounding only — the reviewable floor is applied to overall materiality alone, because
 * forcing it here would drag the trivial threshold up to equal materiality itself.
 */
export const roundMateriality = (v: number): number => {
  if (v <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
};

/**
 * Propose materiality from the entity's own figures. Turnover is preferred because it is the most
 * stable benchmark for a trading or manufacturing SME; total assets is used when turnover is
 * absent or trivially small (an investment or holding entity); profit is used only as a sense
 * check because owner-managed entities routinely run near break-even, which would drive
 * materiality to nothing.
 */
export function proposeMateriality(basis: MaterialityBasis): MaterialityProposal {
  const turnover = n(basis.turnover);
  const assets = n(basis.totalAssets);
  const pbt = n(basis.profitBeforeTax);

  let raw = 0;
  let benchmark: MaterialityProposal["benchmark"] = "floor";
  let pct = 0;

  if (turnover >= 1_000_000) {
    raw = (turnover * TURNOVER_PCT) / 100;
    benchmark = "turnover";
    pct = TURNOVER_PCT;
  } else if (assets >= 1_000_000) {
    raw = (assets * ASSETS_PCT) / 100;
    benchmark = "total_assets";
    pct = ASSETS_PCT;
  } else if (pbt >= 500_000) {
    raw = (pbt * PBT_PCT) / 100;
    benchmark = "profit_before_tax";
    pct = PBT_PCT;
  }

  // The floor applies to overall materiality: below this nothing is reviewable by hand anyway.
  // Performance and trivial are then derived from it, so they stay properly ordered.
  const materiality = Math.max(ABSOLUTE_FLOOR, roundMateriality(raw));
  const performance = roundMateriality(materiality * PERFORMANCE_RATIO);
  const trivial = roundMateriality(materiality * TRIVIAL_RATIO);

  const fmt = (v: number) => `₹${v.toLocaleString("en-IN")}`;
  const rationale = benchmark === "floor"
    ? `The entity reports no turnover or asset base large enough to scale from, so the minimum reviewable threshold of ${fmt(ABSOLUTE_FLOOR)} is proposed. Please set this from your knowledge of the engagement.`
    : `Proposed at ${pct}% of ${benchmark.replace(/_/g, " ")} (${fmt(benchmark === "turnover" ? turnover : benchmark === "total_assets" ? assets : pbt)}). Performance materiality is ${Math.round(PERFORMANCE_RATIO * 100)}% of that, and anything below ${fmt(trivial)} is treated as clearly trivial and not raised.`;

  return { materiality, performance, trivial, basis, benchmark, benchmarkPct: pct, rationale };
}

/**
 * Derive the basis figures from a trial balance. Turnover is the credit side of sales/revenue
 * heads; total assets the debit side of asset groups. Deliberately generous on naming, because a
 * wrong benchmark is visible to the approver whereas a missed one silently falls back to the floor.
 */
export function basisFromTB(
  tb: Array<{ ledger_name: string; parent_group?: string | null; closing_balance: number; balance_type?: string | null }>,
): MaterialityBasis {
  const SALES = /sales|revenue from operation|revenue|income from|turnover|professional fee|service income|job work income/i;
  const ASSET = /fixed asset|current asset|investment|debtor|receivable|bank|cash|inventor|stock|loans? (&|and) advance|deposit/i;
  let turnover = 0;
  let totalAssets = 0;
  for (const r of tb) {
    const hay = `${r.ledger_name} ${r.parent_group ?? ""}`;
    const amt = n(r.closing_balance);
    if (SALES.test(hay) && /cr/i.test(String(r.balance_type ?? "Cr"))) turnover += amt;
    if (ASSET.test(hay) && /dr/i.test(String(r.balance_type ?? "Dr"))) totalAssets += amt;
  }
  return { turnover, totalAssets };
}

// applyMateriality lives in detectionEngine.ts: threshold resolution is engine behaviour, and
// putting it in the dispatch loop means no caller can forget to apply it.
export { applyMateriality } from "./detectionEngine";
export type { MaterialityValues } from "./detectionEngine";
