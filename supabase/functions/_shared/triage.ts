/**
 * Two-tier triage: which findings are worth putting to the client, and which are review notes.
 *
 * The engine produces ~96 findings per engagement against the 18.5 queries a human auditor raises,
 * and every one currently lands in the same undifferentiated list — which is why no auditor has
 * ever dispositioned a single finding. This splits them:
 *
 *   queries — a capped, ranked shortlist. The work an auditor is expected to act on.
 *   notes   — everything else, kept and searchable, promotable, but never auto-raised.
 *
 * Ranking notes:
 *  - Severity is a WEAK signal in this data: 48% of findings are HIGH, ~46 per engagement, so it
 *    cannot select 25. It is a tiebreaker here, not the driver.
 *  - Size relative to the engagement's own materiality is the real discriminator, which is why
 *    this runs after materiality is approved rather than on absolute rupees.
 *  - A per-rule cap enforces BREADTH. Without it a single rule (CRED-004 alone still produces
 *    1,743 findings) fills every slot, and the auditor gets twenty instances of one issue instead
 *    of the spread of distinct issues a human would actually raise. This is the mechanism that
 *    makes the shortlist resemble a human's query list rather than a truncated report.
 *  - Engagement-level findings carry no amount but are often the most consequential (no
 *    depreciation charged at all; no tax provision). They get a fixed mid-band score so they are
 *    never sorted below a merely large balance.
 *
 * Pure and dependency-free so it is unit-testable without a database.
 */

export interface TriageFinding {
  rule_id: string;
  severity?: string | null;
  amount?: number | null;
  /** "account" | "voucher" | "aggregate" — aggregate/engagement-level findings carry no amount */
  detection_level?: string | null;
}

export interface TriageOptions {
  /** hard cap on the client-facing shortlist */
  maxQueries?: number;
  /** most findings any single rule may contribute to the shortlist */
  maxPerRule?: number;
  /** approved performance materiality; ranking falls back to a nominal scale without it */
  performanceMateriality?: number | null;
}

export interface Triaged<T> {
  queries: T[];
  notes: T[];
}

const SEVERITY_WEIGHT: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
/** Engagement-level findings have no amount; place them mid-band rather than last. */
const AGGREGATE_MAGNITUDE = 1.0;
/** Used when no materiality is approved, so ranking still degrades sensibly instead of collapsing. */
const NOMINAL_SCALE = 100_000;

/**
 * Rule families where size is NOT the measure of importance.
 *
 * Measured against the firm's own queries: of those quoting an amount, the MEDIAN is Rs.8,260 and
 * 73% are under Rs.50,000 — a Rs.420 TDS short-deduction, a Rs.26 kasar transfer. An audit query is
 * not a materiality judgement; a compliance breach is a breach at any size, and a bookkeeping
 * oddity is a question at any size. Ranking these on magnitude buries exactly what the auditors
 * raise, so they are scored on severity alone and compete on their own terms.
 */
const COMPLIANCE_PREFIXES = ["TDS", "CASH", "GST", "RC-", "PAY", "CUT", "JE", "MISC", "EXP-MISCLASS"];
const isComplianceRule = (ruleId: string): boolean => {
  const id = String(ruleId ?? "").toUpperCase();
  return COMPLIANCE_PREFIXES.some((p) => id.startsWith(p));
};

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? Math.abs(x) : 0;
};

/**
 * Score a finding. Magnitude is log-scaled so a finding ten times materiality outranks one at
 * materiality without a single enormous balance swamping every other issue type.
 */
export function scoreFinding(f: TriageFinding, performanceMateriality?: number | null): number {
  const sev = SEVERITY_WEIGHT[String(f.severity ?? "MEDIUM").toUpperCase()] ?? 2;
  // Compliance findings are scored on severity alone. A Rs.420 TDS shortfall is the same breach as
  // a Rs.4,20,000 one, and the firm raises both; scaling it by size would rank it below every large
  // balance and it would never reach the shortlist.
  if (isComplianceRule(f.rule_id)) return sev * (1 + AGGREGATE_MAGNITUDE);
  const scale = performanceMateriality && performanceMateriality > 0 ? performanceMateriality : NOMINAL_SCALE;
  const amt = num(f.amount);
  const magnitude = amt > 0
    ? Math.log10(1 + amt / scale)
    : (String(f.detection_level ?? "").toLowerCase() === "aggregate" ? AGGREGATE_MAGNITUDE : 0);
  return sev * (1 + magnitude);
}

/**
 * Split findings into the client-facing shortlist and review notes.
 *
 * The per-rule cap is a HARD limit, not a hint. Topping the list back up to maxQueries with extra
 * instances of an already-capped rule would defeat the only thing the cap exists for: an auditor is
 * better served by seven distinct issues than by ten where six are the same rule repeated. So a
 * shortlist may come back shorter than maxQueries, and the surplus instances become notes, where
 * they remain searchable and promotable.
 */
export function triage<T extends TriageFinding>(findings: T[], opts: TriageOptions = {}): Triaged<T> {
  const maxQueries = opts.maxQueries ?? 25;
  const maxPerRule = opts.maxPerRule ?? 3;
  const pm = opts.performanceMateriality ?? null;

  const ranked = findings
    .map((f, i) => ({ f, i, score: scoreFinding(f, pm) }))
    // index breaks ties so the order is deterministic across runs
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const chosen = new Set<number>();
  const perRule = new Map<string, number>();

  for (const r of ranked) {
    if (chosen.size >= maxQueries) break;
    const used = perRule.get(r.f.rule_id) ?? 0;
    if (used >= maxPerRule) continue;
    chosen.add(r.i);
    perRule.set(r.f.rule_id, used + 1);
  }

  const queries: T[] = [];
  const notes: T[] = [];
  for (const r of ranked) (chosen.has(r.i) ? queries : notes).push(r.f);
  return { queries, notes };
}

export interface TriageSummary {
  total: number;
  queries: number;
  notes: number;
  /** distinct rules represented in the shortlist — the breadth the per-rule cap buys */
  queryRules: number;
}

export function triageSummary<T extends TriageFinding>(t: Triaged<T>): TriageSummary {
  return {
    total: t.queries.length + t.notes.length,
    queries: t.queries.length,
    notes: t.notes.length,
    queryRules: new Set(t.queries.map((q) => q.rule_id)).size,
  };
}
