import { describe, it, expect } from "vitest";
import { inferClause, clauseFill, clause3cdExportText, type ClauseContext } from "./clause3cd";
import type { Finding } from "./scrutinyUi";

const f = (id: string, rule: string, flag: string, clause: string | null = null): Finding => ({
  id, rule_id: rule, client_id: "c1", severity: "HIGH", clause_3cd: clause,
  flag_message: flag, status: "open", narration: "L", financial_year: "2024-25",
});

describe("inferClause", () => {
  it("honours an explicit clause that is in the set", () => {
    expect(inferClause({ clause_3cd: "22", flagMessage: "anything" })).toBe("22");
    expect(inferClause({ clause_3cd: "99", legalReference: "Section 40A(3)" })).toBe("21(d)"); // 99 not in set → infer
  });

  it("infers from legal reference / keywords with correct precedence", () => {
    expect(inferClause({ legalReference: "Section 269ST" })).toBe("31(ba)");
    expect(inferClause({ legalReference: "Section 269T" })).toBe("31(b)");
    expect(inferClause({ legalReference: "Section 269SS" })).toBe("31(a)");
    expect(inferClause({ legalReference: "Section 40A(3)" })).toBe("21(d)");
    expect(inferClause({ flagMessage: "TDS not deducted u/s 40(a)" })).toBe("21(b)");
    expect(inferClause({ ruleName: "MSME 45-day dues (43B(h))" })).toBe("22");
    expect(inferClause({ ruleName: "TDS u/s 194C short deduction" })).toBe("34");
    expect(inferClause({ flagMessage: "capital expenditure charged to P&L" })).toBe("21(a)");
  });

  it("returns null when nothing matches", () => {
    expect(inferClause({ flagMessage: "unrelated observation" })).toBeNull();
  });
});

describe("clauseFill", () => {
  const findings = [
    f("1", "CASH-002", "Cash payment", "21(d)"),
    f("2", "TDS-1", "TDS u/s 194C not deducted"),
    f("3", "LOAN-1", "Loan accepted in cash 269SS"),
    f("4", "GEN-1", "unrelated"),
  ];
  const ctxFor = (x: Finding): ClauseContext => ({ clause_3cd: x.clause_3cd, rule_id: x.rule_id, flagMessage: x.flag_message });

  it("groups by clause in set order and counts mapped/unmapped", () => {
    const res = clauseFill(findings, ctxFor);
    expect(res.mapped).toBe(3);
    expect(res.unmapped).toBe(1);
    const codes = res.groups.map((g) => g.code);
    // groups follow CLAUSE_3CD_SET order: 21(d) (idx 2) → 31(a) (idx 4) → 34 (idx 7)
    expect(codes).toEqual(["21(d)", "31(a)", "34"]);
    expect(res.groups.find((g) => g.code === "21(d)")!.count).toBe(1);
  });
});

describe("clause3cdExportText", () => {
  it("renders a read-only text export with the no-write disclaimer", () => {
    const res = clauseFill([f("1", "CASH-002", "Cash payment ₹45,000", "21(d)")], (x) => ({ clause_3cd: x.clause_3cd, flagMessage: x.flag_message }));
    const text = clause3cdExportText(res);
    expect(text).toContain("Clause 21(d)");
    expect(text).toContain("₹45,000");
    expect(text).toContain("does NOT write into the live Form 3CD");
  });
});
