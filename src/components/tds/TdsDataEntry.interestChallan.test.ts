import { describe, it, expect } from "vitest";
import { planInterestChallans, isInterestOnlyChallan } from "./TdsDataEntry";

// Shape of the real Genius challan list for a 26Q (Shivon Infra, Q2 FY26-27):
// four TDS challans and ONE interest-only challan (TDS 0, Interest 215,
// BSR 0510002, 21/10/2026). The late entries sit on the 09/10 TDS challan, which
// declares no interest of its own — the interest was paid on the separate one.
const ch = (id: string, deposit_date: string, tds: number, interest: number): any => ({
  id, deposit_date, total_tax_deposited: tds, surcharge_deposited: 0, interest_deposited: interest,
  total_challan_amount: tds + interest,
});
const row = (id: string, challan_id: string, date_of_payment: string, tds: number): any =>
  ({ id, challan_id, date_of_payment, tds_amount: tds, total_tax_deducted: tds });

const INT_ID = "int";
const challans = [
  ch("c1", "2026-08-07", 1323, 0), ch("c2", "2026-09-07", 1738, 0), ch("c3", "2026-10-09", 7079, 0),
  ch("c5", "2026-10-09", 16667, 750), ch(INT_ID, "2026-10-21", 0, 215),
];
// c3's entry: paid 20/08, deposited 09/10 → 3 months late, 7079 × 1.5% × 3 = 318.56 → 319.
// c5's entry: 16667 × 1.5% × 3 = 750 — exactly its own declared interest, so it neither draws nor gives.
const rows: Record<string, any[]> = {
  c1: [row("r1", "c1", "2026-07-20", 1323)], c2: [row("r2", "c2", "2026-08-20", 1738)],
  c3: [row("r3", "c3", "2026-08-20", 7079)], c5: [row("r5", "c5", "2026-08-20", 16667)], [INT_ID]: [],
};
const rowsOf = (c: any) => rows[c.id] || [];

describe("interest-only challans (Genius records late-deposit interest as its own challan)", () => {
  it("recognises the TDS-0 / Interest-only challan and nothing else", () => {
    expect(challans.filter(isInterestOnlyChallan).map((c) => c.id)).toEqual([INT_ID]);
  });

  it("with no interest challan in the filing, the plan is empty — nothing changes", () => {
    const plan = planInterestChallans(challans.filter((c) => c.id !== INT_ID), rowsOf);
    expect(plan.via.size + plan.avail.size + plan.consumed.size).toBe(0);
  });

  it("matches the interest challan to the TDS challan whose entries owe it, leaving others alone", () => {
    const big = challans.map((c) => (c.id === INT_ID ? ch(INT_ID, "2026-10-21", 0, 319) : c));
    const plan = planInterestChallans(big, rowsOf);
    expect(plan.via.get("c3")).toBe(319);
    expect(plan.via.get("c5")).toBe(0);          // covered by its own declared interest
    expect(plan.via.get("c1")).toBe(0);
    expect(plan.consumed.get(INT_ID)).toBe(319); // the whole deposit is accounted for
  });

  it("a smaller interest challan: the TDS challan still never reads over-applied — the gap is an interest short-payment", () => {
    const plan = planInterestChallans(challans, rowsOf); // pool 215 < 319 owed (Shivon Infra, the real layout)
    expect(plan.via.get("c3")).toBe(319);        // none of the interest is counted against the TDS challan
    expect(plan.consumed.get(INT_ID)).toBe(215);
    expect(plan.shortfall).toBe(104);
  });

  it("a larger interest challan leaves the surplus unconsumed", () => {
    const plan = planInterestChallans(challans.map((c) => (c.id === INT_ID ? ch(INT_ID, "2026-10-21", 0, 500) : c)), rowsOf);
    expect(plan.via.get("c3")).toBe(319);
    expect(plan.consumed.get(INT_ID)).toBe(319);
    expect(plan.avail.get("c3")).toBe(Number.POSITIVE_INFINITY); // later edits' interest also goes to the interest challan
    expect(plan.shortfall).toBe(0);
  });
});

