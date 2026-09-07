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
