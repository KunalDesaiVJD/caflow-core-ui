import { describe, it, expect } from "vitest";
import { portfolioSummary, portfolioTotals, type ClientRow, type FindingRow } from "./portfolio";

const clients: ClientRow[] = [
  { id: "c1", name: "Alpha Pvt Ltd" },
  { id: "c2", name: "Beta LLP" },
  { id: "c3", name: "Gamma & Co" },
];

const findings: FindingRow[] = [
  { client_id: "c1", severity: "HIGH", status: "queried" },
  { client_id: "c1", severity: "HIGH", status: "queried" },
  { client_id: "c1", severity: "MEDIUM", status: "waived" },
  { client_id: "c2", severity: "LOW", status: "open" },
];

describe("portfolioSummary", () => {
  const rows = portfolioSummary(clients, findings);
  const byId = Object.fromEntries(rows.map((r) => [r.clientId, r]));

  it("aggregates severity + disposition per client, including zero-finding clients", () => {
    expect(byId["c1"]).toMatchObject({ findings: 3, high: 2, medium: 1, queried: 2, waived: 1, riskScore: 12 });
    expect(byId["c2"]).toMatchObject({ findings: 1, low: 1, open: 1, riskScore: 1 });
    expect(byId["c3"]).toMatchObject({ findings: 0, riskScore: 0 });
  });

  it("sorts by risk score (highest first)", () => {
    expect(rows.map((r) => r.clientId)).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps a client name for findings whose client is not in the list", () => {
    const r = portfolioSummary([], [{ client_id: "orphan", severity: "HIGH", status: "open" }]);
    expect(r[0].clientId).toBe("orphan");
    expect(r[0].high).toBe(1);
  });
});

describe("portfolioTotals", () => {
  it("totals across engagements", () => {
    expect(portfolioTotals(portfolioSummary(clients, findings))).toEqual({
      clients: 3, withFindings: 2, findings: 4, high: 2, queriesRaised: 2,
    });
  });
});
