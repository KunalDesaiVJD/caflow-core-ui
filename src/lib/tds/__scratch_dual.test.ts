import { describe, it, expect } from "vitest";
import { reconcileTallyFull, mergeDualLedgerResults, type OfficeTxn, type TallyRow } from "./tallyRecon";
import { canonicalSection } from "./match";

const OFFICE: OfficeTxn[] = [
  { deductee_id: "o1", name: "Madhukant Kanjibhai Patel", date_iso: "2026-04-30", amount: 300000, tds: 19800, section: "192B", pan: "ABCPP1111A" },
  { deductee_id: "o4", name: "Nevil Thummar", date_iso: "2026-04-30", amount: 49372, tds: 0, section: "192B", pan: "BZDPT4273P" },
];
// PRODUCTION section value for a "Staff Salary Expense" ledger:
const SALSEC = canonicalSection("Staff Salary Expense");
const sal = (i: number, party: string, credit: number): TallyRow => ({
  row_index: i, date: "30-Apr-26", iso: "2026-04-30", party, debit: null, credit,
  vch_no: String(i), vch_type: "Journal", section: SALSEC, amountKind: "taxable_income",
});
const tds = (i: number, party: string, credit: number): TallyRow => ({
  row_index: i, date: "30-Apr-26", iso: "2026-04-30", party, debit: null, credit,
  vch_no: String(i), vch_type: "Journal", section: "192B",
});

function dual(office: OfficeTxn[], tally: TallyRow[]) {
  const s = tally.filter((t) => t.amountKind === "taxable_income");
  const d = tally.filter((t) => t.amountKind !== "taxable_income");
  const forAmt = office.map((o) => ({ ...o, tds: null, section: null }));
  const a = reconcileTallyFull(office, d, null, {});
  const b = reconcileTallyFull(forAmt, s, null, {});
  return { rows: mergeDualLedgerResults(a.rows, b.rows), surplus: [...a.surplusLedger, ...b.surplusLedger] };
}

describe("scratch", () => {
  it("what section does a salary expense ledger get?", () => {
    console.log("SALSEC =", JSON.stringify(SALSEC));
    expect(SALSEC).toBe("192");
  });

  it("taxable income amount mismatch reason under PRODUCTION section", () => {
    const { rows } = dual(OFFICE, [
      sal(10, "Madhukant Kanjibhai Patel - Salary", 300000),
      sal(13, "Nevil Thummar - Salary", 49500),
      tds(20, "Madhukant Kanjibhai Patel", 19800),
    ]);
    const nevil = rows.find((r) => r.office_name === "Nevil Thummar")!;
    console.log("RESULT:", nevil.result);
    console.log("REASON:", nevil.reason);
    console.log("CONF:", nevil.confidence, "basis:", nevil.amount_basis);
    console.log("tds_status:", nevil.tds_status, "ti_status:", nevil.taxable_income_status);
    const madhu = rows.find((r) => r.office_name === "Madhukant Kanjibhai Patel")!;
    console.log("MADHU:", madhu.result, madhu.confidence, "|", madhu.reason);
  });

  it("zero-TDS matched employee confidence", () => {
    const { rows } = dual(OFFICE, [
      sal(10, "Madhukant Kanjibhai Patel - Salary", 300000),
      sal(13, "Nevil Thummar - Salary", 49372),
      tds(20, "Madhukant Kanjibhai Patel", 19800),
    ]);
    const nevil = rows.find((r) => r.office_name === "Nevil Thummar")!;
    console.log("ZERO-TDS:", nevil.result, "conf=", nevil.confidence, "tally_party=", JSON.stringify(nevil.tally_party));
  });

  it("null office_tds with a real TDS ledger row on another date", () => {
    const off: OfficeTxn[] = [{ deductee_id: "o1", name: "Madhukant Kanjibhai Patel", date_iso: "2026-04-30", amount: 300000, tds: null, section: "192B", pan: "ABCPP1111A" }];
    const { rows, surplus } = dual(off, [
      sal(10, "Madhukant Kanjibhai Patel - Salary", 300000),
      { row_index: 20, date: "31-May-26", iso: "2026-05-31", party: "Madhukant Kanjibhai Patel", debit: null, credit: 19800, vch_no: "20", vch_type: "Journal", section: "192B" },
    ]);
    console.log("NULL-TDS:", rows[0].result, "|", rows[0].tds_status, "|", rows[0].reason);
    console.log("surplus:", surplus.map((s) => s.party));
  });

  it("a 26Q filing with ONE spuriously tagged salary row", () => {
    const off26: OfficeTxn[] = [
      { deductee_id: "p1", name: "DHANI CONSTRUCTION", date_iso: "2026-05-15", amount: 281475, tds: 5630, section: "194C", pan: "AAEFD1234M" },
      { deductee_id: "p2", name: "X HAWK MULTI SERVICES", date_iso: "2026-06-10", amount: 56295, tds: 563, section: "194C", pan: "AAFFX5678N" },
    ];
    const led26: TallyRow[] = [
      { row_index: 0, date: "15-May-26", iso: "2026-05-15", party: "Dhani Construction", debit: null, credit: 5630, vch_no: "1", vch_type: "Journal", section: "194C" },
      { row_index: 1, date: "10-Jun-26", iso: "2026-06-10", party: "X Hawk Multi Services", debit: null, credit: 563, vch_no: "2", vch_type: "Journal", section: "194C" },
      // one stray row the parser mis-tagged
      { row_index: 2, date: "30-Apr-26", iso: "2026-04-30", party: "Directors Salary Payable", debit: 100000, credit: 100000, vch_no: "9", vch_type: "Journal", section: "194C", amountKind: "taxable_income" },
    ];
    const { rows } = dual(off26, led26);
    console.log("26Q CONTAMINATED:", rows.map((r) => `${r.office_name} => ${r.result}`));
  });
});
