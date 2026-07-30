import { describe, it, expect } from "vitest";
import { parseTallyPdfPages, type PdfTextItem } from "./tallyPdf";

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

  it("leaves the party as '(as per details)' (not corrupted) when no breakdown line's Dr amount matches the row credit", () => {
    // Deliberately mismatched: row credit is 999, but the deductee's Dr line
    // (the thing that's supposed to match) shows 2959 instead — simulates a
    // malformed/edited PDF. Must not misattribute a wrong name; degrade to
    // the same "(as per details)" the pre-fix code always showed.
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
    expect(rows[0].party).toBe("(as per details)");
    expect(rows[0].credit).toBe(999);
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

describe("parseTallyPdfPages — expense-ledger 'Staff Salary Expense' compound rows (real Microcircuits data)", () => {
  it("identifies the Cr breakdown line containing '- Salary' as the deductee, and copies the voucher's own DEBIT total (not that line's net-payable amount) into credit", () => {
    const page = [
      ...HEADER,
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
      ...HEADER,
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
      ...HEADER,
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
      ...HEADER,
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

  // The deduction heads must never stand in for the employee, even when they
  // are the only credit lines the voucher has.
  it("still drops a voucher whose credits are ALL deduction heads", () => {
    const page = [
      ...HEADER,
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
  // sees it. Summing it reported ₹2,19,800 against Office Data's ₹2,00,000,
  // a false mismatch of exactly the TDS, on every director every month.
  it("never adds a contra debit posted to the deductee's OWN account", () => {
    const page = [
      ...HEADER,
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
    expect(rows[0].credit).toBe(199800);   // NOT 219,800 (TDS contra) — 200,000 minus 200 Professional Tax
  });

  it("never adds an explicitly TDS-labelled debit either", () => {
    const page = [
      ...HEADER,
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

  it("a genuine taxable component is still added when a TDS line sits beside it", () => {
    const page = [
      ...HEADER,
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
    expect(rows[0].credit).toBe(51372);    // bonus in, no tax added
  });

  // The sum must not leak across vouchers: the employee WITHOUT a bonus keeps
  // their own figure even when a bonus voucher printed immediately above.
  it("a bonus on one voucher never inflates the next employee's figure", () => {
    const page = [
      ...HEADER,
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
      ...HEADER,
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
      ...HEADER,
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
      ...HEADER,
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
      ...HEADER,
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
    { x: 39, y: 782, w: 86.8, str: "Staff Salary Expense" },
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
