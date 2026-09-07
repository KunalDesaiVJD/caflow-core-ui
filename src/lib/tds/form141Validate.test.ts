import { describe, it, expect } from "vitest";
import {
  checkRowConsistency,
  checkStatementConsistency,
  validateDeal,
  compareWithComputed,
  validateForm141,
  type StatedRow,
} from "./form141Validate";
import { computeForm141ScheduleB, type Form141Deal, type Form141Seller } from "./form141ScheduleB";

const FILING_BUYER = "ADFPB0000E";

const SELLER = (over: Partial<Form141Seller>): Form141Seller => ({
  pan: "ANRPP0000R",
  name: "Seller One",
  contact: "9300000020",
  email: "seller.one@example.com",
  sharePct: 50,
  residentialStatus: "resident",
  ...over,
});

/** The transaction behind the filed acknowledgement BTA0188370. */
const DEAL: Form141Deal = {
  propertyType: "LAND",
  propertyAddress: "KHATA NO- 1349, MOJE GAM- KADADRA, TALUKA- DEHGAM, GANDHI NAGAR, Gujarat 382305",
  dateOfAgreement: "2026-09-02",
  totalSaleConsideration: 25600000,
  totalStampDutyValue: 25600000,
  paymentMode: "lumpsum",
  buyers: [
    { pan: FILING_BUYER, name: "Buyer One", sharePct: 50 },
    { pan: "ACTPP0000E", name: "Buyer Two", sharePct: 50 },
  ],
  sellers: [
    SELLER({ pan: "ANRPP0000R", name: "Seller One" }),
    SELLER({ pan: "CBNPM0000M", name: "Seller Two", email: "seller.two@example.com", contact: "9600000043" }),
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

/**
 * THE HEADLINE CASE.
 *
 * Seller 1's row on the real filed statement reads: previous instalments ₹0,
 * present instalment ₹6,40,000, amount liable ₹64,00,000, rate 1%, tax
 * ₹64,000. Payment mode Lumpsum, stamp duty value equal to consideration.
 *
 * The tax is arithmetically right for the liable amount (1% of ₹64,00,000),
 * so a check that only verified rate × base would pass this row. What is
 * wrong is that the present instalment disagrees with the liable amount by a
 * factor of ten on a lumpsum payment with nothing paid previously — the two
 * must be equal. The portal accepted it anyway.
 */
describe("the defect in the real filed statement", () => {
  const FILED_ROW_1: StatedRow = {
    sellerPan: "ANRPP0000R",
    sellerName: "Seller One",
    proportionateSdv: 6400000,
    previousInstalments: 0,
    presentInstalment: 640000, // ← as filed: a dropped zero
    amountLiable: 6400000,
    ratePct: 1,
    tdsAmount: 64000,
  };

  const FILED_ROW_2: StatedRow = { ...FILED_ROW_1, sellerPan: "CBNPM0000M", sellerName: "Seller Two", presentInstalment: 6400000 };

  it("catches row 1 as BLOCKING", () => {
    const findings = checkRowConsistency(FILED_ROW_1);
    const hit = findings.find((f) => f.code === "row_liable_mismatch");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("blocking");
    expect(hit?.ref).toBe("ANRPP0000R");
  });

  it("names both figures in the message so the user can see which to fix", () => {
    const msg = checkRowConsistency(FILED_ROW_1).find((f) => f.code === "row_liable_mismatch")!.message;
    expect(msg).toContain("₹64,00,000");
    expect(msg).toContain("₹6,40,000");
  });

  it("passes row 2, which is correct — it does not flag the whole statement", () => {
    expect(checkRowConsistency(FILED_ROW_2)).toEqual([]);
  });

  it("does NOT fire on the rate × base check, which row 1 genuinely satisfies", () => {
    // 1% of ₹64,00,000 IS ₹64,000. A naive tax-arithmetic check misses this
    // defect entirely, which is why the instalment/base identity is a rule in
    // its own right.
    expect(checkRowConsistency(FILED_ROW_1).map((f) => f.code)).not.toContain("row_tds_mismatch");
  });

  it("catches it through the full entry point too, not just the row helper", () => {
    const r = validateForm141(DEAL, FILING_BUYER, {
      stated: [{ instalmentSeq: 1, rows: [FILED_ROW_1, FILED_ROW_2], totalTds: 128000 }],
    });
    expect(r.ok).toBe(false);
    expect(r.blocking.map((f) => f.code)).toContain("row_liable_mismatch");
    // And separately, as a stated-vs-computed mismatch.
    expect(r.blocking.map((f) => f.code)).toContain("stated_presentInstalment_mismatch");
  });
});

describe("intra-row arithmetic", () => {
  const GOOD: StatedRow = {
    sellerPan: "ANRPP0000R",
    previousInstalments: 0,
    presentInstalment: 6400000,
    amountLiable: 6400000,
    ratePct: 1,
    tdsAmount: 64000,
  };

  it("passes a clean row", () => {
    expect(checkRowConsistency(GOOD)).toEqual([]);
  });

  it("allows the liable amount to exceed the instalment when the stamp duty value does", () => {
    // SDV 10% above consideration → base is 110% of the instalment.
    const row: StatedRow = { ...GOOD, amountLiable: 7040000, tdsAmount: 70400 };
    expect(checkRowConsistency(row, 1.1)).toEqual([]);
  });

  it("still blocks a wrong liable amount under a step-up", () => {
    const row: StatedRow = { ...GOOD, amountLiable: 6400000, tdsAmount: 64000 };
    expect(checkRowConsistency(row, 1.1).map((f) => f.code)).toContain("row_liable_mismatch");
  });

  it("blocks tax that is not the stated rate of the stated base", () => {
    const f = checkRowConsistency({ ...GOOD, tdsAmount: 60000 });
    expect(f.map((x) => x.code)).toContain("row_tds_mismatch");
    expect(f.find((x) => x.code === "row_tds_mismatch")?.message).toContain("₹64,000");
  });

  it("blocks a rate that is neither standard, no-PAN, nor certificate-backed", () => {
    const f = checkRowConsistency({ ...GOOD, ratePct: 0.5, tdsAmount: 32000 });
    expect(f.map((x) => x.code)).toContain("row_rate_unsupported");
  });

  it("accepts a non-standard rate when a section 395(1) certificate is cited", () => {
    const f = checkRowConsistency({ ...GOOD, ratePct: 0.5, tdsAmount: 32000, section395CertificateNo: "CERT/2026/1" });
    expect(f.map((x) => x.code)).not.toContain("row_rate_unsupported");
  });

  it("blocks 20% being applied although a PAN is on record", () => {
    const f = checkRowConsistency({ ...GOOD, ratePct: 20, tdsAmount: 1280000 });
    expect(f.map((x) => x.code)).toContain("row_no_pan_rate_with_pan");
  });

  it("accepts 20% when there is genuinely no PAN", () => {
    const f = checkRowConsistency({ ...GOOD, sellerPan: null, ratePct: 20, tdsAmount: 1280000 });
    expect(f.map((x) => x.code)).not.toContain("row_no_pan_rate_with_pan");
    expect(f.map((x) => x.code)).not.toContain("row_rate_unsupported");
  });

  it("blocks a malformed PAN", () => {
    expect(checkRowConsistency({ ...GOOD, sellerPan: "ANRP9387R" }).map((f) => f.code)).toContain("row_pan_invalid");
  });

  it("warns on an unrecognised PAN holder-type character", () => {
    const f = checkRowConsistency({ ...GOOD, sellerPan: "ANRXP9387R" });
    const hit = f.find((x) => x.code === "row_pan_unknown_holder_type");
    expect(hit?.severity).toBe("warning");
  });

  it("says nothing about fields that are simply absent", () => {
    expect(checkRowConsistency({ sellerPan: "ANRPP0000R" })).toEqual([]);
  });
});

describe("statement totals", () => {
  it("blocks when Part C does not match the rows", () => {
    const f = checkStatementConsistency({
      rows: [
        { sellerPan: "ANRPP0000R", presentInstalment: 6400000, amountLiable: 6400000, ratePct: 1, tdsAmount: 64000 },
        { sellerPan: "CBNPM0000M", presentInstalment: 6400000, amountLiable: 6400000, ratePct: 1, tdsAmount: 64000 },
      ],
      totalTds: 120000,
    });
    expect(f.map((x) => x.code)).toContain("statement_tds_total_mismatch");
  });

  it("blocks when the total liable does not match the rows", () => {
    const f = checkStatementConsistency({
      rows: [{ sellerPan: "ANRPP0000R", presentInstalment: 6400000, amountLiable: 6400000, ratePct: 1, tdsAmount: 64000 }],
      totalAmountLiable: 12800000,
    });
    expect(f.map((x) => x.code)).toContain("statement_liable_total_mismatch");
  });

  it("passes the sample statement's real totals", () => {
    const f = checkStatementConsistency({
      rows: [
        { sellerPan: "ANRPP0000R", presentInstalment: 6400000, amountLiable: 6400000, ratePct: 1, tdsAmount: 64000 },
        { sellerPan: "CBNPM0000M", presentInstalment: 6400000, amountLiable: 6400000, ratePct: 1, tdsAmount: 64000 },
      ],
      totalTds: 128000,
      totalAmountLiable: 12800000,
    });
    expect(f).toEqual([]);
  });
});

describe("deal integrity", () => {
  it("passes the real transaction with no blocking findings", () => {
    const r = validateForm141(DEAL, FILING_BUYER, { selectedClientPan: FILING_BUYER });
    expect(r.blocking).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("blocks buyer shares that do not total 100%", () => {
    const deal = { ...DEAL, buyers: [{ pan: FILING_BUYER, name: "Buyer One", sharePct: 50 }] };
    const codes = validateDeal(deal, FILING_BUYER).map((f) => f.code);
    expect(codes).toContain("buyer_shares_not_100");
  });

  it("blocks seller shares that do not total 100%", () => {
    const deal = { ...DEAL, sellers: [SELLER({ sharePct: 60 }), SELLER({ pan: "CBNPM0000M", sharePct: 60 })] };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("seller_shares_not_100");
  });

  it("blocks a client whose PAN is not among the buyers", () => {
    const codes = validateDeal(DEAL, FILING_BUYER, "ZZZPZ9999Z").map((f) => f.code);
    expect(codes).toContain("client_pan_not_a_buyer");
  });

  it("blocks a non-resident seller and points at section 195", () => {
    const deal = { ...DEAL, sellers: [SELLER({ sharePct: 100, residentialStatus: "non_resident" as const })] };
    const hit = validateDeal(deal, FILING_BUYER).find((f) => f.code === "non_resident_seller");
    expect(hit?.severity).toBe("blocking");
    expect(hit?.message).toContain("27Q");
  });

  it("blocks a section 395(1) certificate with no rate recorded", () => {
    const deal = { ...DEAL, sellers: [SELLER({ sharePct: 100, section395CertificateNo: "CERT/1", section395Rate: null })] };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("certificate_rate_missing");
  });

  it("blocks instalments totalling more than the buyer's own share", () => {
    const deal = {
      ...DEAL,
      instalments: [{ ...DEAL.instalments[0], amountPaidByBuyer: 20000000 }],
    };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("instalments_exceed_obligation");
  });

  it("blocks Lumpsum carrying more than one instalment", () => {
    const deal = {
      ...DEAL,
      instalments: [
        { ...DEAL.instalments[0], seq: 1, amountPaidByBuyer: 6000000 },
        { ...DEAL.instalments[0], seq: 2, amountPaidByBuyer: 6800000 },
      ],
    };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("lumpsum_multiple_instalments");
  });

  it("blocks tax deducted before the payment it was deducted from", () => {
    const deal = { ...DEAL, instalments: [{ ...DEAL.instalments[0], dateOfDeduction: "2026-08-25" }] };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("deduction_before_payment");
  });

  it("blocks a payment made before the Act commenced", () => {
    const deal = {
      ...DEAL,
      instalments: [{ ...DEAL.instalments[0], datePaidOrCredited: "2026-02-10", dateOfDeduction: "2026-02-10" }],
    };
    const hit = validateDeal(deal, FILING_BUYER).find((f) => f.code === "pre_regime_payment");
    expect(hit?.severity).toBe("blocking");
    expect(hit?.message).toContain("26QB");
  });

  it("does NOT block an agreement predating the Act when payment follows it", () => {
    const deal = { ...DEAL, dateOfAgreement: "2026-01-15" };
    const blocking = validateDeal(deal, FILING_BUYER).filter((f) => f.severity === "blocking");
    expect(blocking).toEqual([]);
  });
});

describe("warnings — proceed, but look", () => {
  it("warns when the stamp duty value exceeds the consideration", () => {
    const deal = { ...DEAL, totalStampDutyValue: 28000000 };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("sdv_above_consideration");
  });

  it("warns when the stamp duty value is missing entirely", () => {
    const deal = { ...DEAL, totalStampDutyValue: 0 };
    const hit = validateDeal(deal, FILING_BUYER).find((f) => f.code === "stamp_duty_value_missing");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toContain("Index-II");
  });

  it("warns on a deal sitting within 5% of the threshold", () => {
    const deal = { ...DEAL, totalSaleConsideration: 5100000, totalStampDutyValue: 5100000, instalments: [{ ...DEAL.instalments[0], amountPaidByBuyer: 2550000 }] };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("near_threshold");
  });

  it("warns when consideration is under the threshold but the stamp duty value is not", () => {
    const deal = { ...DEAL, totalSaleConsideration: 4800000, totalStampDutyValue: 5600000, instalments: [{ ...DEAL.instalments[0], amountPaidByBuyer: 2400000 }] };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("sub_threshold_sdv_liable");
  });

  it("warns on agricultural land rather than blocking", () => {
    const deal = { ...DEAL, propertyType: "AGRICULTURAL LAND" };
    const hit = validateDeal(deal, FILING_BUYER).find((f) => f.code === "agricultural_land");
    expect(hit?.severity).toBe("warning");
  });

  it("warns when a seller has no email and no contact number", () => {
    const deal = { ...DEAL, sellers: [SELLER({ sharePct: 100, email: null, contact: null })] };
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("seller_contact_missing");
  });

  it("warns about an unpaid instalment whose due date has passed", () => {
    const deal = {
      ...DEAL,
      instalments: [{ seq: 1, amountPaidByBuyer: 12800000, datePaidOrCredited: "2026-04-02", dateOfDeduction: "2026-04-02", dateOfDeposit: null }],
    };
    // Due 31-May-2026 — in the past for any run of this suite.
    expect(validateDeal(deal, FILING_BUYER).map((f) => f.code)).toContain("past_due_unpaid");
  });
});

describe("stated against computed", () => {
  const computed = computeForm141ScheduleB(DEAL, FILING_BUYER).statements[0];

  it("passes figures that match the computation", () => {
    const f = compareWithComputed(
      {
        instalmentSeq: 1,
        rows: [
          { sellerPan: "ANRPP0000R", presentInstalment: 6400000, previousInstalments: 0, amountLiable: 6400000, proportionateSdv: 6400000, ratePct: 1, tdsAmount: 64000 },
          { sellerPan: "CBNPM0000M", presentInstalment: 6400000, previousInstalments: 0, amountLiable: 6400000, proportionateSdv: 6400000, ratePct: 1, tdsAmount: 64000 },
        ],
        totalTds: 128000,
      },
      computed,
    );
    expect(f).toEqual([]);
  });

  it("catches an internally consistent row that is nonetheless wrong", () => {
    // Every column scaled by a mistaken 25% share instead of 50%. Intra-row
    // arithmetic is perfectly satisfied — only the deal knows better.
    const row = { sellerPan: "ANRPP0000R", presentInstalment: 3200000, amountLiable: 3200000, ratePct: 1, tdsAmount: 32000 };
    expect(checkRowConsistency(row)).toEqual([]);
    const codes = compareWithComputed({ instalmentSeq: 1, rows: [row] }, computed).map((f) => f.code);
    expect(codes).toContain("stated_presentInstalment_mismatch");
    expect(codes).toContain("stated_tdsAmount_mismatch");
  });

  it("blocks a deductee who is not a seller on the transaction", () => {
    const codes = compareWithComputed(
      { instalmentSeq: 1, rows: [{ sellerPan: "QQQPQ1111Q", presentInstalment: 6400000 }] },
      computed,
    ).map((f) => f.code);
    expect(codes).toContain("stated_seller_not_on_deal");
  });

  it("blocks a Part C total that disagrees with the computation", () => {
    const codes = compareWithComputed({ instalmentSeq: 1, rows: [], totalTds: 100000 }, computed).map((f) => f.code);
    expect(codes).toContain("stated_total_tds_mismatch");
  });
});

describe("validateForm141 — the single gate", () => {
  it("orders blocking findings before warnings", () => {
    const deal = { ...DEAL, totalStampDutyValue: 0, sellers: [SELLER({ sharePct: 60 }), SELLER({ pan: "CBNPM0000M", sharePct: 60 })] };
    const r = validateForm141(deal, FILING_BUYER);
    const firstWarning = r.findings.findIndex((f) => f.severity === "warning");
    const lastBlocking = r.findings.map((f) => f.severity).lastIndexOf("blocking");
    expect(lastBlocking).toBeLessThan(firstWarning);
  });

  it("returns the computation alongside the findings", () => {
    const r = validateForm141(DEAL, FILING_BUYER);
    expect(r.computation.statements[0].totalTds).toBe(128000);
  });

  it("is not ok when anything blocks, and ok when only warnings remain", () => {
    expect(validateForm141({ ...DEAL, totalStampDutyValue: 0 }, FILING_BUYER).ok).toBe(true);
    expect(validateForm141({ ...DEAL, totalSaleConsideration: 0 }, FILING_BUYER).ok).toBe(false);
  });

  it("does not report the same blocker twice from the engine and the deal checks", () => {
    const deal = { ...DEAL, sellers: [SELLER({ sharePct: 100, residentialStatus: "non_resident" as const })] };
    const r = validateForm141(deal, FILING_BUYER);
    expect(r.findings.filter((f) => f.code === "non_resident_seller")).toHaveLength(1);
  });
});
