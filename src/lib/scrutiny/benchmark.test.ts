import { describe, it, expect } from "vitest";
import { benchmark, type BenchFindingRow } from "./benchmark";

const rows = (client: string, cat: string, n: number): BenchFindingRow[] =>
  Array.from({ length: n }, () => ({ client_id: client, rule_id: `${cat}-1` }));

// 3 engagements. CASH total 12 (c1=6 → 1.5× → above); TDS total 6 (c1=1 → 0.5× → below);
// GST total 9 (c1=3 → 1.0× → typical).
const findings: BenchFindingRow[] = [
  ...rows("c1", "CASH", 6), ...rows("c2", "CASH", 3), ...rows("c3", "CASH", 3),
  ...rows("c1", "TDS", 1), ...rows("c2", "TDS", 3), ...rows("c3", "TDS", 2),
  ...rows("c1", "GST", 3), ...rows("c2", "GST", 3), ...rows("c3", "GST", 3),
];

describe("benchmark", () => {
  const result = benchmark({ findings, clientId: "c1", peerEngagements: 3 });
  const byCat = Object.fromEntries(result.map((r) => [r.category, r]));

  it("compares the client to the portfolio average per engagement", () => {
    expect(byCat["CASH"]).toMatchObject({ clientCount: 6, portfolioTotal: 12, portfolioAvg: 4, ratio: 1.5, level: "above" });
    expect(byCat["TDS"]).toMatchObject({ clientCount: 1, portfolioAvg: 2, ratio: 0.5, level: "below" });
    expect(byCat["GST"]).toMatchObject({ clientCount: 3, portfolioAvg: 3, ratio: 1, level: "typical" });
  });

  it("sorts biggest outliers (highest ratio) first", () => {
    expect(result.map((r) => r.category)).toEqual(["CASH", "GST", "TDS"]);
  });

  it("handles a client with no findings in a category", () => {
    const r = benchmark({ findings: rows("c2", "CASH", 4), clientId: "c1", peerEngagements: 2 });
    expect(r[0]).toMatchObject({ category: "CASH", clientCount: 0, ratio: 0, level: "below" });
  });

  it("never divides by zero when peerEngagements is 0", () => {
    const r = benchmark({ findings: rows("c1", "CASH", 2), clientId: "c1", peerEngagements: 0 });
    expect(r[0].portfolioAvg).toBe(2); // denom clamped to 1
    expect(r[0].ratio).toBe(1);
  });
});
