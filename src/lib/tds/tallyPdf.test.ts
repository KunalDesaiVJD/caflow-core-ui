import { describe, it, expect } from "vitest";
import { parseTallyPdfPages, type PdfTextItem } from "./tallyPdf";
import { reconcileTallyFull, resolveTaxableIncomeReading, type OfficeTxn } from "./tallyRecon";

// Column header, identical across every fixture below — geometry lifted
// verbatim (x/y) from a real pdfjs dump of a Skylark Corporation 194A ledger
// PDF, so every test exercises the SAME anchor-derivation code path as
// production, not an idealised layout.
const HEADER: PdfTextItem[] = [
  { x: 237.1, y: 744.8, w: 150.5, str: "SKYLARK CORPORATION" },
  { x: 282.7, y: 667.4, w: 59.5, str: "TDS 194 A" },
  { x: 277.4, y: 655.6, w: 69.7, str: "Ledger Account" },
  { x: 268.1, y: 630.8, w: 88.5, str: "1-Apr-26 to 30-Jun-26" },
  { x: 60.0, y: 603.7, w: 21.0, str: "Date" },
  { x: 280.7, y: 603.7, w: 41.9, str: "Vch Type" },
  { x: 400.9, y: 603.7, w: 35.4, str: "Vch No." },
  { x: 110.6, y: 603.4, w: 51.4, str: "Particulars" },
  { x: 489.0, y: 603.4, w: 24.9, str: "Debit" },
  { x: 562.8, y: 603.4, w: 28.7, str: "Credit" },
];

// Same column geometry as HEADER, but for a genuine employee-cost ledger
// ("Staff Salary Expense") rather than a TDS-liability one ("TDS 194 A") —
// needed since parseTallyPdfPages now gates the salary-expense compound-Cr
// branch on isEmployeeCostLedger(ledgerName) (Unity Organics real-data fix,
// 2026-08-04: that branch used to fire on ANY compound voucher with a
// debit-only header, including a TDS-liability ledger's own challan-payment
// voucher — see tallyPdf.ts's own doc on the fix). Every test below that
// exercises salaryExpenseVoucherRows() needs THIS header, not the shared one.
const SALARY_HEADER: PdfTextItem[] = [
  ...HEADER.filter((i) => i.str !== "TDS 194 A"),
  { x: 259.0, y: 667.4, w: 106.5, str: "Staff Salary Expense" },
];

/** A simple (non-compound) "By" deduction row — party named directly in the
 *  header row, no breakdown lines. Mirrors "5-Apr-26 By Hero Fincorp Ltd…". */
function simpleByRow(y: number, opts: { date?: string; party: string; vchNo: string; credit: number }): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  if (opts.date) items.push({ x: 45.8, y, w: 52.4, str: `${opts.date} By` });
  else items.push({ x: 86.6, y, w: 11.6, str: "By" });
  items.push({ x: 431.3, y, w: 5.0, str: opts.vchNo });
  items.push({ x: 280.7, y: y - 0.4, w: 32.6, str: "Journal" });
  items.push({ x: 553.0, y: y - 0.9, w: 38.7, str: opts.credit.toLocaleString("en-IN", { minimumFractionDigits: 2 }) });
  items.push({ x: 104.3, y: y - 0.4, w: opts.party.length * 5, str: opts.party });
  return items;
}

/** A compound "(as per details)" Journal — header row + expense-head Dr line
 *  + deductee Dr line (TDS amount) + deductee Cr line (gross) + 2-line
 *  narration, exactly reproducing the real Skylark PDF's token geometry
 *  (including pdfjs's own merging of "<date> By" and "<amount> Dr/Cr" into
 *  single runs — that merging is the entire bug this file guards against). */
function compoundJournalRows(y: number, opts: {
  date?: string; vchNo: string; credit: number;
  expenseHead: string; gross: number; deductee: string;
  /** Override for the deductee's own Dr-line amount — defaults to `credit`
   *  (the normal case). Tests that need to simulate a malformed/edited PDF
   *  where nothing actually matches the row's credit pass a different value. */
  deducteeDr?: number;
}): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const deducteeDr = opts.deducteeDr ?? opts.credit;
  if (opts.date) items.push({ x: 39.6, y, w: 58.6, str: `${opts.date} By` });
  else items.push({ x: 86.6, y, w: 11.6, str: "By" });
  items.push({ x: 426.2, y, w: 10.0, str: opts.vchNo });
  items.push({ x: 280.7, y: y - 0.3, w: 32.6, str: "Journal" });
  items.push({ x: 553.0, y: y - 0.8, w: 38.7, str: fmt(opts.credit) });
  items.push({ x: 104.3, y: y - 1.2, w: 70.2, str: "(as per details)" });
  // expense head — Dr, gross amount
  items.push({ x: 105.0, y: y - 11, w: opts.expenseHead.length * 5.2, str: opts.expenseHead });
  items.push({ x: 291.8, y: y - 11, w: 52.8, str: `${fmt(opts.gross)} Dr` });
  // deductee — Dr, TDS amount (== row credit, normally)
  items.push({ x: 105.0, y: y - 21.8, w: opts.deductee.length * 4.3, str: opts.deductee });
  items.push({ x: 296.9, y: y - 21.8, w: 47.8, str: `${fmt(deducteeDr)} Dr` });
  // deductee — Cr, gross amount (duplicate name)
  items.push({ x: 105.0, y: y - 32.6, w: opts.deductee.length * 4.3, str: opts.deductee });
  items.push({ x: 291.8, y: y - 32.6, w: 52.8, str: `${fmt(opts.gross)} Cr` });
  // narration, two lines, pure Particulars text
  items.push({ x: 104.6, y: y - 43.1, w: 176.8, str: `BEING THE INTEREST PAID @ 6% (01.04.` });
  items.push({ x: 104.6, y: y - 53.4, w: 142.0, str: `2026 to 20.05.2026) (${opts.gross}@10%)` });
  return items;
}

/** A pure EXPENSE-ledger compound "(as per details)" Journal voucher — e.g.
 *  Tally's "Staff Salary Expense" ledger, which books every voucher as a
 *  DEBIT (there is no credit for compoundJournalRows' amount-match to key
 *  on). The employee is identified by whichever Cr breakdown line's own text
 *  contains "- Salary" — told apart from the OTHER Cr lines on the same
 *  voucher (PF Employee, Professional Tax, …) purely by that suffix — exactly
 *  reproducing the real Microcircuits "salary expense.pdf" ledger's layout. */