// ACCU-Panels Energy Pvt Ltd, Q2 FY26-27 26Q — the challan list straight from the
// client's Genius file (GENIUS.xls). No interest-only challan here: the 21/10
// challan carries TDS 4,000 AND interest 800, but its own entries owe only ~120 —
// the rest pays the interest the three earlier challans' entries owe beyond what
// they declare (4,861 / 950 / 475 declared vs 5,182 / 953 / 765 calculated).
describe("surplus interest on an ordinary TDS challan pays the other challans' interest (ACCU-Panels Q2)", () => {
  const A = (id: string, deposit_date: string, tds: number, interest: number): any => ch(id, deposit_date, tds, interest);
  const accu = [
    A("a1", "2026-09-12", 172745, 4861), A("a2", "2026-09-12", 31771, 950), A("a3", "2026-09-17", 25487, 475),
    A("a4", "2026-10-07", 139484, 0), A("a5", "2026-10-21", 4000, 800), A("a6", "2026-08-07", 166800, 0),
  ];
  // One row per challan carrying the challan's whole TDS, dated like the Genius file's entries.
  const accuRows: Record<string, any[]> = {
    a1: [row("x1", "a1", "2026-08-31", 172745)], a2: [row("x2", "a2", "2026-08-31", 31771)],
    a3: [row("x3", "a3", "2026-08-31", 25487)], a4: [row("x4", "a4", "2026-09-30", 139484)],
    a5: [row("x5", "a5", "2026-09-30", 4000)], a6: [row("x6", "a6", "2026-07-31", 166800)],
  };
  const accuRowsOf = (c: any) => accuRows[c.id] || [];

  it("the three challans that declare too little are not over-applied: their excess is paid from the 21/10 challan", () => {
    const plan = planInterestChallans(accu, accuRowsOf);
    expect(plan.via.get("a1")).toBe(321);   // 5,182 calculated − 4,861 declared
    expect(plan.via.get("a2")).toBe(3);     // 953 − 950
    expect(plan.via.get("a3")).toBe(290);   // 765 − 475
    expect(plan.via.get("a4")).toBe(0);
    expect(plan.consumed.get("a5")).toBe(614); // 321 + 3 + 290 of its 680 surplus
    expect(plan.shortfall).toBe(0);
  });

  it("a challan that only declares its own interest neither draws nor gives", () => {
    const plan = planInterestChallans(accu, accuRowsOf);
    expect(plan.consumed.has("a1")).toBe(false);
    expect(plan.consumed.has("a6")).toBe(false);
  });

  it("when the surplus is smaller than what is owed, the gap is an interest short-payment — never an over-applied challan", () => {
    const plan = planInterestChallans(accu.map((c) => (c.id === "a5" ? A("a5", "2026-10-21", 4000, 630) : c)), accuRowsOf);
    expect(plan.consumed.get("a5")).toBe(510); // 630 declared − 120 its own entries owe
    expect(plan.shortfall).toBe(104);          // 614 owed − 510 available
  });

  it("a leftover of a few rupees is rounding between CAFlow and Genius, not an overpayment", () => {
    const plan = planInterestChallans(accu.map((c) => (c.id === "a5" ? A("a5", "2026-10-21", 4000, 740) : c)), accuRowsOf);
    expect(plan.consumed.get("a5")).toBe(620); // 740 − 120 = 620 surplus; 614 matched, ₹6 left → treated as consumed
  });

  it("Shivon Infra: a ₹215 interest challan matched to ₹212 of owed interest is not left reading Unconsumed", () => {
    const shivon = [A("s3", "2026-10-09", 7079, 0), A("si", "2026-10-21", 0, 215)];
    const shivonRows: Record<string, any[]> = {
      s3: [row("y1", "s3", "2026-09-08", 3114), row("y2", "s3", "2026-09-08", 3665), row("y3", "s3", "2026-09-24", 300)],
    };
    const plan = planInterestChallans(shivon, (c: any) => shivonRows[c.id] || []);
    expect(plan.via.get("s3")).toBe(212);
    expect(plan.consumed.get("si")).toBe(215);
  });
});
