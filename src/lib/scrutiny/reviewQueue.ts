/**
 * Review & assignment queue (Phase 8, Ticket 8.4 — behind VITE_SCRUTINY_V2).
 *
 * Turns the firm's open findings into a maker-checker worklist: what's awaiting a checker, what a
 * maker still has to raise, what's out with the client, and low-severity items to dispose. Each
 * item is placed in exactly one lane, closed findings (resolved/waived) drop out, and drafts
 * awaiting review are rolled up per maker so a partner can see whose queue is backed up.
 *
 * Deterministic, no AI. Pure + dependency-free → unit-testable without a DB.
 */

export type QueueLane = "to_review" | "to_raise" | "awaiting_client" | "to_dispose";

export const LANE_LABEL: Record<QueueLane, string> = {
  to_review: "Awaiting checker",
  to_raise: "To raise as query",
  awaiting_client: "Awaiting client",
  to_dispose: "To dispose (low)",
};

const LANE_ORDER: QueueLane[] = ["to_review", "to_raise", "awaiting_client", "to_dispose"];

export interface QueueInputFinding {
  id: string;
  client_id: string | null;
  rule_id: string | null;
  severity: string | null;
  status: string | null; // finding disposition: open / resolved / waived
  actioned_by?: string | null; // maker who raised the linked query
  queryStatus?: string | null; // linked query: Draft / Open / Rejected / null
}

export interface QueueItem {
  id: string;
  clientId: string | null;
  ruleId: string | null;
  severity: string | null;
  lane: QueueLane;
  maker: string | null; // owner for review / client lanes
  blockedOn: "checker" | "client" | null;
}

export interface QueueResult {
  items: QueueItem[];
  lanes: { lane: QueueLane; label: string; count: number }[];
  makers: { maker: string; awaitingReview: number }[];
  total: number; // total open work items (closed findings excluded)
}

const sevRank = (s: string | null): number => {
  const u = (s ?? "").toUpperCase();
  return u === "HIGH" ? 3 : u === "MEDIUM" ? 2 : u === "LOW" ? 1 : 0;
};

/** Classify one open finding into its queue lane, or null if it's closed. */
function laneOf(f: QueueInputFinding): QueueItem | null {
  const st = (f.status ?? "").toLowerCase();
  if (st === "resolved" || st === "waived") return null; // disposed

  const q = (f.queryStatus ?? "").toLowerCase();
  const base = { id: f.id, clientId: f.client_id, ruleId: f.rule_id, severity: f.severity };
  if (q === "draft") return { ...base, lane: "to_review", maker: f.actioned_by ?? null, blockedOn: "checker" };
  if (q === "open") return { ...base, lane: "awaiting_client", maker: f.actioned_by ?? null, blockedOn: "client" };
  // no active query (null or a rejected draft) → the auditor still owns it
  const lane: QueueLane = sevRank(f.severity) >= 2 ? "to_raise" : "to_dispose";
  return { ...base, lane, maker: null, blockedOn: null };
}

export function reviewQueue(findings: QueueInputFinding[]): QueueResult {
  const items: QueueItem[] = [];
  for (const f of findings) {
    const it = laneOf(f);
    if (it) items.push(it);
  }

  const laneIdx = (l: QueueLane) => LANE_ORDER.indexOf(l);
  items.sort(
    (a, b) =>
      laneIdx(a.lane) - laneIdx(b.lane) ||
      sevRank(b.severity) - sevRank(a.severity) ||
      (a.clientId ?? "").localeCompare(b.clientId ?? "") ||
      a.id.localeCompare(b.id),
  );

  const lanes = LANE_ORDER.map((lane) => ({
    lane,
    label: LANE_LABEL[lane],
    count: items.filter((i) => i.lane === lane).length,
  }));

  const byMaker = new Map<string, number>();
  for (const i of items) if (i.lane === "to_review" && i.maker) byMaker.set(i.maker, (byMaker.get(i.maker) ?? 0) + 1);
  const makers = [...byMaker.entries()]
    .map(([maker, awaitingReview]) => ({ maker, awaitingReview }))
    .sort((a, b) => b.awaitingReview - a.awaitingReview || a.maker.localeCompare(b.maker));

  return { items, lanes, makers, total: items.length };
}
