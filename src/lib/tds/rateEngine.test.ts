import { describe, it, expect } from "vitest";
import { calcAutoInterest, allocateChallanInterest, withChallanInterest, computeApplied, isChallanFullyUtilised, isChallanOverApplied, computeAllocatable, withKasarVatav, computeChallanOverApplied, computeChallanPooled, getRateForSection, isSupersededSectionCode, is194CaDisabledFor, is194CbDisabledFor, PAN_4TH_CHAR_MAP, type RateEntry } from "./rateEngine";

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

describe("computeChallanOverApplied — the ONE definition, so TdsValidateFinalise.tsx's Stage-1 pre-flight gate agrees with TdsDataEntry.tsx's own 'Over-applied' badge", () => {
  // Reuses the real pinned challan from the top of this file: BSR 0002271,
  // Challan 05069, two ₹560 TDS rows deducted 2026-05-01, deposited
  // 2026-06-08 (2 late months → ₹17 interest each), total_challan_amount
  // ₹1,154 = 1,120 TDS + 34 interest — confirmed fully consumed, not over.
  const challan = { total_challan_amount: 1154, late_fees_234e: 0, kasar_vatav_amount: 0, deposit_date: DEPOSIT_DATE };

  it("is NOT over-applied when live-recomputed applied exactly equals allocatable (the real, fully-consumed challan)", () => {
    const { overApplied, effectiveApplied, allocatable } = computeChallanOverApplied(challan, [TDS_ROW, TDS_ROW]);
    expect(effectiveApplied).toBe(1154); // 1,120 TDS + 34 live-recomputed interest
    expect(allocatable).toBe(1154);
    expect(overApplied).toBe(false);
  });

  it("IS over-applied once one more deductee row is added beyond the challan's own total", () => {
    const { overApplied, effectiveApplied, allocatable } = computeChallanOverApplied(challan, [TDS_ROW, TDS_ROW, TDS_ROW]);
    expect(effectiveApplied).toBe(1730); // 1,680 TDS + 50 interest (3 × 16.80 = 50.40, rounded once on the challan)
    expect(allocatable).toBe(1154);
    expect(overApplied).toBe(true);
  });

  it("uses LIVE-recomputed interest, not each row's stale stored interest_amount — matching computeApplied's own fix above", () => {
    // Same rows as the "IS over-applied" case, but with interest_amount
    // wrongly left at 0 (as an un-touched bulk import would have it) — if
    // this function trusted the stored value instead of recomputing, it
    // would under-report applied as 1,680 (still over 1,154, so the verdict
    // happens to agree here) — the real risk is the FULLY-CONSUMED case
    // above, where trusting 0 would wrongly report NOT over-applied only by
    // accident of these particular numbers. Asserting the exact recomputed
    // total (not just the boolean) proves the live recompute actually ran.
    const staleRows = [TDS_ROW, TDS_ROW, TDS_ROW].map((d) => ({ ...d, interest_amount: 0 }));
    const { effectiveApplied } = computeChallanOverApplied(challan, staleRows);
    expect(effectiveApplied).toBe(1730); // NOT 1,680 — proves interest was recomputed, not trusted
  });

  it("Kasar-Vatav write-off folds into effectiveApplied, matching withKasarVatav's own rule", () => {
    const challanWithKasar = { ...challan, kasar_vatav_amount: 10 };
    const { overApplied, effectiveApplied } = computeChallanOverApplied(challanWithKasar, [TDS_ROW, TDS_ROW]);
    expect(effectiveApplied).toBe(1164); // 1,154 + 10 Kasar-Vatav
    expect(overApplied).toBe(true); // now exceeds the ₹1,154 allocatable
  });

  it("late fees (234E) POOL into effectiveApplied against the challan's raw total — the 2026-08-06 cross-utilization rule, not excluded from allocatable like computeAllocatable's own report-facing use", () => {
    // Same total (1200) as the challan being fully consumed by TDS+interest
    // (1154) + late fee (46) = exactly 1200 — no violation, because late fee
    // is now part of the pooled applied figure, not carved out of the ceiling.
    const challanWithLateFee = { ...challan, total_challan_amount: 1200, late_fees_234e: 46 };
    const { allocatable, effectiveApplied, overApplied } = computeChallanOverApplied(challanWithLateFee, [TDS_ROW, TDS_ROW]);
    expect(allocatable).toBe(1200); // the challan's RAW total — no more subtraction
    expect(effectiveApplied).toBe(1200); // 1,154 TDS+interest + 46 late fee, pooled
    expect(overApplied).toBe(false);
  });
});

