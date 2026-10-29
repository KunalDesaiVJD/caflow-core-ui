/**
 * Billing → Reports statement of account, as data: the opening / closing balances of every
 * (client, firm) and each client's lines for the period, built with the Report tab's own rules.
 * The Report tab uses `accumulateBalances` for its table; the Telegram bot uses
 * `loadReportStatement` to send the same PDF the Report tab downloads.
 *
 * Takes any supabase-js client (browser or service role), so the rules live in one place.
 */
import { composeLedgerEntries, type LedgerEntry, type RawInvoice, type RawKasar, type RawReceipt } from "./entries.ts";
import type { PaymentAdviceRow } from "./layout.ts";
import type { GroupStatementClient } from "./pdf.ts";

/** Invoice statuses that are receivable — drafts, cancelled and voided documents are not. */
export const BILLABLE_STATUSES = ["finalized", "sent", "overdue", "paid"];

export interface Balances {
  ob: number;          // manual opening balance from client_billing_opening_balances
  openingDr: number;   // invoices before period
  openingCr: number;   // receipts / credit notes / kasar before period
  debit: number;       // invoices in period
  credit: number;      // receipts / credit notes / kasar in period
}
export type BalanceAtom = Balances & { clientId: string; firmId: string };

export const emptyBalances = (): Balances => ({ ob: 0, openingDr: 0, openingCr: 0, debit: 0, credit: 0 });
export const netOpening = (b: Balances) => b.ob + b.openingDr - b.openingCr;
export const netClosing = (b: Balances) => netOpening(b) + b.debit - b.credit;

/** One atom per (client, firm) with any activity, split into before-period and in-period figures. */
export function accumulateBalances(o: {
  fromDate: string; toDate: string;
  obRows: { client_id: string | null; firm_id: string; amount: number | null }[];
  invoices: { client_id: string | null; firm_id: string; invoice_date: string | null; total_amount: number | null; document_type: string | null }[];
  receipts: { client_id: string | null; firm_id: string; receipt_date: string | null; amount_received: number | null; tds_amount: number | null; gst_tds_amount: number | null }[];
  kasars: { client_id: string | null; firm_id: string; kasar_date: string | null; amount: number | null }[];
}): Map<string, BalanceAtom> {
  const { fromDate, toDate } = o;
  const atoms = new Map<string, BalanceAtom>();
  const atom = (clientId: string, firmId: string) => {
    const k = `${clientId}|${firmId}`;
    let a = atoms.get(k);
    if (!a) { a = { clientId, firmId, ...emptyBalances() }; atoms.set(k, a); }
    return a;
  };
  for (const ob of o.obRows) {
    if (!ob.client_id) continue;
    atom(ob.client_id, ob.firm_id).ob += Number(ob.amount || 0);
  }
  for (const inv of o.invoices) {
    if (!inv.client_id) continue;
    const a = atom(inv.client_id, inv.firm_id);
    const amt = Number(inv.total_amount || 0);
    if (!amt) continue;
    // Credit notes reduce the debtor (Cr). An undated document counts as in-period
    // (the ledger lines do the same) rather than being dropped from both figures.
    const isCN = inv.document_type === "credit_note";
    if (inv.invoice_date && inv.invoice_date < fromDate) { if (isCN) a.openingCr += amt; else a.openingDr += amt; }
    else if (!inv.invoice_date || inv.invoice_date <= toDate) { if (isCN) a.credit += amt; else a.debit += amt; }
  }
  for (const rec of o.receipts) {
    if (!rec.client_id) continue;
    const a = atom(rec.client_id, rec.firm_id);
    // GST-TDS deducted by the client also settles the invoice.
    const amt = Number(rec.amount_received || 0) + Number(rec.tds_amount || 0) + Number(rec.gst_tds_amount || 0);
    if (!amt) continue;
    if (rec.receipt_date && rec.receipt_date < fromDate) a.openingCr += amt;
    else if (rec.receipt_date && rec.receipt_date >= fromDate && rec.receipt_date <= toDate) a.credit += amt;
  }
  for (const k of o.kasars) {
    if (!k.client_id) continue;
    const a = atom(k.client_id, k.firm_id);
    const amt = Number(k.amount || 0);
    if (!amt) continue;
    if (k.kasar_date && k.kasar_date < fromDate) a.openingCr += amt;
    else if (k.kasar_date && k.kasar_date >= fromDate && k.kasar_date <= toDate) a.credit += amt;
  }
  return atoms;
}

/** Every row of a query, paging past PostgREST's 1,000-row cap. The query must be ordered. */
export async function fetchAllPages<T>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) return out;
  }
}

export interface ReportStatement {
  /** Clients with lines in the statement, by name. */
  perClient: GroupStatementClient[];
  /** Each client's closing with each firm — the payment advice. */
  payments: PaymentAdviceRow[];
  /** Firms whose balances are in the statement. */
  firmIds: string[];
  /** Net closing per client (all firms). */
  closingByClient: Record<string, number>;
}

