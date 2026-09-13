import { describe, it, expect } from "vitest";
import {
  computeForm141ScheduleB,
  evaluateThreshold,
  resolveRate,
  amountLiableForInstalment,
  computeInterest,
  computeLateFee,
  type Form141Deal,
  type Form141Seller,
} from "./form141ScheduleB";
import { taxYearForDate, monthOfDeduction, form141DueDate, monthsOrPartLate, daysLate } from "./form141";

/**
 * Pinned against a REAL filed Form 141 Schedule B and its paired challan
 * receipt — Acknowledgement BTA0188370, CIN 26090200117177ICIC, Tax Year
 * 2026-27, filed and deposited 02-Sep-2026, BSR 6390009, challan 07718.
 *
 * The statement: LAND at Kadadra, Taluka Dehgam, total sale consideration and
 * stamp duty value both ₹2,56,00,000, payment marked Lumpsum, two buyers at
 * 50% each and two sellers at 50% each. The filing buyer's own obligation is
 * therefore ₹1,28,00,000 — ₹64,00,000 to each seller — and the tax is
 * ₹64,000 per seller, ₹1,28,000 in total, with nil interest and nil fee.
 * Every one of those figures is asserted below.
 *
 * ── The row-1 defect this fixture deliberately encodes ────────────────────
 *
 * The FILED statement prints, for seller 1, "Amount paid or credited in
 * present instalment ₹6,40,000" against an "Amount on which tax is liable to
 * be deducted" of ₹64,00,000 — a dropped zero. Seller 2's row is correct at
 * ₹64,00,000. The tax paid was right either way, and the portal accepted the
 * statement regardless, so the money is fine and the STATEMENT is wrong: that
 * figure is what the seller sees and what an officer reads back later.
 *
 * The engine cannot reproduce that error, because it derives the present
 * instalment from the amount paid and the seller's share rather than taking
 * it as input — which is the assertion below. Catching the same defect in a
 * hand-keyed or extracted figure is form141Validate.ts's job.
 */

const RESIDENT_SELLER = (over: Partial<Form141Seller>): Form141Seller => ({
  pan: "AAAPA0000A",
  name: "Seller",
  sharePct: 50,
  residentialStatus: "resident",
  ...over,
});

/** The real transaction behind BTA0188370. PANs masked in the last four. */
const FILING_BUYER = "ADFPB0000E";

const SAMPLE_DEAL: Form141Deal = {
  propertyType: "LAND",
  propertyAddress:
    "KHATA NO- 1349, SR/BLOCK NO- 723/2, MOJE GAM- KADADRA, TALUKA- DEHGAM, GANDHI NAGAR, Gujarat 382305",
  dateOfAgreement: "2026-09-02",
  totalSaleConsideration: 25600000,
  totalStampDutyValue: 25600000,
  paymentMode: "lumpsum",
  buyers: [
    { pan: FILING_BUYER, name: "Buyer One", sharePct: 50 },
    { pan: "ACTPP0000E", name: "Buyer Two", sharePct: 50 },
  ],
  sellers: [
    RESIDENT_SELLER({ pan: "ANRPP0000R", name: "Seller One" }),
    RESIDENT_SELLER({ pan: "CBNPM0000M", name: "Seller Two" }),
  ],
  instalments: [
    {
      seq: 1,
      amountPaidByBuyer: 12800000,
      datePaidOrCredited: "2026-09-02",
      dateOfDeduction: "2026-09-02",
      dateOfDeposit: "2026-09-02",
      dateOfFiling: "2026-09-02",
    },
  ],
};

