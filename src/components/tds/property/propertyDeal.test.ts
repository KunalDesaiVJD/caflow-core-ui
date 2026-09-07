import { describe, it, expect } from "vitest";
import {
  num,
  numOrNull,
  toForm141Deal,
  formatInr,
  emptyTransaction,
  type PropertyDealBundle,
  type PropertyPartyRow,
} from "./propertyDeal";
import { computeForm141ScheduleB } from "@/lib/tds/form141ScheduleB";

/**
 * The mapper is the seam where a stored row becomes engine input. Its whole
 * reason for existing is that PostgREST returns Postgres NUMERIC as a STRING
 * to preserve precision — so "25600000" reaches the client, and feeding that
 * straight into the engine turns multiplication into string concatenation or
 * NaN. These tests deliberately use STRING amounts, the way real rows arrive.
 */

const party = (over: Partial<PropertyPartyRow>): PropertyPartyRow => ({
  id: "p1",
  firm_id: "f1",
  transaction_id: "t1",
  party_role: "seller",
  seq: 1,
  pan: "ANRPP0000R",
  name: "Seller",
  contact: null,
  email: null,
  share_pct: "50",
  residential_status: "resident",
  section_395_certificate_no: null,
  section_395_rate: null,
  ...over,
});

/** The BTA0188370 transaction, with every numeric column as a STRING. */
const BUNDLE: PropertyDealBundle = {
  transaction: {
    id: "t1",
    firm_id: "f1",
    client_id: "c1",
    property_type: "LAND",
    property_address: "MOJE GAM- KADADRA, TALUKA- DEHGAM, GANDHI NAGAR",
    property_pin: "382305",
    date_of_agreement: "2026-09-02",
    total_sale_consideration: "25600000",
    total_stamp_duty_value: "25600000",
    payment_mode: "lumpsum",
    filing_buyer_pan: "ADFPB0000E",
    tax_year: "2026-27",
    status: "draft",
    source: "manual",
    notes: null,
  },
  parties: [
    // Deliberately out of seq order, to prove the mapper sorts them.
    party({ id: "s2", party_role: "seller", seq: 2, pan: "CBNPM0000M", name: "Seller Two" }),
    party({ id: "s1", party_role: "seller", seq: 1, pan: "ANRPP0000R", name: "Seller One" }),
    party({ id: "b2", party_role: "buyer", seq: 2, pan: "ACTPP0000E", name: "Buyer Two" }),
    party({ id: "b1", party_role: "buyer", seq: 1, pan: "ADFPB0000E", name: "Buyer One" }),
  ],
  instalments: [
    {
      id: "i1",
      firm_id: "f1",
      transaction_id: "t1",
      seq: 1,
      amount_paid_by_buyer: "12800000",
      date_paid_or_credited: "2026-09-02",
      date_of_deduction: "2026-09-02",
      date_of_deposit: "2026-09-02",
      date_of_filing: "2026-09-02",
    },
  ],
};

describe("numeric coercion", () => {
  it("turns the strings PostgREST returns into numbers", () => {
    expect(num("25600000")).toBe(25600000);
    expect(num("50.5")).toBe(50.5);
    expect(num(12800000)).toBe(12800000);
  });

  it("treats absent values as zero rather than NaN", () => {
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num("")).toBe(0);
    expect(num("not a number")).toBe(0);
  });

  it("preserves a genuine absence where zero would mean something different", () => {
    // A missing s.395(1) rate must stay null so the engine flags it. Reading
    // it as 0% would deduct nothing at all and look deliberate.
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull("")).toBeNull();
    expect(numOrNull("0.5")).toBe(0.5);
    expect(numOrNull(0)).toBe(0);
  });
});

describe("toForm141Deal", () => {
  const deal = toForm141Deal(BUNDLE);

  it("coerces every stored amount to a number", () => {
    expect(deal.totalSaleConsideration).toBe(25600000);
    expect(deal.totalStampDutyValue).toBe(25600000);
    expect(deal.instalments[0].amountPaidByBuyer).toBe(12800000);
    expect(deal.buyers[0].sharePct).toBe(50);
  });

  it("orders parties by their stored Sl. No., not by row order", () => {
    // Two identical drafts must print their deductees in the same order.
    expect(deal.buyers.map((b) => b.name)).toEqual(["Buyer One", "Buyer Two"]);
    expect(deal.sellers.map((s) => s.name)).toEqual(["Seller One", "Seller Two"]);
  });

  it("separates buyers from sellers", () => {
    expect(deal.buyers).toHaveLength(2);
    expect(deal.sellers).toHaveLength(2);
  });

  it("trims a timestamp back to a plain date", () => {
    const withTs = {
      ...BUNDLE,
      transaction: { ...BUNDLE.transaction, date_of_agreement: "2026-09-02T00:00:00+05:30" },
    };
    expect(toForm141Deal(withTs).dateOfAgreement).toBe("2026-09-02");
  });

  it("carries a null stamp duty value through as zero, not NaN", () => {
    const noSdv = { ...BUNDLE, transaction: { ...BUNDLE.transaction, total_stamp_duty_value: null } };
    expect(toForm141Deal(noSdv).totalStampDutyValue).toBe(0);
  });

  it("feeds the engine correctly end to end — the filed statement replays", () => {
    // The real proof: stored rows in, the acknowledgement's own figures out.
    const r = computeForm141ScheduleB(deal, "ADFPB0000E");
    expect(r.blockers).toEqual([]);
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].totalTds).toBe(128000);
    expect(r.statements[0].rows.map((x) => x.tdsAmount)).toEqual([64000, 64000]);
    expect(r.statements[0].month).toBe("Sep-2026");
    expect(r.statements[0].dueDate).toBe("2026-10-30");
  });
});

describe("display", () => {
  it("groups digits the Indian way, matching the form", () => {
    expect(formatInr(25600000)).toBe("₹2,56,00,000");
    expect(formatInr("12800000")).toBe("₹1,28,00,000");
    expect(formatInr(64000)).toBe("₹64,000");
    expect(formatInr(null)).toBe("₹0");
  });
});

describe("emptyTransaction", () => {
  it("starts amounts blank rather than guessing them", () => {
    const t = emptyTransaction("c1", "f1");
    expect(t.total_sale_consideration).toBe(0);
    expect(t.total_stamp_duty_value).toBeNull();
    expect(t.status).toBe("draft");
    expect(t.source).toBe("manual");
    expect(t.payment_mode).toBe("lumpsum");
  });
});
