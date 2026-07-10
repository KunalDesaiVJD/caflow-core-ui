import { describe, it, expect } from "vitest";
import { rulePrecision, precisionSummary } from "./precision";
import type { Finding } from "./scrutinyUi";

const f = (rule: string, status: string): Finding => ({
  id: rule + status + Math.random(), rule_id: rule, client_id: "c1", severity: "MEDIUM", clause_3cd: null,
  flag_message: "x", status, narration: "L", financial_year: "2024-25",
});

// Rule A: 5 actioned, all real -> promote; B: mostly waived -> demote;
// C: half waived -> monitor; D: too few actioned -> insufficient.
const findings: Finding[] = [
  ...Array(4).fill(0).map(() => f("A", "queried")), f("A", "resolved"),
  f("B", "queried"), ...Array(5).fill(0).map(() => f("B", "waived")),
  ...Array(3).fill(0).map(() => f("C", "queried")), ...Array(3).fill(0).map(() => f("C", "waived")),
  f("D", "queried"), f("D", "waived"), f("D", "open"),
];

describe("rulePrecision", () => {
  it("computes per-rule disposition + precision + verdict", () => {
    const rows = rulePrecision(findings);
    const byId = Object.fromEntries(rows.map((r) => [r.rule_id, r]));
    expect(byId["A"].precision).toBe(1);
    expect(byId["A"].verdict).toBe("promote");
    expect(byId["B"].precision).toBeCloseTo(1 / 6, 3);
    expect(byId["B"].verdict).toBe("demote");
    expect(byId["C"].precision).toBe(0.5);
    expect(byId["C"].verdict).toBe("monitor");
    expect(byId["D"].verdict).toBe("insufficient"); // only 2 actioned (< 5)
    expect(byId["D"].open).toBe(1);
  });

  it("sorts demote candidates first", () => {
    const order = rulePrecision(findings).map((r) => r.rule_id);
    expect(order[0]).toBe("B"); // demote surfaced first
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("C")); // promote before monitor
    expect(order[order.length - 1]).toBe("D"); // insufficient last
  });

  it("ignores findings with no rule_id and reports null precision when nothing is actioned", () => {
    const rows = rulePrecision([f("", "queried"), f("Z", "open"), f("Z", "open")]);
    expect(rows.map((r) => r.rule_id)).toEqual(["Z"]);
    expect(rows[0].precision).toBeNull();
    expect(rows[0].verdict).toBe("insufficient");
  });
});

describe("precisionSummary", () => {
  it("counts rules by verdict", () => {
    const s = precisionSummary(rulePrecision(findings));
    expect(s).toEqual({ rules: 4, promote: 1, demote: 1, monitor: 1, insufficient: 1 });
  });
});
