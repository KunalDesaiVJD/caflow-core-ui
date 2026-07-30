import { describe, expect, it } from "vitest";
import { evaluateAckMismatch, buildAckRejectMessage, buildAckWarningMessage, normalizeFy, type AckFilingIdentity } from "./ackMismatch";
import type { AckFields } from "./ackPdf";

// Real extracted fields from a genuine Form 24Q e-filing acknowledgement
// (Form 24Q_ARN_770000388680821.pdf) — the exact fixture pinned in
// ackPdf.test.ts's "extracts Name/Financial Year/Quarter/..." case. Ground
// truth: FY 2025-26, Quarter Q4.
const REAL_Q4_FIELDS: AckFields = {
  ackNumber: "988617480290526",
  name: "KWIKTEAM SUPPORT SERVICES PRIVATE LIMITED",
  financialYear: "2025-26",
  quarter: "Q4",
  formNo: "24Q",
  tan: "AHMK08204A",
};

const baseFiling = (overrides: Partial<AckFilingIdentity> = {}): AckFilingIdentity => ({
  financial_year: "2025-26",
  quarter: "Q4",
  tan: "AHMK08204A",
  tds_forms: ["24Q"],
  ...overrides,
});

const client = { name: "KWIKTEAM SUPPORT SERVICES PRIVATE LIMITED", tan_number: "AHMK08204A" };

describe("evaluateAckMismatch — regression: real Q4 receipt vs a Q1 filing", () => {
  it("REJECTS (not silently accepted) when a genuine, fully-extracted Q4 acknowledgement is attached to a synthetic Q1 filing row for the same client/FY", () => {
    // This is the exact real-world scenario that previously produced no
    // visible warning and silently linked the wrong receipt: FY matches
    // (2025-26 on both sides), only the Quarter differs (Q4 vs Q1).
    const q1Filing = baseFiling({ quarter: "Q1" });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, q1Filing, client);

    expect(result.rejectReasons).toEqual(["Quarter (Q4 vs Q1)"]);
    expect(result.warnReasons).toEqual([]); // name/TAN/form all match — nothing to warn about either

    const message = buildAckRejectMessage(REAL_Q4_FIELDS, q1Filing, client, result.rejectReasons);
    expect(message).toContain("FY 2025-26 Q4");
    expect(message).toContain("FY 2025-26 Q1");
    expect(message).toContain("Quarter (Q4 vs Q1)");
    expect(message).toContain("Attach the correct file, or contact support if this is expected.");
  });

  it("also rejects the reverse direction — a Q1 receipt attached to a Q4 filing", () => {
    const fieldsQ1: AckFields = { ...REAL_Q4_FIELDS, quarter: "Q1" };
    const q4Filing = baseFiling({ quarter: "Q4" });
    const result = evaluateAckMismatch(fieldsQ1, q4Filing, client);
    expect(result.rejectReasons).toEqual(["Quarter (Q1 vs Q4)"]);
  });
});

describe("evaluateAckMismatch — regression: real 24Q receipt vs a 26Q filing", () => {
  it("REJECTS (not silently accepted) when a genuine, fully-extracted 24Q acknowledgement is attached to a synthetic 26Q filing row for the same client/FY/quarter", () => {
    // The exact real-world scenario reported: a 24Q acknowledgement was
    // attached to a 26Q client's filing and accepted with no block — Form
    // Type was previously a soft warning only, same class of gap FY/Quarter
    // closed earlier. FY and Quarter both match here (2025-26 Q4 on both
    // sides); only the form type differs (24Q vs 26Q).
    const form26QFiling = baseFiling({ tds_forms: ["26Q"] });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, form26QFiling, client);

    expect(result.rejectReasons).toEqual(["Form Type (24Q vs 26Q)"]);
    expect(result.warnReasons).toEqual([]);

    const message = buildAckRejectMessage(REAL_Q4_FIELDS, form26QFiling, client, result.rejectReasons);
    expect(message).toContain("Form Type (24Q vs 26Q)");
    expect(message).toContain("Attach the correct file, or contact support if this is expected.");
  });

  it("rejects on Form Type AND Quarter independently when both genuinely mismatch", () => {
    const filing = baseFiling({ tds_forms: ["26Q"], quarter: "Q1" });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, filing, client);
    expect(result.rejectReasons).toEqual([
      "Quarter (Q4 vs Q1)",
      "Form Type (24Q vs 26Q)",
    ]);
  });
});

