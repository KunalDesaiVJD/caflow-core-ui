import { describe, it, expect } from "vitest";
import { reconcileTallyFull, type OfficeTxn, type TallyRow } from "./tallyRecon";

/**
 * Regression: the money verdict (EXACT_EPS, ₹0.005) is deliberately tighter
 * than the display used to be (Math.round to the whole rupee). A real
 * sub-rupee gap — routine, since Tally ledgers often carry paise while
 * office TDS is entered rounded to the whole rupee — used to flag "Credit
 * Amount Mismatch" while the reason sentence displayed IDENTICAL rounded
 * numbers on both sides and stated "a difference of ₹0". Pinned against the
 * real report: MEET ASHOKBHAI PATEL, office TDS ₹8,291, 194C, whose ledger
 * credit carried 3 paise the office figure didn't — reported "the ledger
 * credit (₹8,291) differs from the office TDS (₹8,291) — a difference of
 * ₹0", which reads as a bug (and was mistaken for one) because it is
 * self-contradictory, even though the underlying gap is real and the verdict
 * itself is correct per the app's explicit "never silently absorb a gap"
 * design.
 */

const OFFICE_BASE: OfficeTxn = {
  deductee_id: "o1", name: "Meet Ashokbhai Patel", date_iso: "2026-04-07",
  amount: 829104, tds: 8291, section: "194C", pan: "ABCPP1234A",
};
const tallyRow = (credit: number): TallyRow => ({
  row_index: 1, date: "07-04-2026", iso: "2026-04-07", party: "Meet Ashokbhai Patel",
  debit: null, credit, vch_no: "1", vch_type: "Journal", section: "194C",
});

describe("reconcileTallyFull — Credit Amount Mismatch reason text reveals the real gap", () => {
  it("a 3-paise ledger/office gap shows DIFFERENT numbers and the true difference, not '₹0'", () => {
    const { rows } = reconcileTallyFull([OFFICE_BASE], [tallyRow(8291.03)], null);
    const r = rows[0];

    expect(r.result).toBe("Credit Amount Mismatch");
    expect(r.tally_credit).toBe(8291.03);
    expect(r.office_tds).toBe(8291);
    // The two figures must render as visibly different numbers...
    expect(r.reason).toContain("₹8,291.03");
    expect(r.reason).toContain("₹8,291)"); // office TDS, no decimals — it IS a whole rupee
    expect(r.reason).not.toContain("₹8,291.03) differs from the office TDS (₹8,291.03)"); // not identical
    // ...and the stated difference must be the real one, never bare "₹0"
    // (a difference of ₹0.03 is fine — it's a bare, undecorated "₹0" that
    // would mean the real gap got rounded away).
    expect(r.reason).toContain("a difference of ₹0.03");
    expect(r.reason).not.toMatch(/a difference of ₹0(?!\.\d)/);
  });

  it("a 49-paise gap (just under half a rupee) is likewise never reported as '₹0'", () => {
    const { rows } = reconcileTallyFull([OFFICE_BASE], [tallyRow(8291.49)], null);
    const r = rows[0];

    expect(r.result).toBe("Credit Amount Mismatch");
    expect(r.reason).toContain("₹8,291.49");
    expect(r.reason).toContain("a difference of ₹0.49");
  });

  it("an EXACT match (identical integer rupees) is Matched, with no decimals in sight", () => {
    const { rows } = reconcileTallyFull([OFFICE_BASE], [tallyRow(8291)], null);
    const r = rows[0];

    expect(r.result).toBe("Matched");
  });

  it("float noise well under EXACT_EPS (sub-paisa) still counts as Matched, no spurious decimals", () => {
    // Half a paisa is the documented float-safety floor (EXACT_EPS = 0.005) —
    // this must stay absorbed, unlike a genuine paisa-level gap above.
    const { rows } = reconcileTallyFull([OFFICE_BASE], [tallyRow(8291 + 0.0001)], null);
    const r = rows[0];

    expect(r.result).toBe("Matched");
  });
});

