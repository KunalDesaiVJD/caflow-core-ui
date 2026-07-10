/**
 * Money-flow summary (Phase 5, Ticket 5.2 — behind VITE_SCRUTINY_V2).
 *
 * Aggregates voucher-level movements to show WHO the money moves with (counterparties) and the
 * biggest ledger→party flows — the readable core of a money-flow graph. Pure + dependency-free.
 *
 * `dr_cr` is the row-level leg from the snapshot: Dr = debit total, Cr = credit total; `net` is
 * Cr − Dr (a positive net leans toward receipts, negative toward payments). We keep magnitudes
 * and both sides so the auditor can judge direction rather than us over-interpreting the sign.
 */

import type { VoucherRow } from "./detectionEngine";

export interface PartyFlow {
  party: string;
  total: number; // total absolute value transacted
  drTotal: number;
  crTotal: number;
  net: number; // crTotal - drTotal
  count: number;
}

const partyOf = (v: VoucherRow): string => (v.party_ledger ?? v.ledger_name ?? "").trim();

/** Aggregate absolute value + Dr/Cr split per counterparty, largest total first. */
export function partyFlows(vouchers: VoucherRow[], minAmount = 0): PartyFlow[] {
  const map = new Map<string, PartyFlow>();
  for (const v of vouchers) {
    const amt = Math.abs(v.amount ?? 0);
    if (amt < minAmount) continue;
    const party = partyOf(v);
    if (!party) continue;
    const cur = map.get(party) ?? { party, total: 0, drTotal: 0, crTotal: 0, net: 0, count: 0 };
    cur.total += amt;
    const dir = String(v.dr_cr ?? "").toLowerCase();
    if (dir.startsWith("d")) cur.drTotal += amt;
    else if (dir.startsWith("c")) cur.crTotal += amt;
    cur.count += 1;
    map.set(party, cur);
  }
  const flows = [...map.values()];
  for (const f of flows) f.net = f.crTotal - f.drTotal;
  return flows.sort((a, b) => b.total - a.total);
}

export interface FlowEdge {
  from: string; // ledger
  to: string; // party
  total: number;
  count: number;
}

/** Aggregate ledger→party flows (graph edges), largest first. */
export function flowEdges(vouchers: VoucherRow[], minAmount = 0): FlowEdge[] {
  const map = new Map<string, FlowEdge>();
  for (const v of vouchers) {
    const amt = Math.abs(v.amount ?? 0);
    if (amt < minAmount) continue;
    const to = (v.party_ledger ?? "").trim();
    if (!to) continue;
    const from = (v.ledger_name ?? "").trim() || "—";
    const key = `${from}→${to}`;
    const cur = map.get(key) ?? { from, to, total: 0, count: 0 };
    cur.total += amt;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface FlowSummary {
  parties: number;
  totalValue: number;
  topParties: PartyFlow[];
  topEdges: FlowEdge[];
}

export function moneyFlowSummary(vouchers: VoucherRow[], opts?: { minAmount?: number; topN?: number }): FlowSummary {
  const minAmount = opts?.minAmount ?? 0;
  const topN = opts?.topN ?? 15;
  const parties = partyFlows(vouchers, minAmount);
  const edges = flowEdges(vouchers, minAmount);
  return {
    parties: parties.length,
    totalValue: parties.reduce((s, p) => s + p.total, 0),
    topParties: parties.slice(0, topN),
    topEdges: edges.slice(0, topN),
  };
}
