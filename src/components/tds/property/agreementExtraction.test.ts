import { describe, it, expect } from "vitest";
import {
  parseIndianAmount,
  normaliseDate,
  normalisePan,
  applyExtraction,
  blockingQueries,
  openQueries,
  resolveQuery,
  confirmField,
  unconfirmedFields,
  CRITICAL_FIELDS,
  type AgreementExtraction,
  type ExtractedField,
} from "./agreementExtraction";
import { emptyTransaction, toForm141Deal, type PropertyDealBundle } from "./propertyDeal";
import { normaliseIndianDigits } from "@/lib/tds/indianAmount";
import { computeForm141ScheduleB } from "@/lib/tds/form141ScheduleB";

const BASE: PropertyDealBundle = {
  transaction: emptyTransaction("client-1", "firm-1"),
  parties: [],
  instalments: [],
};

const f = (value: unknown, confidence: "high" | "medium" | "low" = "high"): ExtractedField => ({
  value,
  confidence,
  page: 1,
  snippet: "source text",
});

/** A clean read of the transaction behind acknowledgement BTA0188370. */
const GOOD_EXTRACTION: AgreementExtraction = {
  document_kind: "sale_agreement",
  document_kind_confidence: "high",
  extraction_status: "extracted",
  queries: [],
  fields: {
    property_type: f("LAND"),
    property_address: f("KHATA NO- 1349, SR/BLOCK NO- 723/2, MOJE GAM- KADADRA, TALUKA- DEHGAM, GANDHI NAGAR, Gujarat 382305"),
    date_of_agreement: f("2026-09-02"),
    total_sale_consideration: f(25600000),
    total_stamp_duty_value: f(25600000),
    payment_mode: f("lumpsum"),
    buyers: f([
      { name: "Buyer One", pan: "ADFPB0000E", share_pct: 50 },
      { name: "Buyer Two", pan: "ACTPP0000E", share_pct: 50 },
    ]),
    sellers: f([
      { name: "Seller One", pan: "ANRPP0000R", contact: "9300000020", email: "one@example.com", share_pct: 50 },
      { name: "Seller Two", pan: "CBNPM0000M", contact: "9600000043", email: "two@example.com", share_pct: 50 },
    ]),
    instalments: f([{ amount: 25600000, date_paid_or_credited: "2026-09-02" }]),
  },
};

describe("parseIndianAmount — the shapes a deed actually writes", () => {
  it("reads 2,2,3 digit grouping, not 3,3,3", () => {
    expect(parseIndianAmount("₹2,56,00,000")).toBe(25600000);
    expect(parseIndianAmount("Rs. 64,00,000")).toBe(6400000);
  });

  it("strips the trailing /- Indian documents use", () => {
    expect(parseIndianAmount("₹1,28,00,000/-")).toBe(12800000);
  });

  it("expands crore and lakh, in their many spellings", () => {
    expect(parseIndianAmount("1.28 Cr")).toBe(12800000);
    expect(parseIndianAmount("2.56 crore")).toBe(25600000);
    expect(parseIndianAmount("50 lakhs")).toBe(5000000);
    expect(parseIndianAmount("50 lacs")).toBe(5000000);
    expect(parseIndianAmount("Rs. 75 Lakh")).toBe(7500000);
  });

  it("passes a plain number straight through", () => {
    expect(parseIndianAmount(25600000)).toBe(25600000);
  });

  it("returns null — never 0 — for anything it cannot read", () => {
    // Zero is a legitimate amount. Substituting it for "unreadable" would take
    // a deal under the ₹50,00,000 threshold and produce no filing at all.
    expect(parseIndianAmount("as per schedule annexed")).toBeNull();
    expect(parseIndianAmount(null)).toBeNull();
    expect(parseIndianAmount("")).toBeNull();
    expect(parseIndianAmount(undefined)).toBeNull();
  });
});

