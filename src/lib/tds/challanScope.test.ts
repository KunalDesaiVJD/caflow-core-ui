import { describe, it, expect } from "vitest";
import { countsAgainstChallan, rowsCountedAgainst } from "./challanScope";
import { pickReusableChallan } from "@/lib/genius-import";

describe("countsAgainstChallan — entries from before the challan's own quarter don't consume it", () => {
  const q2 = { quarter: "Q2", financial_year: "2026-27" };
  it("counts the challan's own quarter and later quarters (carry-forward)", () => {
    expect(countsAgainstChallan(q2, { quarter: "Q2", financial_year: "2026-27" })).toBe(true);
    expect(countsAgainstChallan(q2, { quarter: "Q3", financial_year: "2026-27" })).toBe(true);
    expect(countsAgainstChallan(q2, { quarter: "Q1", financial_year: "2027-28" })).toBe(true);
  });
  it("leaves out an earlier quarter's entries (24Q Q1 rows on a Q2 challan)", () => {
    expect(countsAgainstChallan(q2, { quarter: "Q1", financial_year: "2026-27" })).toBe(false);
    expect(countsAgainstChallan(q2, { quarter: "Q4", financial_year: "2025-26" })).toBe(false);
    const rows = [{ id: "a", quarter: "Q1", financial_year: "2026-27" }, { id: "b", quarter: "Q2", financial_year: "2026-27" }];
    expect(rowsCountedAgainst(q2, rows).map((r) => r.id)).toEqual(["b"]);
  });
  it("counts the row when either period is unknown", () => {
    expect(countsAgainstChallan({ quarter: null, financial_year: null }, { quarter: "Q1", financial_year: "2026-27" })).toBe(true);
    expect(countsAgainstChallan(q2, { quarter: null, financial_year: "2026-27" })).toBe(true);
    expect(countsAgainstChallan(null, { quarter: "Q1", financial_year: "2026-27" })).toBe(true);
  });
});

describe("pickReusableChallan — a serial number alone does not identify a challan", () => {
  const ref = (id: string, bsr: string | null, date: string | null) =>
    ({ id, quarter: "Q1", financial_year: "2026-27", form_type: "26Q", bsr_code: bsr, deposit_date: date });
  it("reuses only the challan with the same BSR and deposit date", () => {
    const list = [ref("other", "1009992", "2026-06-30"), ref("same", "0510002", "2026-07-07")];
    expect(pickReusableChallan(list, "0510002", "2026-07-07")?.id).toBe("same");
    expect(pickReusableChallan(list, "0510002", "2026-06-07")).toBeUndefined();
  });
  it("still matches an older row that has no BSR / date stored", () => {
    expect(pickReusableChallan([ref("old", null, null)], "0510002", "2026-07-07")?.id).toBe("old");
  });
});
