/**
 * Cross-engagement portfolio aggregation (Phase 7, Ticket 7.2 — behind VITE_SCRUTINY_V2).
 *
 * Rolls up scrutiny findings across the firm's clients into a per-engagement summary + totals,
 * so a partner can see the whole portfolio's risk at a glance. Pure + dependency-free.
 */

export interface ClientRow {
  id: string;
  name: string;
}

export interface FindingRow {
  client_id: string | null;
  severity: string | null;
  status: string | null;
}

export interface EngagementSummary {
  clientId: string;
  clientName: string;
  findings: number;
  high: number;
  medium: number;
  low: number;
  open: number;
  queried: number;
  resolved: number;
  waived: number;
  riskScore: number; // high*5 + medium*2 + low*1
}

const blank = (id: string, name: string): EngagementSummary => ({
  clientId: id, clientName: name, findings: 0, high: 0, medium: 0, low: 0,
  open: 0, queried: 0, resolved: 0, waived: 0, riskScore: 0,
});

/** Per-client scrutiny summary (includes clients with zero findings), highest risk first. */
export function portfolioSummary(clients: ClientRow[], findings: FindingRow[]): EngagementSummary[] {
  const byClient = new Map<string, EngagementSummary>();
  for (const c of clients) byClient.set(c.id, blank(c.id, c.name));

  for (const f of findings) {
    const cid = f.client_id ?? "";
    let row = byClient.get(cid);
    if (!row) { row = blank(cid, cid); byClient.set(cid, row); }
    row.findings++;
    const s = (f.severity ?? "").toUpperCase();
    if (s === "HIGH") row.high++;
    else if (s === "MEDIUM") row.medium++;
    else row.low++;
    const st = (f.status ?? "").toLowerCase();
    if (st === "waived") row.waived++;
    else if (st === "queried") row.queried++;
    else if (st === "resolved") row.resolved++;
    else row.open++;
  }

  const out = [...byClient.values()];
  for (const r of out) r.riskScore = r.high * 5 + r.medium * 2 + r.low * 1;
  return out.sort((a, b) => b.riskScore - a.riskScore || b.findings - a.findings || a.clientName.localeCompare(b.clientName));
}

export interface PortfolioTotals {
  clients: number;
  withFindings: number;
  findings: number;
  high: number;
  queriesRaised: number;
}

export function portfolioTotals(rows: EngagementSummary[]): PortfolioTotals {
  return {
    clients: rows.length,
    withFindings: rows.filter((r) => r.findings > 0).length,
    findings: rows.reduce((s, r) => s + r.findings, 0),
    high: rows.reduce((s, r) => s + r.high, 0),
    queriesRaised: rows.reduce((s, r) => s + r.queried, 0),
  };
}
