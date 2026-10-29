/**
 * Statement of account rows for one client — shared by the Report tab's client
 * sheet and the group statement so both build identical lines.
 */
import { receiptDocNo, kasarDocNo, type LedgerEntryKind } from "./kinds.ts";

export interface LedgerEntry {
  entry_date: string;
  doc_no: string;
  doc_id?: string;        // invoice / credit note id — makes the doc no a link
  doc_type?: string;
  kind?: LedgerEntryKind; // invoice / credit note / receipt / TDS / GST TDS / kasar (absent on the opening row)
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface RawInvoice { id: string; firm_id: string; invoice_no: string | null; invoice_date: string | null; total_amount: number | null; document_type: string | null }
export interface RawReceipt { id: string; firm_id: string; receipt_date: string; amount_received: number | null; tds_amount: number | null; gst_tds_amount: number | null; payment_mode: string | null; remarks: string | null }
export interface RawKasar { id: string; firm_id: string; kasar_date: string; amount: number | null; narration: string | null }

/**
 * One client's statement of account for the period. Receipt, TDS, GST TDS and
 * kasar each get their OWN line (never merged into one credit), worded and
 * numbered the same way as the Ledger tab: a receipt's TDS rows carry the
 * receipt's number. A TDS-only entry (no amount received) has just its TDS line.
 */
export function composeLedgerEntries(o: {
  opening: number; obDate: string; obNarration: string;
  invoices: RawInvoice[]; receipts: RawReceipt[]; kasars: RawKasar[];
  fromDate: string; firmTag: (firmId: string) => string;
}): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  if (o.opening !== 0) {
    entries.push({
      entry_date: o.obDate || o.fromDate,
      doc_no: "—",
      narration: o.obNarration,
      debit:   o.opening > 0 ? o.opening : 0,
      credit:  o.opening < 0 ? -o.opening : 0,
      balance: o.opening,
    });
  }

  type Tmp = Omit<LedgerEntry, "balance"> & { date: string };
  const tmp: Tmp[] = [];

  for (const inv of o.invoices) {
    const isCredit = inv.document_type === "credit_note";
    const amt = Number(inv.total_amount || 0);
    const date = inv.invoice_date || o.fromDate;
    tmp.push({
      date, entry_date: date,
      doc_no:    inv.invoice_no || inv.id.slice(0, 8).toUpperCase(),
      doc_id:    inv.id,
      doc_type:  inv.document_type ?? undefined,
      kind:      isCredit ? "credit_note" : "invoice",
      narration: o.firmTag(inv.firm_id) + (isCredit ? `Credit Note — ${inv.invoice_no || ""}` : `Invoice — ${inv.invoice_no || ""}`),
      debit:     isCredit ? 0 : amt,
      credit:    isCredit ? amt : 0,
    });
  }

  for (const rec of o.receipts) {
    const net = Number(rec.amount_received || 0);
    const tds = Number(rec.tds_amount || 0);
    const gst = Number(rec.gst_tds_amount || 0);
    const docNo = receiptDocNo(rec.id);
    const tag = o.firmTag(rec.firm_id);
    const base = { date: rec.receipt_date, entry_date: rec.receipt_date, doc_no: docNo, debit: 0 };
    if (net > 0) {
      tmp.push({ ...base, kind: "receipt", credit: net,
        narration: `${tag}Payment received — ${rec.payment_mode || ""}${rec.remarks ? ` (${rec.remarks})` : ""}`.replace(/—\s*$/, "").trim() });
    }
    if (tds > 0) tmp.push({ ...base, kind: "tds",     credit: tds, narration: `${tag}TDS deducted` });
    if (gst > 0) tmp.push({ ...base, kind: "gst_tds", credit: gst, narration: `${tag}GST TDS deducted` });
  }

  for (const k of o.kasars) {
    tmp.push({
      date: k.kasar_date, entry_date: k.kasar_date,
      doc_no:    kasarDocNo(k.id),
      kind:      "kasar",
      narration: o.firmTag(k.firm_id) + (k.narration ? `Kasar — ${k.narration}` : "Kasar settlement"),
      debit:     0,
      credit:    Number(k.amount || 0),
    });
  }

  tmp.sort((a, b) => a.date.localeCompare(b.date));   // stable: invoice, receipt, TDS, GST TDS, kasar on one day
  let balance = o.opening;
  for (const { date: _d, ...t } of tmp) {
    balance += t.debit - t.credit;
    entries.push({ ...t, balance });
  }
  return entries;
}

