import { describe, it, expect } from "vitest";
import { accumulateBalances, loadReportStatement, netClosing, netOpening } from "../../supabase/functions/_shared/statement/report";

// In-memory stand-in for the supabase-js query builder (select / in / order / range).
function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])];
      const b: any = {
        select: () => b, order: () => b,
        in: (c: string, v: any[]) => { rows = rows.filter(r => v.includes(r[c])); return b; },
        range: (a: number, z: number) => Promise.resolve({ data: rows.slice(a, z + 1), error: null }),
      };
      return b;
    },
  };
}

const F1 = "f1", F2 = "f2";
const tables = {
  invoices: [
    { id: "i0", client_id: "a", firm_id: F1, invoice_no: "1/25-26", invoice_date: "2026-03-10", total_amount: 10000, document_type: "invoice", status: "sent" },
    { id: "i1", client_id: "a", firm_id: F1, invoice_no: "5/26-27", invoice_date: "2026-05-01", total_amount: 50000, document_type: "invoice", status: "finalized" },
    { id: "i2", client_id: "a", firm_id: F2, invoice_no: "K/1", invoice_date: "2026-06-01", total_amount: 20000, document_type: "invoice", status: "overdue" },
    { id: "d1", client_id: "a", firm_id: F1, invoice_no: "DRAFT", invoice_date: "2026-06-05", total_amount: 99999, document_type: "invoice", status: "draft" },
    { id: "c1", client_id: "b", firm_id: F1, invoice_no: "CN/1", invoice_date: "2026-07-01", total_amount: 1000, document_type: "credit_note", status: "finalized" },
  ],
  billing_receipts: [
    { id: "r1abcdef", client_id: "a", firm_id: F1, receipt_date: "2026-05-20", amount_received: 45000, tds_amount: 5000, gst_tds_amount: 0, payment_mode: "neft", remarks: null },
  ],
  billing_kasars: [{ id: "k1abcdef", client_id: "a", firm_id: F2, kasar_date: "2026-06-10", amount: 100, narration: null }],
  client_billing_opening_balances: [{ id: "o1", client_id: "b", firm_id: F1, amount: 3000, balance_date: "2026-04-01", narration: "Opening", gstin: null }],
};

describe("Report statement (shared with the Telegram bot)", () => {
  it("splits figures into before-period and in-period like the Report table", () => {
    const atoms = accumulateBalances({ fromDate: "2026-04-01", toDate: "2027-03-31", obRows: tables.client_billing_opening_balances,
      invoices: tables.invoices.filter(i => i.status !== "draft"), receipts: tables.billing_receipts, kasars: tables.billing_kasars });
    const a1 = atoms.get(`a|${F1}`)!;
    expect(netOpening(a1)).toBe(10000);              // last year's invoice
    expect(netClosing(a1)).toBe(10000 + 50000 - 50000); // receipt + TDS settle the new invoice
    expect(netClosing(atoms.get(`a|${F2}`)!)).toBe(19900);
    expect(netClosing(atoms.get(`b|${F1}`)!)).toBe(2000); // opening 3,000 less credit note
  });

  it("builds each client's lines, the payment advice, and skips drafts", async () => {
    const st = await loadReportStatement(fakeDb(tables), {
      clientIds: ["a", "b"], fromDate: "2026-04-01", toDate: "2027-03-31",
      firmNames: { [F1]: "VJD", [F2]: "KDA" }, clientNames: { a: "Alpha", b: "Beta" },
    });
    expect(st.perClient.map(c => c.name)).toEqual(["Alpha", "Beta"]);
    const alpha = st.perClient[0].entries;
    expect(alpha.map(e => e.kind ?? "opening")).toEqual(["opening", "invoice", "receipt", "tds", "invoice", "kasar"]);
    expect(alpha.some(e => e.doc_no === "DRAFT")).toBe(false);
    expect(alpha[1].narration).toMatch(/^\[VJD\] /);     // two firms → each line tagged with its firm
    expect(alpha[alpha.length - 1].balance).toBe(29900);
    expect(st.closingByClient).toEqual({ a: 29900, b: 2000 });
    expect(st.payments).toEqual(expect.arrayContaining([
      { clientName: "Alpha", firmId: F1, firmName: "VJD", closing: 10000 },
      { clientName: "Alpha", firmId: F2, firmName: "KDA", closing: 19900 },
      { clientName: "Beta", firmId: F1, firmName: "VJD", closing: 2000 },
    ]));
  });

  it("limits to the given firms, and gives a quiet single client its opening line", async () => {
    const st = await loadReportStatement(fakeDb(tables), {
      clientIds: ["a"], fromDate: "2027-04-01", toDate: "2027-05-31", firmIds: [F2],
      firmNames: { [F2]: "KDA" }, clientNames: { a: "Alpha" }, single: true,
    });
    expect(st.firmIds).toEqual([F2]);
    expect(st.perClient[0].entries).toHaveLength(1);
    expect(st.perClient[0].entries[0]).toMatchObject({ narration: "Opening Balance", debit: 19900, balance: 19900 });
    expect(st.perClient[0].entries[0].narration).not.toMatch(/\[/);  // one firm → no tag
  });
});
