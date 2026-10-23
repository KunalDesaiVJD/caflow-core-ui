import { describe, it, expect } from "vitest";
import { composeLedgerEntries, type RawInvoice, type RawReceipt, type RawKasar } from "./statementOfAccount";
import { ledgerEntryKind, receiptDocNo, kasarDocNo } from "./ledgerEntryKinds";

const FIRM = "f1";
const base = { fromDate: "2026-04-01", obDate: "2026-04-01", obNarration: "Opening Balance", firmTag: () => "" };

const invoice = (over: Partial<RawInvoice> = {}): RawInvoice => ({
  id: "inv00001-aaaa", firm_id: FIRM, invoice_no: "INV/1", invoice_date: "2026-05-01", total_amount: 100000, document_type: "invoice", ...over,
});
const receipt = (over: Partial<RawReceipt> = {}): RawReceipt => ({
  id: "rct00001-bbbb", firm_id: FIRM, receipt_date: "2026-05-10", amount_received: 80000,
  tds_amount: null, gst_tds_amount: null, payment_mode: "neft", remarks: null, ...over,
});
const kasar = (over: Partial<RawKasar> = {}): RawKasar => ({
  id: "ksr00001-cccc", firm_id: FIRM, kasar_date: "2026-05-12", amount: 500, narration: null, ...over,
});

describe("composeLedgerEntries — receipt, TDS and kasar are separate lines", () => {
  it("splits one receipt carrying TDS and GST TDS into three lines, never one merged credit", () => {
    const rows = composeLedgerEntries({
      ...base, opening: 0,
      invoices: [invoice()],
      receipts: [receipt({ tds_amount: 10000, gst_tds_amount: 1800 })],
      kasars: [kasar()],
    });
    expect(rows.map(r => r.kind)).toEqual(["invoice", "receipt", "tds", "gst_tds", "kasar"]);
    expect(rows.map(r => r.credit)).toEqual([0, 80000, 10000, 1800, 500]);
    // Nothing is lost by splitting: 100000 − 80000 − 10000 − 1800 − 500
    expect(rows[rows.length - 1].balance).toBe(7700);
  });

  it("gives the TDS and GST TDS lines the receipt's own number so they trace back to it", () => {
    const rows = composeLedgerEntries({
      ...base, opening: 0, invoices: [], kasars: [],
      receipts: [receipt({ tds_amount: 10000, gst_tds_amount: 1800 })],
    });
    const rct = receiptDocNo("rct00001-bbbb");
    expect(rct).toBe("RCT-rct000");
    expect(rows.map(r => r.doc_no)).toEqual([rct, rct, rct]);
  });

  it("records a TDS-only entry (no amount received) as just its TDS line", () => {
    const rows = composeLedgerEntries({
      ...base, opening: 0, kasars: [],
      invoices: [invoice()],
      receipts: [receipt({ amount_received: 0, tds_amount: 2000 })],
    });
    expect(rows.map(r => r.kind)).toEqual(["invoice", "tds"]);
    expect(rows.some(r => r.kind === "receipt")).toBe(false);
    expect(rows[1].narration).toBe("TDS deducted");
    expect(rows[1].balance).toBe(98000);
  });

  it("numbers kasar like the Ledger tab and keeps the kasar narration", () => {
    const rows = composeLedgerEntries({
      ...base, opening: 0, invoices: [], receipts: [],
      kasars: [kasar({ narration: "Exchange Rate Diff." }), kasar({ id: "ksr00002-dddd", narration: null })],
    });
    expect(rows.map(r => r.doc_no)).toEqual([kasarDocNo("ksr00001-cccc"), kasarDocNo("ksr00002-dddd")]);
    expect(rows.map(r => r.narration)).toEqual(["Kasar — Exchange Rate Diff.", "Kasar settlement"]);
  });

  it("puts the opening balance first, without a kind, and runs the balance from it", () => {
    const rows = composeLedgerEntries({ ...base, opening: 5000, invoices: [invoice({ total_amount: 1000 })], receipts: [], kasars: [] });
    expect(rows[0]).toMatchObject({ doc_no: "—", debit: 5000, credit: 0, balance: 5000 });
    expect(rows[0].kind).toBeUndefined();
    expect(rows[1].balance).toBe(6000);
  });

  it("shows a credit opening balance as a credit", () => {
    const rows = composeLedgerEntries({ ...base, opening: -300, invoices: [], receipts: [], kasars: [] });
    expect(rows[0]).toMatchObject({ debit: 0, credit: 300, balance: -300 });
  });

  it("treats credit notes as credits and keeps invoices as debits, tagged with their ids", () => {
    const rows = composeLedgerEntries({
      ...base, opening: 0, receipts: [], kasars: [],
      invoices: [invoice(), invoice({ id: "cn000001-eeee", invoice_no: "CN/1", document_type: "credit_note", total_amount: 2000, invoice_date: "2026-05-20" })],
    });
    expect(rows.map(r => [r.kind, r.debit, r.credit])).toEqual([["invoice", 100000, 0], ["credit_note", 0, 2000]]);
    expect(rows.map(r => r.doc_id)).toEqual(["inv00001-aaaa", "cn000001-eeee"]);
  });

  it("orders by date and keeps receipt → TDS → GST TDS in that order within one day", () => {
    const rows = composeLedgerEntries({
      ...base, opening: 0, kasars: [],
      invoices: [invoice({ invoice_date: "2026-05-10" })],
      receipts: [receipt({ receipt_date: "2026-05-10", tds_amount: 1, gst_tds_amount: 1 }), receipt({ id: "rct00002-ffff", receipt_date: "2026-05-02", amount_received: 5 })],
    });
    expect(rows.map(r => [r.entry_date, r.kind])).toEqual([
      ["2026-05-02", "receipt"], ["2026-05-10", "invoice"], ["2026-05-10", "receipt"], ["2026-05-10", "tds"], ["2026-05-10", "gst_tds"],
    ]);
  });

  it("tags lines with the firm name only when the statement spans firms", () => {
    const tag = (id: string) => `[${id === "f2" ? "Second" : "First"}] `;
    const rows = composeLedgerEntries({
      ...base, opening: 0, kasars: [], receipts: [receipt({ firm_id: "f2", tds_amount: 100 })],
      invoices: [invoice()], firmTag: tag,
    });
    expect(rows.map(r => r.narration)).toEqual(["[First] Invoice — INV/1", "[Second] Payment received — neft", "[Second] TDS deducted"]);
  });
});

describe("ledgerEntryKind — stored ledger rows", () => {
  it("tells TDS and GST TDS adjustments apart by narration, including the dated variant", () => {
    expect(ledgerEntryKind("adjustment", "TDS deducted")).toBe("tds");
    expect(ledgerEntryKind("adjustment", "TDS deducted — Date: 30/04/2026")).toBe("tds");
    expect(ledgerEntryKind("adjustment", "GST TDS deducted")).toBe("gst_tds");
    expect(ledgerEntryKind("adjustment", "Round-off")).toBe("adjustment");
  });
  it("maps the other stored types straight through", () => {
    expect(ledgerEntryKind("receipt")).toBe("receipt");
    expect(ledgerEntryKind("kasar")).toBe("kasar");
    expect(ledgerEntryKind("invoice")).toBe("invoice");
    expect(ledgerEntryKind("credit_note")).toBe("credit_note");
    expect(ledgerEntryKind("something_else")).toBe("other");
  });
});