describe("normaliseDate", () => {
  it("reads an ambiguous slash date as DD/MM/YYYY, the Indian convention", () => {
    // 05/09/2026 is 5 September, not 9 May. Reading it the American way would
    // move the filing four months and invent a late fee.
    expect(normaliseDate("05/09/2026")).toBe("2026-09-05");
    expect(normaliseDate("2-9-2026")).toBe("2026-09-02");
  });

  it("passes ISO through", () => {
    expect(normaliseDate("2026-09-02")).toBe("2026-09-02");
    expect(normaliseDate("2026-09-02T00:00:00Z")).toBe("2026-09-02");
  });

  it("rejects an impossible date rather than coercing it", () => {
    expect(normaliseDate("32/13/2026")).toBeNull();
    expect(normaliseDate("sometime in September")).toBeNull();
  });
});

describe("normalisePan", () => {
  it("accepts a well-formed PAN and uppercases it", () => {
    expect(normalisePan("adfpb0000e")).toBe("ADFPB0000E");
    expect(normalisePan(" ANRPP0000R ")).toBe("ANRPP0000R");
  });

  it("rejects a near-miss rather than filing under a PAN nobody owns", () => {
    expect(normalisePan("ANRP0000R")).toBeNull();   // 9 chars
    expect(normalisePan("ANRPP00000")).toBeNull();  // ends in a digit
    expect(normalisePan("not a pan")).toBeNull();
    expect(normalisePan(null)).toBeNull();
  });
});

describe("applyExtraction — a clean read", () => {
  const r = applyExtraction(GOOD_EXTRACTION, BASE);

  it("fills the transaction", () => {
    expect(r.bundle.transaction.property_type).toBe("LAND");
    expect(r.bundle.transaction.total_sale_consideration).toBe(25600000);
    expect(r.bundle.transaction.total_stamp_duty_value).toBe(25600000);
    expect(r.bundle.transaction.date_of_agreement).toBe("2026-09-02");
    expect(r.bundle.transaction.payment_mode).toBe("lumpsum");
  });

  it("marks the transaction as extracted, not manual", () => {
    expect(r.bundle.transaction.source).toBe("agreement_upload");
  });

  it("reads both sides of the deal", () => {
    expect(r.bundle.parties.filter((p) => p.party_role === "buyer")).toHaveLength(2);
    expect(r.bundle.parties.filter((p) => p.party_role === "seller")).toHaveLength(2);
  });

  it("scales the deed's whole-property amount down to this buyer's share", () => {
    // The deed states ₹2,56,00,000 for the property. This buyer holds 50%, so
    // their own payment — what Form 141 asks for — is ₹1,28,00,000.
    expect(r.bundle.instalments[0].amount_paid_by_buyer).toBe(12800000);
  });

  it("proposes same-day deduction, which the deed never states", () => {
    expect(r.bundle.instalments[0].date_of_deduction).toBe("2026-09-02");
    expect(r.bundle.instalments[0].date_of_deposit).toBeNull();
  });

  it("asks for no confirmations when everything read at high confidence", () => {
    expect(r.needsConfirmation).toEqual([]);
    expect(r.withheld).toEqual([]);
  });

  it("produces a transaction the engine computes correctly", () => {
    // The real proof of the whole pipeline: deed → extraction → bundle →
    // engine → the acknowledgement's own figures.
    const computed = computeForm141ScheduleB(toForm141Deal(r.bundle), "ADFPB0000E");
    expect(computed.blockers).toEqual([]);
    expect(computed.statements[0].totalTds).toBe(128000);
    expect(computed.statements[0].rows.map((x) => x.tdsAmount)).toEqual([64000, 64000]);
  });
});