describe("Form 141 Schedule B — replay of the filed acknowledgement BTA0188370", () => {
  const result = computeForm141ScheduleB(SAMPLE_DEAL, FILING_BUYER);

  it("produces no blockers and one statement", () => {
    expect(result.blockers).toEqual([]);
    expect(result.statements).toHaveLength(1);
  });

  it("is liable — ₹2,56,00,000 clears the ₹50,00,000 threshold", () => {
    expect(result.threshold.liable).toBe(true);
    expect(result.threshold.testedAmount).toBe(25600000);
    expect(result.threshold.basis).toBe("consideration");
  });

  it("lands in Tax Year 2026-27, Month of Deduction Sep-2026, due 30-Oct-2026", () => {
    const s = result.statements[0];
    expect(s.taxYear).toBe("2026-27");
    expect(s.month).toBe("Sep-2026");
    // 30 days from the END of September, not the 7th of October.
    expect(s.dueDate).toBe("2026-10-30");
  });

  it("emits ONE statement carrying TWO seller rows — not two statements", () => {
    // Form 141 consolidates what Form 26QB split per buyer-seller pair: the
    // real acknowledgement covers both sellers under one CIN and one challan.
    expect(result.statements[0].rows).toHaveLength(2);
  });

  it("apportions ₹64,00,000 to each seller and deducts ₹64,000 apiece", () => {
    const [row1, row2] = result.statements[0].rows;
    for (const row of [row1, row2]) {
      expect(row.presentInstalment).toBe(6400000);
      expect(row.amountLiable).toBe(6400000);
      expect(row.proportionateSdv).toBe(6400000);
      expect(row.previousInstalments).toBe(0);
      expect(row.ratePct).toBe(1);
      expect(row.tdsAmount).toBe(64000);
      expect(row.section395Applicable).toBe(false);
    }
    expect(row1.sellerPan).toBe("ANRPP0000R");
    expect(row2.sellerPan).toBe("CBNPM0000M");
  });

  it("cannot reproduce the filed statement's row-1 defect", () => {
    // The filed document printed ₹6,40,000 here. The engine derives the figure
    // from amountPaidByBuyer × seller share, so ₹64,00,000 is the only value
    // it can produce — the defect has to enter through hand-keying or
    // extraction, which is where the validation engine catches it.
    expect(result.statements[0].rows[0].presentInstalment).toBe(6400000);
    expect(result.statements[0].rows[0].presentInstalment).not.toBe(640000);
  });

  it("totals to ₹1,28,00,000 liable and ₹1,28,000 tax, matching Part C", () => {
    const s = result.statements[0];
    expect(s.totalAmountLiable).toBe(12800000);
    expect(s.totalTds).toBe(128000);
  });

  it("charges nil interest and nil fee — deducted, deposited and filed same day", () => {
    const s = result.statements[0];
    expect(s.interest).toBe(0);
    expect(s.fee).toBe(0);
    expect(s.totalPayable).toBe(128000);
    expect(result.grandTotalPayable).toBe(128000);
  });
});

describe("threshold — tested on the property, never on a party's share", () => {
  it("holds two buyers at ₹30,00,000 each liable on a ₹60,00,000 property", () => {
    // The classic implementation error: testing each buyer's ₹30,00,000 share
    // would exempt a transaction that is plainly liable.
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      totalSaleConsideration: 6000000,
      totalStampDutyValue: 6000000,
      instalments: [{ ...SAMPLE_DEAL.instalments[0], amountPaidByBuyer: 3000000 }],
    };
    const r = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(r.threshold.liable).toBe(true);
    expect(r.statements[0].totalTds).toBe(30000); // 1% of the buyer's ₹30,00,000
  });

  it("exempts a deal only when consideration AND stamp duty value are both under ₹50,00,000", () => {
    const both = evaluateThreshold({ ...SAMPLE_DEAL, totalSaleConsideration: 4500000, totalStampDutyValue: 4800000 });
    expect(both.liable).toBe(false);
  });

  it("is liable when the stamp duty value alone reaches the threshold", () => {
    const r = evaluateThreshold({ ...SAMPLE_DEAL, totalSaleConsideration: 4500000, totalStampDutyValue: 5200000 });
    expect(r.liable).toBe(true);
    expect(r.basis).toBe("stamp_duty_value");
  });

  it("treats exactly ₹50,00,000 as liable", () => {
    expect(evaluateThreshold({ ...SAMPLE_DEAL, totalSaleConsideration: 5000000, totalStampDutyValue: 0 }).liable).toBe(true);
  });

  it("produces no statements at all when not liable", () => {
    const deal = { ...SAMPLE_DEAL, totalSaleConsideration: 4000000, totalStampDutyValue: 4000000 };
    expect(computeForm141ScheduleB(deal, FILING_BUYER).statements).toEqual([]);
  });
});

describe("taxable base — higher of consideration and stamp duty value", () => {
  it("steps the base up when the stamp duty value exceeds consideration", () => {
    // SDV 10% above consideration → an instalment bears tax on 110% of itself.
    expect(amountLiableForInstalment(1000000, 10000000, 11000000)).toBe(1100000);
  });

  it("never reduces the base when the stamp duty value is lower", () => {
    expect(amountLiableForInstalment(1000000, 10000000, 8000000)).toBe(1000000);
  });

  it("carries the step-up through to the tax on a real deal", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      totalSaleConsideration: 25600000,
      totalStampDutyValue: 28160000, // 10% above
    };
    const r = computeForm141ScheduleB(deal, FILING_BUYER);
    const row = r.statements[0].rows[0];
    expect(row.presentInstalment).toBe(6400000);
    expect(row.amountLiable).toBe(7040000);
    expect(row.tdsAmount).toBe(70400);
  });
});

