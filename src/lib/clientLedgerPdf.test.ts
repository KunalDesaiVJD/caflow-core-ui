import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeLedgerEntries } from "./statementOfAccount";
import { buildClientLedgerPdf } from "./clientLedgerPdf";

beforeAll(() => {
  const font = (n: string) => { const b = readFileSync(join(process.cwd(), "public/fonts", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  vi.stubGlobal("fetch", async (u: string) => ({ ok: true, arrayBuffer: async () => font(String(u).includes("Bold") ? "NotoSans-Bold.ttf" : "NotoSans-Regular.ttf") }));
});

const common = { fromDate: "2026-04-01", obDate: "2026-04-01", obNarration: "Opening Balance", firmTag: () => "" };

describe("buildClientLedgerPdf", () => {
  it("builds a PDF for a client with receipt, TDS, GST TDS, kasar and a credit note", async () => {
    const entries = composeLedgerEntries({
      ...common, opening: 10000,
      invoices: [
        { id: "i1", firm_id: "f1", invoice_no: "INV/1", invoice_date: "2026-05-01", total_amount: 100000, document_type: "invoice" },
        { id: "c1", firm_id: "f1", invoice_no: "CN/1", invoice_date: "2026-05-20", total_amount: 2000, document_type: "credit_note" },
      ],
      receipts: [{ id: "r1abcdef", firm_id: "f1", receipt_date: "2026-05-10", amount_received: 70000, tds_amount: 7000, gst_tds_amount: 1260, payment_mode: "neft", remarks: null }],
      kasars: [{ id: "k1abcdef", firm_id: "f1", kasar_date: "2026-05-12", amount: 500, narration: "Rounding" }],
    });
    const { blob, base64 } = await buildClientLedgerPdf({
      clientName: "Alpha Traders", firmLabel: "V J Desai & Co. LLP", logoDataUrl: null,
      fromDate: "2026-04-01", toDate: "2026-10-28", entries, fallbackClosing: 0,
    });
    expect(blob.size).toBeGreaterThan(1000);
    expect(base64.length).toBeGreaterThan(1000);
  });

  it("builds an empty-period statement from the fallback closing balance", async () => {
    const { blob } = await buildClientLedgerPdf({
      clientName: "Beta", firmLabel: "x", logoDataUrl: null, fromDate: "2026-04-01", toDate: "2026-10-28", entries: [], fallbackClosing: -500,
    });
    expect(blob.size).toBeGreaterThan(500);
  });

  it("ignores a logo it cannot draw instead of failing", async () => {
    const { blob } = await buildClientLedgerPdf({
      clientName: "Gamma", firmLabel: "x", logoDataUrl: "data:text/html;base64,PGh0bWw+", fromDate: "2026-04-01", toDate: "2026-10-28", entries: [], fallbackClosing: 0,
    });
    expect(blob.size).toBeGreaterThan(500);
  });
});