describe("confidence gating", () => {
  it("withholds a LOW-confidence consideration rather than pre-filling a guess", () => {
    const ex: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: { ...GOOD_EXTRACTION.fields, total_sale_consideration: f(25600000, "low") },
    };
    const r = applyExtraction(ex, BASE);
    expect(r.bundle.transaction.total_sale_consideration).toBe(0); // left as the blank default
    expect(r.withheld).toContain("total_sale_consideration");
  });

  it("pre-fills a MEDIUM-confidence critical field but demands confirmation", () => {
    const ex: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: { ...GOOD_EXTRACTION.fields, total_stamp_duty_value: f(25600000, "medium") },
    };
    const r = applyExtraction(ex, BASE);
    expect(r.bundle.transaction.total_stamp_duty_value).toBe(25600000);
    expect(r.needsConfirmation).toContain("total_stamp_duty_value");
  });

  it("still pre-fills a LOW-confidence non-critical field", () => {
    // A wrong address is obvious on sight and costs a correction. A wrong
    // consideration is invisible and costs a misfiled return.
    const ex: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: { ...GOOD_EXTRACTION.fields, property_address: f("Some address", "low") },
    };
    const r = applyExtraction(ex, BASE);
    expect(r.bundle.transaction.property_address).toBe("Some address");
    expect(r.withheld).not.toContain("property_address");
  });

  it("treats the two amounts and the agreement date as the critical set", () => {
    expect([...CRITICAL_FIELDS].sort()).toEqual([
      "date_of_agreement",
      "total_sale_consideration",
      "total_stamp_duty_value",
    ]);
  });

  it("withholds an unparseable amount even at high confidence", () => {
    const ex: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: { ...GOOD_EXTRACTION.fields, total_sale_consideration: f("as per annexure") },
    };
    const r = applyExtraction(ex, BASE);
    expect(r.bundle.transaction.total_sale_consideration).toBe(0);
    expect(r.withheld).toContain("total_sale_consideration");
  });
});

/**
 * The three shapes a model actually returns for a list field.
 *
 * The prompt says "every field is an object {value, confidence, page,
 * snippet}" AND "buyers — array of {...}". Both are satisfiable three
 * different ways, and requiring only the specified one is what made a real
 * registered deed come back with no parties, no payments and therefore no
 * tax — silently, which is the worst part: zero tax looks exactly like a
 * below-threshold deal.
 */
describe("list fields — every shape a model returns", () => {
  const BUYERS = [
    { name: "Buyer One", pan: "ADFPB0000E", share_pct: 50 },
    { name: "Buyer Two", pan: "ACTPP0000E", share_pct: 50 },
  ];

  const withBuyers = (buyers: unknown): AgreementExtraction => ({
    ...GOOD_EXTRACTION,
    fields: { ...GOOD_EXTRACTION.fields, buyers: buyers as never },
  });

  it("reads the specified shape: {value: [...]}", () => {
    const r = applyExtraction(withBuyers(f(BUYERS)), BASE);
    expect(r.bundle.parties.filter((p) => p.party_role === "buyer")).toHaveLength(2);
    expect(r.unreadable).not.toContain("buyers");
  });

  it("reads a BARE array with no envelope", () => {
    const r = applyExtraction(withBuyers(BUYERS), BASE);
    const buyers = r.bundle.parties.filter((p) => p.party_role === "buyer");
    expect(buyers).toHaveLength(2);
    expect(buyers[0].name).toBe("Buyer One");
    expect(buyers[0].pan).toBe("ADFPB0000E");
    expect(buyers[0].share_pct).toBe(50);
  });

  it("reads rows whose every leaf carries its OWN envelope", () => {
    const nested = f([
      {
        name: { value: "Buyer One", confidence: "high", page: 2, snippet: "..." },
        pan: { value: "ADFPB0000E", confidence: "high", page: 2, snippet: "..." },
        share_pct: { value: 50, confidence: "medium", page: 2, snippet: "..." },
      },
    ]);
    const r = applyExtraction(withBuyers(nested), BASE);
    const buyers = r.bundle.parties.filter((p) => p.party_role === "buyer");
    expect(buyers).toHaveLength(1);
    expect(buyers[0].name).toBe("Buyer One");
    expect(buyers[0].pan).toBe("ADFPB0000E");
    expect(buyers[0].share_pct).toBe(50);
  });

  it("reads instalments in a bare-array shape too, and computes tax from them", () => {
    const ex: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: {
        ...GOOD_EXTRACTION.fields,
        buyers: BUYERS as never,
        sellers: [
          { name: "Seller One", pan: "ANRPP0000R", share_pct: 50 },
          { name: "Seller Two", pan: "CBNPM0000M", share_pct: 50 },
        ] as never,
        instalments: [{ amount: 25600000, date_paid_or_credited: "2026-09-02" }] as never,
      },
    };
    const r = applyExtraction(ex, BASE);
    expect(r.unreadable).toEqual([]);
    const computed = computeForm141ScheduleB(toForm141Deal(r.bundle), "ADFPB0000E");
    expect(computed.statements[0].totalTds).toBe(128000);
  });

  it("SAYS SO when a field arrives in a shape it cannot read", () => {
    // The old failure was silent. A list that yields nothing must be reported,
    // because an empty seller list computes zero tax.
    const r = applyExtraction(withBuyers(f("Girishbhai and Pratapbhai")), BASE);
    expect(r.bundle.parties.filter((p) => p.party_role === "buyer")).toHaveLength(0);
    expect(r.unreadable).toContain("buyers");
  });

  it("does NOT report a field the model legitimately left empty", () => {
    const r = applyExtraction(withBuyers(f(null)), BASE);
    expect(r.unreadable).not.toContain("buyers");
  });

  it("tolerates an enveloped scalar and a bare scalar alike", () => {
    const bare: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: {
        ...GOOD_EXTRACTION.fields,
        property_type: "LAND" as never,
        total_sale_consideration: f(25600000),
      },
    };
    expect(applyExtraction(bare, BASE).bundle.transaction.property_type).toBe("LAND");
  });
});

