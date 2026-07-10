/**
 * SLA nudges / alerts (Phase 8, Ticket 8.2 — behind VITE_SCRUTINY_V2).
 *
 * Deterministic ageing of the actionable scrutiny items — draft queries waiting on a checker,
 * approved queries waiting on the client, and high findings not yet raised — into a prioritised
 * "what's overdue" list. No AI, no DB: the caller supplies the clock start per item and `now`.
 * Pure + dependency-free → unit-testable without a DB or a real clock.
 *
 * Advisory only — nudges never block sign-off / UDIN (decision #8); they surface follow-ups.
 */

export type SlaKind = "draft_review" | "client_response" | "high_unraised";
export type SlaLevel = "overdue" | "escalate";

export interface SlaItem {
  id: string;
  kind: SlaKind;
  label: string;
  clientId?: string | null;
  /** when the SLA clock started — ISO string or epoch ms; null/invalid ⇒ item is skipped */
  since: string | number | null;
}

export interface SlaThreshold {
  dueDays: number; // ≥ this age ⇒ overdue
  escalateDays: number; // ≥ this age ⇒ escalate
}
export type SlaThresholds = Record<SlaKind, SlaThreshold>;

/** CA defaults (§8): review drafts fast, chase clients weekly, don't sit on high findings. */
export const SLA_DEFAULTS: SlaThresholds = {
  draft_review: { dueDays: 2, escalateDays: 5 },
  client_response: { dueDays: 7, escalateDays: 14 },
  high_unraised: { dueDays: 3, escalateDays: 7 },
};

export interface SlaNudge {
  id: string;
  kind: SlaKind;
  label: string;
  clientId: string | null;
  ageDays: number;
  level: SlaLevel;
  message: string;
}

const DAY = 86_400_000;

const toMs = (v: string | number | null): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

function messageFor(kind: SlaKind, label: string, ageDays: number, level: SlaLevel): string {
  const esc = level === "escalate" ? "ESCALATE — " : "";
  if (kind === "draft_review") return `${esc}Draft query "${label}" awaiting a checker for ${ageDays}d — approve or reject.`;
  if (kind === "client_response") return `${esc}Query "${label}" sent ${ageDays}d ago, no client response — follow up.`;
  return `${esc}High finding "${label}" open ${ageDays}d, not yet raised as a client query.`;
}

const LEVEL_ORDER: Record<SlaLevel, number> = { escalate: 0, overdue: 1 };
const KIND_ORDER: Record<SlaKind, number> = { high_unraised: 0, draft_review: 1, client_response: 2 };

/** Age each item and return only those past their due threshold, most urgent first. */
export function slaNudges(items: SlaItem[], now: number, thresholds: SlaThresholds = SLA_DEFAULTS): SlaNudge[] {
  const out: SlaNudge[] = [];
  for (const it of items) {
    const start = toMs(it.since);
    if (start == null) continue;
    const ageDays = Math.floor((now - start) / DAY);
    if (ageDays < 0) continue;
    const th = thresholds[it.kind];
    if (!th) continue;
    let level: SlaLevel | null = null;
    if (ageDays >= th.escalateDays) level = "escalate";
    else if (ageDays >= th.dueDays) level = "overdue";
    if (!level) continue;
    out.push({
      id: it.id,
      kind: it.kind,
      label: it.label,
      clientId: it.clientId ?? null,
      ageDays,
      level,
      message: messageFor(it.kind, it.label, ageDays, level),
    });
  }
  return out.sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      b.ageDays - a.ageDays ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

export interface SlaSummary {
  overdue: number;
  escalate: number;
  total: number;
}

export function slaSummary(nudges: SlaNudge[]): SlaSummary {
  const escalate = nudges.filter((n) => n.level === "escalate").length;
  return { escalate, overdue: nudges.length - escalate, total: nudges.length };
}