describe("rate resolution", () => {
  it("steps to 20% when the seller has no PAN", () => {
    const r = resolveRate(RESIDENT_SELLER({ pan: null }));
    expect(r.ratePct).toBe(20);
    expect(r.basis).toBe("no_pan");
  });

  it("honours a section 395(1) certificate rate", () => {
    const r = resolveRate(RESIDENT_SELLER({ section395CertificateNo: "CERT/2026/001", section395Rate: 0.5 }));
    expect(r.ratePct).toBe(0.5);
    expect(r.basis).toBe("section_395");
  });

  it("flags a certificate number with no rate instead of silently using 1%", () => {
    const r = resolveRate(RESIDENT_SELLER({ section395CertificateNo: "CERT/2026/002", section395Rate: null }));
    expect(r.certificateRateMissing).toBe(true);
  });

  it("applies 20% end to end for a PAN-less seller", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      sellers: [RESIDENT_SELLER({ pan: null, name: "No PAN Seller", sharePct: 100 })],
    };
    const r = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(r.statements[0].rows[0].tdsAmount).toBe(2560000); // 20% of ₹1,28,00,000
  });
});

describe("blockers — conditions that make a draft meaningless", () => {
  it("blocks a non-resident seller and names section 195", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      sellers: [RESIDENT_SELLER({ residentialStatus: "non_resident", name: "NR Seller", sharePct: 100 })],
    };
    const r = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(r.blockers.map((b) => b.code)).toContain("non_resident_seller");
    expect(r.blockers[0].message).toContain("195");
    expect(r.statements).toEqual([]);
  });

  it("blocks a payment made before the Act commenced", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      instalments: [{ ...SAMPLE_DEAL.instalments[0], datePaidOrCredited: "2026-03-15", dateOfDeduction: "2026-03-15" }],
    };
    const r = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(r.blockers.map((b) => b.code)).toContain("pre_regime");
    expect(r.blockers.find((b) => b.code === "pre_regime")?.message).toContain("26QB");
  });

  it("does NOT block an agreement signed before the Act when payment falls after it", () => {
    // An agreement to sell executed in March 2026 with instalments running
    // into 2026-27 is entirely ordinary and produces Form 141 filings.
    const deal: Form141Deal = { ...SAMPLE_DEAL, dateOfAgreement: "2026-03-01" };
    const r = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(r.blockers).toEqual([]);
    expect(r.statements).toHaveLength(1);
  });

  it("blocks when the named filing buyer is not a buyer on the transaction", () => {
    const r = computeForm141ScheduleB(SAMPLE_DEAL, "ZZZPZ9999Z");
    expect(r.blockers.map((b) => b.code)).toContain("no_filing_buyer");
  });
});

describe("instalments", () => {
  const INSTALMENT_DEAL: Form141Deal = {
    ...SAMPLE_DEAL,
    paymentMode: "instalments",
    sellers: [RESIDENT_SELLER({ pan: "ANRPP0000R", name: "Sole Seller", sharePct: 100 })],
    instalments: [
      { seq: 1, amountPaidByBuyer: 5000000, datePaidOrCredited: "2026-09-02", dateOfDeduction: "2026-09-02", dateOfDeposit: "2026-09-20", dateOfFiling: "2026-09-20" },
      { seq: 2, amountPaidByBuyer: 4000000, datePaidOrCredited: "2027-03-10", dateOfDeduction: "2027-03-10", dateOfDeposit: "2027-03-25", dateOfFiling: "2027-03-25" },
      { seq: 3, amountPaidByBuyer: 3800000, datePaidOrCredited: "2027-04-15", dateOfDeduction: "2027-04-15", dateOfDeposit: "2027-04-30", dateOfFiling: "2027-04-30" },
    ],
  };

  const r = computeForm141ScheduleB(INSTALMENT_DEAL, FILING_BUYER);

  it("produces one statement per instalment", () => {
    expect(r.statements).toHaveLength(3);
  });

  it("carries previous instalments forward cumulatively", () => {
    expect(r.statements[0].rows[0].previousInstalments).toBe(0);
    expect(r.statements[1].rows[0].previousInstalments).toBe(5000000);
    expect(r.statements[2].rows[0].previousInstalments).toBe(9000000);
  });

  it("straddles the year end — instalment 3 falls in the next Tax Year", () => {
    expect(r.statements[0].taxYear).toBe("2026-27");
    expect(r.statements[1].taxYear).toBe("2026-27");
    expect(r.statements[2].taxYear).toBe("2027-28");
    expect(r.statements[2].month).toBe("Apr-2027");
  });

  it("deducts on each instalment independently", () => {
    expect(r.statements[0].totalTds).toBe(50000);
    expect(r.statements[1].totalTds).toBe(40000);
    expect(r.statements[2].totalTds).toBe(38000);
    expect(r.grandTotalTds).toBe(128000);
  });
});