describe("shares are never re-normalised", () => {
  it("carries a deed whose shares do not total 100% straight through", () => {
    // Smoothing 60+60 to 50+50 would hide a real defect behind a plausible
    // number. The validation engine blocks on it instead.
    const ex: AgreementExtraction = {
      ...GOOD_EXTRACTION,
      fields: {
        ...GOOD_EXTRACTION.fields,
        sellers: f([
          { name: "Seller One", pan: "ANRPP0000R", share_pct: 60 },
          { name: "Seller Two", pan: "CBNPM0000M", share_pct: 60 },
        ]),
      },
    };
    const r = applyExtraction(ex, BASE);
    const sellers = r.bundle.parties.filter((p) => p.party_role === "seller");
    expect(sellers.map((s) => s.share_pct)).toEqual([60, 60]);
  });
});

describe("a document that is not a property instrument", () => {
  const notProperty: AgreementExtraction = {
    document_kind: "other",
    document_kind_confidence: "high",
    extraction_status: "not_a_property_document",
    fields: {},
    queries: [{
      field: "document_kind",
      question: "This looks like a rent agreement, not a property transfer. Is that right?",
      why: "TDS on rent is a different schedule of Form 141 and is not handled here.",
      evidence: { page: 1, snippet: "LEASE DEED" },
      blocking: true,
    }],
  };

  it("returns nothing rather than a half-filled transaction", () => {
    const r = applyExtraction(notProperty, BASE);
    expect(r.bundle).toEqual(BASE);
    expect(r.needsConfirmation).toEqual([]);
  });

  it("still surfaces the query explaining why", () => {
    const r = applyExtraction(notProperty, BASE);
    expect(r.queries).toHaveLength(1);
    expect(blockingQueries(r.queries)).toHaveLength(1);
  });

  it("returns nothing for a failed extraction too", () => {
    const r = applyExtraction({ ...notProperty, extraction_status: "failed" }, BASE);
    expect(r.bundle).toEqual(BASE);
  });
});