function salaryExpenseVoucherRows(y: number, opts: {
  date?: string; vchNo: string; debit: number;
  /** Cr breakdown lines in the order Tally actually prints them, e.g.
   *  [{ label: "Nevil Thummar - Salary", amount: 49372 }, { label: "PF Employee", amount: 1800 }].
   *  A long label WRAPS onto its own line below — confirmed on a real ledger
   *  that the amount stays with the FIRST line and the continuation prints
   *  alone on the next, e.g. "Keshviben Hasmukhbhau" (+amount), "Gami -
   *  Salary" (alone) — set `wrap` to reproduce that exact shape. */
  crLines: { label: string; amount: number; wrap?: string }[];
  /** Optional Dr breakdown line ("Bonus Expense") before the Cr lines. */
  bonusDr?: { label: string; amount: number };
}): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  if (opts.date) items.push({ x: 40.8, y, w: 57.7, str: `${opts.date} To` });
  else items.push({ x: 86.6, y, w: 11.6, str: "To" });
  items.push({ x: 426.2, y, w: 10.0, str: opts.vchNo });
  items.push({ x: 280.7, y: y - 0.3, w: 32.6, str: "Journal" });
  items.push({ x: 456.0, y: y - 0.8, w: 58.0, str: fmt(opts.debit) });
  items.push({ x: 104.3, y: y - 1.2, w: 70.2, str: "(as per details)" });
  let lineY = y - 11;
  if (opts.bonusDr) {
    items.push({ x: 105.0, y: lineY, w: opts.bonusDr.label.length * 5.2, str: opts.bonusDr.label });
    items.push({ x: 291.8, y: lineY, w: 52.8, str: `${fmt(opts.bonusDr.amount)} Dr` });
    lineY -= 10.8;
  }
  for (const cr of opts.crLines) {
    items.push({ x: 105.0, y: lineY, w: cr.label.length * 4.3, str: cr.label });
    items.push({ x: 291.8, y: lineY, w: 52.8, str: `${fmt(cr.amount)} Cr` });
    lineY -= 10.8;
    if (cr.wrap) {
      items.push({ x: 105.0, y: lineY, w: cr.wrap.length * 4.3, str: cr.wrap });
      lineY -= 10.8;
    }
  }
  return items;
}

function challanPaymentRow(y: number, opts: { date: string; bank: string; vchNo: string; debit: number }): PdfTextItem[] {
  return [
    { x: 40.8, y, w: 57.7, str: `${opts.date} To` },
    { x: 426.2, y, w: 10.0, str: opts.vchNo },
    { x: 280.7, y: y - 0.4, w: 37.2, str: "Payment" },
    { x: 456.0, y: y - 0.9, w: 58.0, str: opts.debit.toLocaleString("en-IN", { minimumFractionDigits: 2 }) },
    { x: 104.3, y: y - 0.4, w: opts.bank.length * 4.7, str: opts.bank },
    { x: 104.6, y: y - 11, w: 18.0, str: "TDS" },
  ];
}

/** A TDS-liability compound Journal where the TDS amount is NEVER restated
 *  on the Dr side (unlike compoundJournalRows above) — Dr is purely the
 *  gross expense + its GST input lines, and the vendor is named on a single
 *  Cr line for the net payable (Dr total = Cr vendor + this row's own TDS
 *  credit, by double-entry). Exactly reproduces a real Bindra Construction
 *  works-contract voucher's layout (194c-partnership.pdf). */
function worksContractVoucherRows(y: number, opts: {
  date?: string; vchNo: string; credit: number;
  drLines: { label: string; amount: number }[];
  vendor: string; vendorCr: number;
}): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  if (opts.date) items.push({ x: 39.6, y, w: 58.6, str: `${opts.date} By` });
  else items.push({ x: 86.6, y, w: 11.6, str: "By" });
  items.push({ x: 426.2, y, w: 10.0, str: opts.vchNo });
  items.push({ x: 280.7, y: y - 0.3, w: 32.6, str: "Journal" });
  items.push({ x: 553.0, y: y - 0.8, w: 38.7, str: fmt(opts.credit) });
  items.push({ x: 104.3, y: y - 1.2, w: 70.2, str: "(as per details)" });
  let lineY = y - 11;
  for (const dr of opts.drLines) {
    items.push({ x: 105.0, y: lineY, w: dr.label.length * 5.2, str: dr.label });
    items.push({ x: 291.8, y: lineY, w: 52.8, str: `${fmt(dr.amount)} Dr` });
    lineY -= 10.8;
  }
  items.push({ x: 105.0, y: lineY, w: opts.vendor.length * 4.3, str: opts.vendor });
  items.push({ x: 291.8, y: lineY, w: 52.8, str: `${fmt(opts.vendorCr)} Cr` });
  return items;
}

