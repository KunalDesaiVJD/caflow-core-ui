import { describe, it, expect } from "vitest";
import {
  HANDLED_CHECK_KINDS,
  ruleCheckKind,
  isAutoChecked,
  groupByTemplate,
  groupByCategory,
  computeCoverage,
} from "./coverage";
import { TIER_A_CHECK_KINDS, TIER_B_CHECK_KINDS } from "./detectionEngine";
import type { Finding, RuleTemplate } from "./scrutinyUi";

// --- fixtures -------------------------------------------------------------

const rule = (over: Partial<RuleTemplate> & { rule_id: string }): RuleTemplate => ({
  rule_name: over.rule_id,
  category: "CASH",
  detection_logic: { check: "single_txn" },
  threshold_value: null,
  threshold_type: null,
  severity: "high",
  legal_reference: null,
  audit_query_template: null,
  is_active: true,
  ...over,
});

const finding = (over: Partial<Finding> & { id: string; rule_id: string }): Finding => ({
  client_id: "c1",
  severity: "HIGH",
  clause_3cd: null,
  flag_message: "flag",
  status: "open",
  narration: null,
  financial_year: "2024-25",
  ...over,
});

// --- HANDLED_CHECK_KINDS reuses the engine registry (no duplication) ------

describe("HANDLED_CHECK_KINDS", () => {
  it("is exactly the union of the engine's Tier A + Tier B kinds", () => {
    const expected = new Set([...TIER_A_CHECK_KINDS, ...TIER_B_CHECK_KINDS]);
    expect(HANDLED_CHECK_KINDS.size).toBe(expected.size);
    for (const k of expected) expect(HANDLED_CHECK_KINDS.has(k)).toBe(true);
  });

  it("recognises a few known handled kinds and rejects an unhandled one", () => {
    expect(HANDLED_CHECK_KINDS.has("single_txn")).toBe(true);
    expect(HANDLED_CHECK_KINDS.has("daily_max")).toBe(true);
    expect(HANDLED_CHECK_KINDS.has("py_comparison")).toBe(true);
    expect(HANDLED_CHECK_KINDS.has("ratio")).toBe(false); // Tier C — advisory
  });
});

describe("ruleCheckKind / isAutoChecked", () => {
  it("reads the check kind from an object or a JSON string", () => {
    expect(ruleCheckKind(rule({ rule_id: "A", detection_logic: { check: "daily_max" } }))).toBe("daily_max");
    expect(ruleCheckKind(rule({ rule_id: "B", detection_logic: '{"check":"single_txn"}' }))).toBe("single_txn");
    expect(ruleCheckKind(rule({ rule_id: "C", detection_logic: null }))).toBe("");
  });

  it("flags handled rules auto and unhandled rules advisory", () => {
    expect(isAutoChecked(rule({ rule_id: "A", detection_logic: { check: "single_txn" } }))).toBe(true);
    expect(isAutoChecked(rule({ rule_id: "B", detection_logic: { check: "ratio" } }))).toBe(false);
  });
});

// --- grouping -------------------------------------------------------------

describe("groupByTemplate", () => {
  const rules = [
    rule({ rule_id: "CASH-001", detection_logic: { check: "single_txn" } }), // auto + will have a hit
    rule({ rule_id: "CASH-002", detection_logic: { check: "daily_max" } }), // auto + no hit -> clean
    rule({ rule_id: "RATIO-001", detection_logic: { check: "ratio" }, category: "RATIO" }), // no handler -> advisory
  ];
  const findings = [
    finding({ id: "f1", rule_id: "CASH-001", severity: "HIGH" }),
    finding({ id: "f2", rule_id: "CASH-001", severity: "MEDIUM" }),
  ];

  it("joins findings to their rule and classifies status", () => {
    const groups = groupByTemplate(rules, findings);
    const byId = Object.fromEntries(groups.map((g) => [g.rule.rule_id, g]));

    expect(byId["CASH-001"].status).toBe("hits");
    expect(byId["CASH-001"].hitCount).toBe(2);
    expect(byId["CASH-001"].high).toBe(1);
    expect(byId["CASH-001"].medium).toBe(1);

    expect(byId["CASH-002"].status).toBe("clean"); // auto, ran, nothing found
    expect(byId["CASH-002"].hitCount).toBe(0);

    expect(byId["RATIO-001"].status).toBe("advisory"); // no engine handler
    expect(byId["RATIO-001"].auto).toBe(false);
  });

  it("ignores findings whose rule_id is absent", () => {
    const groups = groupByTemplate(rules, [finding({ id: "x", rule_id: "" })]);
    expect(groups.reduce((s, g) => s + g.hitCount, 0)).toBe(0);
  });
});

describe("groupByCategory + computeCoverage", () => {
  const rules = [
    rule({ rule_id: "CASH-001", category: "CASH", detection_logic: { check: "single_txn" } }),
    rule({ rule_id: "CASH-002", category: "CASH", detection_logic: { check: "daily_max" } }),
    rule({ rule_id: "RATIO-001", category: "RATIO", detection_logic: { check: "ratio" } }),
  ];
  const findings = [finding({ id: "f1", rule_id: "CASH-001", severity: "HIGH" })];
  const groups = groupByTemplate(rules, findings);

  it("rolls up categories busiest-first with correct counts", () => {
    const cats = groupByCategory(groups);
    expect(cats.map((c) => c.category)).toEqual(["CASH", "RATIO"]); // CASH has the hit
    const cash = cats[0];
    expect(cash.hitCount).toBe(1);
    expect(cash.autoCount).toBe(2);
    expect(cash.advisoryCount).toBe(0);
    expect(cash.cleanCount).toBe(1); // CASH-002
    expect(cats[1].advisoryCount).toBe(1); // RATIO-001
  });

  it("computes advisory coverage totals", () => {
    const cov = computeCoverage(groups);
    expect(cov).toEqual({ total: 3, auto: 2, advisory: 1, withHits: 1, totalHits: 1 });
  });
});
