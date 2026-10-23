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
  ch("c5", "2026-10-09", 16667, 1000), ch(INT_ID, "2026-10-21", 0, 215),
];
// c3's entry: paid 20/08, deposited 09/10 → 3 months late, 7079 × 1.5% × 3 = 318.56 → 319.
// c5's entry: 16667 × 1.5% × 3 = 750 — within its own declared 1000, so it draws nothing.
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

  it("a smaller interest challan covers only part — the rest still counts against the TDS challan", () => {
    const plan = planInterestChallans(challans, rowsOf); // pool 215 < 319 owed
    expect(plan.via.get("c3")).toBe(215);
    expect(plan.consumed.get(INT_ID)).toBe(215);
  });

  it("a larger interest challan leaves the surplus unconsumed", () => {
    const plan = planInterestChallans(challans.map((c) => (c.id === INT_ID ? ch(INT_ID, "2026-10-21", 0, 500) : c)), rowsOf);
    expect(plan.via.get("c3")).toBe(319);
    expect(plan.consumed.get(INT_ID)).toBe(319);
    expect(plan.avail.get("c3")).toBe(500);      // 319 drawn + 181 still available to later edits
  });
});
