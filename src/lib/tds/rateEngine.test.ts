import { describe, it, expect } from "vitest";
import { calcAutoInterest, computeApplied, isChallanFullyUtilised, isChallanOverApplied, computeAllocatable, withKasarVatav, getRateForSection, type RateEntry } from "./rateEngine";

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

/**
 * Second, independent regression: the SAME desync bug also lived in
 * TdsDataEntry.tsx's fetchCarryForwardChallans (the "Carried Forward"
 * candidate list on the Select Filing screen), autoMatchChallans (the
 * Auto-match toast), summaryStats (the page-level summary bar), and
 * TdsReports.tsx (the Genius export's over-applied guard + the Challan
 * Register's utilisation status) — each a SEPARATE hand-rolled
 * reimplementation of "applied", not the shared computeApplied(), so fixing
 * getChallanBreakdownAll alone didn't fix any of these.
 *
 * Pinned against a second real challan (BSR 6390009, Challan 18387, client
 * with TAN reflected in the report): two deductees, ₹2,28,233 and ₹11,219
 * TDS, both deducted in June 2024, challan deposited 2024-07-22 (2 late
 * months on the July 7 due date) — both rows' stored interest_amount was
 * confirmed 0 in the database, while the challan's own declared interest
 * total is ₹7,184. Before the fix, fetchCarryForwardChallans computed
 * unconsumed = 246,636 − 239,452 = 7,184 (over its 0.5 threshold), so this
 * FULLY UTILISED, zero-current-quarter-activity challan kept re-qualifying
 * as a Carry-Forward candidate every subsequent quarter — "why does this
 * show up, it was fully used last quarter and nothing changed this quarter".
 */
describe("computeApplied — second real case (₹2,46,636 challan, two large deductees)", () => {
  const DEDUCTEE_1 = { tds_amount: 228233, total_tax_deducted: 228233, date_of_payment: "2024-06-15" };
  const DEDUCTEE_2 = { tds_amount: 11219, total_tax_deducted: 11219, date_of_payment: "2024-06-30" };
  const CHALLAN_DEPOSIT_DATE = "2024-07-22"; // 2 late months on the 2024-07-07 due date
  const CHALLAN_TOTAL = 246636; // = 239452 TDS + 7184 interest, per the challan's own figures

  it("live interest for each row sums to the challan's own declared ₹7,184", () => {
    const i1 = calcAutoInterest(DEDUCTEE_1.tds_amount, DEDUCTEE_1.date_of_payment, CHALLAN_DEPOSIT_DATE).interest;
    const i2 = calcAutoInterest(DEDUCTEE_2.tds_amount, DEDUCTEE_2.date_of_payment, CHALLAN_DEPOSIT_DATE).interest;
    expect(i1).toBe(6847);
    expect(i2).toBe(337);
    expect(i1 + i2).toBe(7184);
  });

  it("naively trusting stored interest_amount (0, unsynced) reports a large false 'still available' balance", () => {
    const rows = [{ ...DEDUCTEE_1, interest_amount: 0 }, { ...DEDUCTEE_2, interest_amount: 0 }];
    const { applied } = computeApplied(rows);
    expect(applied).toBe(239452);
    expect(CHALLAN_TOTAL - applied).toBe(7184); // the exact false carry-forward balance reported
  });

  it("live-recomputed interest correctly reports the challan as fully consumed — nothing to carry forward", () => {
    const rows = [DEDUCTEE_1, DEDUCTEE_2].map((d) => ({
      ...d,
      interest_amount: calcAutoInterest(d.tds_amount, d.date_of_payment, CHALLAN_DEPOSIT_DATE).interest,
    }));
    const { applied } = computeApplied(rows);
    const allocatable = computeAllocatable(CHALLAN_TOTAL, 0);
    expect(applied).toBe(CHALLAN_TOTAL);
    expect(isChallanFullyUtilised(applied, allocatable)).toBe(true);
    // This is the exact "unconsumed > 0.5" gate fetchCarryForwardChallans
    // uses to decide whether a fully-utilised prior-quarter challan still
    // qualifies as a Carry-Forward candidate.
    expect(allocatable - applied).toBeLessThanOrEqual(0.5);
  });
});

/**
 * Kasar-Vatav (round-off/write-off): a small residual balance — ₹5, ₹10, a
 * stray ₹250 — left on a challan after every real deductee entry, with no
 * deductee to attach it to. withKasarVatav folds it into the "applied" figure
 * fed to isChallanFullyUtilised/isChallanOverApplied so the challan can close
 * out as Fully Utilised, WITHOUT inventing a fake deductee row and WITHOUT
 * inflating computeApplied's own tds/interest/surcharge breakdown (that must
 * keep reporting only what was actually deducted from deductees).
 */
