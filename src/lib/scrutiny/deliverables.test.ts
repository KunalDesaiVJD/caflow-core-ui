import { describe, it, expect } from "vitest";
import { workpaperText, queryLetterText } from "./deliverables";
import type { Finding } from "./scrutinyUi";

const f = (rule: string, sev: string): Finding => ({
  id: rule + sev, rule_id: rule, client_id: "c1", severity: sev, clause_3cd: null,
  flag_message: "x", status: "open", narration: "L", financial_year: "2024-25",
});

describe("workpaperText", () => {
  const text = workpaperText({
    financialYear: "2024-25",
    totalRules: 119,
    autoChecked: 50,
    findings: [f("CASH-1", "HIGH"), f("CASH-2", "MEDIUM"), f("TDS-1", "LOW")],
    requiredCaptured: 7,
    requiredTotal: 11,
    missingFacts: ["BRS obtained"],
    raisedCount: 2,
  });

  it("includes scope, findings totals, categories, facts and conclusion", () => {
    expect(text).toContain("FY 2024-25");
    expect(text).toContain("50 of 119 checks auto-verified");
    expect(text).toContain("3 findings — 1 high, 1 medium, 1 low");
    expect(text).toContain("CASH: 2");
    expect(text).toContain("2 findings raised as client queries");
    expect(text).toContain("7 of 11 required judgment facts");
    expect(text).toContain("BRS obtained");
    expect(text).toContain("never blocks sign-off / UDIN");
  });

  it("reports a clean conclusion when there are no findings", () => {
    const t = workpaperText({ financialYear: "2024-25", totalRules: 119, autoChecked: 50, findings: [], requiredCaptured: 0, requiredTotal: 11, missingFacts: [], raisedCount: 0 });
    expect(t).toContain("No exceptions noted by the deterministic checks");
  });
});

describe("queryLetterText", () => {
  it("numbers the queries and includes the salutation/closing", () => {
    const t = queryLetterText([{ label: "CASH-002", text: "Explain the cash payment of ₹45,000." }], "2024-25");
    expect(t).toContain("Subject: Audit queries — FY 2024-25");
    expect(t).toContain("1. Explain the cash payment of ₹45,000.  [CASH-002]");
    expect(t).toContain("Yours faithfully");
  });

  it("handles the empty case", () => {
    expect(queryLetterText([], "2024-25")).toContain("No queries have been raised yet");
  });
});
