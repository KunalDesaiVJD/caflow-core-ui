/**
 * Year-on-year rollover (Phase 8, Ticket 8.3 — behind VITE_SCRUTINY_V2).
 *
 * Carries forward the *standing* engagement facts from the prior year as a starting point for a
 * new year's file, so the auditor re-confirms rather than re-enters. Deliberately CONSERVATIVE
 * (§8 CA default): only entity attributes that rarely change year-to-year carry — related-party
 * nominations and a short list of structural general facts. Every per-year audit assertion
 * (cash verified, GST reconciled, MRL obtained, going concern, UDIN…) is intentionally NOT
 * carried, so last year's "yes" can never silently become this year's evidence.
 *
 * Waived-finding exclusions already carry across all years automatically (see exclusionLearning);
 * the 119 rules run every year unchanged — so facts are the one thing rollover must move.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

/** General facts that are standing entity attributes → safe to carry as a re-confirmable default. */
export const STANDING_FACT_KEYS: readonly string[] = [
  "rp_exist", // related parties generally persist
  "msme_client_registered", // the entity's own MSME status
  "msme_udyam_no", // Udyam number
  "msme_vendors_identified", // vendor MSME tagging carries as a base
  "loans_directors", // director/partner loan relationship persists
];

export interface FactStoreRow {
  fact_type: string; // general | related_party | certificate
  fact_key: string;
  fact_value: string | null;
}

export type CarryStatus = "new" | "already-set";

export interface CarryItem {
  fact_type: string;
  fact_key: string;
  fact_value: string | null;
  status: CarryStatus; // new ⇒ will be added this year; already-set ⇒ current file already has it
}

export interface RolloverPlan {
  eligible: CarryItem[]; // every standing fact / RP nomination found in the prior year
  toApply: CarryItem[]; // the subset that is genuinely new to this year (status === "new")
  alreadySet: number;
}

const captured = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";

/** A prior fact is eligible to carry only if it's a RP nomination or a standing general fact. */
export function isCarryEligible(row: FactStoreRow): boolean {
  if (row.fact_type === "related_party") return true;
  if (row.fact_type === "general") return STANDING_FACT_KEYS.includes(row.fact_key);
  return false; // certificates + annual general facts must be re-answered
}

const TYPE_ORDER: Record<string, number> = { general: 0, related_party: 1 };

/**
 * Build the carry-forward plan from prior- and current-year fact rows. Items already captured in
 * the current file are marked `already-set` (never overwritten); the rest are `new` and returned
 * in `toApply` for the auditor to accept.
 */
export function rolloverPlan(prior: FactStoreRow[], current: FactStoreRow[]): RolloverPlan {
  const currentKeys = new Set<string>();
  for (const r of current) if (captured(r.fact_value)) currentKeys.add(`${r.fact_type}::${r.fact_key}`);

  const seen = new Set<string>();
  const eligible: CarryItem[] = [];
  for (const r of prior) {
    if (!captured(r.fact_value) || !isCarryEligible(r)) continue;
    const k = `${r.fact_type}::${r.fact_key}`;
    if (seen.has(k)) continue; // dedup prior rows
    seen.add(k);
    eligible.push({
      fact_type: r.fact_type,
      fact_key: r.fact_key,
      fact_value: r.fact_value,
      status: currentKeys.has(k) ? "already-set" : "new",
    });
  }

  eligible.sort(
    (a, b) => (TYPE_ORDER[a.fact_type] ?? 9) - (TYPE_ORDER[b.fact_type] ?? 9) || a.fact_key.localeCompare(b.fact_key),
  );

  const toApply = eligible.filter((e) => e.status === "new");
  return { eligible, toApply, alreadySet: eligible.length - toApply.length };
}

/**
 * The immediately-preceding financial year present in `years` (excluding `current`). Relies on the
 * "YYYY-YY" convention sorting lexicographically (2023-24 < 2024-25). Returns null if none earlier.
 */
export function priorFyOf(years: string[], current: string): string | null {
  let best: string | null = null;
  for (const y of years) {
    if (y >= current) continue;
    if (best == null || y > best) best = y;
  }
  return best;
}