/**
 * Regression: applySplitEntryGrouping's fold-reason sentence is a SECOND,
 * untouched call site of the same shared inr() the tests above pin — and
 * SPLIT_FOLD_TOLERANCE is a flat ±₹1 slack (never an exact-equality check),
 * so a genuine within-tolerance paisa gap is the NORMAL case here, not an
 * edge case. Before inr() became paisa-aware, that gap always rounded away
 * and the fold sentence's claim of "exactly" happened to look true. Once
 * inr() started showing real sub-rupee gaps, the SAME sentence started
 * asserting two now-visibly-different numbers are equal "exactly" — a
 * self-contradiction on a row confidently badged "Matched", which is worse
 * than the bug being fixed elsewhere in this file (a checker has no reason
 * to doubt a "Matched" row the way they would a flagged mismatch).
 */
describe("reconcileTallyFull — split-entry fold reason never claims a false 'exactly'", () => {
  // Real client pattern (per applySplitEntryGrouping's own doc): one payment
  // entered as two office rows, same party/date/section.
  const SPLIT_OFFICE: OfficeTxn[] = [
    { deductee_id: "s1", name: "Virender Singh", date_iso: "2026-04-07", amount: null, tds: 135200, section: "194C", pan: "ABCPV1234A" },
    { deductee_id: "s2", name: "Virender Singh", date_iso: "2026-04-07", amount: null, tds: 17472, section: "194C", pan: "ABCPV1234A" },
  ];
  const splitTallyRow = (credit: number): TallyRow => ({
    row_index: 1, date: "07-04-2026", iso: "2026-04-07", party: "Virender Singh",
    debit: null, credit, vch_no: "1", vch_type: "Journal", section: "194C",
  });

  it("a within-tolerance 42-paise fold gap states the real gap, never 'exactly'", () => {
    // Sum = 152672.00 exactly; ledger credit is 42 paise more — inside the
    // flat ₹1 SPLIT_FOLD_TOLERANCE, so the fold still fires.
    const { rows } = reconcileTallyFull(SPLIT_OFFICE, [splitTallyRow(152672.42)], null);
    const folded = rows.filter((r) => r.result === "Matched");
    expect(folded).toHaveLength(2); // anchor + folded-in leftover, both patched

    for (const r of folded) {
      expect(r.reason).toContain("₹1,52,672"); // the office-side sum, whole rupee
      expect(r.reason).toContain("₹1,52,672.42"); // the ledger credit, real paise
      // The two different numbers above must never be glued together with "exactly".
      expect(r.reason).not.toMatch(/exactly\.?$/);
      expect(r.reason?.toLowerCase()).not.toContain("exactly");
    }
  });

  it("a genuine exact fold (identical whole-rupee sum) still says 'exactly'", () => {
    const { rows } = reconcileTallyFull(SPLIT_OFFICE, [splitTallyRow(152672)], null);
    const folded = rows.filter((r) => r.result === "Matched");
    expect(folded).toHaveLength(2);
    for (const r of folded) expect(r.reason).toContain("exactly.");
  });
});

/**
 * Real client pattern (M J Surgical): a "Provision Ledger" print interleaves
 * several TDS sections in ONE file, including "UNPAID TDS-26/27-SALARY"
 * (canonicalises to "192") alongside genuine 26Q sections (194A/194C/194J/
 * 194Q). Importing it into a 26Q filing stored the Salary rows there too, and
 * since a 26Q return's own Office Data never has a Section 192 record (a
 * salaried employee is never entered as 26Q Office Data), every one of those
 * rows surfaced as "Office Data Not Found" — a wall of false mismatches for
 * deductions that are 24Q's business, not 26Q's. `formType` scopes the ledger
 * rows a reconciliation run is even allowed to consider claiming/surplus-ing.
 */