describe("parseTallyPdfPages — compound '(as per details)' Journal rows", () => {
  it("resolves the real deductee name and a clean date for the exact Skylark 194A case", () => {
    const page = [
      ...HEADER,
      ...compoundJournalRows(485.5, {
        date: "20-May-26", vchNo: "32", credit: 2959,
        expenseHead: "Interest on Unsecured Loan", gross: 29590,
        deductee: "Nikhilbhai Bhikhabhai Patel (UK)",
      }),
      // Second entry, same day — Tally omits the date, "By" prints standalone.
      ...compoundJournalRows(414.1, {
        vchNo: "33", credit: 7397,
        expenseHead: "Interest on Unsecured Loan", gross: 73973,
        deductee: "Hansaben Nikhilbhai Patel (UK)",
      }),
    ];
    const result = parseTallyPdfPages([page]);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(2);

    const [r1, r2] = result.rows;
    expect(r1.date).toBe("20-May-26");           // not "20-May-26 By"
    expect(r1.party).toBe("Nikhilbhai Bhikhabhai Patel (UK)"); // not "(as per details)"
    expect(r1.credit).toBe(2959);

    expect(r2.date).toBe("20-May-26");            // inherited from r1
    expect(r2.party).toBe("Hansaben Nikhilbhai Patel (UK)");
    expect(r2.credit).toBe(7397);

    // Narration is captured for display (never reconciled on — see the
    // field's own doc), joined across its wrapped lines, and scoped
    // per-row — the second entry's narration must reflect ITS OWN gross
    // amount (73973), not leak the first entry's (29590).
    expect(r1.narration).toBe("BEING THE INTEREST PAID @ 6% (01.04. 2026 to 20.05.2026) (29590@10%)");
    expect(r2.narration).toBe("BEING THE INTEREST PAID @ 6% (01.04. 2026 to 20.05.2026) (73973@10%)");
  });

  it("never lets the generic expense head (Dr, gross amount) be mistaken for the deductee", () => {
    const page = [
      ...HEADER,
      ...compoundJournalRows(485.5, {
        date: "1-Jun-26", vchNo: "40", credit: 500,
        expenseHead: "Interest on Unsecured Loan", gross: 5000,
        deductee: "Some Lender Pvt Ltd",
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).not.toMatch(/Interest on Unsecured Loan/);
    expect(rows[0].party).toBe("Some Lender Pvt Ltd");
  });

  it("generalises to a different section's expense head (194J-style professional fees), proving the match is amount-driven not name-keyed", () => {
    const page = [
      ...HEADER,
      ...compoundJournalRows(485.5, {
        date: "12-Jun-26", vchNo: "61", credit: 1000,
        expenseHead: "Professional Fees Payable", gross: 10000,
        deductee: "ABC Consultants LLP",
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("ABC Consultants LLP");
    expect(rows[0].credit).toBe(1000);
  });

  it("still recovers the real deductee from the duplicate Cr line's fallback, even when the Dr line's amount doesn't match the row credit", () => {
    // Deliberately mismatched: row credit is 999, but the deductee's Dr line
    // (the thing the ORIGINAL amount-match branch keys on) shows 2959
    // instead — simulates a malformed/edited PDF. Before the Cr-line
    // fallback existed (see the "TDS-liability voucher, no Dr-side
    // restatement" branch in tallyPdf.ts), this degraded all the way to
    // "(as per details)" rather than risk a wrong name. Now the SAME
    // deductee name printed on the voucher's own Cr line (the net-payable
    // line, present on every real compound voucher of this shape) is
    // recovered instead — a strictly better outcome, not a regression: the
    // Cr line names the real payee independently of whatever went wrong on
    // the Dr side, exactly the same trust this codebase already places on a
    // Cr line elsewhere (see the expense-ledger "- Salary" branch below).
    const page = [
      ...HEADER,
      ...compoundJournalRows(485.5, {
        date: "3-Jun-26", vchNo: "70", credit: 999,
        expenseHead: "Interest on Unsecured Loan", gross: 29590,
        deductee: "Nikhilbhai Bhikhabhai Patel (UK)", deducteeDr: 2959,
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Nikhilbhai Bhikhabhai Patel (UK)");
    expect(rows[0].credit).toBe(999);   // the row's own TDS credit, untouched by the fallback
  });

  it("still drops a compound 'To (as per details)' challan/payment voucher entirely (debit side, no credit)", () => {
    const page = [
      ...HEADER,
      ...compoundJournalRows(485.5, {
        date: "20-May-26", vchNo: "32", credit: 2959,
        expenseHead: "Interest on Unsecured Loan", gross: 29590,
        deductee: "Nikhilbhai Bhikhabhai Patel (UK)",
      }),
      ...challanPaymentRow(343.4, { date: "6-Jun-26", bank: "ICICI Bank - 346705001528 (Current)", vchNo: "156", debit: 12853 }),
    ];
    const { rows, skipped } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);           // only the genuine deduction
    expect(rows[0].party).toBe("Nikhilbhai Bhikhabhai Patel (UK)");
    expect(skipped.payments).toBeGreaterThanOrEqual(1);
  });
});

describe("parseTallyPdfPages — TDS-liability compound Journal with NO Dr-side TDS restatement (real Bindra Construction case)", () => {
  // Verbatim from a real voucher (194c-partnership.pdf, "Elite Infraspace"):
  //
  //   7-Apr-26 By (as per details)      Journal   3    8,291.04
  //     Works Contract @ 18%          8,29,104.21 Dr
  //     SGST Input @ 9%                  74,619.38 Dr
  //     CGST Input @ 9%                  74,619.38 Dr
  //     Elite Infraspace               9,70,051.93 Cr
  //
  // Dr 8,29,104.21 + 74,619.38 + 74,619.38 = 9,78,342.97 = Cr 9,70,051.93 +
  // this row's own 8,291.04 TDS credit. No Dr line ever equals 8,291.04 (the
  // ORIGINAL amount-match branch never fires), and this was also the ONLY
  // row on its page — before the fix, the party stayed "(as per details)"
  // and the record read as a false mismatch against Office Data's identical
  // ₹8,291 TDS figure (a ₹0 difference, misreported as unresolved because
  // the PARTY, not the amount, failed to reconcile).
  it("resolves the vendor from the lone Cr line when no Dr line ever matches the row's TDS credit, as the ONLY row on its page", () => {
    const page = [
      ...HEADER,
      ...worksContractVoucherRows(485.5, {
        date: "7-Apr-26", vchNo: "3", credit: 8291.04,
        drLines: [
          { label: "Works Contract @ 18%", amount: 829104.21 },
          { label: "SGST Input @ 9%", amount: 74619.38 },
          { label: "CGST Input @ 9%", amount: 74619.38 },
        ],
        vendor: "Elite Infraspace", vendorCr: 970051.93,
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Elite Infraspace");
    expect(rows[0].credit).toBe(8291.04);   // the row's own TDS credit, untouched by the fallback
  });

  it("never lets the fallback pre-empt a REAL Dr-side match, even when Cr lines are also present", () => {
    // Regression guard: the fallback only captures a CANDIDATE, applied only
    // if the whole voucher ends with no Dr-side match ever found. A genuine
    // Dr-line restatement (the ORIGINAL, higher-confidence signal) must
    // still win over the new fallback whenever it's actually present.
    const page = [
      ...HEADER,
      ...compoundJournalRows(485.5, {
        date: "20-May-26", vchNo: "32", credit: 2959,
        expenseHead: "Interest on Unsecured Loan", gross: 29590,
        deductee: "Nikhilbhai Bhikhabhai Patel (UK)",
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Nikhilbhai Bhikhabhai Patel (UK)");
  });

  it("does not leak the fallback across vouchers — a normal simple row printed right after is unaffected", () => {
    const page = [
      ...HEADER,
      ...worksContractVoucherRows(485.5, {
        date: "7-Apr-26", vchNo: "3", credit: 8291.04,
        drLines: [{ label: "Works Contract @ 18%", amount: 829104.21 }],
        vendor: "Elite Infraspace", vendorCr: 820813.17,
      }),
      ...simpleByRow(414.1, { date: "10-Apr-26", party: "Some Other Vendor", vchNo: "4", credit: 5000 }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ party: "Elite Infraspace", credit: 8291.04 });
    expect(rows[1]).toMatchObject({ party: "Some Other Vendor", credit: 5000 });
  });
});

/** A TDS-liability compound Journal shared by SEVERAL employees in one payroll
 *  run — the shape neither compoundJournalRows (one deductee, Dr amount ==
 *  row credit) nor worksContractVoucherRows (Cr-fallback) covers: N Dr lines
 *  whose amounts SUM to the row's own credit, with none matching it alone.
 *  Verbatim geometry from a real Unity Organics Pvt Ltd "TDS on Salary-92B"
 *  ledger (192B.pdf), voucher 101. */
function multiEmployeeTdsJournalRows(y: number, opts: {
  date?: string; vchNo: string; credit: number;
  employees: { party: string; amount: number }[];
  narration?: string;
}): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  if (opts.date) items.push({ x: 40, y, w: 58, str: `${opts.date} By` });
  else items.push({ x: 87, y, w: 12, str: "By" });
  items.push({ x: 421, y, w: 15, str: opts.vchNo });
  items.push({ x: 281, y: y - 1, w: 33, str: "Journal" });
  items.push({ x: 547, y: y - 1, w: 44, str: fmt(opts.credit) });
  items.push({ x: 104, y: y - 1, w: 70, str: "(as per details)" });
  let lineY = y - 11;
  for (const emp of opts.employees) {
    items.push({ x: 105, y: lineY, w: emp.party.length * 4.3, str: emp.party });
    items.push({ x: 292, y: lineY, w: 53, str: `${fmt(emp.amount)} Dr` });
    lineY -= 11;
  }
  if (opts.narration) items.push({ x: 105, y: lineY, w: opts.narration.length * 4.3, str: opts.narration });
  return items;
}

describe("parseTallyPdfPages — multi-employee TDS-liability compound Journal (real Unity Organics Pvt Ltd case)", () => {
  // Real case: one payroll run's TDS for THREE employees booked in a single
  // ₹52,000 Journal (30,000 + 9,000 + 13,000 = 52,000 exactly), on a "TDS on
  // Salary-92B" ledger. Before this fix, no single Dr line matched the
  // row's own ₹52,000 credit, so the voucher was left as the literal,
  // unmatchable party "(as per details)" — every one of Unity's 6 real
  // office records against this ledger read as "TDS Missing from TDS
  // Ledger" even though the TDS totals matched exactly.
  it("splits a voucher shared by 3 employees into 3 separate rows when their Dr amounts sum exactly to the row's credit", () => {
    const page = [
      ...SALARY_HEADER.map((i) => (i.str === "Staff Salary Expense" ? { ...i, str: "TDS on Salary-92B" } : i)),
      ...multiEmployeeTdsJournalRows(478, {
        date: "30-Apr-26", vchNo: "101", credit: 52000,
        employees: [
          { party: "ZALAK P. KAPOPARA (SALARY)", amount: 30000 },
          { party: "Umang P Kapopara (Salary)", amount: 9000 },
          { party: "KARISHMA HIREN PATOLIYA", amount: 13000 },
        ],
        narration: "TDS FOR THE MONTH OF APR26",
      }),
    ];
    const { rows, issues } = parseTallyPdfPages([page]);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => ({ party: r.party, credit: r.credit, date: r.date }))).toEqual([
      { party: "ZALAK P. KAPOPARA (SALARY)", credit: 30000, date: "30-Apr-26" },
      { party: "Umang P Kapopara (Salary)", credit: 9000, date: "30-Apr-26" },
      { party: "KARISHMA HIREN PATOLIYA", credit: 13000, date: "30-Apr-26" },
    ]);
    // Each split row is its own independent entry, not three copies of one.
    expect(new Set(rows.map((r) => r.row_index)).size).toBe(3);
  });

  it("does NOT split when the Dr lines do not sum exactly to the row's credit — leaves it as the literal unresolved '(as per details)' row, same fail-safe the single-deductee case already relies on", () => {
    const page = [
      ...SALARY_HEADER.map((i) => (i.str === "Staff Salary Expense" ? { ...i, str: "TDS on Salary-92B" } : i)),
      ...multiEmployeeTdsJournalRows(478, {
        date: "30-Apr-26", vchNo: "101", credit: 52000,
        employees: [
          { party: "ZALAK P. KAPOPARA (SALARY)", amount: 30000 },
          { party: "Umang P Kapopara (Salary)", amount: 9000 },
          // Missing Karishma's ₹13,000 — sum is 39,000, not 52,000. A
          // malformed/partially-read PDF must never be force-split on a
          // guess; the exact-sum requirement is the whole safety net. The
          // row is kept (not silently dropped — the credit column WAS
          // printed, unlike the debit-only case above) but stays
          // unresolvable by name, exactly as an unmatchable compound
          // voucher already reads today.
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("(as per details)");
    expect(rows[0].credit).toBe(52000);
  });

  // The OTHER real Unity bug, same ledger: the compound Cr-line "expense
  // ledger" branch (meant only for a genuine Staff Salary Expense ledger)
  // had no ledger-type gate, so it ALSO misfired on this TDS-liability
  // ledger's own challan-payment voucher — mistaking "HDFC Bank C.C A/c" for
  // an employee and tagging the whole payment as taxable income.
  it("never mistakes a TDS-liability ledger's own challan-payment voucher (bank Cr line) for a taxable-income row", () => {
    const page = [
      ...SALARY_HEADER.map((i) => (i.str === "Staff Salary Expense" ? { ...i, str: "TDS on Salary-92B" } : i)),
      ...salaryExpenseVoucherRows(478, {
        date: "30-Apr-26", vchNo: "46", debit: 312780,
        crLines: [
          { label: "TDS on Interest - 94A", amount: 76224 },
          { label: "TDS on Rent-94I", amount: 9585 },
          { label: "HDFC Bank C.C A/c", amount: 547144 },
        ],
      }),
    ];
    const { rows, skipped } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(0);
    expect(skipped.payments).toBe(1);
  });
});

describe("parseTallyPdfPages — expense-ledger 'Staff Salary Expense' compound rows (real Microcircuits data)", () => {
  it("identifies the Cr breakdown line containing '- Salary' as the deductee, and copies the voucher's own DEBIT total (not that line's net-payable amount) into credit", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "1", debit: 31372,
        crLines: [
          { label: "Nevil Thummar - Salary", amount: 49372 },
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) - Employee", amount: 200 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Nevil Thummar - Salary");
    expect(rows[0].credit).toBe(31172);      // 31,372 debit, minus the 200 Professional Tax — NOT 49372
    expect(rows[0].date).toBe("30-Apr-26");
  });

  it("is unaffected by breakdown-line ORDER — the '- Salary' line still wins when PF/Professional Tax print first", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "2", debit: 39705,
        crLines: [
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) - Employee", amount: 200 },
          { label: "Kunjal Hasmukhbhai Gami - Salary", amount: 37705 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Kunjal Hasmukhbhai Gami - Salary");
    expect(rows[0].credit).toBe(39505);   // 39,705 debit, minus the 200 Professional Tax
  });

  // TAXABLE INCOME IS SPLIT ACROSS SEVERAL Dr LINES. Reproduced verbatim from
  // a real voucher (Nevil Thummar, April):
  //
  //   To (as per details)      Journal 11   Debit 31,372.00
  //     Bonus Expense            20,000.00 Dr
  //     Nevil Thummar - Salary   49,372.00 Cr
  //     PF Employee               1,800.00 Cr
  //     Professional Tax - (AMC)    200.00 Cr
  //
  // Dr 31,372 + 20,000 = Cr 49,372 + 1,800 + 200 = 51,372. The voucher's own
  // debit is only the salary-expense share; reading it alone reported 31,372
  // against Office Data's 51,372 — a false mismatch of exactly the bonus.
  it("adds every taxable Dr component (Bonus Expense) to the employee's taxable income", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "11", debit: 31372,
        bonusDr: { label: "Bonus Expense", amount: 20000 },
        crLines: [
          { label: "Nevil Thummar - Salary", amount: 49372 },
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) - Employee", amount: 200 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Nevil Thummar - Salary");
    expect(rows[0].credit).toBe(51172);          // 31,372 + 20,000 - 200 Professional Tax
    expect(rows[0].amountKind).toBe("taxable_income");
  });

  // THE EMPLOYEE'S LINE IS NOT ALWAYS NAMED "… - Salary". Verbatim from a real
  // Kwikteam "Salary Expenses" ledger:
  //
  //   30-Apr-26 To (as per details)   Journal 6   Debit 32,261.00
  //     Krunal Rajendrakumar Nayak    30,131.00 Cr
  //     Professional Tax (AMC)           200.00 Cr
  //     PF (Employee's Share)          1,800.00 Cr
  //     ESIC (Employee's Share)          130.00 Cr
  //
  // Requiring the literal word "Salary" was one client's naming convention, not
  // a rule: here every voucher failed to resolve a deductee and all 15 were
  // dropped as payments, surfacing as "No credit (deduction) entries were found
  // in this ledger" for a ledger that is nothing but salary. The employee is
  // now identified structurally — not a statutory head, and carrying the bulk
  // of the voucher — so naming style is irrelevant.
  it("finds the employee when the credit line is a bare name, with no '- Salary' suffix", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "6", debit: 32261,
        crLines: [
          { label: "Krunal Rajendrakumar Nayak", amount: 30131 },
          { label: "Professional Tax (AMC)", amount: 200 },
          { label: "PF (Employee's Share)", amount: 1800 },
          { label: "ESIC (Employee's Share)", amount: 130 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Krunal Rajendrakumar Nayak");
    expect(rows[0].credit).toBe(32061);            // 32,261 debit, minus the 200 Professional Tax
    expect(rows[0].amountKind).toBe("taxable_income");
  });

  // Real client (24Q Director's Remuneration ledger): FOUR Cr breakdown lines,
  // not the usual two or three — "192B - TDS Payable" AND a separate
  // "Education Cess TDS" line alongside Professional Tax and the employee's
  // own "- Salary" line. Both TDS-named lines contain the word "TDS", so
  // isTaxLine() recognises both, the same as it already recognised
  // Professional Tax — neither is a candidate for the employee line, AND
  // neither inflates the taxable figure, matching the employee's own "-
  // Salary" Cr line exactly (real Accurate PMS Pvt Ltd voucher: leaving TDS
  // Payable/Education Cess untaxed-but-uncounted put Taxable Income ₹28,850
  // above the employee's own line — TAX IS NOT INCOME, see isTaxLine's own
  // doc, applies here exactly as it does to Professional Tax alone).
  it("excludes a 'TDS Payable' line and a separate 'Education Cess TDS' line from Taxable Income, same as Professional Tax", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "360", debit: 213000,
        crLines: [
          { label: "192B - TDS Payable", amount: 27740 },
          { label: "Education Cess TDS", amount: 1110 },
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "Dushyant Prajapati - Salary", amount: 183950 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Dushyant Prajapati - Salary");
    expect(rows[0].credit).toBe(183950);   // matches the employee's own Cr line exactly
    expect(rows[0].ptExcluded).toBe(29050);  // 27,740 + 1,110 + 200
    expect(rows[0].amountKind).toBe("taxable_income");
  });

  // Real client: THREE directors on the SAME DAY whose vouchers are byte-for-
  // byte identical in every figure (debit 2,13,000; breakdown 27,740/1,110/
  // 200/1,83,950) — only the employee's own name differs. Tied amounts are
  // exactly the shape that could confuse a matcher that leans on amount to
  // break ties; this file's job is only PARSING (Stage-3's separate exclusivity
  // engine does the pairing — see tallyRecon.test.ts/dualLedger.test.ts), so
  // the one thing that MUST hold here is that parsing keeps all three rows
  // distinct, each under its own real name, none dropped or merged.
  it("keeps three same-day, same-amount vouchers for different directors fully distinct", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "360", debit: 213000,
        crLines: [
          { label: "192B - TDS Payable", amount: 27740 },
          { label: "Education Cess TDS", amount: 1110 },
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "Dineshkumar V Padsala - Salary", amount: 183950 },
        ],
      }),
      ...salaryExpenseVoucherRows(340.9, {
        vchNo: "361", debit: 213000,
        crLines: [
          { label: "192B - TDS Payable", amount: 27740 },
          { label: "Education Cess TDS", amount: 1110 },
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "Dushyant Prajapati - Salary", amount: 183950 },
        ],
      }),
      ...salaryExpenseVoucherRows(196.3, {
        vchNo: "363", debit: 213000,
        crLines: [
          { label: "192B - TDS Payable", amount: 27740 },
          { label: "Education Cess TDS", amount: 1110 },
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "Pinnag Rathod - Salary", amount: 183950 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows.map((r) => ({ party: r.party, credit: r.credit, date: r.date, ptExcluded: r.ptExcluded }))).toEqual([
      { party: "Dineshkumar V Padsala - Salary", credit: 183950, date: "30-Apr-26", ptExcluded: 29050 },
      { party: "Dushyant Prajapati - Salary", credit: 183950, date: "30-Apr-26", ptExcluded: 29050 },
      { party: "Pinnag Rathod - Salary", credit: 183950, date: "30-Apr-26", ptExcluded: 29050 },
    ]);
  });

  // The deduction heads must never stand in for the employee, even when they
  // are the only credit lines the voucher has.
  it("still drops a voucher whose credits are ALL deduction heads", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "6", debit: 2130,
        crLines: [
          { label: "Professional Tax (AMC)", amount: 200 },
          { label: "PF (Employee's Share)", amount: 1800 },
          { label: "ESIC (Employee's Share)", amount: 130 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(0);
  });

  // TAX IS NOT INCOME — and the tax line is NOT labelled "TDS". Reproduced
  // verbatim from the real "Director Remuneration - RCM" ledger:
  //
  //   30-Apr-26 To (as per details)   Journal 30   Debit 2,00,000.00
  //     Madhukant Kanjibhai Patel - Salary    19,800.00 Dr
  //     Madhukant Kanjibhai Patel - Salary  1,99,800.00 Cr
  //     Professional Tax - (AMC) - Employee     200.00 Cr
  //     TDS 192 B                            19,800.00 Cr
  //
  // The TDS is DEBITED TO THE EMPLOYEE'S OWN ACCOUNT (settling part of what
  // is owed to them) and credited to "TDS 192 B". So the extra debit carries
  // the EMPLOYEE'S name, not the word TDS — a name-based tax filter never
  // sees it. Summing it (without the contra-exclusion below) reported
  // ₹2,19,800 for this real MICROCIRCUITS director, Madhukant Kanjibhai
  // Patel — and his real stored Office Data (queried directly: filing
  // 1af64f16, section 192B, both April and May) is ₹2,00,000, confirming the
  // FULL voucher debit — Professional Tax AND TDS both INCLUDED — is the
  // right final figure, not 199,800 (PT excluded, TDS not) as this test used
  // to assert with no real data behind that specific number. Parsing alone
  // (this test) still excludes every tax line — that's what makes the GROSS
  // reading (credit + ptExcluded, see resolveTaxableIncomeReading in
  // tallyRecon.ts) reconstruct ₹2,00,000 exactly once Office Data is used to
  // pick it; this layer only has to prove the self-contra Dr line is never
  // double-counted, which is why it still equals 20,000 short of 2,00,000 —
  // NOT 39,800 short (the un-fixed, contra-double-counted bug this test
  // exists to guard against).
  it("never adds a contra debit posted to the deductee's OWN account", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "30", debit: 200000,
        bonusDr: { label: "Madhukant Kanjibhai Patel - Salary", amount: 19800 },
        crLines: [
          { label: "Madhukant Kanjibhai Patel - Salary", amount: 199800 },
          { label: "Professional Tax - (AMC) - Employee", amount: 200 },
          { label: "TDS 192 B", amount: 19800 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Madhukant Kanjibhai Patel - Salary");
    // NOT 219,800 (the self-contra double-counted) and NOT 199,800 (PT
    // excluded but TDS left in, this test's old, never-verified assumption)
    // — 200,000 minus BOTH tax lines (200 PT + 19,800 TDS); ptExcluded
    // carries the 20,000 back for resolveTaxableIncomeReading to restore.
    expect(rows[0].credit).toBe(180000);
    expect(rows[0].ptExcluded).toBe(20000);
  });

  it("never adds an explicitly TDS-labelled debit either", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "7", debit: 200000,
        bonusDr: { label: "TDS 192 B", amount: 19800 },
        crLines: [
          { label: "Madhukant Kanjibhai Patel - Salary", amount: 180200 },
          { label: "PF Employee", amount: 1800 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows[0].credit).toBe(200000);
  });

  // The bonus stays IN (a genuine Dr-side taxable component, not a tax
  // line and not a self-contra) while the TDS Cr line comes back OUT — same
  // exclusion as Madhukant's case above, at the parse layer. Net here
  // (49,872) is 1,500 short of the old assumed 51,372; ptExcluded carries
  // that 1,500 for resolveTaxableIncomeReading, which is where a real
  // Office Data figure of 51,372 (bonus-and-TDS both in, as Madhukant's real
  // office data shows for his own tax lines) would actually get restored.
  it("a genuine taxable component is still added when a TDS line sits beside it", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "8", debit: 31372,
        bonusDr: { label: "Bonus Expense", amount: 20000 },
        crLines: [
          { label: "TDS 192 B", amount: 1500 },
          { label: "Nevil Thummar - Salary", amount: 49872 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows[0].credit).toBe(49872);    // bonus in, TDS excluded (see ptExcluded)
    expect(rows[0].ptExcluded).toBe(1500);
  });

  // The sum must not leak across vouchers: the employee WITHOUT a bonus keeps
  // their own figure even when a bonus voucher printed immediately above.
  it("a bonus on one voucher never inflates the next employee's figure", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "11", debit: 31372,
        bonusDr: { label: "Bonus Expense", amount: 20000 },
        crLines: [
          { label: "Nevil Thummar - Salary", amount: 49372 },
          { label: "PF Employee", amount: 1800 },
        ],
      }),
      ...salaryExpenseVoucherRows(414.1, {
        vchNo: "12", debit: 31372,
        crLines: [
          { label: "Urmi Bansi Patel - Salary", amount: 29572 },
          { label: "PF Employee", amount: 1800 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ party: "Nevil Thummar - Salary", credit: 51372 });
    expect(rows[1]).toMatchObject({ party: "Urmi Bansi Patel - Salary", credit: 31372 });
  });

  it("still drops the voucher entirely when NO Cr breakdown line is recoverable (no '- Salary' line at all)", () => {
    // A voucher whose breakdown is only deductions (PF/Professional Tax), no
    // named employee "- Salary" line — must stay a dropped "payment" row, the
    // same guarantee the pre-existing challan/payment tests rely on.
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "4", debit: 2000,
        crLines: [
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) - Employee", amount: 200 },
        ],
      }),
    ];
    const { rows, skipped } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(0);
    expect(skipped.payments).toBeGreaterThanOrEqual(1);
  });

  it("processes multiple employees' vouchers on one page independently, no cross-contamination", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "1", debit: 31372,
        crLines: [
          { label: "Nevil Thummar - Salary", amount: 49372 },
          { label: "PF Employee", amount: 1800 },
        ],
      }),
      ...salaryExpenseVoucherRows(414.1, {
        vchNo: "2", debit: 39705,
        crLines: [
          { label: "Kunjal Hasmukhbhai Gami - Salary", amount: 37705 },
          { label: "PF Employee", amount: 1800 },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows.map(r => ({ party: r.party, credit: r.credit, date: r.date }))).toEqual([
      { party: "Nevil Thummar - Salary", credit: 31372, date: "30-Apr-26" },
      { party: "Kunjal Hasmukhbhai Gami - Salary", credit: 39705, date: "30-Apr-26" }, // inherited
    ]);
  });

  // REGRESSION — real MICROCIRCUITS "salary expense.pdf" (all 7 pages read):
  // an employee whose full name is too long for one line wraps onto a SECOND
  // baseline, but the AMOUNT stays pinned to the FIRST line alongside only
  // half the name (e.g. "Keshviben Hasmukhbhau  23,000.00 Cr" then "Gami -
  // Salary" alone below) — confirmed against the real PDF's own pdfjs
  // coordinates. The wrap must not lose the row, and the reassembled name
  // must be the FULL name, not just whichever half happened to sit with the
  // amount or the "- Salary" word.
  it("reassembles a wrapped employee name whose amount sits with the FIRST half, not the half containing '- Salary'", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Apr-26", vchNo: "18", debit: 25000,
        crLines: [
          { label: "Keshviben Hasmukhbhau", amount: 23000, wrap: "Gami - Salary" },
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) -", amount: 200, wrap: "Employee" },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("Keshviben Hasmukhbhau Gami - Salary");
    expect(rows[0].credit).toBe(24800);   // 25,000 debit, minus the 200 Professional Tax
  });

  it("does the same across two consecutive wrapped-name vouchers with no cross-contamination (real Devansiben/Uttamkumar case)", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        vchNo: "22", debit: 73038,
        crLines: [
          { label: "Uttamkumar Vinodbhai", amount: 71038, wrap: "Thummar - Salary" },
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) -", amount: 200, wrap: "Employee" },
        ],
      }),
      ...salaryExpenseVoucherRows(414.1, {
        vchNo: "23", debit: 23038,
        crLines: [
          { label: "Devansiben Mukeshbhai", amount: 21038, wrap: "Panchal - Salary" },
          { label: "PF Employee", amount: 1800 },
          { label: "Professional Tax - (AMC) -", amount: 200, wrap: "Employee" },
        ],
      }),
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows.map(r => ({ party: r.party, credit: r.credit }))).toEqual([
      { party: "Uttamkumar Vinodbhai Thummar - Salary", credit: 72838 },   // 73,038 - 200 PT
      { party: "Devansiben Mukeshbhai Panchal - Salary", credit: 22838 },  // 23,038 - 200 PT
    ]);
  });
});