describe("computeChallanPooled — cross-utilization between TDS, Interest, and Late Fee (firm instruction 2026-08-06)", () => {
  const BASE = { total_challan_amount: 5200, late_fees_234e: 0, kasar_vatav_amount: 0, deposit_date: "2026-06-08" };
  // Paid 2026-06-01 → due date 2026-07-07 → deposited 2026-06-08 is on time,
  // so calcAutoInterest contributes ₹0 and these fixtures stay round numbers.
  const ON_TIME = "2026-06-01";

  it("is valid as long as TDS+Interest+LateFee together stay within the total, regardless of how it's split", () => {
    // ₹4,800 TDS + ₹100 late fee = ₹4,900 pooled applied against a ₹5,200
    // challan — the user's own worked example (5,000/100/100 declared,
    // 4,800/90/10 used).
    const rows = [{ tds_amount: 4800, total_tax_deducted: 4800, date_of_payment: ON_TIME, interest_amount: 0 }];
    const r = computeChallanPooled({ ...BASE, late_fees_234e: 100 }, rows);
    expect(r.tds).toBe(4800);
    expect(r.lateFees).toBe(100);
    expect(r.effectiveApplied).toBe(4900);
    expect(r.allocatable).toBe(5200);
    expect(r.overApplied).toBe(false);
    expect(r.unconsumed).toBe(300);
  });

  it("no component is checked against its own individual share — only the pooled grand total matters", () => {
    // TDS alone (₹5,000) already exceeds what the OLD per-component mental
    // model would call "TDS's share" of a ₹5,200 challan carrying a ₹50 late
    // fee — but nothing in this rule ever compares a component to anything
    // but the shared pool, so it's valid as long as the total fits.
    const rows = [{ tds_amount: 5000, total_tax_deducted: 5000, date_of_payment: ON_TIME, interest_amount: 0 }];
    const r = computeChallanPooled({ ...BASE, late_fees_234e: 50 }, rows);
    expect(r.effectiveApplied).toBe(5050);
    expect(r.overApplied).toBe(false);
  });

  it("a genuinely over-applied challan is still correctly rejected", () => {
    const rows = [{ tds_amount: 5100, total_tax_deducted: 5100, date_of_payment: ON_TIME, interest_amount: 0 }];
    const r = computeChallanPooled({ ...BASE, late_fees_234e: 200 }, rows); // 5,100 + 200 = 5,300 > 5,200
    expect(r.effectiveApplied).toBe(5300);
    expect(r.overApplied).toBe(true);
    expect(r.unconsumed).toBe(0);
  });
});