describe("the resolution queue", () => {
  const WITH_QUERIES: AgreementExtraction = {
    ...GOOD_EXTRACTION,
    fields: { ...GOOD_EXTRACTION.fields, total_stamp_duty_value: f(null, "low") },
    queries: [
      {
        field: "total_stamp_duty_value",
        question: "The stamp duty value is not stated in this document. What is it?",
        why: "Tax is charged on the higher of consideration and stamp duty value, so an absent figure can understate the deduction.",
        evidence: { page: null, snippet: null },
        blocking: true,
      },
      {
        field: "total_sale_consideration",
        question: "The consideration reads 'Two Crore Fifty Six Lakh' in words but '2,65,00,000' in figures. Which is right?",
        why: "The two disagree by ₹9,00,000, which changes the tax by ₹9,000.",
        options: ["₹2,56,00,000 (words)", "₹2,65,00,000 (figures)"],
        evidence: { page: 3, snippet: "Rupees Two Crore Fifty Six Lakh (Rs. 2,65,00,000/-)" },
        blocking: true,
      },
      {
        field: "property_type",
        question: "Is this agricultural land?",
        why: "Rural agricultural land is outside the charge.",
        evidence: { page: 2, snippet: "agricultural survey no." },
        blocking: false,
      },
    ],
  };

  const r = applyExtraction(WITH_QUERIES, BASE);

  it("separates blocking questions from the rest", () => {
    expect(r.queries).toHaveLength(3);
    expect(blockingQueries(r.queries)).toHaveLength(2);
    expect(openQueries(r.queries)).toHaveLength(3);
  });

  it("records an answer without deleting the question", () => {
    const after = resolveQuery(r.queries, 0, "₹2,56,00,000 per Index-II", "2026-09-07T10:00:00Z");
    expect(after).toHaveLength(3);
    expect(after[0].answer).toBe("₹2,56,00,000 per Index-II");
    expect(after[0].resolvedAt).toBe("2026-09-07T10:00:00Z");
    // The question survives alongside its answer — both halves stay on the
    // record for whoever reads the file later.
    expect(after[0].question).toContain("stamp duty value");
  });

  it("clears a resolved query out of the open and blocking sets", () => {
    const after = resolveQuery(r.queries, 0, "₹2,56,00,000");
    expect(blockingQueries(after)).toHaveLength(1);
    expect(openQueries(after)).toHaveLength(2);
  });

  it("leaves other queries untouched when one is answered", () => {
    const after = resolveQuery(r.queries, 1, "the words are right");
    expect(after[0].resolvedAt).toBeNull();
    expect(after[2].resolvedAt).toBeNull();
  });
});

