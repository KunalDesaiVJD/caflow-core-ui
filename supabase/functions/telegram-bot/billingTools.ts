/**
 * Billing tools for the Telegram bot — the same figures the Billing section shows.
 *
 * Balances come from v_billing_reconciliation.canonical_closing (opening + invoices
 * − credit notes − receipts incl. TDS − kasar, per firm and client), so the bot, the
 * Report tab and the statements agree. Open invoices are "finalized / sent / overdue"
 * with amount_due > 0 (part payments counted); cancelled documents never count.
 */
import { ageingBuckets, daysBetween, dueDateOf, type ToolDef } from "../_shared/botAgent.ts";

const OPEN = ["finalized", "sent", "overdue"];
const BILLING_LOG_TYPES = ["invoice_generated", "quotation_sent", "proforma_sent", "credit_note_issued", "payment_reminder", "ledger_statement"];

export const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const isoDaysAgo = (n: number) => {
  const d = new Date(todayIst() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
};
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const NEW_BILLING_TOOLS: ToolDef[] = [
  {
    name: "get_client_balance",
    description: "Closing balance of a client with each firm (receivable Dr / advance Cr), its client group(s), open invoices count and last receipt. Use for 'how much does X owe'.",
    input_schema: { type: "object", properties: { client_name: { type: "string", description: "Client name or part of it" } }, required: ["client_name"] },
  },
  {
    name: "get_group_balances",
    description: "Client-group balances. With group_name: every client in the group with closing balance per firm (the payment advice). Without: all groups ranked by receivable.",
    input_schema: { type: "object", properties: { group_name: { type: "string", description: "Group name or part of it (optional)" }, limit: { type: "number", description: "Max groups when listing (default 15)" } } },
  },
  {
    name: "get_firm_summary",
    description: "Receivables by firm: total outstanding, overdue amount, number of clients with a balance, and the overall total.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_receipts",
    description: "Receipts recorded (amount received, TDS, GST TDS) — optionally for one client and/or a date range.",
    input_schema: { type: "object", properties: {
      client_name: { type: "string", description: "Client name (optional)" },
      from_date: { type: "string", description: "YYYY-MM-DD (optional, default 30 days ago)" },
      to_date: { type: "string", description: "YYYY-MM-DD (optional, default today)" },
      limit: { type: "number", description: "Max rows (default 20)" },
    } },
  },
  {
    name: "get_ageing",
    description: "Ageing of open invoices by days past due (not due, 0-30, 31-60, 61-90, 90+), optionally for one firm.",
    input_schema: { type: "object", properties: { firm_name: { type: "string", description: "Firm name (optional)" } } },
  },
  {
    name: "get_reminder_status",
    description: "Automatic payment-reminder runs: recent runs with sent / failed counts, and reminders sent per client in the period.",
    input_schema: { type: "object", properties: { days: { type: "number", description: "Look-back days (default 7)" } } },
  },
  {
    name: "get_email_log",
    description: "Billing emails sent (invoices, credit notes, reminders, statements) with status, optionally for one client.",
    input_schema: { type: "object", properties: {
      client_name: { type: "string", description: "Client name (optional)" },
      days: { type: "number", description: "Look-back days (default 7)" },
      limit: { type: "number", description: "Max rows (default 20)" },
    } },
  },
  {
    name: "get_cancelled_documents",
    description: "Invoices / credit notes that were cancelled, with reason and date.",
    input_schema: { type: "object", properties: { days: { type: "number", description: "Look-back days (default 90)" }, limit: { type: "number", description: "Max rows (default 20)" } } },
  },
];

/** Every page of a query, in a stable order (PostgREST caps a page at 1,000 rows). */
async function fetchAll<T = any>(make: () => any, orderCol = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().order(orderCol).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function createBillingTools(sb: any) {
  const firmNames = async (): Promise<Record<string, string>> => {
    const { data } = await sb.from("firms").select("id, name");
    return Object.fromEntries((data || []).map((f: any) => [f.id, f.name]));
  };
  const findClients = async (name: string) => {
    const { data } = await sb.from("clients").select("id, name, email, phone").ilike("name", `%${name.trim()}%`).limit(25);
    return (data || []) as { id: string; name: string; email: string | null; phone: string | null }[];
  };
  const balancesFor = async (clientIds?: string[]) => {
    const rows: any[] = [];
    if (clientIds) {
      for (let i = 0; i < clientIds.length; i += 150) {
        const { data, error } = await sb.from("v_billing_reconciliation").select("firm_id, client_id, canonical_closing").in("client_id", clientIds.slice(i, i + 150));
        if (error) throw new Error(error.message);
        rows.push(...(data || []));
      }
    } else {
      rows.push(...await fetchAll(() => sb.from("v_billing_reconciliation").select("firm_id, client_id, canonical_closing"), "client_id"));
    }
    return rows.map(r => ({ firm_id: r.firm_id as string, client_id: r.client_id as string, closing: round2(Number(r.canonical_closing)) }));
  };
  const openInvoices = async (filter: { clientIds?: string[]; firmId?: string } = {}) => {
    const q = () => {
      let x = sb.from("invoices")
        .select("id, invoice_no, client_id, firm_id, to_name, invoice_date, due_date, payment_due_days, amount_due, total_amount, status")
        .eq("document_type", "invoice").in("status", OPEN).gt("amount_due", 0.005);
      if (filter.clientIds) x = x.in("client_id", filter.clientIds.slice(0, 300));
      if (filter.firmId) x = x.eq("firm_id", filter.firmId);
      return x;
    };
    return (await fetchAll<any>(q)).map(i => ({ ...i, due: dueDateOf(i), amount_due: round2(Number(i.amount_due)) }));
  };
  const clientNameMap = async (ids: string[]) => {
    const out: Record<string, string> = {};
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    for (let i = 0; i < uniq.length; i += 150) {
      const { data } = await sb.from("clients").select("id, name").in("id", uniq.slice(i, i + 150));
      for (const c of data || []) out[c.id] = c.name;
    }
    return out;
  };

  async function getOutstanding(input: Record<string, any>) {
    const today = todayIst();
    let clientIds: string[] | undefined;
    if (input.client_name) {
      clientIds = (await findClients(input.client_name)).map(c => c.id);
      if (!clientIds.length) return { error: `No client matches "${input.client_name}"` };
    }
    if (input.group_name) {
      const { data: g } = await sb.from("client_groups").select("id, name").ilike("name", `%${input.group_name}%`).limit(1).maybeSingle();
      if (!g) return { error: `No client group matches "${input.group_name}"` };
      const mem = await fetchAll<any>(() => sb.from("client_group_memberships").select("client_id").eq("group_id", g.id), "client_id");
      clientIds = mem.map(m => m.client_id);
    }
    let firmId: string | undefined;
    if (input.firm_name) {
      const { data: f } = await sb.from("firms").select("id").ilike("name", `%${input.firm_name}%`).limit(1).maybeSingle();
      if (!f) return { error: `No firm matches "${input.firm_name}"` };
      firmId = f.id;
    }
    let inv = await openInvoices({ clientIds, firmId });
    if (input.overdue_only) inv = inv.filter(i => i.due && i.due < today);
    inv.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const [names, firms] = await Promise.all([clientNameMap(inv.map(i => i.client_id)), firmNames()]);
    const limit = Math.min(Number(input.limit) || 25, 100);
    return {
      as_on: today,
      count: inv.length,
      total_outstanding: round2(inv.reduce((s, i) => s + i.amount_due, 0)),
      overdue_total: round2(inv.filter(i => i.due && i.due < today).reduce((s, i) => s + i.amount_due, 0)),
      showing: Math.min(limit, inv.length),
      invoices: inv.slice(0, limit).map(i => ({
        invoice_no: i.invoice_no, client: names[i.client_id] || i.to_name || "—", firm: firms[i.firm_id] || "—",
        invoice_date: i.invoice_date, due_date: i.due, amount_due: i.amount_due,
        days_overdue: i.due && i.due < today ? daysBetween(i.due, today) : 0,
      })),
    };
  }

  async function getClientBalance(input: Record<string, any>) {
    const matches = await findClients(String(input.client_name || ""));
    if (!matches.length) return { error: `No client matches "${input.client_name}"` };
    const ids = matches.map(c => c.id);
    const [bal, firms, inv, mem] = await Promise.all([
      balancesFor(ids), firmNames(), openInvoices({ clientIds: ids }),
      fetchAll<any>(() => sb.from("client_group_memberships").select("client_id, group_id, client_groups(name)").in("client_id", ids), "client_id"),
    ]);
    const { data: lastRcpts } = await sb.from("billing_receipts")
      .select("client_id, receipt_date, amount_received, tds_amount, gst_tds_amount").in("client_id", ids)
      .order("receipt_date", { ascending: false }).limit(50);
    return {
      as_on: todayIst(),
      clients: matches.slice(0, 10).map(c => {
        const mine = bal.filter(b => b.client_id === c.id && Math.abs(b.closing) >= 0.005);
        const r = (lastRcpts || []).find((x: any) => x.client_id === c.id);
        return {
          client: c.name, email: c.email, phone: c.phone,
          groups: mem.filter(m => m.client_id === c.id).map(m => m.client_groups?.name).filter(Boolean),
          by_firm: mine.map(b => ({ firm: firms[b.firm_id] || "—", closing: b.closing, nature: b.closing > 0 ? "receivable (Dr)" : "advance (Cr)" })),
          total_closing: round2(mine.reduce((s, b) => s + b.closing, 0)),
          open_invoices: inv.filter(i => i.client_id === c.id).length,
          last_receipt: r ? { date: r.receipt_date, amount: round2(Number(r.amount_received) + Number(r.tds_amount || 0) + Number(r.gst_tds_amount || 0)) } : null,
        };
      }),
      more_matches: Math.max(0, matches.length - 10),
    };
  }

  async function getGroupBalances(input: Record<string, any>) {
    const firms = await firmNames();
    if (input.group_name) {
      const { data: groups } = await sb.from("client_groups").select("id, name").ilike("name", `%${input.group_name}%`).limit(5);
      if (!groups?.length) return { error: `No client group matches "${input.group_name}"` };
      const g = groups[0];
      const mem = await fetchAll<any>(() => sb.from("client_group_memberships").select("client_id").eq("group_id", g.id), "client_id");
      const ids = mem.map(m => m.client_id);
      const [bal, names] = await Promise.all([balancesFor(ids), clientNameMap(ids)]);
      const clients = ids.map(id => {
        const lines = bal.filter(b => b.client_id === id && Math.abs(b.closing) >= 0.5)
          .map(b => ({ firm: firms[b.firm_id] || "—", closing: b.closing }));
        return { client: names[id] || "—", payment_advice: lines, closing: round2(lines.reduce((s, l) => s + l.closing, 0)) };
      }).sort((a, b) => a.client.localeCompare(b.client));
      return { group: g.name, other_matches: groups.slice(1).map((x: any) => x.name), clients_in_group: ids.length, clients: clients.filter(c => c.payment_advice.length) };
    }
    const [groups, mem, bal] = await Promise.all([
      fetchAll<any>(() => sb.from("client_groups").select("id, name")),
      fetchAll<any>(() => sb.from("client_group_memberships").select("client_id, group_id"), "client_id"),
      balancesFor(),
    ]);
    const closingOf: Record<string, number> = {};
    for (const b of bal) closingOf[b.client_id] = (closingOf[b.client_id] || 0) + b.closing;
    const inGroup = new Set(mem.map(m => m.client_id));
    const rows = groups.map(g => {
      const ids = mem.filter(m => m.group_id === g.id).map(m => m.client_id);
      return { group: g.name, clients: ids.length, receivable: round2(ids.reduce((s, id) => s + Math.max(0, closingOf[id] || 0), 0)) };
    }).filter(r => r.receivable > 0).sort((a, b) => b.receivable - a.receivable);
    const ungrouped = Object.entries(closingOf).filter(([id]) => !inGroup.has(id)).reduce((s, [, v]) => s + Math.max(0, v), 0);
    return { groups: rows.slice(0, Math.min(Number(input.limit) || 15, 60)), groups_with_balance: rows.length, not_in_any_group_receivable: round2(ungrouped) };
  }

  async function getFirmSummary() {
    const today = todayIst();
    const [bal, firms, inv] = await Promise.all([balancesFor(), firmNames(), openInvoices()]);
    const by: Record<string, { receivable: number; advances: number; clients: number; overdue: number }> = {};
    for (const b of bal) {
      const f = (by[b.firm_id] ||= { receivable: 0, advances: 0, clients: 0, overdue: 0 });
      if (b.closing > 0.005) { f.receivable += b.closing; f.clients++; } else if (b.closing < -0.005) f.advances += -b.closing;
    }
    for (const i of inv) if (i.due && i.due < today) (by[i.firm_id] ||= { receivable: 0, advances: 0, clients: 0, overdue: 0 }).overdue += i.amount_due;
    const rows = Object.entries(by).map(([id, v]) => ({ firm: firms[id] || "—", receivable: round2(v.receivable), overdue: round2(v.overdue), advances: round2(v.advances), clients_with_balance: v.clients }))
      .filter(r => r.receivable || r.advances || r.overdue).sort((a, b) => b.receivable - a.receivable);
    return { as_on: today, firms: rows, total_receivable: round2(rows.reduce((s, r) => s + r.receivable, 0)), total_overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)) };
  }

  async function getReceipts(input: Record<string, any>) {
    const from = input.from_date || isoDaysAgo(30), to = input.to_date || todayIst();
    let q = sb.from("billing_receipts").select("client_id, firm_id, receipt_date, amount_received, tds_amount, gst_tds_amount, payment_mode, payment_reference")
      .gte("receipt_date", from).lte("receipt_date", to).order("receipt_date", { ascending: false }).limit(Math.min(Number(input.limit) || 20, 100));
    if (input.client_name) {
      const ids = (await findClients(input.client_name)).map(c => c.id);
      if (!ids.length) return { error: `No client matches "${input.client_name}"` };
      q = q.in("client_id", ids);
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    const [names, firms] = await Promise.all([clientNameMap((data || []).map((r: any) => r.client_id)), firmNames()]);
    const rows = (data || []).map((r: any) => ({
      date: r.receipt_date, client: names[r.client_id] || "—", firm: firms[r.firm_id] || "—",
      received: round2(Number(r.amount_received)), tds: round2(Number(r.tds_amount || 0)), gst_tds: round2(Number(r.gst_tds_amount || 0)),
      mode: r.payment_mode, reference: r.payment_reference,
    }));
    return { from, to, count: rows.length, total_received: round2(rows.reduce((s: number, r: any) => s + r.received, 0)), total_tds: round2(rows.reduce((s: number, r: any) => s + r.tds + r.gst_tds, 0)), receipts: rows };
  }

  async function getAgeing(input: Record<string, any>) {
    let firmId: string | undefined;
    if (input.firm_name) {
      const { data: f } = await sb.from("firms").select("id").ilike("name", `%${input.firm_name}%`).limit(1).maybeSingle();
      if (!f) return { error: `No firm matches "${input.firm_name}"` };
      firmId = f.id;
    }
    const inv = await openInvoices({ firmId });
    const b = ageingBuckets(inv, todayIst());
    return { as_on: todayIst(), open_invoices: inv.length, buckets: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, round2(v)])) };
  }

  async function getReminderStatus(input: Record<string, any>) {
    const since = isoDaysAgo(Number(input.days) || 7);
    const [{ data: runs }, { data: logs }] = await Promise.all([
      sb.from("billing_reminder_runs").select("trigger, started_at, finished_at, sent, failed, pending, error").gte("started_at", since).order("started_at", { ascending: false }).limit(15),
      sb.from("billing_reminder_log").select("client_id, kind, status, sent_at, error").gte("sent_at", since).order("sent_at", { ascending: false }).limit(500),
    ]);
    const names = await clientNameMap((logs || []).map((l: any) => l.client_id));
    const failed = (logs || []).filter((l: any) => l.status !== "sent");
    return {
      since, runs: runs || [],
      reminders_sent: (logs || []).filter((l: any) => l.status === "sent").length,
      reminders_failed: failed.length,
      recent: (logs || []).slice(0, 15).map((l: any) => ({ client: names[l.client_id] || "—", kind: l.kind, status: l.status, at: l.sent_at, error: l.error || undefined })),
      note: (runs || []).length === 0 ? "No reminder run in this period — check Billing → Email Settings → Reminders (rules enabled, schedule)." : undefined,
    };
  }

  async function getEmailLog(input: Record<string, any>) {
    const since = isoDaysAgo(Number(input.days) || 7);
    let q = sb.from("notification_log").select("type, status, sent_at, content, client_id").eq("channel", "email").in("type", BILLING_LOG_TYPES)
      .gte("sent_at", since).order("sent_at", { ascending: false }).limit(Math.min(Number(input.limit) || 20, 100));
    if (input.client_name) {
      const ids = (await findClients(input.client_name)).map(c => c.id);
      if (!ids.length) return { error: `No client matches "${input.client_name}"` };
      q = q.in("client_id", ids);
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    const names = await clientNameMap((data || []).map((r: any) => r.client_id));
    return {
      since, count: (data || []).length, failed: (data || []).filter((r: any) => r.status !== "sent").length,
      emails: (data || []).map((r: any) => ({ at: r.sent_at, type: r.type, status: r.status, to: r.content?.to, subject: r.content?.subject, client: names[r.client_id] || undefined, error: r.content?.error })),
    };
  }

  async function getCancelled(input: Record<string, any>) {
    const since = isoDaysAgo(Number(input.days) || 90);
    const { data, error } = await sb.from("invoices").select("invoice_no, document_type, client_id, to_name, total_amount, invoice_date, voided_reason, voided_at")
      .eq("status", "voided").gte("invoice_date", since).order("invoice_date", { ascending: false }).limit(Math.min(Number(input.limit) || 20, 100));
    if (error) return { error: error.message };
    const names = await clientNameMap((data || []).map((r: any) => r.client_id));
    return { since, count: (data || []).length, documents: (data || []).map((r: any) => ({ no: r.invoice_no, type: r.document_type, client: names[r.client_id] || r.to_name, amount: round2(Number(r.total_amount)), date: r.invoice_date, reason: r.voided_reason, cancelled_at: r.voided_at })) };
  }

  async function run(name: string, input: Record<string, any>): Promise<any | undefined> {
    switch (name) {
      case "get_outstanding_invoices": return getOutstanding(input);
      case "get_client_balance": return getClientBalance(input);
      case "get_group_balances": return getGroupBalances(input);
      case "get_firm_summary": return getFirmSummary();
      case "get_receipts": return getReceipts(input);
      case "get_ageing": return getAgeing(input);
      case "get_reminder_status": return getReminderStatus(input);
      case "get_email_log": return getEmailLog(input);
      case "get_cancelled_documents": return getCancelled(input);
      default: return undefined;
    }
  }

  return { run, getOutstanding, getClientBalance, getGroupBalances, getFirmSummary, getReceipts, getAgeing, getReminderStatus, getEmailLog, getCancelled };
}