describe("interest", () => {
  it("charges nothing when deducted on time and deposited by the due date", () => {
    const i = computeInterest(100000, "2026-09-02", "2026-09-02", "2026-10-30");
    expect(i.total).toBe(0);
  });

  it("charges 1.5% a month, or part, for a late deposit — counted from the deduction month", () => {
    // Deducted 02-Sep, due 30-Oct, deposited 15-Dec → Sep, Oct, Nov, Dec = 4.
    const i = computeInterest(100000, "2026-09-02", "2026-09-02", "2026-12-15");
    expect(i.lateDepositMonths).toBe(4);
    expect(i.lateDeposit).toBe(6000);
    expect(i.total).toBe(6000);
  });

  it("charges 1% a month for late DEDUCTION, from the date of payment", () => {
    // Paid 02-Sep but deducted 10-Nov → Sep, Oct, Nov = 3 months.
    const i = computeInterest(100000, "2026-09-02", "2026-11-10", "2026-11-10");
    expect(i.lateDeductionMonths).toBe(3);
    expect(i.lateDeduction).toBe(3000);
  });

  it("adds both limbs when tax was deducted late AND deposited late", () => {
    const i = computeInterest(100000, "2026-09-02", "2026-11-10", "2027-02-20");
    expect(i.lateDeduction).toBe(3000); // 3 months at 1%
    expect(i.lateDepositMonths).toBe(4); // Nov, Dec, Jan, Feb
    expect(i.lateDeposit).toBe(6000);
    expect(i.total).toBe(9000);
  });

  it("reports nothing for a draft with no deposit date yet", () => {
    const i = computeInterest(100000, "2026-09-02", "2026-09-02", null);
    expect(i.lateDeposit).toBe(0);
  });

  it("flows through to the statement's Part C", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      instalments: [{ ...SAMPLE_DEAL.instalments[0], dateOfDeposit: "2026-12-15", dateOfFiling: "2026-12-15" }],
    };
    const s = computeForm141ScheduleB(deal, FILING_BUYER).statements[0];
    expect(s.totalTds).toBe(128000);
    expect(s.interest).toBe(7680); // 128000 × 1.5% × 4
  });
});

describe("late fee", () => {
  it("charges nothing when filed by the due date", () => {
    expect(computeLateFee(128000, "2026-09-02", "2026-10-30").fee).toBe(0);
  });

  it("charges ₹200 a day past the due date", () => {
    // Due 30-Oct-2026, filed 15-Dec-2026 → 46 days.
    const { fee, days } = computeLateFee(128000, "2026-09-02", "2026-12-15");
    expect(days).toBe(46);
    expect(fee).toBe(9200);
  });

  it("caps the fee at the tax deducted", () => {
    // 46 days would be ₹9,200, but the tax on the statement is only ₹5,000.
    const { fee } = computeLateFee(5000, "2026-09-02", "2026-12-15");
    expect(fee).toBe(5000);
  });

  it("reports nothing for a draft that has not been filed", () => {
    expect(computeLateFee(128000, "2026-09-02", null).fee).toBe(0);
  });
});

