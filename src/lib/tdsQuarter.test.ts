import { describe, it, expect } from "vitest";
import { financialYearToAssessmentYear, assessmentYearToFinancialYear } from "./tdsQuarter";

describe("financialYearToAssessmentYear / assessmentYearToFinancialYear — the ONE conversion", () => {
  // Genius files always state their period as an Assessment Year; every
  // screen that lets a user pick "the FY" needs the identical round-trip, or
  // a file for one financial year silently gets filed under the wrong one.
  it("Assessment Year is Financial Year + 1", () => {
    expect(financialYearToAssessmentYear("2024-25")).toBe("2025-26");
    expect(financialYearToAssessmentYear("2025-26")).toBe("2026-27");
  });

  it("round-trips both directions", () => {
    for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27", "2030-31"]) {
      const ay = financialYearToAssessmentYear(fy);
      expect(assessmentYearToFinancialYear(ay)).toBe(fy);
    }
  });

  it("matches the real incident: A.Y. 2025-26 on the file means FY 2024-25, not FY 2025-26", () => {
    // A client's challan (deposit date 07/08/2024 — unambiguously FY 2024-25)
    // was imported while FY 2025-26 was selected in the UI, because the
    // file's own "A.Y. 2025-26" reads, at a glance, like it already says the
    // right year.
    expect(assessmentYearToFinancialYear("2025-26")).toBe("2024-25");
    expect(assessmentYearToFinancialYear("2025-26")).not.toBe("2025-26");
  });
});
