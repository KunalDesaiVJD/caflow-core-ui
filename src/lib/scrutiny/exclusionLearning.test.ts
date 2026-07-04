import { describe, it, expect } from "vitest";
import { exclusionKey, buildExclusionSet, matchExclusions, type PriorWaived } from "./exclusionLearning";
import type { Finding } from "./scrutinyUi";

const f = (id: string, rule: string, narration: string): Finding => ({
  id, rule_id: rule, client_id: "c1", severity: "MEDIUM", clause_3cd: null,
  flag_message: "x", status: "open", narration, financial_year: "2024-25",
});

describe("exclusionKey", () => {
  it("normalises rule + ledger", () => {
    expect(exclusionKey("CASH-002", " Cash-in-Hand ")).toBe("cash-002|cash-in-hand");
    expect(exclusionKey(null, null)).toBe("|");
  });
});

describe("buildExclusionSet", () => {
  const prior: PriorWaived[] = [
    { rule_id: "CASH-002", narration: "Cash-in-Hand", financial_year: "2023-24" },
    { rule_id: "CASH-002", narration: "Cash-in-Hand", financial_year: "2024-25" }, // current FY — excluded
    { rule_id: null, narration: null, financial_year: "2023-24" }, // empty — skipped
  ];

  it("learns only from other periods and dedups/skips empties", () => {
    const set = buildExclusionSet(prior, "2024-25");
    expect(set.has("cash-002|cash-in-hand")).toBe(true);
    expect(set.has("|")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("without excludeFy, includes every period", () => {
    expect(buildExclusionSet(prior).size).toBe(1); // both CASH-002 rows dedupe to one key
  });
});

describe("matchExclusions", () => {
  it("flags findings that recur from a prior-period waiver", () => {
    const set = buildExclusionSet(
      [{ rule_id: "CASH-002", narration: "Cash-in-Hand", financial_year: "2023-24" }],
      "2024-25",
    );
    const flags = matchExclusions(
      [f("1", "CASH-002", "Cash-in-Hand"), f("2", "TDS-194C", "Freight")],
      set,
    );
    expect(flags["1"]).toBe(true);
    expect(flags["2"]).toBeUndefined();
  });

  it("returns {} when there are no exclusions", () => {
    expect(matchExclusions([f("1", "CASH-002", "Cash")], new Set())).toEqual({});
  });
});
