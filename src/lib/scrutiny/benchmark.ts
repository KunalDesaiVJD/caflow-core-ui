/**
 * Benchmarking (Phase 7, Ticket 7.3 — behind VITE_SCRUTINY_V2).
 *
 * Compares the current client's finding profile, by category, against the portfolio average per
 * engagement — so a partner can spot where a client is an outlier (e.g. "3× the portfolio's
 * cash-payment rate"). Pure + dependency-free → unit-testable without a DB.
 */

const catOf = (ruleId: string | null): string => (ruleId ?? "").split("-")[0] || "GEN";

export interface BenchFindingRow {
  client_id: string | null;
  rule_id: string | null;
}

export type BenchLevel = "above" | "typical" | "below";

export interface BenchmarkRow {
  category: string;
  clientCount: number;
  portfolioTotal: number;
  portfolioAvg: number; // per engagement (with findings)
  ratio: number | null; // clientCount / portfolioAvg
  level: BenchLevel;
}

export interface BenchmarkInputs {
  findings: BenchFindingRow[];
  clientId: string;
  /** number of engagements to average over (engagements with findings) */
  peerEngagements: number;
  aboveAt?: number; // ratio ≥ this → above (default 1.5)
  belowAt?: number; // ratio ≤ this → below (default 0.5)
}

/** Per-category benchmark of the client against the portfolio average, biggest outliers first. */
export function benchmark(inp: BenchmarkInputs): BenchmarkRow[] {
  const aboveAt = inp.aboveAt ?? 1.5;
  const belowAt = inp.belowAt ?? 0.5;
  const denom = Math.max(1, inp.peerEngagements);

  const totalByCat = new Map<string, number>();
  const clientByCat = new Map<string, number>();
  for (const f of inp.findings) {
    const c = catOf(f.rule_id);
    totalByCat.set(c, (totalByCat.get(c) ?? 0) + 1);
    if (f.client_id === inp.clientId) clientByCat.set(c, (clientByCat.get(c) ?? 0) + 1);
  }

  const rows: BenchmarkRow[] = [];
  for (const [category, portfolioTotal] of totalByCat) {
    const clientCount = clientByCat.get(category) ?? 0;
    const portfolioAvg = portfolioTotal / denom;
    const ratio = portfolioAvg > 0 ? clientCount / portfolioAvg : null;
    let level: BenchLevel = "typical";
    if (ratio != null) {
      if (ratio >= aboveAt) level = "above";
      else if (ratio <= belowAt) level = "below";
    }
    rows.push({ category, clientCount, portfolioTotal, portfolioAvg, ratio, level });
  }

  return rows.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.clientCount - a.clientCount || a.category.localeCompare(b.category));
}