describe("date helpers", () => {
  it("maps a date to its Tax Year across the April boundary", () => {
    expect(taxYearForDate("2026-04-01")).toBe("2026-27");
    expect(taxYearForDate("2027-03-31")).toBe("2026-27");
    expect(taxYearForDate("2027-04-01")).toBe("2027-28");
    expect(taxYearForDate("2027-01-15")).toBe("2026-27");
  });

  it("formats the Month of Deduction exactly as the form prints it", () => {
    expect(monthOfDeduction("2026-09-02")).toBe("Sep-2026");
    expect(monthOfDeduction("2027-01-31")).toBe("Jan-2027");
  });

  it("computes the due date 30 days from the end of the deduction month", () => {
    expect(form141DueDate("2026-09-02")).toBe("2026-10-30"); // Sep ends 30th
    expect(form141DueDate("2026-09-30")).toBe("2026-10-30"); // same month, same due date
    expect(form141DueDate("2027-02-10")).toBe("2027-03-30"); // Feb 2027 ends 28th
    expect(form141DueDate("2026-12-25")).toBe("2027-01-30"); // crosses the year
  });

  it("counts months by calendar boundary crossed, not by 30-day blocks", () => {
    expect(monthsOrPartLate("2026-09-02", "2026-09-02")).toBe(0);
    expect(monthsOrPartLate("2026-09-02", "2026-09-30")).toBe(1);
    expect(monthsOrPartLate("2026-09-30", "2026-10-01")).toBe(2); // one day, two months
    expect(monthsOrPartLate("2026-09-02", "2026-11-05")).toBe(3);
  });

  it("counts whole days for the fee", () => {
    expect(daysLate("2026-10-30", "2026-10-30")).toBe(0);
    expect(daysLate("2026-10-30", "2026-11-01")).toBe(2);
    expect(daysLate("2026-11-01", "2026-10-30")).toBe(0);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * The audit fixes
 * ════════════════════════════════════════════════════════════════════════════
 */

describe("an inoperative PAN carries the no-PAN rate", () => {
  it("charges 20% on a PAN that exists but is not operative", () => {
    const seller = RESIDENT_SELLER({ panStatus: "inoperative" });
    const r = resolveRate(seller);
    expect(r.ratePct).toBe(20);
    expect(r.basis).toBe("inoperative_pan");
  });

  it("charges 20% on an invalid PAN too", () => {
    expect(resolveRate(RESIDENT_SELLER({ panStatus: "invalid" })).ratePct).toBe(20);
  });

  it("leaves an operative PAN at the standard rate", () => {
    const r = resolveRate(RESIDENT_SELLER({ panStatus: "operative" }));
    expect(r.ratePct).toBe(1);
    expect(r.basis).toBe("standard");
  });

  it("does NOT treat 'unknown' as inoperative — it is unchecked, not bad", () => {
    // Pricing an unchecked PAN at 20% would over-deduct on every ordinary
    // deal. The validation layer reports it instead.
    expect(resolveRate(RESIDENT_SELLER({ panStatus: "unknown" })).ratePct).toBe(1);
    expect(resolveRate(RESIDENT_SELLER({})).ratePct).toBe(1);
  });

  it("carries the higher rate all the way through to the computed tax", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      sellers: [RESIDENT_SELLER({ pan: "ANRPP0000R", name: "Inoperative", sharePct: 100, panStatus: "inoperative" })],
    };
    const out = computeForm141ScheduleB(deal, FILING_BUYER);
    const row = out.statements[0].rows[0];
    // Buyer's 50% of ₹2,56,00,000 = ₹1,28,00,000, at 20% rather than 1%.
    expect(row.amountLiable).toBe(12800000);
    expect(row.ratePct).toBe(20);
    expect(row.rateBasis).toBe("inoperative_pan");
    expect(row.tdsAmount).toBe(2560000);
  });
});

describe("a section 395(1) certificate is not a standing concession", () => {
  const CERTIFIED = (over: Partial<Form141Seller> = {}) =>
    RESIDENT_SELLER({
      pan: "ANRPP0000R",
      name: "Certified Seller",
      sharePct: 100,
      section395CertificateNo: "CERT/2026/001",
      section395Rate: 0.1,
      ...over,
    });

  it("applies the certificate rate inside the validity window", () => {
    const r = resolveRate(
      CERTIFIED({ section395ValidFrom: "2026-04-01", section395ValidTo: "2027-03-31" }),
      { dateOfDeduction: "2026-09-02" },
    );
    expect(r.ratePct).toBe(0.1);
    expect(r.basis).toBe("section_395");
  });

  it("reverts to the standard rate for a deduction after the certificate expires", () => {
    const r = resolveRate(
      CERTIFIED({ section395ValidFrom: "2026-04-01", section395ValidTo: "2026-08-31" }),
      { dateOfDeduction: "2026-09-02" },
    );
    expect(r.ratePct).toBe(1);
    expect(r.basis).toBe("certificate_expired");
    expect(r.certificateExpired).toBe(true);
  });

  it("reverts for a deduction BEFORE the certificate takes effect", () => {
    const r = resolveRate(
      CERTIFIED({ section395ValidFrom: "2026-10-01", section395ValidTo: "2027-03-31" }),
      { dateOfDeduction: "2026-09-02" },
    );
    expect(r.basis).toBe("certificate_expired");
  });

  it("reverts once the amount the certificate covers is used up", () => {
    const r = resolveRate(CERTIFIED({ section395CeilingAmount: 10000000 }), {
      dateOfDeduction: "2026-09-02",
      alreadyCovered: 9000000,
      amountLiable: 2000000,
    });
    expect(r.ratePct).toBe(1);
    expect(r.basis).toBe("certificate_exhausted");
    expect(r.certificateCeilingExceeded).toBe(true);
  });

  it("stays on the certificate rate right up to the ceiling", () => {
    const r = resolveRate(CERTIFIED({ section395CeilingAmount: 10000000 }), {
      dateOfDeduction: "2026-09-02",
      alreadyCovered: 8000000,
      amountLiable: 2000000,
    });
    expect(r.basis).toBe("section_395");
  });

  it("exhausts the ceiling across instalments, not within one", () => {
    // ₹1,28,00,000 of the buyer's obligation, paid in two equal halves,
    // against a certificate covering ₹70,00,000. The first instalment
    // (₹64,00,000) fits; the second would take it to ₹1,28,00,000, so it
    // goes through wholly at the standard rate.
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      paymentMode: "instalments",
      sellers: [CERTIFIED({ section395CeilingAmount: 7000000 })],
      instalments: [
        { seq: 1, amountPaidByBuyer: 6400000, datePaidOrCredited: "2026-09-02", dateOfDeduction: "2026-09-02", dateOfDeposit: "2026-09-02", dateOfFiling: "2026-09-02" },
        { seq: 2, amountPaidByBuyer: 6400000, datePaidOrCredited: "2026-10-02", dateOfDeduction: "2026-10-02", dateOfDeposit: "2026-10-02", dateOfFiling: "2026-10-02" },
      ],
    };
    const out = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(out.statements[0].rows[0].rateBasis).toBe("section_395");
    expect(out.statements[0].rows[0].ratePct).toBe(0.1);
    expect(out.statements[1].rows[0].rateBasis).toBe("certificate_exhausted");
    expect(out.statements[1].rows[0].ratePct).toBe(1);
  });

  it("reports the certificate as not applied when it did not govern the rate", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      sellers: [CERTIFIED({ section395ValidFrom: "2026-04-01", section395ValidTo: "2026-08-31" })],
    };
    const row = computeForm141ScheduleB(deal, FILING_BUYER).statements[0].rows[0];
    expect(row.section395Applicable).toBe(false);
    // The number still prints — it was held, it just did not cover this.
    expect(row.section395CertificateNo).toBe("CERT/2026/001");
  });
});

