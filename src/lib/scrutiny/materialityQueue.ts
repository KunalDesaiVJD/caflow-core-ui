/**
 * Materiality approval queue (firm-wide).
 *
 * Every engagement needs its materiality approved before scrutiny thresholds scale to it, and a
 * firm clearing a backlog wants the ones that matter most at the top. "Matters most" is not the
 * biggest client: it is the engagement where approving would change the most, plus the ones where
 * the system could not propose a sensible figure and is guessing.
 *
 * Pure and dependency-free so it is unit-testable without a database.
 */

export type JudgmentStatus = "proposed" | "approved" | "rejected" | "superseded";

export interface MaterialityRow {
  id: string;
  client_id: string;
  client_name: string;
  financial_year: string;
  status: JudgmentStatus;
  /** system suggestion */
  proposed: {
    materiality?: number;
    performance?: number;
    trivial?: number;
    benchmark?: string;
    benchmark_pct?: number;
    basis?: { turnover?: number | null; totalAssets?: number | null };
    rationale?: string;
  } | null;
  /** what a human approved; null until decided */
  decided: { materiality?: number; performance?: number; trivial?: number } | null;
  decided_at?: string | null;
  /** open findings on the engagement — the size of the prize for approving */
  finding_count?: number;
}

export interface QueueItem extends MaterialityRow {
  /** true when the proposal fell back to the floor: no usable turnover or asset base */
  needsAttention: boolean;
  /** how far the human moved the number, once decided (0 when unchanged) */
  overridePct: number | null;
  priority: number;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Rank the queue. Pending items always outrank decided ones; within pending, an engagement with
 * more open findings comes first because approving it removes more noise. A proposal that fell
 * back to the floor is pushed to the very top regardless of size — there the system has no opinion
 * at all and a human must supply one, which is exactly the case silent defaults would hide.
 */
export function materialityQueue(rows: MaterialityRow[]): QueueItem[] {
  return rows
    .map((r): QueueItem => {
      const needsAttention = (r.proposed?.benchmark ?? "floor") === "floor";
      const pProposed = n(r.proposed?.performance);
      const pDecided = r.decided ? n(r.decided.performance) : null;
      const overridePct = pDecided != null && pProposed > 0
        ? Math.round(((pDecided - pProposed) / pProposed) * 100)
        : null;
      const pending = r.status === "proposed";
      const priority =
        (pending ? 1_000_000 : 0) +
        (pending && needsAttention ? 500_000 : 0) +
        n(r.finding_count);
      return { ...r, needsAttention, overridePct, priority };
    })
    .sort((a, b) => b.priority - a.priority || a.client_name.localeCompare(b.client_name));
}

export interface QueueTotals {
  total: number;
  pending: number;
  approved: number;
  needsAttention: number;
  /** open findings sitting on engagements that have not been approved yet */
  findingsBlocked: number;
}

export function queueTotals(items: QueueItem[]): QueueTotals {
  const pending = items.filter((i) => i.status === "proposed");
  return {
    total: items.length,
    pending: pending.length,
    approved: items.filter((i) => i.status === "approved").length,
    needsAttention: pending.filter((i) => i.needsAttention).length,
    findingsBlocked: pending.reduce((s, i) => s + n(i.finding_count), 0),
  };
}

/**
 * Validate an edited set of figures before it can be approved. The three levels must stay ordered
 * — a trivial threshold above performance materiality would silently suppress everything the
 * performance level is supposed to catch.
 */
export function validateMateriality(v: { materiality: number; performance: number; trivial: number }): string | null {
  if (!(v.materiality > 0)) return "Materiality must be greater than zero.";
  if (!(v.performance > 0)) return "Performance materiality must be greater than zero.";
  if (!(v.trivial >= 0)) return "The trivial threshold cannot be negative.";
  if (v.performance > v.materiality) return "Performance materiality cannot exceed overall materiality.";
  if (v.trivial >= v.performance) return "The trivial threshold must sit below performance materiality.";
  return null;
}

/** Indian-format currency for display, e.g. 1300000 -> "₹13,00,000". */
export const inr = (v: unknown): string => `₹${Math.round(n(v)).toLocaleString("en-IN")}`;

/** Compact basis line shown under the client name so the approver sees what drove the figure. */
export function basisLabel(r: MaterialityRow): string {
  const b = r.proposed?.benchmark;
  if (!b || b === "floor") return "No usable turnover or asset base — set this from your knowledge of the engagement";
  const pct = r.proposed?.benchmark_pct;
  const amt = b === "turnover" ? r.proposed?.basis?.turnover : r.proposed?.basis?.totalAssets;
  const label = b.replace(/_/g, " ");
  return amt ? `${pct}% of ${label} (${inr(amt)})` : `${pct}% of ${label}`;
}