describe("isSupersededSectionCode — the plain code once its (a)/(b) siblings exist", () => {
  const rateMaster: RateEntry[] = [
    { section_code: "194C", nature_of_payment: "Contractor / Sub-contractor", rate_individual: 1, rate_company: 2, rate_no_pan: 20, threshold_individual: 30000, threshold_company: 30000, effective_from: "2025-04-01", effective_to: null },
    { section_code: "194C(a)", nature_of_payment: "Contractor / Sub-contractor - Individual/HUF", rate_individual: 1, rate_company: 1, rate_no_pan: 20, threshold_individual: 30000, threshold_company: 30000, effective_from: "2026-04-01", effective_to: null },
    { section_code: "194C(b)", nature_of_payment: "Contractor / Sub-contractor - Others", rate_individual: 2, rate_company: 2, rate_no_pan: 20, threshold_individual: 30000, threshold_company: 30000, effective_from: "2026-04-01", effective_to: null },
    { section_code: "194J", nature_of_payment: "Professional/Technical", rate_individual: 10, rate_company: 10, rate_no_pan: 20, threshold_individual: 50000, threshold_company: 50000, effective_from: "2025-04-01", effective_to: null },
  ];

  it("flags the plain code once its (a)/(b) siblings exist in the same set", () => {
    expect(isSupersededSectionCode("194C", rateMaster)).toBe(true);
  });

  it("does not flag a plain code with no bifurcated siblings", () => {
    expect(isSupersededSectionCode("194J", rateMaster)).toBe(false);
  });

  it("never flags an (a)/(b) code itself — a suffixed code can't be 'superseded' by itself", () => {
    expect(isSupersededSectionCode("194C(a)", rateMaster)).toBe(false);
    expect(isSupersededSectionCode("194C(b)", rateMaster)).toBe(false);
  });
});

/**
 * 194C(a) (Individual/HUF, 1%) vs 194C(b) (Others, 2%) must be mutually
 * exclusive by deductee type in the UI — the real-world incident this closes
 * is a Ltd company entered under 194C(a), deducting at 1% instead of 2%.
 */
describe("is194CaDisabledFor / is194CbDisabledFor — 194C(a)/(b) mutual exclusivity by deductee type", () => {
  it("disables 194C(a) for a Company — the real-world bug", () => {
    expect(is194CaDisabledFor("Company")).toBe(true);
  });

  it("disables 194C(a) for every other definite non-Individual/HUF constitution too", () => {
    for (const type of ["Firm", "Firm/LLP", "LLP", "Trust", "AOP", "BOI", "Local Authority", "AJP", "Government"]) {
      expect(is194CaDisabledFor(type)).toBe(true);
    }
  });

  it("keeps 194C(a) enabled for Individual and HUF", () => {
    expect(is194CaDisabledFor("Individual")).toBe(false);
    expect(is194CaDisabledFor("HUF")).toBe(false);
  });

  it("disables 194C(b) for Individual or HUF", () => {
    expect(is194CbDisabledFor("Individual")).toBe(true);
    expect(is194CbDisabledFor("HUF")).toBe(true);
  });

  it("keeps 194C(b) enabled for Company/Firm/LLP/Trust/AOP", () => {
    for (const type of ["Company", "Firm", "LLP", "Trust", "AOP"]) expect(is194CbDisabledFor(type)).toBe(false);
  });

  it("'Non-Company' — the government's own Form 26Q status code — stays eligible for BOTH, disabled by neither", () => {
    // Ambiguous at this app's data-model level (could be a genuine Individual/
    // HUF, or a non-individual non-company) — 344 live rows rely on it
    // staying eligible for 194C(a) specifically; blocking it would be the
    // exact regression the original getRateForSection fix deliberately avoided.
    expect(is194CaDisabledFor("Non-Company")).toBe(false);
    expect(is194CbDisabledFor("Non-Company")).toBe(false);
  });

  it("neither side is disabled when the type is not yet known", () => {
    expect(is194CaDisabledFor(null)).toBe(false);
    expect(is194CaDisabledFor(undefined)).toBe(false);
    expect(is194CbDisabledFor(null)).toBe(false);
    expect(is194CbDisabledFor(undefined)).toBe(false);
  });
});

/**
 * All 10 CBDT-defined PAN 4th-character constitutions must resolve to a
 * deductee type — a missing entry silently left deductee_type unset (the
 * real-world "B" bug report), and "L" was wrongly mapped to "LLP" instead of
 * Local Authority (an LLP's actual 4th character is "F", shared with Firm).
 */