describe("previous instalments follow the money, not the sequence number", () => {
  /** A forgotten earlier payment, entered last — which is how it happens. */
  const BACK_ENTERED: Form141Deal = {
    ...SAMPLE_DEAL,
    paymentMode: "instalments",
    sellers: [RESIDENT_SELLER({ pan: "ANRPP0000R", name: "Only Seller", sharePct: 100 })],
    instalments: [
      { seq: 1, amountPaidByBuyer: 5000000, datePaidOrCredited: "2026-08-01", dateOfDeduction: "2026-08-01", dateOfDeposit: null, dateOfFiling: null },
      { seq: 2, amountPaidByBuyer: 3000000, datePaidOrCredited: "2026-06-01", dateOfDeduction: "2026-06-01", dateOfDeposit: null, dateOfFiling: null },
    ],
  };

  it("orders the statements by payment date", () => {
    const out = computeForm141ScheduleB(BACK_ENTERED, FILING_BUYER);
    expect(out.statements.map((s) => s.instalmentSeq)).toEqual([2, 1]);
    expect(out.statements.map((s) => s.month)).toEqual(["Jun-2026", "Aug-2026"]);
  });

  it("carries forward what had actually been paid by that date", () => {
    const out = computeForm141ScheduleB(BACK_ENTERED, FILING_BUYER);
    const june = out.statements.find((s) => s.instalmentSeq === 2)!;
    const august = out.statements.find((s) => s.instalmentSeq === 1)!;

    // June came first in fact, so nothing preceded it.
    expect(june.rows[0].previousInstalments).toBe(0);
    // By August, the June payment of ₹30,00,000 had been made. Ordering by
    // seq would have reported ₹0 here and ₹50,00,000 against June — both
    // statements wrong, in opposite directions.
    expect(august.rows[0].previousInstalments).toBe(3000000);
  });

  it("keeps the entered order for payments made the same day", () => {
    const sameDay: Form141Deal = {
      ...BACK_ENTERED,
      instalments: BACK_ENTERED.instalments.map((i) => ({ ...i, datePaidOrCredited: "2026-07-01", dateOfDeduction: "2026-07-01" })),
    };
    expect(computeForm141ScheduleB(sameDay, FILING_BUYER).statements.map((s) => s.instalmentSeq)).toEqual([1, 2]);
  });
});

