import { describe, it, expect } from "vitest";
import {
  FACT_CATALOGUE,
  factGateStatus,
  groupFactsByCategory,
  isCaptured,
  type CapturedFacts,
} from "./facts";

describe("FACT_CATALOGUE", () => {
  it("has ~30 facts with unique keys and valid types", () => {
    expect(FACT_CATALOGUE.length).toBeGreaterThanOrEqual(30);
    const keys = FACT_CATALOGUE.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length); // unique
    for (const f of FACT_CATALOGUE) {
      expect(["boolean", "text", "select"]).toContain(f.type);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it("marks several facts as required (Gate-4 set is non-trivial)", () => {
    const required = FACT_CATALOGUE.filter((f) => f.required);
    expect(required.length).toBeGreaterThanOrEqual(8);
  });
});

describe("isCaptured", () => {
  it("treats non-blank strings as captured", () => {
    expect(isCaptured("yes")).toBe(true);
    expect(isCaptured("")).toBe(false);
    expect(isCaptured("   ")).toBe(false);
    expect(isCaptured(undefined)).toBe(false);
    expect(isCaptured(null)).toBe(false);
  });
});

describe("factGateStatus (advisory)", () => {
  it("counts captured + required-missing", () => {
    const captured: CapturedFacts = { rp_exist: "yes", cash_verified: "no" };
    const gate = factGateStatus(FACT_CATALOGUE, captured);
    expect(gate.total).toBe(FACT_CATALOGUE.length);
    expect(gate.captured).toBe(2);
    expect(gate.requiredTotal).toBe(FACT_CATALOGUE.filter((f) => f.required).length);
    expect(gate.requiredCaptured).toBe(2); // rp_exist + cash_verified are required
    expect(gate.missing.every((f) => f.required)).toBe(true);
    expect(gate.missing.find((f) => f.key === "rp_exist")).toBeUndefined(); // captured
  });

  it("reports all required missing when nothing captured", () => {
    const gate = factGateStatus(FACT_CATALOGUE, {});
    expect(gate.captured).toBe(0);
    expect(gate.requiredCaptured).toBe(0);
    expect(gate.missing.length).toBe(gate.requiredTotal);
  });
});

describe("groupFactsByCategory", () => {
  it("groups every fact under a category, preserving order", () => {
    const groups = groupFactsByCategory(FACT_CATALOGUE);
    const flat = groups.flatMap((g) => g.facts);
    expect(flat.length).toBe(FACT_CATALOGUE.length);
    expect(groups[0].category).toBe("Related Parties");
    expect(groups.map((g) => g.category)).toContain("MSME & Vendors");
  });
});
