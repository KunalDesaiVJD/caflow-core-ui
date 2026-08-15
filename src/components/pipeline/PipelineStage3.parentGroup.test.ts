import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { matchParentGroup, PARENT_GROUP_MAP_NCE, PARENT_GROUP_MAP_CORP } from "@/components/pipeline/PipelineStage3";

// Regression for the reported "TB sub-group is not coming through in COA
// Mapping ... ledgers show in a haphazard manner" bug. Root cause: Tally's
// "Outstanding Expenses" / "Outstanding Salary" / "Outstanding For Labour"
// sub-groups (visible in the Tally Sync trial balance, nested under Current
// Liabilities) had no PARENT_GROUP_MAP_NCE/_CORP entry, so ledgers in them
// skipped the high-confidence, group-aware tier-1 auto-mapping and fell
// through to tier-2 ledger-NAME keyword rules — which can route a genuine
// Balance Sheet payable to a P&L code purely because of a coincidental word
// match (e.g. "Salary Payable" keyword-matching "salary" -> Employee
// Benefits Expense instead of Other Current Liabilities).
describe("PipelineStage3 — outstanding-expense sub-groups route to Other Current Liabilities", () => {
  const cases: Array<[string, string]> = [
    ["Outstanding Expenses",     "Electricity Expenses Payable"],
    ["Outstanding Salary",       "Salary Payable"],
    ["Outstanding For Labour",   "Labour Charges Payable"],
  ];

  for (const [group] of cases) {
    it(`NCE: "${group}" parent_group maps to Other Current Liabilities (NCE_OCL), not a P&L code`, () => {
      const hit = matchParentGroup(group, PARENT_GROUP_MAP_NCE);
      expect(hit?.code).toBe("NCE_OCL");
      expect(hit?.confidence).toBe("high");
    });

    it(`Corporate: "${group}" parent_group maps to Other Current Liabilities (BS_CL_OCL), not a P&L code`, () => {
      const hit = matchParentGroup(group, PARENT_GROUP_MAP_CORP);
      expect(hit?.code).toBe("BS_CL_OCL");
      expect(hit?.confidence).toBe("high");
    });
  }

  it("still matches the pre-existing 'Duties & Taxes' sub-group unchanged (no regression to the working case)", () => {
    expect(matchParentGroup("Duties & Taxes", PARENT_GROUP_MAP_NCE)?.code).toBe("NCE_OCL");
    expect(matchParentGroup("Sundry Creditors", PARENT_GROUP_MAP_NCE)?.code).toBe("NCE_TP");
  });
});
