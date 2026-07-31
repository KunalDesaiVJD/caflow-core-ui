import { describe, it, expect } from "vitest";
import { calcAutoInterest, computeApplied, isChallanFullyUtilised, computeAllocatable } from "./rateEngine";

/**
 * Regression: TdsDataEntry.tsx's "Unconsumed Amount" (and the underlying
 * Applied/Fully-Utilised badge) is computed from computeApplied(rows), which
 * sums each row's PERSISTED interest_amount column. But the grid's own
 * Interest cell is a read-only, always-LIVE calcAutoInterest tooltip that is
 * never sourced from that column — interest_amount is only ever written by
 * the per-cell edit handler, so a row that arrived via bulk import (Genius
 * Excel) and was never hand-edited afterward can sit at interest_amount 0
 * forever while the grid still shows a real, non-zero interest figure right
 * next to it.
 *
 * Pinned against a real challan (BSR 0002271, Challan 05069): two Genius-
 * imported deductees, TDS ₹560 each, deducted 2026-05-01, challan deposited
 * 2026-06-08 (one day past the 2026-06-07 due date → 2 late months → ₹17
 * interest each, ₹34 total) — exactly matching the challan's own declared
 * total_challan_amount of ₹1,154 (1,120 TDS + 34 interest). Both rows'
 * stored interest_amount was confirmed 0 in the database, so summing it
 * directly reported "Unconsumed Amount: ₹34" on a challan that was, in
 * truth, fully consumed.
 */

const TDS_ROW = { tds_amount: 560, total_tax_deducted: 560, date_of_payment: "2026-05-01", interest_amount: 0 };
const DEPOSIT_DATE = "2026-06-08"; // one day past the 2026-06-07 due date

describe("calcAutoInterest — pinned against the real Bindra/Revti-style late-deposit case", () => {
  it("computes ₹17 interest for a ₹560 TDS row deducted 2026-05-01, deposited 2026-06-08", () => {
    const { interest, lateMonths } = calcAutoInterest(560, "2026-05-01", DEPOSIT_DATE);
    expect(lateMonths).toBe(2);
    expect(interest).toBe(17);
  });

  it("is ₹0 when deposited on or before the due date (2026-06-07)", () => {
    expect(calcAutoInterest(560, "2026-05-01", "2026-06-07").interest).toBe(0);
  });
});

describe("computeApplied on rows with a live-recomputed interest_amount — the fix TdsDataEntry.tsx now applies", () => {
  it("naively summing the STORED interest_amount (0, unsynced from a bulk import) under-reports Applied and leaves a false Unconsumed balance", () => {
    const rows = [TDS_ROW, TDS_ROW];
    const { applied } = computeApplied(rows); // interest_amount is 0 on both — the bug, if nothing recomputes it
    const allocatable = computeAllocatable(1154, 0);
    expect(applied).toBe(1120); // 560 + 560, no interest
    expect(isChallanFullyUtilised(applied, allocatable)).toBe(false);
    expect(allocatable - applied).toBe(34); // the exact false "Unconsumed Amount" reported
  });

  it("mapping each row through calcAutoInterest before computeApplied (the actual fix) correctly reports the challan as fully consumed", () => {
    const rows = [TDS_ROW, TDS_ROW].map((d) => ({
      ...d,
      interest_amount: calcAutoInterest(d.tds_amount, d.date_of_payment, DEPOSIT_DATE).interest,
    }));
    const { applied, tds, interest } = computeApplied(rows);
    const allocatable = computeAllocatable(1154, 0);
    expect(tds).toBe(1120);
    expect(interest).toBe(34); // 17 + 17, now recovered
    expect(applied).toBe(1154);
    expect(isChallanFullyUtilised(applied, allocatable)).toBe(true);
    expect(Math.max(0, allocatable - applied)).toBe(0); // Unconsumed Amount is correctly ₹0
  });
});