describe("confirming a reading", () => {
  const ex: AgreementExtraction = {
    ...GOOD_EXTRACTION,
    fields: {
      ...GOOD_EXTRACTION.fields,
      total_stamp_duty_value: f(25600000, "medium"),
      date_of_agreement: f("2026-09-02", "medium"),
    },
  };
  const r = applyExtraction(ex, BASE);

  it("lists both unconfirmed readings", () => {
    expect(unconfirmedFields(r.provenance).sort()).toEqual(["date_of_agreement", "total_stamp_duty_value"]);
  });

  it("promotes a field once a human has looked at it", () => {
    const p = confirmField(r.provenance, "total_stamp_duty_value");
    expect(p.total_stamp_duty_value.needsConfirmation).toBe(false);
    expect(p.total_stamp_duty_value.source).toBe("user_resolved");
    // Confirming records that someone checked; it does not alter the value.
    expect(unconfirmedFields(p)).toEqual(["date_of_agreement"]);
  });

  it("keeps the page and snippet so the reviewer can check the source", () => {
    expect(r.provenance.total_stamp_duty_value.page).toBe(1);
    expect(r.provenance.total_stamp_duty_value.snippet).toBe("source text");
  });

  it("is a no-op on a field that was never extracted", () => {
    expect(confirmField(r.provenance, "nonexistent")).toBe(r.provenance);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Gujarati દસ્તાવેજ — native numerals, and rows that must not vanish
 * ════════════════════════════════════════════════════════════════════════════
 */

describe("normaliseIndianDigits", () => {
  it("reads Gujarati numerals", () => {
    expect(normaliseIndianDigits("૨,૫૬,૦૦,૦૦૦")).toBe("2,56,00,000");
  });

  it("reads the other Indian scripts a deed might arrive in", () => {
    expect(normaliseIndianDigits("१२८०००")).toBe("128000");   // Devanagari
    expect(normaliseIndianDigits("੫੦੦੦੦੦੦")).toBe("5000000"); // Gurmukhi
    expect(normaliseIndianDigits("১২৮")).toBe("128");          // Bengali
  });

  it("leaves everything that is not a digit alone", () => {
    // Mixed script is the normal case: a Gujarati deed with an English schedule.
    expect(normaliseIndianDigits("સર્વે નં. ૧૪૨, Block ૭૨૩/૨"))
      .toBe("સર્વે નં. 142, Block 723/2");
    expect(normaliseIndianDigits("₹2,56,00,000/-")).toBe("₹2,56,00,000/-");
  });
});

describe("parseIndianAmount — Gujarati figures", () => {
  it("reads an amount written in Gujarati numerals", () => {
    // JS gives up here on its own: Number("૨૫૬૦૦૦૦૦") is NaN and /\d/ does not
    // match a Gujarati digit, so this used to return null — and a null amount
    // silently dropped the whole instalment row.
    expect(parseIndianAmount("૨,૫૬,૦૦,૦૦૦")).toBe(25600000);
    expect(parseIndianAmount("₹ ૬૪,૦૦,૦૦૦/-")).toBe(6400000);
  });

  it("still applies the lakh/crore multipliers to native numerals", () => {
    expect(parseIndianAmount("૫૦ lacs")).toBe(5000000);
  });

  it("has not changed how Latin figures read", () => {
    expect(parseIndianAmount("₹2,56,00,000")).toBe(25600000);
    expect(parseIndianAmount("Rs. 1.28 Cr")).toBe(12800000);
    expect(parseIndianAmount("not an amount")).toBeNull();
  });
});

describe("normaliseDate — Gujarati figures", () => {
  it("reads a date written in Gujarati numerals", () => {
    expect(normaliseDate("૦૨/૦૯/૨૦૨૬")).toBe("2026-09-02");
    expect(normaliseDate("૦૨-Sep-૨૦૨૬")).toBe("2026-09-02");
  });
});

describe("instalment rows that cannot be read are reported, not swallowed", () => {
  const withInstalments = (rows: unknown[]): AgreementExtraction => ({
    ...GOOD_EXTRACTION,
    fields: {
      ...GOOD_EXTRACTION.fields,
      payment_mode: f("instalments"),
      instalments: f(rows),
    },
  });

  it("says how many of how many survived", () => {
    const r = applyExtraction(
      withInstalments([
        { amount: 5000000, date_paid_or_credited: "2026-06-01" },
        { amount: "could not read", date_paid_or_credited: "2026-07-01" },
        { amount: 5000000, date_paid_or_credited: "2026-08-01" },
      ]),
      BASE,
    );
    expect(r.bundle.instalments).toHaveLength(2);
    expect(r.dropped).toEqual([{ field: "instalments", kept: 2, total: 3 }]);
  });

  it("catches a row whose DATE is the unreadable half", () => {
    const r = applyExtraction(
      withInstalments([
        { amount: 5000000, date_paid_or_credited: "2026-06-01" },
        { amount: 5000000, date_paid_or_credited: "sometime after Diwali" },
      ]),
      BASE,
    );
    expect(r.dropped).toEqual([{ field: "instalments", kept: 1, total: 2 }]);
  });

  it("reports nothing when every row was usable", () => {
    const r = applyExtraction(
      withInstalments([
        { amount: 5000000, date_paid_or_credited: "2026-06-01" },
        { amount: 5000000, date_paid_or_credited: "2026-08-01" },
      ]),
      BASE,
    );
    expect(r.dropped).toEqual([]);
  });

  it("no longer drops a row merely for being written in Gujarati", () => {
    // The regression this pair of fixes exists for: before the digit
    // normalisation, this row parsed to null and disappeared.
    const r = applyExtraction(
      withInstalments([
        { amount: "૫૦,૦૦,૦૦૦", date_paid_or_credited: "૦૧/૦૬/૨૦૨૬" },
        { amount: 5000000, date_paid_or_credited: "2026-08-01" },
      ]),
      BASE,
    );
    expect(r.dropped).toEqual([]);
    expect(r.bundle.instalments).toHaveLength(2);
    // Buyer One holds 50%, so their share of a ₹50,00,000 payment is ₹25,00,000.
    expect(r.bundle.instalments[0].amount_paid_by_buyer).toBe(2500000);
    expect(r.bundle.instalments[0].date_paid_or_credited).toBe("2026-06-01");
  });
});