describe("evaluateAckMismatch — regression: new IT-portal 'Form 140' receipt for a genuine 26Q return", () => {
  // Real extracted fields from a genuine e-filing receipt (Form
  // 140_ARN_770000408905932.pdf) for ATC LOGISTICS, Tax Year 2026-27, Q1.
  // The portal's newer "Acknowledgement Receipt of Income Tax Forms (Other
  // Than Income Tax Return)" template — seen starting Tax Year 2026-27,
  // apparently tied to the new Income Tax Act 2025 renumbering (this receipt
  // cites section 397(3)(b), not the old Act's 200(3)) — prints "Form No. :
  // Form 140" instead of "Form 26Q". Ground truth that this genuinely IS a
  // 26Q return: the receipt lists its own attachment as "26QRQ1.zip" and its
  // Form Description as "...deduction of tax...in respect of payments made
  // other than salary" (26Q's own defining description). Before this fix,
  // this real, correct receipt was REJECTED with "Form Type (140 vs 26Q)".
  const REAL_FORM_140_FIELDS: AckFields = {
    ackNumber: "796898970300726",
    name: "Atc Logistics",
    financialYear: "2026-27", // extracted via the Tax Year fallback — see ackPdf.test.ts
    quarter: "Q1",
    formNo: "140",
    tan: "AHMA14484B",
  };
  const atcFiling = baseFiling({
    financial_year: "2026-27", quarter: "Q1", tan: "AHMA14484B", tds_forms: ["26Q"],
  });
  const atcClient = { name: "ATC LOGISTICS", tan_number: "AHMA14484B" };

  it("does NOT reject — Form 140 is recognised as the portal's own code for 26Q", () => {
    const result = evaluateAckMismatch(REAL_FORM_140_FIELDS, atcFiling, atcClient);
    expect(result.rejectReasons).toEqual([]);
    expect(result.warnReasons).toEqual([]);
  });

  it("still rejects a genuine Form 140 receipt attached to an actually-different filing (24Q)", () => {
    const wrongFiling = baseFiling({
      financial_year: "2026-27", quarter: "Q1", tan: "AHMA14484B", tds_forms: ["24Q"],
    });
    const result = evaluateAckMismatch(REAL_FORM_140_FIELDS, wrongFiling, atcClient);
    expect(result.rejectReasons).toEqual(["Form Type (140 vs 24Q)"]);
  });
});

describe("evaluateAckMismatch — Financial Year", () => {
  it("rejects a genuine Financial Year mismatch", () => {
    const filing = baseFiling({ financial_year: "2024-25" });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, filing, client);
    expect(result.rejectReasons).toEqual(["Financial Year (2025-26 vs 2024-25)"]);
  });

  it("rejects on BOTH Financial Year and Quarter independently when both genuinely mismatch", () => {
    const filing = baseFiling({ financial_year: "2024-25", quarter: "Q2" });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, filing, client);
    expect(result.rejectReasons).toEqual([
      "Financial Year (2025-26 vs 2024-25)",
      "Quarter (Q4 vs Q2)",
    ]);
  });

  it("treats '2025-26' and '2025-2026' as equivalent — no reject for a harmless 2-vs-4-digit end-year difference", () => {
    const filing = baseFiling({ financial_year: "2025-2026" });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, filing, client);
    expect(result.rejectReasons).toEqual([]);
  });

  it("normalizeFy folds 4-digit end years and uppercases free text the same way on both sides", () => {
    expect(normalizeFy("2025-2026")).toBe(normalizeFy("2025-26"));
    expect(normalizeFy(" 2025-26 ")).toBe("2025-26");
  });
});

