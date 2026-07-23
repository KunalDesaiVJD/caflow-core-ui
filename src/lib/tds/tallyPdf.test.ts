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
