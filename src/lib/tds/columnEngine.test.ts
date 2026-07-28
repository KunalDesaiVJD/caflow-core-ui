import { describe, it, expect } from "vitest";
import { explodeMonthlyColumns, resolveMapping, buildCanonicalRow } from "./columnEngine";

// Real client file (MICROCIRCUITS INNOVATIONS PVT LTD, 24Q Q1 FY 2026-27) —
// reported bug: Stage 1 showed 0/70 matched despite PAN overlap on both
// sides. Root cause: the "SALARY" sheet is one row per employee with a
// repeating {APRIL, APRIL - BONUS, APRIL-TDS, MAY, ...} column group per
// calendar month for the whole year — resolveMapping's engine is fundamentally
// row-per-transaction, so its ratio-based fallback locked onto ONE arbitrary
// month's columns (or the annual TOTAL) for the entire file, silently
// discarding the filing's own Apr/May/Jun figures for every employee.
const SALARY_HEADER = [
  "SR NO", "PAN", "SALARY ",
  "APRIL", "APRIL - BONUS", "APRIL-TDS",
  "MAY", "MAY - BONUS", "MAY-TDS",
  "JUNE", "JUN - BONUS", "JUN-TDS",
  "July", "JULY- BONUS", "July-TDS",
  "TOTAL SALARY", "TOTAL  TDS", "TOTAL BOUNS",
];
function rowFrom(values: unknown[]): Record<string, unknown> {
  return Object.fromEntries(SALARY_HEADER.map((h, i) => [h, values[i]]));
}
const SALARY_ROWS = [
  rowFrom([1, "ACOPP5720C", "Madhukant Kanjibhai Patel - Salary", 200000, 0, 19800, 200000, 0, 19800, 200000, 0, 19800, "", "", "", 600000, 59400, 0]),
  rowFrom([2, "ANMPP3375Q", "Nirmitkumar Madhukant Patel - Salary", 350000, 0, 34800, 350000, 0, 34800, 350000, 0, 34800, "", "", "", 1050000, 104400, 0]),
  // A bonus-only employee, and one with no April activity at all (July starter).
  rowFrom([3, "BZDPT4273P", "Nevil Thummar - Salary", 31372, 20000, 0, 31372, 20000, 0, 31372, 20000, 0, 0, 0, 0, 94116, 0, 60000]),
];

describe("explodeMonthlyColumns — repeating per-month layout", () => {
  it("is a no-op when fewer than 2 distinct months are present (e.g. a normal single-pair file)", () => {
    const rows = [{ "Party Name": "X", "PAN": "ABCDE1234F", "Amount Paid": 1000, "TDS Amount": 100 }];
    expect(explodeMonthlyColumns(rows, "Q1", "2026-27")).toBe(rows);
  });

  it("is a no-op when the quarter/financial year is missing or unrecognised", () => {
    expect(explodeMonthlyColumns(SALARY_ROWS, null, "2026-27")).toBe(SALARY_ROWS);
    expect(explodeMonthlyColumns(SALARY_ROWS, "Q9", "2026-27")).toBe(SALARY_ROWS);
  });

  it("explodes each employee into one row per month of the filing's quarter (Q1 = Apr/May/Jun)", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    // 3 employees × 3 months = 9 rows (Nevil has activity every month too).
    expect(exploded).toHaveLength(9);
    const madhukant = exploded.filter((r) => r.PAN === "ACOPP5720C");
    expect(madhukant).toHaveLength(3);
    for (const r of madhukant) {
      expect(r.amount_paid).toBe(200000);
      expect(r.tds_amount).toBe(19800);
    }
    // Dates land inside FY 2026-27's April/May/June 2026.
    expect(madhukant.map((r) => r.date_of_payment).sort()).toEqual(["2026-04-30", "2026-05-31", "2026-06-30"]);
  });

  it("adds bonus into amount_paid but keeps TDS as its own column", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    const nevil = exploded.filter((r) => r.PAN === "BZDPT4273P");
    expect(nevil).toHaveLength(3);
    for (const r of nevil) { expect(r.amount_paid).toBe(51372); expect(r.tds_amount).toBe(0); }
  });

  it("drops the annual TOTAL columns so they never compete as a spurious extra money candidate", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    for (const r of exploded) {
      expect(r).not.toHaveProperty("TOTAL SALARY");
      expect(r).not.toHaveProperty("TOTAL  TDS");
      expect(r).not.toHaveProperty("TOTAL BOUNS");
    }
  });

  it("leaves a row from a DIFFERENT, non-monthly sheet completely untouched", () => {
    const otherSheetRow = { "Vendor Name": "ABC Traders", "PAN": "ZYXWV9876G", "Bill Amount": 50000, "TDS": 500 };
    const mixed = [...SALARY_ROWS, otherSheetRow];
    const exploded = explodeMonthlyColumns(mixed, "Q1", "2026-27");
    expect(exploded).toContainEqual(otherSheetRow);
  });

  it("end-to-end: resolveMapping + buildCanonicalRow now correctly resolve amount_paid/tds_amount/date_of_payment for every employee", () => {
    const exploded = explodeMonthlyColumns(SALARY_ROWS, "Q1", "2026-27");
    const { map, report } = resolveMapping(exploded);
    expect(report.amount_paid?.header).toBe("amount_paid");
    expect(report.tds_amount?.header).toBe("tds_amount");
    expect(report.date_of_payment?.header).toBe("date_of_payment");
    expect(report.pan?.header).toBe("PAN");

    const built = exploded.map((r) => buildCanonicalRow(r, map));
    const madhukantApril = built.find((r) => r.pan === "ACOPP5720C" && r.date_of_payment === "2026-04-30");
    expect(madhukantApril).toMatchObject({ amount_paid: 200000, tds_amount: 19800, deductee_name: "Madhukant Kanjibhai Patel - Salary" });
  });
});
