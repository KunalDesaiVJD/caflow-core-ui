import { describe, it, expect } from "vitest";
import { evidencePackText, type EvidencePackInputs } from "./evidencePack";
import type { Finding } from "./scrutinyUi";

const F = (rule_id: string, severity: string): Finding => ({
  id: `${rule_id}-${severity}`,
  rule_id,
  client_id: "c1",
  severity,
  clause_3cd: null,
  flag_message: null,
  status: "open",
  narration: null,
  financial_year: "2024-25",
});

const base: EvidencePackInputs = {
  financialYear: "2024-25",
  findings: [F("CASH-01", "HIGH"), F("CASH-02", "MEDIUM"), F("GST-01", "LOW")],
  coverageAuto: 50,
  coverageTotal: 119,
  requiredCaptured: 3,
  requiredTotal: 5,
  missingFacts: ["Going concern basis", "Fixed asset additions"],
  relatedParties: [],
  raisedCount: 2,
  clauseGroups: [
    { code: "21(d)", label: "Amounts inadmissible u/s 40(a)", count: 1 },
    { code: "34", label: "TDS compliance", count: 2 },
  ],
};

describe("evidencePackText", () => {
  const text = evidencePackText(base);

  it("headers with the financial year", () => {
    expect(text).toContain("EVIDENCE PACK (FY 2024-25)");
  });

  it("reports coverage with the advisory remainder", () => {
    expect(text).toContain("50 of 119 checks auto-verified");
    expect(text).toContain("69 advisory");
    expect(text).toContain("never blocks sign-off / UDIN");
  });

  it("summarises findings by severity and category", () => {
    expect(text).toContain("3 findings — 1 high, 1 medium, 1 low");
    expect(text).toContain("CASH: 2 (1H / 1M / 0L)");
    expect(text).toContain("GST: 1 (0H / 0M / 1L)");
  });

  it("lists captured vs required facts and outstanding items", () => {
    expect(text).toContain("3 of 5 required judgment facts captured");
    expect(text).toContain("Outstanding: Going concern basis; Fixed asset additions.");
    expect(text).toContain("captured in the Facts & Judgment tab");
  });

  it("maps the 3CD clauses and states it does not write the live form", () => {
    expect(text).toContain("Clause 21(d) — Amounts inadmissible u/s 40(a): 1");
    expect(text).toContain("Clause 34 — TDS compliance: 2");
    expect(text).toContain("does not write the live Form 3CD");
  });

  it("reports raised queries and a findings-based conclusion", () => {
    expect(text).toContain("2 findings raised as client queries");
    expect(text).toContain("3 exceptions noted; 1 high-risk require attention");
  });

  it("names related parties when nominated", () => {
    const t = evidencePackText({ ...base, relatedParties: ["Acme Pvt Ltd", "Beta LLP"] });
    expect(t).toContain("Related parties nominated: Acme Pvt Ltd, Beta LLP.");
  });

  it("handles a clean engagement with no findings or clauses", () => {
    const t = evidencePackText({ ...base, findings: [], raisedCount: 0, clauseGroups: [] });
    expect(t).toContain("0 findings — 0 high, 0 medium, 0 low");
    expect(t).toContain("0 findings raised as client queries");
    expect(t).toContain("No findings mapped to the 3CD clause set.");
    expect(t).toContain("No exceptions noted by the deterministic checks");
  });
});
