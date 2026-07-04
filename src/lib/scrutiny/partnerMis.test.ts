import { describe, it, expect } from "vitest";
import { partnerMis, dispositionOf, type MisFindingRow } from "./partnerMis";

const R = (o: Partial<MisFindingRow>): MisFindingRow => ({
  client_id: "c1",
  rule_id: "CASH-01",
  severity: "HIGH",
  status: "open",
  queryStatus: null,
  ...o,
});

describe("dispositionOf", () => {
  it("ranks waived and resolved above an active query, and open last", () => {
    expect(dispositionOf(R({ status: "waived", queryStatus: "Open" }))).toBe("waived");
    expect(dispositionOf(R({ status: "resolved" }))).toBe("resolved");
    expect(dispositionOf(R({ status: "open", queryStatus: "Draft" }))).toBe("queried");
    expect(dispositionOf(R({ status: "open", queryStatus: "Rejected" }))).toBe("open");
    expect(dispositionOf(R({ status: "open", queryStatus: null }))).toBe("open");
  });
});

describe("partnerMis", () => {
  it("counts engagements including clean ones from engagementCount", () => {
    const rows = [R({ client_id: "c1" }), R({ client_id: "c2" })];
    const m = partnerMis(rows, 5);
    expect(m.engagements.total).toBe(5);
    expect(m.engagements.withFindings).toBe(2);
    expect(m.engagements.clean).toBe(3);
  });

  it("never reports fewer engagements than clients with findings", () => {
    const rows = [R({ client_id: "c1" }), R({ client_id: "c2" }), R({ client_id: "c3" })];
    expect(partnerMis(rows, 1).engagements.total).toBe(3); // engagementCount too low is clamped up
  });

  it("tallies the severity mix", () => {
    const m = partnerMis([R({ severity: "HIGH" }), R({ severity: "MEDIUM" }), R({ severity: "LOW" }), R({ severity: null })]);
    expect(m.findings).toEqual({ total: 4, high: 1, medium: 1, low: 2 });
  });

  it("computes disposition counts and the actioned rate", () => {
    const rows = [
      R({ status: "waived" }),
      R({ status: "resolved" }),
      R({ status: "open", queryStatus: "Open" }),
      R({ status: "open", queryStatus: null }),
    ];
    const m = partnerMis(rows);
    expect(m.disposition).toMatchObject({ waived: 1, resolved: 1, queried: 1, open: 1 });
    expect(m.disposition.rate).toBeCloseTo(0.75); // 3 of 4 actioned
  });

  it("flags only engagements with an unresolved high finding", () => {
    const rows = [
      R({ client_id: "a", severity: "HIGH", status: "open" }), // open high → flagged
      R({ client_id: "b", severity: "HIGH", status: "resolved" }), // resolved → not flagged
      R({ client_id: "c", severity: "LOW", status: "open" }), // low → not flagged
    ];
    expect(partnerMis(rows).engagements.withOpenHigh).toBe(1);
  });

  it("splits query throughput by status", () => {
    const m = partnerMis([
      R({ queryStatus: "Draft" }),
      R({ queryStatus: "Draft" }),
      R({ queryStatus: "Open" }),
      R({ queryStatus: "Rejected" }),
    ]);
    expect(m.queries).toEqual({ drafts: 2, awaitingClient: 1, rejected: 1 });
  });

  it("surfaces top risk categories and the per-engagement average", () => {
    const rows = [
      R({ client_id: "a", rule_id: "CASH-01", severity: "HIGH" }),
      R({ client_id: "a", rule_id: "CASH-02", severity: "HIGH" }),
      R({ client_id: "b", rule_id: "GST-01", severity: "LOW" }),
    ];
    const m = partnerMis(rows);
    expect(m.topCategories[0].category).toBe("CASH");
    expect(m.avgFindingsPerEngagement).toBeCloseTo(1.5); // 3 findings / 2 engagements
  });

  it("is safe on an empty firm", () => {
    const m = partnerMis([], 0);
    expect(m.findings.total).toBe(0);
    expect(m.disposition.rate).toBe(0);
    expect(m.avgFindingsPerEngagement).toBe(0);
    expect(m.topCategories).toEqual([]);
  });
});
