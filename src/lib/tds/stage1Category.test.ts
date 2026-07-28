import { describe, it, expect } from "vitest";
import { errorTypeFor, reasonFor, type ReconResultLike } from "./tdsReport";

/**
 * STAGE 1 — every dispute must be filed under the figure that actually differs.
 *
 * Stage 1 has always COMPUTED a full per-field diff (comparePair in
 * tds-recon-compare emits name / pan / date / amount / tds / interest / section,
 * each with the exact values and the exact gap). It then threw that away when
 * assigning the record a CATEGORY: every paired dispute became one
 * undifferentiated "Field Mismatch" bucket, so a checker could neither see nor
 * filter by whether the problem was the gross figure, the TDS figure, the name
 * or the date — a generic verdict where the engine held the exact reason.
 *
 * Both 24Q and 26Q carry TWO independent money figures per record and compare
 * them separately, so each gets its own named category — the same vocabulary
 * Stage 3 reports.
 */
const rec = (fields: Partial<Record<string, boolean>>, status: ReconResultLike["match_status"] = "mismatched"): ReconResultLike => ({
  match_status: status,
  field_diffs: ["name", "pan", "date", "amount", "tds", "interest", "section"].map((field) => ({
    field, office: null, imported: null, matched: fields[field] !== false, difference: "",
  })),
});

describe("Stage 1 — the category names the figure that differs, for 24Q and 26Q alike", () => {
  it("24Q calls the gross figure Taxable Income; 26Q calls it Amount", () => {
    const r = rec({ amount: false });
    expect(errorTypeFor(r, "24Q")).toBe("Taxable Income Mismatch");
    expect(errorTypeFor(r, "26Q")).toBe("Amount Mismatch");
  });

  it("a TDS-only difference is its own category on both forms", () => {
    const r = rec({ tds: false });
    expect(errorTypeFor(r, "24Q")).toBe("TDS Amount Mismatch");
    expect(errorTypeFor(r, "26Q")).toBe("TDS Amount Mismatch");
  });

  it("name, date and section each get their own category", () => {
    expect(errorTypeFor(rec({ name: false }), "26Q")).toBe("Name Mismatch");
    expect(errorTypeFor(rec({ date: false }), "26Q")).toBe("Date Mismatch");
    expect(errorTypeFor(rec({ section: false }), "26Q")).toBe("Section Mismatch");
    expect(errorTypeFor(rec({ pan: false }), "26Q")).toBe("PAN Mismatch");
  });

  // Identity outranks money: if the parties differ, comparing their figures is
  // meaningless. Money outranks date, and the gross figure is named before TDS.
  it("when several fields differ, identity outranks money and money outranks date", () => {
    expect(errorTypeFor(rec({ name: false, amount: false, tds: false, date: false }), "24Q")).toBe("Name Mismatch");
    expect(errorTypeFor(rec({ amount: false, tds: false, date: false }), "24Q")).toBe("Taxable Income Mismatch");
    expect(errorTypeFor(rec({ tds: false, date: false }), "24Q")).toBe("TDS Amount Mismatch");
  });

  it("the FULL field list is never lost — it stays in the reason sentence", () => {
    const r = rec({ amount: false, tds: false });
    // The category is one bucket; the sentence still names every field.
    expect(errorTypeFor(r, "24Q")).toBe("Taxable Income Mismatch");
    expect(reasonFor(r)).toContain("differ");
  });

  it("one-sided and matched records keep their own distinct categories", () => {
    expect(errorTypeFor(rec({}, "office_only"), "24Q")).toBe("Office Data Only");
    expect(errorTypeFor(rec({}, "imported_only"), "24Q")).toBe("Imported Data Only");
    expect(errorTypeFor(rec({}, "matched"), "24Q")).toBe("Matched");
  });

  // Results stored before field_diffs existed have nothing to classify by.
  it("falls back to the old generic label only when no field diff is recorded", () => {
    expect(errorTypeFor({ match_status: "mismatched", field_diffs: null }, "24Q")).toBe("Field Mismatch");
  });

  it("never returns the generic label when a field diff IS recorded", () => {
    for (const f of ["name", "pan", "date", "amount", "tds", "interest", "section"]) {
      expect(errorTypeFor(rec({ [f]: false }), "26Q")).not.toBe("Field Mismatch");
    }
  });
});
