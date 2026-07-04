import { describe, it, expect } from "vitest";
import { rolloverPlan, priorFyOf, isCarryEligible, type FactStoreRow } from "./rollover";

const g = (fact_key: string, fact_value: string | null): FactStoreRow => ({ fact_type: "general", fact_key, fact_value });
const rp = (name: string): FactStoreRow => ({ fact_type: "related_party", fact_key: name, fact_value: "nominated" });

describe("isCarryEligible", () => {
  it("carries RP nominations and standing general facts, not annual ones or certificates", () => {
    expect(isCarryEligible(rp("Acme"))).toBe(true);
    expect(isCarryEligible(g("rp_exist", "yes"))).toBe(true);
    expect(isCarryEligible(g("msme_udyam_no", "UDYAM-1"))).toBe(true);
    expect(isCarryEligible(g("cash_verified", "yes"))).toBe(false);
    expect(isCarryEligible(g("gst_reconciled", "yes"))).toBe(false);
    expect(isCarryEligible({ fact_type: "certificate", fact_key: "MRL", fact_value: "obtained" })).toBe(false);
  });
});

describe("rolloverPlan", () => {
  it("carries standing facts + RP nominations that are new to the current year", () => {
    const prior: FactStoreRow[] = [
      g("rp_exist", "yes"),
      g("loans_directors", "yes"),
      g("cash_verified", "yes"), // annual → ignored
      g("udin_generated", "yes"), // annual → ignored
      rp("Acme Pvt Ltd"),
      rp("Beta LLP"),
    ];
    const plan = rolloverPlan(prior, []);
    expect(plan.toApply.map((i) => i.fact_key).sort()).toEqual(["Acme Pvt Ltd", "Beta LLP", "loans_directors", "rp_exist"]);
    expect(plan.toApply.every((i) => i.status === "new")).toBe(true);
    expect(plan.alreadySet).toBe(0);
  });

  it("does not overwrite facts already captured this year", () => {
    const prior: FactStoreRow[] = [g("rp_exist", "yes"), g("loans_directors", "no"), rp("Acme")];
    const current: FactStoreRow[] = [g("rp_exist", "no"), rp("Acme")]; // both already present
    const plan = rolloverPlan(prior, current);
    expect(plan.alreadySet).toBe(2);
    expect(plan.toApply.map((i) => i.fact_key)).toEqual(["loans_directors"]);
    // preserves the PRIOR value on the carried item
    expect(plan.toApply[0].fact_value).toBe("no");
  });

  it("skips prior facts with an empty value and dedups repeats", () => {
    const prior: FactStoreRow[] = [g("rp_exist", ""), g("rp_exist", "yes"), g("msme_udyam_no", null)];
    const plan = rolloverPlan(prior, []);
    expect(plan.toApply.map((i) => i.fact_key)).toEqual(["rp_exist"]);
  });

  it("orders general facts before related parties", () => {
    const prior: FactStoreRow[] = [rp("Zeta"), g("rp_exist", "yes")];
    const plan = rolloverPlan(prior, []);
    expect(plan.eligible.map((i) => i.fact_type)).toEqual(["general", "related_party"]);
  });

  it("returns an empty plan when there is nothing to carry", () => {
    expect(rolloverPlan([], []).toApply).toHaveLength(0);
    expect(rolloverPlan([g("cash_verified", "yes")], []).toApply).toHaveLength(0);
  });
});

describe("priorFyOf", () => {
  it("returns the greatest FY earlier than the current one", () => {
    expect(priorFyOf(["2022-23", "2023-24", "2024-25"], "2024-25")).toBe("2023-24");
  });
  it("ignores the current and any later years", () => {
    expect(priorFyOf(["2024-25", "2025-26"], "2024-25")).toBe(null);
  });
  it("returns null when no prior year exists", () => {
    expect(priorFyOf([], "2024-25")).toBe(null);
  });
});