// REGRESSION — real MICROCIRCUITS ledger, continuation pages (2 onward): the
// "Date" and "Particulars" header labels sat exactly 56px apart (66 and 122)
// and EVERY breakdown line's indented text printed at their exact midpoint
// (94) — an equal-distance tie in readBand's nearest-text-column heuristic
// that used to resolve to "date", silently swallowing the employee's own
// name as a garbage date value. That corrupted `lastDate` for every
// following row on the page and derailed the compound-party state machine,
// losing every voucher on the page from that point on (confirmed: an entire
// 7-page real ledger dropped from 54 real vouchers to 6 before this fix).
describe("parseTallyPdfPages — a Date/Particulars anchor tie never swallows breakdown text as a date (real MICROCIRCUITS page-2+ geometry)", () => {
  const TIE_HEADER: PdfTextItem[] = [
    { x: 39, y: 795, w: 224.8, str: "MICROCIRCUITS INNOVATIONS PRIVATE LIMITED" },
    // Strictly above "Ledger Account" (not the same y) — findLedgerName only
    // considers a candidate whose y is > the caption's; real Tally PDFs print
    // the ledger name a line above the caption, never on the same baseline.
    { x: 39, y: 783, w: 86.8, str: "Staff Salary Expense" },
    { x: 143, y: 782, w: 65.1, str: "Ledger Account" },
    { x: 232, y: 782, w: 91.0, str: "1-Apr-26 to 30-Jun-26" },
    { x: 66, y: 767, w: 19.6, str: "Date" },
    { x: 122, y: 768, w: 48.1, str: "Particulars" },
    { x: 545, y: 768, w: 26.9, str: "Credit" },
    { x: 459, y: 768, w: 23.3, str: "Debit" },
    { x: 357, y: 767, w: 33.1, str: "Vch No." },
    { x: 213, y: 767, w: 39.3, str: "Vch Type" },
  ];
  it("resolves a voucher on a page whose Date/Particulars anchors are 56px apart and whose breakdown text sits at the exact midpoint (x=94)", () => {
    const page: PdfTextItem[] = [
      ...TIE_HEADER,
      { x: 44, y: 716, w: 37.2, str: "30-Apr-26" },
      { x: 88, y: 715, w: 8.1, str: "To" },
      { x: 102, y: 716, w: 65.6, str: "(as per details)" },
      { x: 462, y: 715, w: 41.4, str: "25,000.00" },
      { x: 435, y: 716, w: 9.3, str: "18" },
      { x: 314, y: 717, w: 30.2, str: "Journal" },
      { x: 94, y: 702, w: 102.3, str: "Keshviben Hasmukhbhau" },
      { x: 259, y: 702, w: 27.8, str: "23,000.00 Cr" },
      { x: 94, y: 691, w: 53.5, str: "Gami - Salary" },
      { x: 94, y: 678, w: 52.6, str: "PF Employee" },
      { x: 259, y: 678, w: 28.0, str: "1,800.00 Cr" },
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("30-Apr-26");                              // not "Keshviben Hasmukhbhau"
    expect(rows[0].party).toBe("Keshviben Hasmukhbhau Gami - Salary");
    expect(rows[0].credit).toBe(25000);
  });
});

describe("parseTallyPdfPages — regression: simple (non-compound) rows are unaffected", () => {
  it("keeps a directly-named party and its wrapped continuation line intact", () => {
    const page = [
      ...HEADER,
      ...simpleByRow(572.3, { date: "5-Apr-26", party: "Hero Fincorp Ltd - Tranche 01 - 78143", vchNo: "2", credit: 8421 }),
      { x: 104.6, y: 560.4, w: 52.3, str: "84206@10%" }, // wrapped continuation of the party's own ledger name
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("5-Apr-26");
    expect(rows[0].party).toBe("Hero Fincorp Ltd - Tranche 01 - 78143 84206@10%");
    expect(rows[0].credit).toBe(8421);
    // A simple row never reaches the compound-journal narration-capture path
    // — its own wrapped continuation line is (correctly) read as more of the
    // party name instead, not narration.
    expect(rows[0].narration).toBeNull();
  });

  // Real Accurate PMS Pvt Ltd 194C ledger, Q2 FY 2026-27: the narration wraps
  // onto a second line, and that tail used to be glued onto the party name —
  // turning one contractor into a separate "party" per invoice.
  it("never appends a wrapped NARRATION tail to the party name (real Ketan Parmar case)", () => {
    const page = [
      ...HEADER,
      ...simpleByRow(572.3, { date: "2-Sep-26", party: "Ketan Parmar (BH Parmar Electrician)", vchNo: "656", credit: 1054 }),
      { x: 104.6, y: 560.4, w: 160.0, str: "BEING TDS DEDUCT INV NO. 144 AMT-" },
      { x: 104.6, y: 548.5, w: 60.0, str: "105448/-@ 1%" },
      ...simpleByRow(530.0, { party: "Ketan Parmar (BH Parmar Electrician)", vchNo: "660", credit: 163 }),
      { x: 104.6, y: 518.1, w: 170.0, str: "BEING INV NO. 151 AMT- 16300/- @ 1%" },
    ];
    const { rows } = parseTallyPdfPages([page]);
    expect(rows.map((r) => ({ party: r.party, credit: r.credit, narration: r.narration }))).toEqual([
      { party: "Ketan Parmar (BH Parmar Electrician)", credit: 1054, narration: "BEING TDS DEDUCT INV NO. 144 AMT- 105448/-@ 1%" },
      { party: "Ketan Parmar (BH Parmar Electrician)", credit: 163, narration: "BEING INV NO. 151 AMT- 16300/- @ 1%" },
    ]);
  });

  it("still drops a simple challan/payment row (Debit side)", () => {
    const page = [
      ...HEADER,
      ...challanPaymentRow(543.4, { date: "30-Apr-26", bank: "ICICI Bank - 346705001528 (Current)", vchNo: "43", debit: 1149242 }),
    ];
    const { rows, skipped } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(0);
    expect(skipped.payments).toBe(1);
  });

  it("drops Opening/Closing Balance rows", () => {
    const page = [
      ...HEADER,
      { x: 42.2, y: 586.1, w: 56.0, str: "1-Apr-26 By" },
      { x: 116.3, y: 585.7, w: 81.5, str: "Opening Balance" },
      { x: 533.6, y: 585.7, w: 58.0, str: "11,49,242.00" },
    ];
    const { rows, skipped } = parseTallyPdfPages([page]);
    expect(rows).toHaveLength(0);
    expect(skipped.balances).toBe(1);
  });
});

describe("parseTallyPdfPages — a full multi-entry page, mixing every row shape", () => {
  it("produces exactly the deduction rows a human reading the PDF would expect, in order", () => {
    const page = [
      ...HEADER,
      ...simpleByRow(572.3, { date: "5-Apr-26", party: "Hero Fincorp Ltd - Tranche 01 - 78143", vchNo: "2", credit: 8421 }),
      { x: 104.6, y: 560.4, w: 52.3, str: "84206@10%" },
      ...challanPaymentRow(543.4, { date: "30-Apr-26", bank: "ICICI Bank - 346705001528 (Current)", vchNo: "43", debit: 1149242 }),
      ...compoundJournalRows(485.5, {
        date: "20-May-26", vchNo: "32", credit: 2959,
        expenseHead: "Interest on Unsecured Loan", gross: 29590,
        deductee: "Nikhilbhai Bhikhabhai Patel (UK)",
      }),
      ...compoundJournalRows(414.1, {
        vchNo: "33", credit: 7397,
        expenseHead: "Interest on Unsecured Loan", gross: 73973,
        deductee: "Hansaben Nikhilbhai Patel (UK)",
      }),
    ];
    const { rows, skipped } = parseTallyPdfPages([page]);
    expect(rows.map(r => ({ party: r.party, credit: r.credit, date: r.date }))).toEqual([
      { party: "Hero Fincorp Ltd - Tranche 01 - 78143 84206@10%", credit: 8421, date: "5-Apr-26" },
      { party: "Nikhilbhai Bhikhabhai Patel (UK)", credit: 2959, date: "20-May-26" },
      { party: "Hansaben Nikhilbhai Patel (UK)", credit: 7397, date: "20-May-26" },
    ]);
    expect(skipped.payments).toBe(1);
  });
});

// REAL DATA, END TO END: three real Accurate PMS Pvt Ltd employees' June-2026
// vouchers (byte-for-byte from the client's own "Salary Exp." ledger PDF),
// reconciled against their REAL stored Office Data (tds_deductees.
// amount_paid_credited, pulled from production for this exact filing).
// Confirmed independently across three unrelated employees before this fix
// shipped: Office Data's "Taxable Income" for THIS client equals the
// voucher's FULL debit — Professional Tax, TDS Payable and Education Cess
// all INCLUDED — so parsing must exclude all three (isTaxLine, not
// PROFESSIONAL_TAX_RE alone) AND resolveTaxableIncomeReading must pick the
// GROSS reading back up, not merely avoid a crash.
describe("parseTallyPdfPages → resolveTaxableIncomeReading → reconcileTallyFull — real Accurate PMS Pvt Ltd June vouchers", () => {
  const office: OfficeTxn[] = [
    { deductee_id: "e1", name: "SHEETALBEN DUSHYANTKUMAR PRAJAPATI", date_iso: "2026-06-30", amount: 123000, tds: null, section: null },
    { deductee_id: "e2", name: "Dharmesh Gohil", date_iso: "2026-06-30", amount: 121000, tds: null, section: null },
    { deductee_id: "e3", name: "SNEHAL DINESHBHAI PADSALA", date_iso: "2026-06-30", amount: 121500, tds: null, section: null },
  ];
  it("parses and resolves all three to Matched, with the gross reading reconstructing the real voucher debit exactly", () => {
    const page = [
      ...SALARY_HEADER,
      ...salaryExpenseVoucherRows(485.5, {
        date: "30-Jun-26", vchNo: "365", debit: 123000,
        crLines: [
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "192B - TDS Payable", amount: 8197 },
          { label: "Education Cess TDS", amount: 328 },
          { label: "Sheetalben D Prajapati", amount: 114275 },
        ],
      }),
      ...salaryExpenseVoucherRows(340.9, {
        vchNo: "366", debit: 121000,
        crLines: [
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "192B - TDS Payable", amount: 7870 },
          { label: "Education Cess TDS", amount: 315 },
          { label: "Dharmesh Gohil - Salary", amount: 112615 },
        ],
      }),
      ...salaryExpenseVoucherRows(196.3, {
        vchNo: "364", debit: 121500,
        crLines: [
          { label: "Professional Tax - Employ", amount: 200 },
          { label: "192B - TDS Payable", amount: 7952 },
          { label: "Education Cess TDS", amount: 318 },
          { label: "Snehal Padsala", amount: 113030 },
        ],
      }),
    ];
    const { rows: parsed } = parseTallyPdfPages([page]);
    expect(parsed.map((r) => ({ credit: r.credit, ptExcluded: r.ptExcluded }))).toEqual([
      { credit: 114275, ptExcluded: 8725 },  // 123,000 - (200 + 8,197 + 328)
      { credit: 112615, ptExcluded: 8385 },  // 121,000 - (200 + 7,870 + 315)
      { credit: 113030, ptExcluded: 8470 },  // 121,500 - (200 + 7,952 + 318)
    ]);

    const resolved = resolveTaxableIncomeReading(office, parsed);
    expect(resolved.map((r) => r.credit)).toEqual([123000, 121000, 121500]);

    const { rows } = reconcileTallyFull(office, resolved, null, {});
    for (const r of rows) expect(r.result).toBe("Matched");
  });
});
