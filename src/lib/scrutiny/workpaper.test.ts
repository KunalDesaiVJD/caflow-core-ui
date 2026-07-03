import { describe, it, expect } from "vitest";
import { groupByLedger, ledgerConclusion, UNATTRIBUTED_LEDGER } from "./workpaper";
import type { Finding } from "./scrutinyUi";

const f = (over: Partial<Finding> & { id: string }): Finding => ({
  rule_id: "R",
  client_id: "c1",
  severity: "MEDIUM",
  clause_3cd: null,
  flag_message: "msg",
  status: "open",
  narration: "Cash",
  financial_year: "2024-25",
  ...over,
});

describe("groupByLedger", () => {
  const findings = [
    f({ id: "1", narration: "Cash", severity: "HIGH" }),
    f({ id: "2", narration: "Cash", severity: "LOW" }),
    f({ id: "3", narration: "Sundry Debtors", severity: "MEDIUM" }),
    f({ id: "4", narration: null, severity: "HIGH" }), // → Unattributed
    f({ id: "5", narration: "   ", severity: "LOW" }), // blank → Unattributed
  ];

  it("buckets by ledger, treating null/blank narration as Unattributed", () => {
    const groups = groupByLedger(findings);
    const byLedger = Object.fromEntries(groups.map((g) => [g.ledger, g]));
    expect(byLedger["Cash"].total).toBe(2);
    expect(byLedger["Cash"].high).toBe(1);
    expect(byLedger["Cash"].low).toBe(1);
    expect(byLedger["Sundry Debtors"].total).toBe(1);
    expect(byLedger[UNATTRIBUTED_LEDGER].total).toBe(2);
  });

  it("sorts highest-risk ledgers first and Unattributed last", () => {
    const order = groupByLedger(findings).map((g) => g.ledger);
    expect(order[0]).toBe("Cash"); // has the only named-ledger HIGH
    expect(order[order.length - 1]).toBe(UNATTRIBUTED_LEDGER);
  });

  it("returns an empty array for no findings", () => {
    expect(groupByLedger([])).toEqual([]);
  });
});

describe("ledgerConclusion", () => {
  it("summarises the exception count and severity mix", () => {
    const g = groupByLedger([
      f({ id: "1", narration: "Cash", severity: "HIGH" }),
      f({ id: "2", narration: "Cash", severity: "MEDIUM" }),
    ])[0];
    expect(ledgerConclusion(g)).toBe("2 exceptions noted (1 high, 1 medium) — review and raise queries as needed.");
  });

  it("uses the singular for a single exception", () => {
    const g = groupByLedger([f({ id: "1", narration: "Cash", severity: "LOW" })])[0];
    expect(ledgerConclusion(g)).toBe("1 exception noted (1 low) — review and raise queries as needed.");
  });
});