describe("PAN_4TH_CHAR_MAP — all 10 CBDT PAN constitution codes", () => {
  it("maps every official 4th-character code to its correct constitution", () => {
    expect(PAN_4TH_CHAR_MAP).toEqual({
      P: "Individual", C: "Company", H: "HUF", F: "Firm/LLP",
      A: "AOP", T: "Trust", B: "BOI", L: "Local Authority",
      J: "AJP", G: "Government",
    });
  });

  it("'L' is Local Authority, never LLP", () => {
    expect(PAN_4TH_CHAR_MAP.L).toBe("Local Authority");
    expect(PAN_4TH_CHAR_MAP.L).not.toBe("LLP");
  });

  it("'B' (Body of Individuals) resolves instead of being silently missing", () => {
    expect(PAN_4TH_CHAR_MAP.B).toBe("BOI");
  });

  it("'F' covers both Firm and LLP, since CBDT gives them the same PAN code", () => {
    expect(PAN_4TH_CHAR_MAP.F).toBe("Firm/LLP");
  });

  it("'J' (Artificial Juridical Person) and 'G' (Government) resolve instead of being missing", () => {
    expect(PAN_4TH_CHAR_MAP.J).toBe("AJP");
    expect(PAN_4TH_CHAR_MAP.G).toBe("Government");
  });
});

// Real challan: Shree Hari Infra, BSR 6390009 / 17768, deposited 31/08/2026,
// TDS ₹30,506, interest paid ₹915 (Genius). Every row is 2 months late.
// Rounding each row on its own gave ₹916 and a false "Over-applied ₹1".
describe("allocateChallanInterest — interest rounded once on the challan total (Genius)", () => {
  const DEP = "2026-08-31";
  const ROWS = [
    { tds: 5806, paymentDate: "2026-07-01" },   // 174.18
    { tds: 5000, paymentDate: "2026-07-07" },   // 150.00
    { tds: 19550, paymentDate: "2026-07-30" },  // 586.50
    { tds: 150, paymentDate: "2026-07-16" },    // 4.50
  ];

  it("totals ₹915 (30,506 × 1.5% × 2 = 915.18), not the ₹916 of per-row rounding", () => {
    const alloc = allocateChallanInterest(ROWS, DEP);
    expect(alloc.reduce((s, x) => s + x, 0)).toBe(915);
    const perRow = ROWS.reduce((s, r) => s + calcAutoInterest(r.tds, r.paymentDate, DEP).interest, 0);
    expect(perRow).toBe(916);
  });

  it("spreads the leftover rupee to the larger of the two half-rupee rows", () => {
    expect(allocateChallanInterest(ROWS, DEP)).toEqual([174, 150, 587, 4]);
  });

  it("makes the challan Fully Utilised at ₹31,421 (TDS 30,506 + interest 915)", () => {
    const deductees = ROWS.map((r) => ({ tds_amount: r.tds, total_tax_deducted: r.tds, date_of_payment: r.paymentDate }));
    const pooled = computeChallanPooled({ total_challan_amount: 31421, deposit_date: DEP }, deductees);
    expect(pooled.interest).toBe(915);
    expect(pooled.overApplied).toBe(false);
    expect(pooled.unconsumed).toBe(0);
  });

  it("a single-row challan gives exactly calcAutoInterest's own figure", () => {
    for (const r of ROWS) {
      expect(allocateChallanInterest([r], DEP)).toEqual([calcAutoInterest(r.tds, r.paymentDate, DEP).interest]);
    }
  });

  it("rows paid on time stay at ₹0 and never receive a leftover rupee", () => {
    const alloc = allocateChallanInterest([...ROWS, { tds: 9999, paymentDate: "2026-08-20" }], DEP);
    expect(alloc).toEqual([174, 150, 587, 4, 0]);
  });

  it("withChallanInterest sets interest_amount on each row", () => {
    const rows = withChallanInterest(ROWS.map((r) => ({ tds_amount: r.tds, date_of_payment: r.paymentDate })), DEP);
    expect(rows.map((r) => r.interest_amount)).toEqual([174, 150, 587, 4]);
  });
});