/**
 * The Report tab's statement for some clients: a group's clients, or one client (`single`).
 * Same queries, balances and lines as Billing → Reports, for every firm (or `firmIds`).
 */
export async function loadReportStatement(db: any, o: {
  clientIds: string[]; fromDate: string; toDate: string;
  firmIds?: string[]; firmNames: Record<string, string>; clientNames: Record<string, string>;
  single?: boolean;
}): Promise<ReportStatement> {
  const { fromDate, toDate } = o;
  const clientIds = Array.from(new Set(o.clientIds));
  const lim = (q: any) => (o.firmIds?.length ? q.in("firm_id", o.firmIds) : q);
  const inv: (RawInvoice & { client_id: string })[] = [];
  const rec: (RawReceipt & { client_id: string })[] = [];
  const kas: (RawKasar & { client_id: string })[] = [];
  const obs: { client_id: string; firm_id: string; amount: number | null; balance_date: string | null; narration: string | null; gstin: string | null }[] = [];
  for (let i = 0; i < clientIds.length; i += 100) {
    const chunk = clientIds.slice(i, i + 100);
    const [a, b, c, d] = await Promise.all([
      fetchAllPages<any>(() => lim(db.from("invoices")
        .select("id, client_id, firm_id, invoice_no, invoice_date, total_amount, document_type")
        .in("client_id", chunk).in("document_type", ["invoice", "credit_note"]).in("status", BILLABLE_STATUSES))
        .order("invoice_date").order("id")),
      fetchAllPages<any>(() => lim(db.from("billing_receipts")
        .select("id, client_id, firm_id, receipt_date, amount_received, tds_amount, gst_tds_amount, payment_mode, remarks")
        .in("client_id", chunk)).order("receipt_date").order("id")),
      fetchAllPages<any>(() => lim(db.from("billing_kasars")
        .select("id, client_id, firm_id, kasar_date, amount, narration")
        .in("client_id", chunk)).order("kasar_date").order("id")),
      fetchAllPages<any>(() => lim(db.from("client_billing_opening_balances")
        .select("id, client_id, firm_id, amount, balance_date, narration, gstin")
        .in("client_id", chunk)).order("id")),
    ]);
    inv.push(...a); rec.push(...b); kas.push(...c); obs.push(...d);
  }

  const atoms = Array.from(accumulateBalances({ fromDate, toDate, obRows: obs, invoices: inv, receipts: rec, kasars: kas }).values());
  const firmIds = Array.from(new Set(atoms.map(a => a.firmId)));
  const multiFirm = firmIds.length > 1;
  const firmTag = (fid: string) => (multiFirm ? `[${o.firmNames[fid] ?? "Firm"}] ` : "");
  const inPeriod = (d: string | null) => !!d && d >= fromDate && d <= toDate;

  const perClient: GroupStatementClient[] = [];
  const closingByClient: Record<string, number> = {};
  for (const clientId of Array.from(new Set(atoms.map(a => a.clientId)))) {
    const mine = atoms.filter(a => a.clientId === clientId);
    const opening = mine.reduce((s, a) => s + netOpening(a), 0);
    closingByClient[clientId] = mine.reduce((s, a) => s + netClosing(a), 0);
    const clientObs = obs.filter(r => r.client_id === clientId && r.gstin == null);
    let entries: LedgerEntry[] = composeLedgerEntries({
      opening,
      obDate: clientObs.map(r => r.balance_date).filter(Boolean).sort()[0] || fromDate,
      obNarration: clientObs.length === 1 && clientObs[0].narration ? clientObs[0].narration : "Opening Balance",
      invoices: inv.filter(r => r.client_id === clientId && (!r.invoice_date || inPeriod(r.invoice_date))),
      receipts: rec.filter(r => r.client_id === clientId && inPeriod(r.receipt_date)),
      kasars: kas.filter(r => r.client_id === clientId && inPeriod(r.kasar_date)),
      fromDate, firmTag,
    });
    // A client's own statement always has its opening / closing line, even for a quiet period.
    if (entries.length === 0 && o.single) {
      const c = closingByClient[clientId];
      entries = [{ entry_date: fromDate, doc_no: "—", narration: "Opening Balance", debit: Math.max(0, c), credit: Math.max(0, -c), balance: c }];
    }
    if (entries.length > 0) perClient.push({ clientId, name: o.clientNames[clientId] ?? "—", entries });
  }
  perClient.sort((a, b) => a.name.localeCompare(b.name));

  const payments: PaymentAdviceRow[] = atoms.map(a => ({
    clientName: o.clientNames[a.clientId] ?? "—", firmId: a.firmId,
    firmName: o.firmNames[a.firmId] ?? "—", closing: netClosing(a),
  }));
  return { perClient, payments, firmIds, closingByClient };
}
