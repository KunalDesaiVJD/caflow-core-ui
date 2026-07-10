/**
 * Exclusion learning (Ticket 2.5, Phase 2 — behind VITE_SCRUTINY_V2).
 *
 * Deterministic baseline: learn from the auditor's OWN prior-period waivers. A finding the
 * auditor waived in an earlier year (same rule + same ledger) that recurs this year is flagged
 * "seen before", so a known-benign exception can be dismissed quickly instead of re-investigated.
 *
 * This uses only data already in `scrutiny_findings` (status='waived') — no embeddings, no new
 * table, prod-safe. Semantic (Voyage-embedding) similarity is a later upgrade that needs a
 * VOYAGE_API_KEY + a vector store; the key is a per-rule + per-ledger match here.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";

export interface PriorWaived {
  rule_id: string | null;
  narration: string | null;
  financial_year: string | null;
}

/** Stable match key: rule + ledger/account (narration), case/space-normalised. */
export function exclusionKey(rule_id: string | null, narration: string | null): string {
  return `${(rule_id ?? "").trim().toLowerCase()}|${(narration ?? "").trim().toLowerCase()}`;
}

/**
 * Build the set of exclusion keys from prior waived findings. Pass `excludeFy` (the current
 * financial year) so a finding only learns from OTHER periods, never from itself.
 */
export function buildExclusionSet(priorWaived: PriorWaived[], excludeFy?: string): Set<string> {
  const s = new Set<string>();
  for (const f of priorWaived) {
    if (excludeFy && f.financial_year === excludeFy) continue;
    const k = exclusionKey(f.rule_id, f.narration);
    if (k !== "|") s.add(k); // skip fully-empty keys
  }
  return s;
}

/** finding_id -> true when the finding matches a prior-period waiver. */
export function matchExclusions(findings: Finding[], exclusions: Set<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (exclusions.size === 0) return out;
  for (const f of findings) {
    if (exclusions.has(exclusionKey(f.rule_id, f.narration))) out[f.id] = true;
  }
  return out;
}
