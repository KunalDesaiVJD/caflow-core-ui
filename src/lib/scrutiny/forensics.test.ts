import { describe, it, expect } from "vitest";
import { leadingDigit, benfordAnalysis, findDuplicates } from "./forensics";
import type { VoucherRow } from "./detectionEngine";

const v = (amount: number, voucher_date: string, party: string): VoucherRow => ({
  amount, voucher_date, party_ledger: party, dr_cr: "Dr", voucher_number: null, voucher_type: null, ledger_name: null, narration: null,
});

describe("leadingDigit", () => {
  it("returns the first significant digit, or null", () => {
    expect(leadingDigit(123)).toBe(1);
    expect(leadingDigit(9)).toBe(9);
    expect(leadingDigit(-450)).toBe(4);
    expect(leadingDigit(1000)).toBe(1);
    expect(leadingDigit(0)).toBeNull();
    expect(leadingDigit(0.5)).toBeNull();
    expect(leadingDigit(NaN)).toBeNull();
  });
});

describe("benfordAnalysis", () => {
  it("returns 9 digits with correct expected percentages", () => {
    const r = benfordAnalysis([10, 20, 30]);
    expect(r.digits).toHaveLength(9);
    expect(r.digits[0].expectedPct).toBeCloseTo(30.103, 2); // digit 1
    expect(r.digits[8].expectedPct).toBeCloseTo(4.576, 2); // digit 9
  });

  it("flags an insufficient sample (< 50)", () => {
    expect(benfordAnalysis([10, 20, 30]).verdict).toBe("insufficient");
    expect(benfordAnalysis([10, 20, 30]).total).toBe(3);
  });

  it("reports close conformance for a Benford-shaped sample", () => {
    const counts = [301, 176, 125, 97, 79, 67, 58, 51, 46]; // ~Benford proportions, n=1000
    const amounts: number[] = [];
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) amounts.push((i + 1) * 10); });
    const r = benfordAnalysis(amounts);
    expect(r.total).toBe(1000);
    expect(r.digits[0].observedPct).toBeCloseTo(30.1, 0);
    expect(r.verdict).toBe("close");
  });

  it("reports nonconformance for a skewed sample", () => {
    const amounts = Array.from({ length: 100 }, () => 90); // all leading digit 9
    expect(benfordAnalysis(amounts).verdict).toBe("nonconforming");
  });
});

describe("findDuplicates", () => {
  it("groups vouchers sharing amount + date + party", () => {
    const groups = findDuplicates([
      v(5000, "2024-05-01", "ABC Traders"),
      v(5000, "2024-05-01", "abc traders"), // same (case-insensitive) → duplicate
      v(5000, "2024-05-02", "ABC Traders"), // different date → not a duplicate
      v(700, "2024-05-01", "XYZ"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].amount).toBe(5000);
    expect(groups[0].party).toBe("ABC Traders");
  });

  it("respects minAmount and requires a date", () => {
    const rows = [
      v(100, "2024-05-01", "A"), v(100, "2024-05-01", "A"), // below threshold
      v(9000, "", "B"), v(9000, "", "B"), // no date
    ];
    expect(findDuplicates(rows, 1000)).toHaveLength(0);
  });

  it("sorts most-repeated (then largest) first", () => {
    const groups = findDuplicates([
      v(1000, "2024-05-01", "A"), v(1000, "2024-05-01", "A"),
      v(9000, "2024-05-02", "B"), v(9000, "2024-05-02", "B"), v(9000, "2024-05-02", "B"),
    ]);
    expect(groups[0].count).toBe(3); // the triple first
    expect(groups[1].count).toBe(2);
  });
});
