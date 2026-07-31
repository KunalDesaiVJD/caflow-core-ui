import { describe, it, expect } from "vitest";
import { isOfficeAnchored, isDisplayMismatch } from "./TdsTallyRecon";

/**
 * 24Q Stage-3 firm policy: the dual (Data Entry <-> Tally) reconciliation
 * keeps running for every form — mapping, name identification and record
 * matching must never stop — but for 24Q specifically, a pure ledger-surplus
 * row (a Tally credit with no Office Data / Data Entry counterpart) must not
 * surface as a reviewable mismatch. Every other form keeps showing both
 * directions, exactly as before.
 */

const officeRow = (result: string, overrides: Partial<any> = {}) =>
  ({ result, office_deductee_id: "d1", office_name: "Acme Pvt Ltd", mapped: false, overridden: false, ...overrides }) as any;

const ledgerOnlyRow = (result: string, overrides: Partial<any> = {}) =>
  ({ result, office_deductee_id: null, office_name: null, mapped: false, overridden: false, ...overrides }) as any;

describe("isOfficeAnchored", () => {
  it("is true for a row with an office_deductee_id or office_name", () => {
    expect(isOfficeAnchored(officeRow("Date Mismatch"))).toBe(true);
    expect(isOfficeAnchored({ result: "x", office_deductee_id: null, office_name: "Acme" } as any)).toBe(true);
  });

  it("is false for a pure ledger-surplus row (both null)", () => {
    expect(isOfficeAnchored(ledgerOnlyRow("Office Data Not Found"))).toBe(false);
  });
});

describe("isDisplayMismatch — 24Q hides ledger-only mismatches, every other form shows both directions", () => {
  it("24Q: an office-anchored mismatch (Data Entry vs Tally) is shown", () => {
    expect(isDisplayMismatch(officeRow("Credit Amount Mismatch"), "24Q")).toBe(true);
    expect(isDisplayMismatch(officeRow("TDS Missing from Office Data" as any, { office_deductee_id: "d1", office_name: "Acme" }), "24Q")).toBe(true);
  });

  it("24Q: a pure ledger-surplus mismatch (Tally has no Office Data counterpart) is hidden", () => {
    expect(isDisplayMismatch(ledgerOnlyRow("Office Data Not Found"), "24Q")).toBe(false);
    expect(isDisplayMismatch(ledgerOnlyRow("Taxable Income Missing from Office Data" as any), "24Q")).toBe(false);
    expect(isDisplayMismatch(ledgerOnlyRow("TDS Missing from Office Data" as any), "24Q")).toBe(false);
  });

  it("24Q: Matched is never a mismatch regardless of anchoring", () => {
    expect(isDisplayMismatch(officeRow("Matched"), "24Q")).toBe(false);
    expect(isDisplayMismatch(ledgerOnlyRow("Matched"), "24Q")).toBe(false);
  });

  it("26Q (dual-ledger like 24Q, but NOT the scoped form): ledger-only mismatches still show", () => {
    expect(isDisplayMismatch(ledgerOnlyRow("Office Data Not Found"), "26Q")).toBe(true);
  });

  it("27Q/27EQ (single-ledger forms): ledger-only mismatches still show, unaffected", () => {
    expect(isDisplayMismatch(ledgerOnlyRow("Office Data Not Found"), "27Q")).toBe(true);
    expect(isDisplayMismatch(ledgerOnlyRow("Office Data Not Found"), "27EQ")).toBe(true);
  });

  it("every form: an office-anchored mismatch always shows", () => {
    for (const form of ["24Q", "26Q", "27Q", "27EQ"]) {
      expect(isDisplayMismatch(officeRow("Party Name Mismatch"), form)).toBe(true);
    }
  });
});
