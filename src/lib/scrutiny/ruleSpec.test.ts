import { describe, it, expect } from "vitest";
import { validateRule, KNOWN_CHECKS } from "./ruleSpec";

const base = {
  rule_id: "CASH-050",
  rule_name: "Cash payment over 10,000",
  category: "CASH",
  severity: "high",
  audit_query_template: "Cash {amount} on {date}",
};

describe("validateRule", () => {
  it("accepts a well-formed expr rule and marks it runnable", () => {
    const r = validateRule({
      ...base,
      detection_logic: { check: "expr", grain: "voucher", scope: { cash_only: true }, where: [{ field: "abs_amount", op: ">", value: 10000 }] },
    });
    expect(r.valid).toBe(true);
    expect(r.runnable).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("accepts a supported named check", () => {
    const r = validateRule({ ...base, detection_logic: { check: "single_txn", threshold: 10000 } });
    expect(r.valid).toBe(true);
    expect(r.runnable).toBe(true);
  });

  it("rejects an unknown check as not runnable", () => {
    const r = validateRule({ ...base, detection_logic: { check: "invent_something" } });
    expect(r.valid).toBe(false);
    expect(r.runnable).toBe(false);
    expect(r.errors.join(" ")).toMatch(/no engine handler/i);
  });

  it("flags a bad operator in a where condition", () => {
    const r = validateRule({ ...base, detection_logic: { check: "expr", where: [{ field: "amount", op: "≫", value: 1 }] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unknown operator/i);
  });

  it("requires a valid aggregate block on aggregate grain", () => {
    const r = validateRule({ ...base, detection_logic: { check: "expr", grain: "aggregate", aggregate: { by: [], fn: "avg" } } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/aggregate\.by|aggregate\.fn|having/i);
  });

  it("errors on missing required fields", () => {
    const r = validateRule({ detection_logic: { check: "expr" } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/rule_id/i);
    expect(r.errors.join(" ")).toMatch(/rule_name/i);
  });

  it("warns when a voucher-grain expr has no scope or where (would match everything)", () => {
    const r = validateRule({ ...base, detection_logic: { check: "expr", grain: "voucher" } });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/every voucher/i);
  });

  it("exposes the known-check registry (expr is included)", () => {
    expect(KNOWN_CHECKS.has("expr")).toBe(true);
    expect(KNOWN_CHECKS.has("single_txn")).toBe(true);
  });
});