describe("withKasarVatav", () => {
  it("adds the write-off on top of the real deductee-rows applied total", () => {
    expect(withKasarVatav(1120, 34)).toBe(1154);
  });

  it("treats a missing/zero amount as a no-op", () => {
    expect(withKasarVatav(1120, 0)).toBe(1120);
    expect(withKasarVatav(1120, null)).toBe(1120);
    expect(withKasarVatav(1120, undefined)).toBe(1120);
  });

  it("closes a ₹250-short challan to exactly Fully Utilised", () => {
    const rows = [{ tds_amount: 50000, total_tax_deducted: 50000 }];
    const { applied } = computeApplied(rows);
    const allocatable = computeAllocatable(50250, 0);
    // Before the write-off: genuinely short by ₹250, correctly Unconsumed.
    expect(isChallanFullyUtilised(applied, allocatable)).toBe(false);
    expect(allocatable - applied).toBe(250);
    // After recording a ₹250 Kasar-Vatav adjustment: reads as closed.
    const effectiveApplied = withKasarVatav(applied, 250);
    expect(isChallanFullyUtilised(effectiveApplied, allocatable)).toBe(true);
    expect(isChallanOverApplied(effectiveApplied, allocatable)).toBe(false);
  });

  it("a write-off capped exactly at the gap never reads as over-applied", () => {
    const rows = [{ tds_amount: 1000, total_tax_deducted: 1000 }];
    const { applied } = computeApplied(rows);
    const allocatable = computeAllocatable(1005, 0);
    const rawUnconsumed = allocatable - applied; // 5 — the max a caller should ever pass
    const effectiveApplied = withKasarVatav(applied, rawUnconsumed);
    expect(isChallanFullyUtilised(effectiveApplied, allocatable)).toBe(true);
    expect(isChallanOverApplied(effectiveApplied, allocatable)).toBe(false);
  });
});

/**
 * Regression: a real return deducted TDS at 1% under 194C(a) on a Ltd
 * company, instead of 2% under 194C(b) — accepted silently, with the rate
 * field LOCKED as "auto-computed" so there was no way to even notice.
 *
 * Root cause: the Section 393 reform split 194C into an Individual/HUF-only
 * variant (194C(a), 1%) and an Others variant (194C(b), 2%). The rate
 * master's 194C(a) row still has a rate_company column populated (schema
 * completeness, not a real combination) — getRateForSection blindly returned
 * it for a Company deductee. A company can never legitimately fall under an
 * "Individual/HUF" section; getRateForSection must refuse to hand back that
 * rate rather than confidently return a wrong number.
 */
describe("getRateForSection — an Individual/HUF-only section must never rate a non-individual deductee", () => {
  const SEC_194C_A: RateEntry = {
    section_code: "194C(a)", nature_of_payment: "Contractor / Sub-contractor - Individual/HUF",
    rate_individual: 1, rate_company: 1, rate_no_pan: 20,
    threshold_individual: 30000, threshold_company: 30000,
    effective_from: "2026-04-01", effective_to: null,
  };
  const SEC_194C_B: RateEntry = {
    section_code: "194C(b)", nature_of_payment: "Contractor / Sub-contractor - Others",
    rate_individual: 2, rate_company: 2, rate_no_pan: 20,
    threshold_individual: 30000, threshold_company: 30000,
    effective_from: "2026-04-01", effective_to: null,
  };
  const rateMaster = [SEC_194C_A, SEC_194C_B];

  it("refuses a rate for a Company under the Individual/HUF-only 194C(a) — the real-world bug", () => {
    const r = getRateForSection(rateMaster, "194C(a)", "Company", "2026-04-30");
    expect(r.rate).toBeNull();
    expect(r.rateFound).toBe(false);
    expect(r.sectionRestrictedToIndividual).toBe(true);
  });

  it("still correctly rates an Individual/HUF under 194C(a) at 1%", () => {
    const r = getRateForSection(rateMaster, "194C(a)", "Individual", "2026-04-30");
    expect(r.rate).toBe(1);
    expect(r.rateFound).toBe(true);
    expect(r.sectionRestrictedToIndividual).toBe(false);
  });

  it("correctly rates a Company under the sibling 194C(b) at 2% — the fix, not just the refusal", () => {
    const r = getRateForSection(rateMaster, "194C(b)", "Company", "2026-04-30");
    expect(r.rate).toBe(2);
    expect(r.rateFound).toBe(true);
    expect(r.sectionRestrictedToIndividual).toBe(false);
  });

  // "Non-Company" is the government's own Form 26Q status code (Genius
  // import maps status "02" to it — see genius-import.ts), and is this app's
  // long-standing, intentional stand-in for "gets the Individual/HUF rate" —
  // 344 live deductee rows depend on exactly this today. The guard must key
  // off the literal "Company" value, not "not an individual", or it would
  // newly misflag every one of those 344 correct rows instead of just the
  // 2 genuinely wrong "Company" ones this bug was pinned against.
  it("does NOT refuse 'Non-Company' — the pre-existing, correct stand-in for the individual/HUF rate", () => {
    const r = getRateForSection(rateMaster, "194C(a)", "Non-Company", "2026-04-30");
    expect(r.rate).toBe(1);
    expect(r.rateFound).toBe(true);
    expect(r.sectionRestrictedToIndividual).toBe(false);
  });
});