describe("residency is a fact somebody asserts, never a default", () => {
  /**
   * The gap this closes was the most expensive one in the module. Extraction
   * used to write "resident" onto every seller it read, because the column
   * defaulted that way — and nothing in a sale deed states residency. An NRI
   * sale therefore computed 1% where section 195 needs roughly 20% before
   * surcharge and cess, produced a clean-looking statement, and left the
   * BUYER carrying the whole shortfall under section 201 with interest.
   */
  const unknownSeller = (over: Partial<Form141Seller> = {}): Form141Seller => ({
    ...RESIDENT_SELLER(over),
    residentialStatus: "unknown",
  });

  it("refuses to compute while any seller's residency is unestablished", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      sellers: [unknownSeller({ pan: "ANRPP0000R", name: "Seller One" }), SAMPLE_DEAL.sellers[1]],
    };
    const out = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(out.blockers.map((b) => b.code)).toContain("seller_residency_unknown");
    expect(out.statements).toEqual([]);
  });

  it("names the seller, so the preparer knows whose to check", () => {
    const deal: Form141Deal = { ...SAMPLE_DEAL, sellers: [unknownSeller({ name: "Seller One" })] };
    const hit = computeForm141ScheduleB(deal, FILING_BUYER).blockers
      .find((b) => b.code === "seller_residency_unknown");
    expect(hit?.message).toContain("Seller One");
  });

  it("computes normally once every seller's residency is settled", () => {
    expect(computeForm141ScheduleB(SAMPLE_DEAL, FILING_BUYER).blockers).toEqual([]);
  });

  it("still sends a non-resident to section 195 rather than computing 1%", () => {
    const deal: Form141Deal = {
      ...SAMPLE_DEAL,
      sellers: [RESIDENT_SELLER({ name: "NRI Seller", residentialStatus: "non_resident" }), SAMPLE_DEAL.sellers[1]],
    };
    const out = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(out.blockers.map((b) => b.code)).toContain("non_resident_seller");
  });
});

describe("who paid whom — the allocation override", () => {
  /**
   * Two buyers, two sellers, and buyer A is buying seller X's half while buyer
   * B buys seller Y's. Pro-rata turns that into four rows at 25% each. The
   * TOTAL tax is identical, so nothing on screen looks wrong — but the
   * deductee-wise split is exactly what reaches each seller's 26AS and AIS.
   * Seller X gets credited with tax on money they never received, and their
   * real credit is short by the same amount.
   */
  const TWO_BY_TWO: Form141Deal = {
    ...SAMPLE_DEAL,
    instalments: [{ ...SAMPLE_DEAL.instalments[0], amountPaidByBuyer: 12800000 }],
  };

  it("splits pro-rata when the deed says nothing — unchanged behaviour", () => {
    const rows = computeForm141ScheduleB(TWO_BY_TWO, FILING_BUYER).statements[0].rows;
    expect(rows.map((r) => r.presentInstalment)).toEqual([6400000, 6400000]);
  });

  it("follows the deed instead when it says who was paid", () => {
    const deal: Form141Deal = {
      ...TWO_BY_TWO,
      instalments: [{
        ...TWO_BY_TWO.instalments[0],
        allocations: [{ sellerKey: "ANRPP0000R", amount: 12800000 }],
      }],
    };
    const rows = computeForm141ScheduleB(deal, FILING_BUYER).statements[0].rows;
    // The whole payment went to seller one; seller two received nothing from
    // it, and must not be credited pro-rata as if they had.
    expect(rows[0].presentInstalment).toBe(12800000);
    expect(rows[1].presentInstalment).toBe(0);
  });

  it("treats an allocation list as complete — an unnamed seller got nothing", () => {
    // The trap: falling back to pro-rata for a seller missing from the list
    // would pay them twice, once here and once from their own allocation on
    // another instalment.
    const deal: Form141Deal = {
      ...TWO_BY_TWO,
      instalments: [{
        ...TWO_BY_TWO.instalments[0],
        allocations: [{ sellerKey: "CBNPM0000M", amount: 12800000 }],
      }],
    };
    const rows = computeForm141ScheduleB(deal, FILING_BUYER).statements[0].rows;
    expect(rows[0].presentInstalment).toBe(0);
    expect(rows[1].presentInstalment).toBe(12800000);
  });

  it("adds up several slices to the same seller", () => {
    const deal: Form141Deal = {
      ...TWO_BY_TWO,
      instalments: [{
        ...TWO_BY_TWO.instalments[0],
        allocations: [
          { sellerKey: "ANRPP0000R", amount: 8000000 },
          { sellerKey: "ANRPP0000R", amount: 4800000 },
        ],
      }],
    };
    expect(computeForm141ScheduleB(deal, FILING_BUYER).statements[0].rows[0].presentInstalment)
      .toBe(12800000);
  });

  it("carries an allocated payment into the next statement's previous-instalments column", () => {
    const deal: Form141Deal = {
      ...TWO_BY_TWO,
      paymentMode: "instalments",
      instalments: [
        {
          seq: 1, amountPaidByBuyer: 6400000,
          datePaidOrCredited: "2026-09-02", dateOfDeduction: "2026-09-02",
          allocations: [{ sellerKey: "ANRPP0000R", amount: 6400000 }],
        },
        {
          seq: 2, amountPaidByBuyer: 6400000,
          datePaidOrCredited: "2026-10-02", dateOfDeduction: "2026-10-02",
          allocations: [{ sellerKey: "ANRPP0000R", amount: 6400000 }],
        },
      ],
    };
    const out = computeForm141ScheduleB(deal, FILING_BUYER);
    // Seller one has now received both payments; the second statement must
    // say so, because that column is a statement of historical fact.
    expect(out.statements[1].rows[0].previousInstalments).toBe(6400000);
    expect(out.statements[1].rows[1].previousInstalments).toBe(0);
  });
});