describe("evaluateAckMismatch — extraction failure is NOT a mismatch (nothing to compare)", () => {
  const ALL_NULL_FIELDS: AckFields = { ackNumber: null, name: null, financialYear: null, quarter: null, formNo: null, tan: null };

  it("never rejects or warns when the PDF has no text layer at all (scanned/image-only) — even against a totally different filing", () => {
    const filing = baseFiling({ financial_year: "2019-20", quarter: "Q1", tds_forms: ["26Q"] });
    const result = evaluateAckMismatch(ALL_NULL_FIELDS, filing, { name: "SOME OTHER COMPANY LTD", tan_number: "ZZZZ00000Z" });
    expect(result.rejectReasons).toEqual([]);
    expect(result.warnReasons).toEqual([]);
  });

  it("rejects on Financial Year alone when Quarter extraction failed but FY was readable and genuinely mismatches (per-field, not all-or-nothing)", () => {
    const partialFields: AckFields = { ...REAL_Q4_FIELDS, quarter: null };
    const filing = baseFiling({ financial_year: "2024-25", quarter: "Q1" });
    const result = evaluateAckMismatch(partialFields, filing, client);
    // Quarter contributes nothing (extraction failed = nothing to compare there),
    // but the genuinely-extracted, genuinely-mismatched FY still rejects.
    expect(result.rejectReasons).toEqual(["Financial Year (2025-26 vs 2024-25)"]);
  });

  it("rejects on Quarter alone when Financial Year extraction failed but Quarter was readable and genuinely mismatches", () => {
    const partialFields: AckFields = { ...REAL_Q4_FIELDS, financialYear: null };
    const filing = baseFiling({ quarter: "Q1" });
    const result = evaluateAckMismatch(partialFields, filing, client);
    expect(result.rejectReasons).toEqual(["Quarter (Q4 vs Q1)"]);
  });
});

describe("evaluateAckMismatch — Client Name is now a REJECT (upgraded from warn-only)", () => {
  it("rejects on a genuine name mismatch, even when FY/Quarter/Form all match", () => {
    const filing = baseFiling();
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, filing, { name: "SOME COMPLETELY DIFFERENT COMPANY LIMITED", tan_number: "AHMK08204A" });
    expect(result.rejectReasons.length).toBeGreaterThan(0);
    expect(result.rejectReasons[0]).toContain("Client Name");
    expect(result.warnReasons).toEqual([]);
  });

  it("does not reject on equivalent name spellings (PVT/PRIVATE, LTD/LIMITED handled by nameCompare)", () => {
    const fieldsWithPvtLtd: AckFields = { ...REAL_Q4_FIELDS, name: "KWIKTEAM SUPPORT SERVICES PVT LTD" };
    const result = evaluateAckMismatch(fieldsWithPvtLtd, baseFiling(), client);
    expect(result.rejectReasons).toEqual([]);
  });

  it("buildAckWarningMessage returns null when there is nothing to warn about", () => {
    expect(buildAckWarningMessage(REAL_Q4_FIELDS, baseFiling(), client, [])).toBeNull();
  });

  it("buildAckWarningMessage renders the mismatch reasons when present (used for the remaining warn-only fields, e.g. TAN)", () => {
    const reasons = ['TAN ("X" vs "Y")'];
    const message = buildAckWarningMessage(REAL_Q4_FIELDS, baseFiling(), client, reasons);
    expect(message).toContain("Please verify this is the correct file.");
    expect(message).toContain('TAN ("X" vs "Y")');
  });
});

describe("evaluateAckMismatch — TAN remains warn-only; Form Type is now a REJECT (upgraded)", () => {
  it("warns (does not reject) on a TAN mismatch — not part of the required Form/Client/FY/Quarter set", () => {
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, baseFiling(), { name: client.name, tan_number: "BBBB00000B" });
    expect(result.rejectReasons).toEqual([]);
    expect(result.warnReasons.some((r) => r.startsWith("TAN"))).toBe(true);
  });

  it("rejects (does not merely warn) on a Form Type mismatch", () => {
    const filing = baseFiling({ tds_forms: ["26Q"] });
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, filing, client);
    expect(result.warnReasons).toEqual([]);
    expect(result.rejectReasons.some((r) => r.startsWith("Form Type"))).toBe(true);
  });
});

describe("evaluateAckMismatch — a fully matching receipt produces neither reject nor warn", () => {
  it("returns empty reject and warn arrays when every field matches", () => {
    const result = evaluateAckMismatch(REAL_Q4_FIELDS, baseFiling(), client);
    expect(result.rejectReasons).toEqual([]);
    expect(result.warnReasons).toEqual([]);
  });
});
