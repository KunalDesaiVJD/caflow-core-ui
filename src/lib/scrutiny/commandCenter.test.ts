import { describe, it, expect } from "vitest";
import { riskByCategory, radarGeometry, attentionFeed } from "./commandCenter";
import type { Finding } from "./scrutinyUi";

const f = (rule: string, sev: string): Finding => ({
  id: rule + sev + Math.random(), rule_id: rule, client_id: "c1", severity: sev, clause_3cd: null,
  flag_message: "x", status: "open", narration: "L", financial_year: "2024-25",
});

describe("riskByCategory", () => {
  it("rolls up by category with a weighted score, highest first", () => {
    const cats = riskByCategory([f("CASH-1", "HIGH"), f("CASH-2", "MEDIUM"), f("TDS-1", "LOW")]);
    const cash = cats.find((c) => c.category === "CASH")!;
    expect(cash.high).toBe(1);
    expect(cash.medium).toBe(1);
    expect(cash.total).toBe(2);
    expect(cash.score).toBe(5 + 2); // high*5 + medium*2
    expect(cats[0].category).toBe("CASH"); // higher score first
  });
});

describe("radarGeometry", () => {
  it("produces one axis + polygon point per item, centred", () => {
    const g = radarGeometry([{ label: "A", value: 10 }, { label: "B", value: 5 }, { label: "C", value: 0 }], 240, 4);
    expect(g.axes).toHaveLength(3);
    expect(g.polygon.split(" ")).toHaveLength(3);
    expect(g.center).toBe(120);
    expect(g.rings).toHaveLength(4);
    // largest value sits on the outer radius (0.8 * center = 96 from centre) at the top axis
    expect(g.axes[0].y).toBeCloseTo(120 - 96, 0);
    // a zero value collapses to the centre
    expect(g.axes[2].x).toBeCloseTo(120, 0);
    expect(g.axes[2].y).toBeCloseTo(120, 0);
  });

  it("does not divide by zero for empty / all-zero input", () => {
    expect(radarGeometry([]).axes).toHaveLength(0);
    const z = radarGeometry([{ label: "A", value: 0 }]);
    expect(z.axes[0].x).toBeCloseTo(120, 0);
  });
});

describe("attentionFeed", () => {
  it("builds a prioritised list from the current state", () => {
    const items = attentionFeed({
      findings: [f("CASH-1", "HIGH"), f("CASH-2", "HIGH"), f("TDS-1", "LOW")],
      draftCount: 3,
      recurringCount: 1,
      missingFacts: ["BRS obtained", "TDS returns filed"],
    });
    expect(items[0]).toEqual({ kind: "high_finding", label: "2 high-risk findings to review" });
    expect(items.find((i) => i.kind === "draft")?.label).toContain("3 draft queries");
    expect(items.find((i) => i.kind === "recurring")?.label).toContain("1 finding recurring");
    expect(items.filter((i) => i.kind === "missing_fact")).toHaveLength(2);
  });

  it("omits sections with nothing to show", () => {
    const items = attentionFeed({ findings: [], draftCount: 0, recurringCount: 0, missingFacts: [] });
    expect(items).toHaveLength(0);
  });

  it("caps missing-fact items at 5", () => {
    const items = attentionFeed({ findings: [], draftCount: 0, recurringCount: 0, missingFacts: ["a", "b", "c", "d", "e", "f", "g"] });
    expect(items.filter((i) => i.kind === "missing_fact")).toHaveLength(5);
  });
});