describe("a deal that straddles the 1961 and 2025 Acts", () => {
  /**
   * A deed signed in FY 2025-26 whose instalments run into 2026-27 is
   * ordinary, not exotic. It used to block the ENTIRE transaction on the first
   * pre-commencement payment, so every genuine transitional deal produced
   * nothing at all — and a preparer who cannot get a draft out of the software
   * prepares it somewhere else.
   */
  const STRADDLING: Form141Deal = {
    ...SAMPLE_DEAL,
    paymentMode: "instalments",
    dateOfAgreement: "2026-01-15",
    instalments: [
      { seq: 1, amountPaidByBuyer: 6400000, datePaidOrCredited: "2026-01-20", dateOfDeduction: "2026-01-20" },
      { seq: 2, amountPaidByBuyer: 6400000, datePaidOrCredited: "2026-09-02", dateOfDeduction: "2026-09-02" },
    ],
  };

  it("still produces a Form 141 for the payments that belong to it", () => {
    const out = computeForm141ScheduleB(STRADDLING, FILING_BUYER);
    expect(out.blockers).toEqual([]);
    expect(out.statements).toHaveLength(1);
    expect(out.statements[0].instalmentSeq).toBe(2);
  });

  it("lists the pre-commencement payments rather than dropping them", () => {
    // Setting them aside must never read as "handled" — each is a separate
    // Form 26QB, due under the 1961 Act.
    const out = computeForm141ScheduleB(STRADDLING, FILING_BUYER);
    expect(out.form26qbPayments).toHaveLength(1);
    expect(out.form26qbPayments?.[0].datePaidOrCredited).toBe("2026-01-20");
    expect(out.form26qbPayments?.[0].amountPaidByBuyer).toBe(6400000);
  });

  it("does not let a pre-commencement payment inflate the later statement", () => {
    const out = computeForm141ScheduleB(STRADDLING, FILING_BUYER);
    // Only the September payment is on this form, apportioned across two
    // sellers: 64,00,000 / 2.
    expect(out.statements[0].rows.map((r) => r.presentInstalment)).toEqual([3200000, 3200000]);
  });

  it("blocks only when EVERY payment predates the Act", () => {
    const deal: Form141Deal = {
      ...STRADDLING,
      instalments: [STRADDLING.instalments[0]],
    };
    const out = computeForm141ScheduleB(deal, FILING_BUYER);
    expect(out.blockers.map((b) => b.code)).toContain("pre_regime");
    expect(out.statements).toEqual([]);
    // Still listed, so the preparer knows the 26QB is outstanding.
    expect(out.form26qbPayments).toHaveLength(1);
  });
});
