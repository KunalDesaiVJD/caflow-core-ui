import { describe, it, expect } from "vitest";
import { reconcile, entriesFromVouchers, entriesFromRows, keyFor, type ReconEntry } from "./reconcile";
import type { VoucherRow } from "./detectionEngine";

const e = (key: string, amount: number, label = ""): ReconEntry => ({ key, amount, label });

describe("reconcile", () => {
  it("splits into matched / only-external / only-book with totals", () => {
    const r = reconcile(
      [e("100", 1000), e("200", 2000)],
      [e("100", 1000), e("300", 3000)],
    );
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].external.key).toBe("100");
    expect(r.onlyExternal.map((x) => x.key)).toEqual(["200"]);
    expect(r.onlyBook.map((x) => x.key)).toEqual(["300"]);
    expect(r.externalTotal).toBe(3000);
    expect(r.bookTotal).toBe(4000);
    expect(r.matchedTotal).toBe(1000);
  });

  it("matches duplicates one-to-one", () => {
    const r = reconcile([e("50", 500), e("50", 500)], [e("50", 500)]);
    expect(r.matched).toHaveLength(1);
    expect(r.onlyExternal).toHaveLength(1); // the second external 50 has no book match
    expect(r.onlyBook).toHaveLength(0);
  });
});

describe("keyFor", () => {
  it("keys by rounded amount, optionally with date", () => {
    expect(keyFor(1000.004, "2024-05-01", "amount")).toBe("100000");
    expect(keyFor(1000, "2024-05-01", "amount_date")).toBe("100000|2024-05-01");
  });
});

describe("entriesFromVouchers", () => {
  const vs: VoucherRow[] = [
    { amount: 1500, dr_cr: "Dr", voucher_date: "2024-05-01", party_ledger: "ABC", ledger_name: "Bank", voucher_number: "P1", voucher_type: null, narration: null },
    { amount: 0, dr_cr: "Dr", voucher_date: "2024-05-01", party_ledger: "X", ledger_name: "Bank", voucher_number: null, voucher_type: null, narration: null },
  ];
  it("maps non-zero vouchers to entries and skips zero amounts", () => {
    expect(entriesFromVouchers(vs, "amount")).toEqual([{ key: "150000", amount: 1500, label: "2024-05-01 · ABC · P1" }]);
    expect(entriesFromVouchers(vs, "amount_date")[0].key).toBe("150000|2024-05-01");
  });
});

describe("entriesFromRows (best-effort column detection)", () => {
  it("finds amount + date from varied headers and strips ₹/commas", () => {
    const rows = [
      { "Invoice Date": "2024-05-01", "Supplier GSTIN": "27ABC", "Invoice Value": "1,500.00" },
      { "Txn Date": "2024-05-02", "Narration": "NEFT", "Amount": "₹2,000" },
      { "Description": "junk with no number" },
    ];
    const entries = entriesFromRows(rows, "amount");
    expect(entries).toHaveLength(2); // junk row skipped
    expect(entries[0]).toEqual({ key: "150000", amount: 1500, label: "2024-05-01 · 27ABC" });
    expect(entries[1].amount).toBe(2000);
  });

  it("round-trips against book entries via reconcile", () => {
    const book = entriesFromVouchers(
      [{ amount: 1500, dr_cr: "Dr", voucher_date: "2024-05-01", party_ledger: "ABC", ledger_name: "Bank", voucher_number: null, voucher_type: null, narration: null }],
      "amount",
    );
    const external = entriesFromRows([{ "Invoice Value": "1500" }], "amount");
    const r = reconcile(external, book);
    expect(r.matched).toHaveLength(1);
  });
});
