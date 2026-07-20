import { describe, it, expect } from "vitest";
import { proposeMateriality, basisFromTB, applyMateriality, roundMateriality } from "./materiality";

describe("proposeMateriality — scales to the entity, never decides for the auditor", () => {
  it("prefers turnover for a trading entity", () => {
    const p = proposeMateriality({ turnover: 120_000_000, totalAssets: 40_000_000 });
    expect(p.benchmark).toBe("turnover");
    expect(p.materiality).toBe(600_000); // 0.5% of 12cr
    expect(p.performance).toBe(360_000); // 60%
    expect(p.trivial).toBe(30_000);
  });

  it("falls back to total assets when there is no real turnover (holding entity)", () => {
    const p = proposeMateriality({ turnover: 0, totalAssets: 80_000_000 });
    expect(p.benchmark).toBe("total_assets");
    expect(p.materiality).toBe(800_000); // 1% of 8cr
  });

  // Owner-managed entities routinely run near break-even; scaling off profit would drive
  // materiality to nothing and flood the auditor with trivia.
  it("does not let a near-break-even profit collapse the threshold", () => {
    const p = proposeMateriality({ turnover: 50_000_000, profitBeforeTax: 12_000 });
    expect(p.benchmark).toBe("turnover");
    expect(p.materiality).toBeGreaterThan(100_000);
  });

  it("never proposes below the minimum reviewable floor", () => {
    const p = proposeMateriality({ turnover: 0, totalAssets: 0 });
    expect(p.benchmark).toBe("floor");
    expect(p.materiality).toBe(25_000);
    expect(p.rationale).toContain("Please set this");
  });

  it("rounds to a figure an auditor would actually write down", () => {
    expect(roundMateriality(617_432)).toBe(620_000);
    expect(roundMateriality(1_234_567)).toBe(1_200_000);
  });

  it("always explains where the number came from", () => {
    const p = proposeMateriality({ turnover: 120_000_000 });
    expect(p.rationale).toContain("0.5%");
    expect(p.rationale).toContain("turnover");
    expect(p.basis.turnover).toBe(120_000_000);
  });
});

describe("basisFromTB", () => {
  it("reads turnover from credit-side revenue heads and assets from debit-side asset heads", () => {
    const b = basisFromTB([
      { ledger_name: "Sales - Local", parent_group: "Sales Accounts", closing_balance: 9_000_000, balance_type: "Cr" },
      { ledger_name: "Job Work Income", parent_group: "Direct Incomes", closing_balance: 1_000_000, balance_type: "Cr" },
      { ledger_name: "HDFC Bank", parent_group: "Bank Accounts", closing_balance: 2_000_000, balance_type: "Dr" },
      { ledger_name: "Plant & Machinery", parent_group: "Fixed Assets", closing_balance: 5_000_000, balance_type: "Dr" },
      { ledger_name: "Rent", parent_group: "Indirect Expenses", closing_balance: 400_000, balance_type: "Dr" },
    ]);
    expect(b.turnover).toBe(10_000_000);
    expect(b.totalAssets).toBe(7_000_000);
  });
});

describe("applyMateriality — rewrites relative thresholds, and only when approved", () => {
  const rule = {
    rule_id: "DORM-201",
    detection_logic: {
      check: "no_movement",
      min_balance: 100_000,
      where: [{ field: "abs_closing", op: ">", value: 50_000 }],
      materiality: { "min_balance": 0.25, "where.0.value": 0.5 },
    } as Record<string, unknown>,
  };
  const values = { materiality: 600_000, performance: 360_000, trivial: 30_000 };

  it("substitutes multiples of performance materiality, including nested paths", () => {
    const out = applyMateriality(rule, values);
    const dl = out.detection_logic as Record<string, unknown>;
    expect(dl.min_balance).toBe(90_000);                                   // 0.25 x 360k
    expect((dl.where as Array<Record<string, unknown>>)[0].value).toBe(180_000); // 0.5 x 360k
  });

  // An engagement with no approved materiality must behave exactly as it does today, not go silent.
  it("leaves the literal thresholds untouched when nothing has been approved", () => {
    const out = applyMateriality(rule, null);
    const dl = out.detection_logic as Record<string, unknown>;
    expect(dl.min_balance).toBe(100_000);
    expect((dl.where as Array<Record<string, unknown>>)[0].value).toBe(50_000);
  });

  it("ignores rules that never opted in", () => {
    const plain = { rule_id: "X", detection_logic: { check: "no_movement", min_balance: 1_000 } };
    expect(applyMateriality(plain, values).detection_logic.min_balance).toBe(1_000);
  });

  it("does not mutate the rule it was given", () => {
    const before = JSON.stringify(rule.detection_logic);
    applyMateriality(rule, values);
    expect(JSON.stringify(rule.detection_logic)).toBe(before);
  });

  it("survives a path that does not exist rather than throwing", () => {
    const bad = { rule_id: "Y", detection_logic: { check: "no_movement", materiality: { "nope.0.deep": 1 } } };
    expect(() => applyMateriality(bad, values)).not.toThrow();
  });
});
