/**
 * Rule precision & learning (Phase 7, Ticket 7.1 — behind VITE_SCRUTINY_V2).
 *
 * Tracks how each rule's findings were dispositioned by the auditor and derives precision:
 *  - waived    = the auditor dismissed it (treated as a false positive)
 *  - queried   = raised to the client (a real exception)
 *  - resolved  = actioned / accepted (not a false positive)
 *  - open      = not yet dispositioned
 * precision = (queried + resolved) / (queried + resolved + waived), over ACTIONED findings.
 *
 * A consistently-waived rule is a DEMOTE candidate (noisy); a consistently-actioned rule is a
 * PROMOTE candidate. These are ADVISORY SUGGESTIONS only — actually demoting/promoting a rule is a
 * partner action that is logged (canonical decision #11) and is not applied here.
 *
 * Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";

export type PrecisionVerdict = "promote" | "demote" | "monitor" | "insufficient";

export interface RulePrecision {
  rule_id: string;
  total: number;
  open: number;
  queried: number;
  resolved: number;
  waived: number;
  actioned: number; // queried + resolved + waived
  precision: number | null; // null when nothing is actioned yet
  verdict: PrecisionVerdict;
}

export interface PrecisionOpts {
  minActioned?: number; // below this, verdict is "insufficient"
  promoteAt?: number; // precision >= this → promote
  demoteAt?: number; // precision <= this → demote
}

const verdictOrder = (v: PrecisionVerdict): number =>
  v === "demote" ? 0 : v === "promote" ? 1 : v === "monitor" ? 2 : 3;

/** Per-rule precision + a promote/demote/monitor suggestion, demote candidates first. */
export function rulePrecision(findings: Finding[], opts: PrecisionOpts = {}): RulePrecision[] {
  const minActioned = opts.minActioned ?? 5;
  const promoteAt = opts.promoteAt ?? 0.8;
  const demoteAt = opts.demoteAt ?? 0.3;

  const m = new Map<string, RulePrecision>();
  for (const f of findings) {
    const id = f.rule_id ?? "";
    if (!id) continue;
    const cur = m.get(id) ?? { rule_id: id, total: 0, open: 0, queried: 0, resolved: 0, waived: 0, actioned: 0, precision: null, verdict: "insufficient" as PrecisionVerdict };
    cur.total++;
    const s = (f.status ?? "").toLowerCase();
    if (s === "waived") cur.waived++;
    else if (s === "queried") cur.queried++;
    else if (s === "resolved") cur.resolved++;
    else cur.open++;
    m.set(id, cur);
  }

  const out = [...m.values()];
  for (const r of out) {
    r.actioned = r.queried + r.resolved + r.waived;
    r.precision = r.actioned > 0 ? (r.queried + r.resolved) / r.actioned : null;
    if (r.actioned < minActioned || r.precision === null) r.verdict = "insufficient";
    else if (r.precision >= promoteAt) r.verdict = "promote";
    else if (r.precision <= demoteAt) r.verdict = "demote";
    else r.verdict = "monitor";
  }

  return out.sort((a, b) => verdictOrder(a.verdict) - verdictOrder(b.verdict) || (a.precision ?? 1) - (b.precision ?? 1));
}

export interface PrecisionSummary {
  rules: number;
  promote: number;
  demote: number;
  monitor: number;
  insufficient: number;
}

export function precisionSummary(rows: RulePrecision[]): PrecisionSummary {
  return {
    rules: rows.length,
    promote: rows.filter((r) => r.verdict === "promote").length,
    demote: rows.filter((r) => r.verdict === "demote").length,
    monitor: rows.filter((r) => r.verdict === "monitor").length,
    insufficient: rows.filter((r) => r.verdict === "insufficient").length,
  };
}
