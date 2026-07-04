/**
 * Partner MIS (Phase 8, Ticket 8.5 — behind VITE_SCRUTINY_V2).
 *
 * A firm-level rollup of the scrutiny book for the partner: engagement completion, the finding
 * mix, how far findings have been disposed, query throughput, and where risk concentrates. One
 * pass over the firm-wide findings (each carrying its live query status). Reuses riskByCategory
 * for the risk concentration so the radar and MIS never disagree.
 *
 * Deterministic, no AI. Pure + dependency-free → unit-testable without a DB.
 */

import type { Finding } from "./scrutinyUi";
import { riskByCategory } from "./commandCenter";

export interface MisFindingRow {
  client_id: string | null;
  rule_id: string | null;
  severity: string | null;
  status: string | null; // open / resolved / waived
  queryStatus?: string | null; // linked query: Draft / Open / Rejected / null
}

export type Disposition = "waived" | "resolved" | "queried" | "open";

export interface PartnerMis {
  engagements: { total: number; withFindings: number; clean: number; withOpenHigh: number };
  findings: { total: number; high: number; medium: number; low: number };
  disposition: { open: number; queried: number; resolved: number; waived: number; rate: number };
  queries: { drafts: number; awaitingClient: number; rejected: number };
  topCategories: { category: string; score: number; total: number }[];
  avgFindingsPerEngagement: number;
}

const sev = (s: string | null): "HIGH" | "MEDIUM" | "LOW" => {
  const u = (s ?? "").toUpperCase();
  return u === "HIGH" ? "HIGH" : u === "MEDIUM" ? "MEDIUM" : "LOW";
};

/** Disposition of one finding, most-final first: waived → resolved → queried (active) → open. */
export function dispositionOf(row: MisFindingRow): Disposition {
  const st = (row.status ?? "").toLowerCase();
  if (st === "waived") return "waived";
  if (st === "resolved") return "resolved";
  const q = (row.queryStatus ?? "").toLowerCase();
  if (q === "draft" || q === "open") return "queried"; // an active query is in progress
  return "open";
}

/**
 * Firm-level MIS. `engagementCount` is the number of clients in the firm (so "clean" engagements
 * with zero findings are counted); if omitted it falls back to the distinct clients seen in rows.
 */
export function partnerMis(rows: MisFindingRow[], engagementCount?: number): PartnerMis {
  const clients = new Set<string>();
  const clientsWithFindings = new Set<string>();
  const clientsWithOpenHigh = new Set<string>();

  let high = 0, medium = 0, low = 0;
  let open = 0, queried = 0, resolved = 0, waived = 0;
  let drafts = 0, awaitingClient = 0, rejected = 0;

  for (const r of rows) {
    const cid = r.client_id ?? "";
    clients.add(cid);
    clientsWithFindings.add(cid);

    const s = sev(r.severity);
    if (s === "HIGH") high++; else if (s === "MEDIUM") medium++; else low++;

    const d = dispositionOf(r);
    if (d === "waived") waived++;
    else if (d === "resolved") resolved++;
    else if (d === "queried") queried++;
    else open++;

    if (s === "HIGH" && d !== "waived" && d !== "resolved") clientsWithOpenHigh.add(cid);

    const q = (r.queryStatus ?? "").toLowerCase();
    if (q === "draft") drafts++;
    else if (q === "open") awaitingClient++;
    else if (q === "rejected") rejected++;
  }

  const total = rows.length;
  const withFindings = clientsWithFindings.size;
  const totalEngagements = Math.max(engagementCount ?? clients.size, withFindings);
  const actioned = queried + resolved + waived;

  const cats = riskByCategory(rows as Finding[]);

  return {
    engagements: {
      total: totalEngagements,
      withFindings,
      clean: Math.max(0, totalEngagements - withFindings),
      withOpenHigh: clientsWithOpenHigh.size,
    },
    findings: { total, high, medium, low },
    disposition: { open, queried, resolved, waived, rate: total > 0 ? actioned / total : 0 },
    queries: { drafts, awaitingClient, rejected },
    topCategories: cats.slice(0, 6).map((c) => ({ category: c.category, score: c.score, total: c.total })),
    avgFindingsPerEngagement: withFindings > 0 ? total / withFindings : 0,
  };
}