describe("reconcileTallyFull — formType scopes ledger rows to their own return (192 is 24Q-only)", () => {
  const salaryRow = (party: string, credit: number): TallyRow => ({
    row_index: 1, date: "30-04-2026", iso: "2026-04-30", party,
    debit: null, credit, vch_no: null, vch_type: null, section: "192",
  });
  const nonSalaryRow = (party: string, credit: number): TallyRow => ({
    row_index: 2, date: "30-04-2026", iso: "2026-04-30", party,
    debit: null, credit, vch_no: null, vch_type: null, section: "194C",
  });
  // A real 26Q filing's own office data — no Section 192 records, ever.
  const OFFICE_26Q: OfficeTxn[] = [
    { deductee_id: "v1", name: "Bhavin Engineers", date_iso: "2026-04-30", amount: 78992, tds: 790, section: "194C", pan: "AMQPP5814M" },
  ];
  // A real 24Q filing's own office data — no non-192 records, ever.
  const OFFICE_24Q: OfficeTxn[] = [
    { deductee_id: "e1", name: "Alsi Nirav Balochiya", date_iso: "2026-04-30", amount: null, tds: 9280, section: "192", pan: "DQHPK5501A" },
  ];

  it("without formType (omitted), a Salary row still pollutes a 26Q run as surplus — pre-existing behaviour, unchanged", () => {
    const tally = [nonSalaryRow("Bhavin Engineers", 790), salaryRow("Alsi Nirav Balochiya", 9280)];
    const { surplusLedger } = reconcileTallyFull(OFFICE_26Q, tally, null);
    expect(surplusLedger.map((r) => r.party)).toContain("Alsi Nirav Balochiya");
  });

  it("formType 'ONLY': a Salary (192) row never becomes 26Q surplus — the real M J Surgical bug", () => {
    const tally = [nonSalaryRow("Bhavin Engineers", 790), salaryRow("Alsi Nirav Balochiya", 9280)];
    const { rows, surplusLedger } = reconcileTallyFull(OFFICE_26Q, tally, null, {}, "26Q");
    expect(surplusLedger.map((r) => r.party)).not.toContain("Alsi Nirav Balochiya");
    // the genuine 194C row still reconciles normally — scoping isn't a blanket suppression
    expect(rows.find((r) => r.office_name === "Bhavin Engineers")?.result).toBe("Matched");
  });

  it("formType '24Q': a non-Salary (194C) row never becomes 24Q surplus — the symmetric case", () => {
    const tally = [salaryRow("Alsi Nirav Balochiya", 9280), nonSalaryRow("Bhavin Engineers", 790)];
    const { rows, surplusLedger } = reconcileTallyFull(OFFICE_24Q, tally, null, {}, "24Q");
    expect(surplusLedger.map((r) => r.party)).not.toContain("Bhavin Engineers");
    expect(rows.find((r) => r.office_name === "Alsi Nirav Balochiya")?.result).toBe("Matched");
  });

  it("192A/192B/192C sub-codes are still recognised as Salary, not just the bare '192'", () => {
    const tally = [
      { ...salaryRow("Director A", 5000), section: "192B" },
      nonSalaryRow("Bhavin Engineers", 790),
    ];
    const { surplusLedger } = reconcileTallyFull(OFFICE_26Q, tally, null, {}, "26Q");
    expect(surplusLedger.map((r) => r.party)).not.toContain("Director A");
  });

  it("a row with NO identifiable section is never excluded on absence of evidence", () => {
    const unknownSectionRow: TallyRow = {
      row_index: 3, date: "30-04-2026", iso: "2026-04-30", party: "Mystery Vendor",
      debit: null, credit: 500, vch_no: null, vch_type: null, section: null,
    };
    // No office record at all to claim it — the only way it can end up as
    // surplus is if the scoping filter LEFT it in `scoped` to begin with.
    const { surplusLedger } = reconcileTallyFull([], [unknownSectionRow], null, {}, "26Q");
    expect(surplusLedger.map((r) => r.party)).toContain("Mystery Vendor");
  });
});
