import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeLedgerEntries } from "./statementOfAccount";
import { buildGroupStatementPdf, summariseEntries, type GroupStatementClient } from "./groupStatementPdf";

const firmTag = () => "";
const stmt = (o: Parameters<typeof composeLedgerEntries>[0]) => composeLedgerEntries(o);
const common = { fromDate: "2026-04-01", obDate: "2026-04-01", obNarration: "Opening Balance", firmTag };

// Client A: opening 10,000; invoice 100,000; receipt 70,000 + TDS 7,000 + GST TDS 1,260; kasar 500; credit note 2,000
const clientA: GroupStatementClient = {
  clientId: "a", name: "Alpha Traders",
  entries: stmt({
    ...common, opening: 10000,
    invoices: [
      { id: "i1", firm_id: "f1", invoice_no: "INV/1", invoice_date: "2026-05-01", total_amount: 100000, document_type: "invoice" },
      { id: "c1", firm_id: "f1", invoice_no: "CN/1", invoice_date: "2026-05-20", total_amount: 2000, document_type: "credit_note" },
    ],
    receipts: [{ id: "r1abcdef", firm_id: "f1", receipt_date: "2026-05-10", amount_received: 70000, tds_amount: 7000, gst_tds_amount: 1260, payment_mode: "neft", remarks: null }],
    kasars: [{ id: "k1abcdef", firm_id: "f1", kasar_date: "2026-05-12", amount: 500, narration: null }],
  }),
};
// Client B: TDS-only entry against one invoice
const clientB: GroupStatementClient = {
  clientId: "b", name: "Beta Enterprises",
  entries: stmt({
    ...common, opening: 0,
    invoices: [{ id: "i2", firm_id: "f1", invoice_no: "INV/2", invoice_date: "2026-06-01", total_amount: 50000, document_type: "invoice" }],
    receipts: [{ id: "r2abcdef", firm_id: "f1", receipt_date: "2026-06-15", amount_received: 0, tds_amount: 5000, gst_tds_amount: null, payment_mode: "other", remarks: null }],
    kasars: [],
  }),
};

describe("summariseEntries — credits split by kind", () => {
  it("keeps receipts, TDS (incl. GST TDS), kasar and credit notes apart and reconciles to the ledger", () => {
    const s = summariseEntries(clientA.entries);
    expect(s).toEqual({ opening: 10000, debit: 100000, receipts: 70000, tds: 8260, kasar: 500, creditNotes: 2000, closing: 29240 });
    // …and agrees with the running balance on the last printed line
    expect(s.closing).toBe(clientA.entries[clientA.entries.length - 1].balance);
  });
  it("shows a TDS-only client with no receipts", () => {
    const s = summariseEntries(clientB.entries);
    expect(s).toMatchObject({ receipts: 0, tds: 5000, closing: 45000 });
  });
});

describe("buildGroupStatementPdf", () => {
  beforeAll(() => {
    // The PDF font is a public asset fetched by URL in the browser — serve it from disk here.
    vi.stubGlobal("fetch", async (path: string) => {
      const buf = readFileSync(join(process.cwd(), "public", path));
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    });
  });

  it("renders a valid multi-client PDF", async () => {
    const { base64, blob } = await buildGroupStatementPdf({
      groupName: "Alpha Group", firmLabel: "V J Desai & Co. LLP", logoDataUrl: null,
      fromDate: "2026-04-01", toDate: "2026-10-23", perClient: [clientA, clientB],
    });
    const bytes = Buffer.from(base64, "base64");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(blob.size).toBe(bytes.length);
    if (process.env.SAVE_SAMPLE_PDF) (await import("node:fs")).writeFileSync(process.env.SAVE_SAMPLE_PDF, bytes);
  }, 30_000);
});
