/**
 * Billing → Reports, through Telegram. Every statement the bot sends or emails is the Report
 * tab's statement of account (same balances, same lines, same PDF), and the report table
 * itself — client / group / firm wise, any period — can be asked for in plain words.
 */
import { bestNameMatches, nameTokens, type ToolDef } from "../_shared/botAgent.ts";
import { accumulateBalances, BILLABLE_STATUSES, fetchAllPages, loadReportStatement, netClosing, netOpening } from "../_shared/statement/report.ts";
import { buildReportStatementPdf, defaultPeriod, fyOf } from "./statementPdf.ts";
import { todayIst } from "./billingTools.ts";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const PERIOD_PROPS = {
  from_date: { type: "string", description: "Period start YYYY-MM-DD (optional)" },
  to_date: { type: "string", description: "Period end YYYY-MM-DD (optional, default today)" },
  financial_year: { type: "string", description: "Financial year like 2025-26 (optional; default the current FY from 1 April to today)" },
};
const TARGET_PROPS = {
  client_name: { type: "string", description: "Client name or part of it — for one client's statement" },
  group_name: { type: "string", description: "Client group name or part of it — for a group statement" },
  only_clients: { type: "array", items: { type: "string" }, description: "Group statement: include only these clients (names or parts of names)" },
  exclude_clients: { type: "array", items: { type: "string" }, description: "Group statement: leave these clients out (names or parts of names)" },
  firm_name: { type: "string", description: "Only this firm's balances (optional; default every firm)" },
};

export const REPORT_TOOLS: ToolDef[] = [
  {
    name: "send_statement",
    description: "Send the statement of account PDF from Billing → Reports to this Telegram chat — for one client or for a client group (each client's ledger plus the amount payable to each firm, with bank details; no group total). Use for any request for a ledger, khata, statement, account copy or balance confirmation as a PDF.",
    input_schema: { type: "object", properties: { ...TARGET_PROPS, ...PERIOD_PROPS } },
  },
  {
    name: "email_statement",
    description: "Email the Billing → Reports statement of account PDF. A group goes to the group's saved master email (To) and additional emails (CC); a client to the client's email; email_to overrides. First call WITHOUT confirm to get the recipients and amounts, show them to the user, and call again with confirm=true only after the user agrees (unless the user already clearly said to send it now).",
    input_schema: { type: "object", properties: {
      ...TARGET_PROPS, ...PERIOD_PROPS,
      email_to: { type: "string", description: "Recipient email(s), comma separated — overrides the saved ones" },
      cc: { type: "string", description: "CC email(s), comma separated (optional)" },
      message: { type: "string", description: "Message for the email body (optional)" },
      confirm: { type: "boolean", description: "true = really send. Leave out to preview the recipients first." },
    } },
  },
  {
    name: "get_statement",
    description: "The statement of account as text: opening balance, every invoice, credit note, receipt, TDS, GST TDS and kasar line in the period with running balance, and the closing balance per firm. Use to answer questions about a client's or group's account without sending a PDF.",
    input_schema: { type: "object", properties: { ...TARGET_PROPS, ...PERIOD_PROPS, max_lines: { type: "number", description: "Max lines per client (default 40)" } } },
  },
  {
    name: "get_report",
    description: "The Billing → Reports table (sundry debtors): opening, debit (billed), credit (received/credited) and closing for each client, group or firm in a period. Use for 'top debtors', 'who owes the most', 'debtors as on date', 'group-wise receivable', 'advances / credit balances', 'clients with nil balance'.",
    input_schema: { type: "object", properties: {
      ...PERIOD_PROPS,
      view_by: { type: "string", enum: ["client", "group", "firm"], description: "Rows per client (default), per client group, or per firm" },
      firm_name: { type: "string", description: "Only this firm (optional)" },
      group_name: { type: "string", description: "Only the clients of this group (optional)" },
      balance: { type: "string", enum: ["receivable", "advance", "nil", "non_nil", "all"], description: "Filter rows by closing balance (default non_nil)" },
      sort: { type: "string", enum: ["closing_desc", "closing_asc", "name", "debit_desc", "credit_desc"], description: "Default closing_desc" },
      limit: { type: "number", description: "Max rows (default 25, up to 200)" },
    } },
  },
  {
    name: "get_billing_totals",
    description: "Totals for a period: billed (invoices), credit notes, received, TDS, GST TDS and kasar — overall and broken down by month, firm, client or group. Use for 'how much did we bill / collect in September', 'monthly collection this year', 'top clients by billing', 'firm-wise billing'.",
    input_schema: { type: "object", properties: {
      ...PERIOD_PROPS,
      group_by: { type: "string", enum: ["month", "firm", "client", "group", "none"], description: "Breakdown (default month)" },
      client_name: { type: "string", description: "Only this client (optional)" },
      group_name: { type: "string", description: "Only this group's clients (optional)" },
      firm_name: { type: "string", description: "Only this firm (optional)" },
      limit: { type: "number", description: "Max breakdown rows (default 24)" },
    } },
  },
  {
    name: "get_groups",
    description: "Client groups: with group_name, its clients (with closing balance) and its saved email / phone for communication; without, every group with its client count and whether contacts are saved. not_in_group=true lists clients with a balance that are in no group.",
    input_schema: { type: "object", properties: {
      group_name: { type: "string", description: "Group name or part of it (optional)" },
      not_in_group: { type: "boolean", description: "List clients with a balance that belong to no group" },
      limit: { type: "number", description: "Max rows (default 50)" },
    } },
  },
];

export interface ReportToolHooks {
  /** Send a PDF to the chat. */
  sendPdf: (chatId: number, bytes: Uint8Array, filename: string, caption: string) => Promise<void>;
  /** Short progress note to the chat. */
  notify: (chatId: number, text: string) => Promise<void>;
  supabaseUrl: string;
  serviceKey: string;
}

export function createReportTools(sb: any, hooks: ReportToolHooks) {
  // ── Lookups ────────────────────────────────────────────────────────────────
  const firmList = async () => {
    const { data } = await sb.from("firms").select("id, name").order("name");
    return (data || []) as { id: string; name: string }[];
  };
  async function firmIdsFor(name?: string): Promise<{ ids?: string[]; error?: string; label?: string }> {
    if (!name) return {};
    const firms = await firmList();
    const hit = firms.filter(f => norm(f.name).includes(norm(name)));
    if (!hit.length) return { error: `No firm matches "${name}". Firms: ${firms.map(f => f.name).join(", ")}` };
    return { ids: hit.map(f => f.id), label: hit.map(f => f.name).join(", ") };
  }
  /** Best match by name: exact (ignoring case / punctuation) wins, else the only partial match. */
  function pick<T extends { name: string }>(rows: T[], q: string): { hit?: T; ambiguous?: string[] } {
    const exact = rows.filter(r => norm(r.name) === norm(q));
    if (exact.length === 1) return { hit: exact[0] };
    if (rows.length === 1) return { hit: rows[0] };
    if (rows.length === 0) return {};
    const starts = rows.filter(r => norm(r.name).startsWith(norm(q)));
    if (starts.length === 1) return { hit: starts[0] };
    return { ambiguous: rows.slice(0, 12).map(r => r.name) };
  }
  async function groupMembers(groupId: string): Promise<string[]> {
    const mem = await fetchAllPages<any>(() => sb.from("client_group_memberships").select("client_id").eq("group_id", groupId).order("client_id"));
    return Array.from(new Set(mem.map(m => m.client_id)));
  }
  async function namesOf(ids: string[]): Promise<Record<string, { name: string; email: string | null }>> {
    const out: Record<string, { name: string; email: string | null }> = {};
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from("clients").select("id, name, email").in("id", ids.slice(i, i + 150));
      for (const c of data || []) out[c.id] = { name: c.name || "—", email: c.email ?? null };
    }
    return out;
  }

  /**
   * Rows whose name contains the text; failing that, rows matching every word of it
   * (so "Satve Realty" finds SATVED REALTY and "Amadius Ramani" finds Amadius Group Ramani).
   */
  async function findByName(table: string, cols: string, q: string, extra: (x: any) => any = x => x): Promise<{ rows: any[] } | { error: string }> {
    const text = q.trim().replace(/[%_,()]/g, " ");
    const { data, error } = await extra(sb.from(table).select(cols).ilike("name", `%${text}%`)).limit(25);
    if (error) return { error: error.message };
    if (data?.length) return { rows: data };
    // Try each word, longest first, and keep the names that match all the words.
    for (const w of nameTokens(text).sort((a, b) => b.length - a.length).slice(0, 3)) {
      const stem = w.length > 5 ? w.slice(0, w.length - 1) : w;   // tolerate one wrong last letter
      const { data: cand, error: e2 } = await extra(sb.from(table).select(cols).ilike("name", `%${stem}%`)).limit(200);
      if (e2) return { error: e2.message };
      const best = bestNameMatches(text, (cand || []) as any[]);
      if (best.length) return { rows: best.slice(0, 25) };
    }
    return { rows: [] };
  }

  type Target = { kind: "client" | "group"; id: string; name: string; clientIds: string[]; group?: any; client?: any; note?: string };
  async function resolveTarget(input: Record<string, any>): Promise<Target | { error: string }> {
    if (input.group_name) {
      const found = await findByName("client_groups", "id, name, contact_email, contact_phone, extra_emails, extra_phones", String(input.group_name));
      if ("error" in found) return { error: `Group lookup failed: ${found.error}` };
      const { hit, ambiguous } = pick(found.rows, input.group_name);
      if (ambiguous) return { error: `Several groups match "${input.group_name}": ${ambiguous.join("; ")}. Ask which one.` };
      if (!hit) return { error: `No client group matches "${input.group_name}".` };
      let ids = await groupMembers(hit.id);
      let note: string | undefined;
      const only: string[] = (input.only_clients || []).map((s: string) => norm(s)).filter(Boolean);
      const skip: string[] = (input.exclude_clients || []).map((s: string) => norm(s)).filter(Boolean);
      if (only.length || skip.length) {
        const names = await namesOf(ids);
        const has = (id: string, list: string[]) => list.some(q => norm(names[id]?.name || "").includes(q));
        const before = ids.length;
        ids = ids.filter(id => (!only.length || has(id, only)) && !has(id, skip));
        if (!ids.length) return { error: `No client of ${hit.name} is left after the include / exclude filter.` };
        note = `${ids.length} of ${before} clients of the group selected`;
      }
      return { kind: "group", id: hit.id, name: hit.name, clientIds: ids, group: hit, note };
    }
    if (input.client_name) {
      const found = await findByName("clients", "id, name, email", String(input.client_name), q => q.is("deleted_at", null));
      if ("error" in found) return { error: `Client lookup failed: ${found.error}` };
      const { hit, ambiguous } = pick(found.rows, input.client_name);
      if (ambiguous) return { error: `Several clients match "${input.client_name}": ${ambiguous.join("; ")}. Ask which one.` };
      if (!hit) return { error: `No client matches "${input.client_name}".` };
      return { kind: "client", id: hit.id, name: hit.name, clientIds: [hit.id], client: hit };
    }
    return { error: "Say which client (client_name) or client group (group_name)." };
  }

  function period(input: Record<string, any>): { from: string; to: string; label: string } {
    const today = todayIst();
    let { from, to } = defaultPeriod(today);
    const fy = String(input.financial_year || "").match(/(\d{4})/);
    if (fy) {
      const y = Number(fy[1]);
      from = `${y}-04-01`;
      const end = `${y + 1}-03-31`;
      to = end < today ? end : today;
    }
    if (input.from_date) from = String(input.from_date).slice(0, 10);
    if (input.to_date) to = String(input.to_date).slice(0, 10);
    return { from, to, label: `${from} to ${to}` };
  }

  // ── Statement (PDF / email / text) ───────────────────────────────────────────
  async function sendStatement(chatId: number, input: Record<string, any>) {
    const t = await resolveTarget(input);
    if ("error" in t) return t;
    const f = await firmIdsFor(input.firm_name);
    if (f.error) return { error: f.error };
    const p = period(input);
    await hooks.notify(chatId, `⏳ Preparing the statement of account — ${t.name}, ${p.label}…`);
    const st = await buildReportStatementPdf(sb, { kind: t.kind, name: t.name, clientIds: t.clientIds, fromDate: p.from, toDate: p.to, firmIds: f.ids });
    if (!st) return { error: `Nothing in the statement — ${t.name} has no balance or transaction in ${p.label}.` };
    const payable = st.payments.filter(x => x.closing > 0).reduce((s, x) => s + x.closing, 0);
    await hooks.sendPdf(chatId, st.bytes, st.filename,
      `Statement of Account — ${t.name}\n${p.label}${t.kind === "group" ? ` · ${st.clients} clients` : ""}${t.note ? ` (${t.note})` : ""}`);
    return {
      sent: true, file: st.filename, period: p.label, kind: t.kind, name: t.name, clients_in_pdf: st.clients, ...(t.note ? { note: t.note } : {}),
      payment_advice: st.payments.slice(0, 60), total_payable: round2(payable),
    };
  }

  const splitEmails = (s?: string) => String(s || "").split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

  async function emailStatement(chatId: number, input: Record<string, any>) {
    const t = await resolveTarget(input);
    if ("error" in t) return t;
    const f = await firmIdsFor(input.firm_name);
    if (f.error) return { error: f.error };
    const p = period(input);
    let to = splitEmails(input.email_to);
    let cc = splitEmails(input.cc);
    if (!to.length) {
      if (t.kind === "group") {
        const saved = [t.group.contact_email, ...(t.group.extra_emails || [])].filter(Boolean);
        to = saved.slice(0, 1); if (!cc.length) cc = saved.slice(1);
      } else if (t.client?.email) to = splitEmails(t.client.email);
    }
    if (!to.length) {
      return { error: t.kind === "group"
        ? `No email is saved for group ${t.name} (Clients → Groups → Communication). Ask the user for the email address and pass it as email_to.`
        : `No email address on file for ${t.name}. Ask the user for the email address and pass it as email_to.` };
    }
    cc = cc.filter(x => !to.includes(x));
    const st = await loadReportStatement(sb, {
      clientIds: t.clientIds, fromDate: p.from, toDate: p.to, firmIds: f.ids,
      firmNames: Object.fromEntries((await firmList()).map(x => [x.id, x.name])),
      clientNames: Object.fromEntries(Object.entries(await namesOf(t.clientIds)).map(([k, v]) => [k, v.name])),
      single: t.kind === "client",
    });
    if (!st.perClient.length) return { error: `Nothing to send — ${t.name} has no balance or transaction in ${p.label}.` };
    const lines = st.payments.filter(x => Math.abs(x.closing) >= 0.5).map(x => ({ client: x.clientName, firm: x.firmName, closing: round2(x.closing) }));
    if (!input.confirm) {
      return {
        preview: true, to, cc, period: p.label, statement_of: t.name, clients_in_pdf: st.perClient.length, ...(t.note ? { note: t.note } : {}),
        payment_advice: lines.slice(0, 40),
        next: "Show the user these recipients and amounts and ask to confirm. Call email_statement again with the same inputs and confirm=true to send.",
      };
    }
    await hooks.notify(chatId, `⏳ Emailing the statement of account — ${t.name} → ${to.join(", ")}…`);
    const pdf = await buildReportStatementPdf(sb, { kind: t.kind, name: t.name, clientIds: t.clientIds, fromDate: p.from, toDate: p.to, firmIds: f.ids });
    if (!pdf) return { error: "Nothing to send." };
    let b64 = ""; for (let i = 0; i < pdf.bytes.length; i += 0x8000) b64 += String.fromCharCode(...pdf.bytes.subarray(i, i + 0x8000));
    b64 = btoa(b64);
    const firmForSend = st.firmIds.length === 1 ? st.firmIds[0] : (await firmList()).find(x => /v\s*j\s*desai/i.test(x.name))?.id ?? st.firmIds[0];
    const partial = t.kind === "group" && !!t.note;
    const results: { to: string; status: string; error?: string }[] = [];
    for (const [i, addr] of to.entries()) {
      const res = await fetch(`${hooks.supabaseUrl}/functions/v1/send-notification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hooks.serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ledger_statement", firm_id: firmForSend, direct_email: addr,
          ...(t.kind === "group" ? { client_group_id: t.id } : { client_id: t.id }),
          ...(i === 0 && cc.length ? { custom_cc: cc } : {}),
          payload: {
            client_name: t.name,
            custom_subject: `Statement of Account — ${t.name} — ${p.label}`,
            custom_message: input.message || `Dear Sir/Madam,\n\nPlease find attached the statement of account${t.kind === "group" ? ` for ${t.name}` : ""} for the period ${p.label}.\n\nKindly review and revert if any discrepancies are noticed.\n\nRegards`,
            pdf_base64: b64, pdf_filename: pdf.filename,
            ...(partial ? { statement_client_ids: t.clientIds } : {}),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      const d = body?.results?.direct?.email;
      results.push(res.ok && d?.status === "sent" ? { to: addr, status: "sent" } : { to: addr, status: "failed", error: d?.error || body?.error || `HTTP ${res.status}` });
    }
    return { emailed: results.every(r => r.status === "sent"), results, cc, file: pdf.filename, period: p.label };
  }

  async function getStatement(input: Record<string, any>) {
    const t = await resolveTarget(input);
    if ("error" in t) return t;
    const f = await firmIdsFor(input.firm_name);
    if (f.error) return { error: f.error };
    const p = period(input);
    const firms = await firmList();
    const names = await namesOf(t.clientIds);
    const st = await loadReportStatement(sb, {
      clientIds: t.clientIds, fromDate: p.from, toDate: p.to, firmIds: f.ids,
      firmNames: Object.fromEntries(firms.map(x => [x.id, x.name])),
      clientNames: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.name])), single: t.kind === "client",
    });
    const max = Math.min(Number(input.max_lines) || 40, 200);
    return {
      statement_of: t.name, kind: t.kind, period: p.label, ...(t.note ? { note: t.note } : {}),
      clients: st.perClient.slice(0, 40).map(c => ({
        client: c.name,
        lines: c.entries.slice(-max).map(e => ({ date: e.entry_date, doc: e.doc_no, narration: e.narration, debit: round2(e.debit), credit: round2(e.credit), balance: round2(e.balance) })),
        ...(c.entries.length > max ? { earlier_lines_not_shown: c.entries.length - max } : {}),
        closing: round2(st.closingByClient[c.clientId] ?? 0),
      })),
      closing_by_firm: st.payments.filter(x => Math.abs(x.closing) >= 0.5).map(x => ({ client: x.clientName, firm: x.firmName, closing: round2(x.closing) })),
    };
  }

  // ── Report table / totals / groups ───────────────────────────────────────────
  /** Billing rows for the balances — every client, or up to 150 given clients (URL length). */
  async function loadAll(firmIds?: string[], clientIds?: string[]) {
    const lim = (q: any) => {
      let x = firmIds?.length ? q.in("firm_id", firmIds) : q;
      if (clientIds) x = x.in("client_id", clientIds);
      return x;
    };
    const [invoices, receipts, kasars, obRows] = await Promise.all([
      fetchAllPages<any>(() => lim(sb.from("invoices").select("id, client_id, firm_id, invoice_date, total_amount, document_type")
        .in("document_type", ["invoice", "credit_note"]).in("status", BILLABLE_STATUSES)).order("id")),
      fetchAllPages<any>(() => lim(sb.from("billing_receipts").select("id, client_id, firm_id, receipt_date, amount_received, tds_amount, gst_tds_amount")).order("id")),
      fetchAllPages<any>(() => lim(sb.from("billing_kasars").select("id, client_id, firm_id, kasar_date, amount")).order("id")),
      fetchAllPages<any>(() => lim(sb.from("client_billing_opening_balances").select("id, client_id, firm_id, amount")).order("id")),
    ]);
    return { invoices, receipts, kasars, obRows };
  }
  async function membershipsOf(clientIds: string[]) {
    const out: { client_id: string; group_id: string }[] = [];
    for (let i = 0; i < clientIds.length; i += 150) {
      out.push(...await fetchAllPages<any>(() => sb.from("client_group_memberships").select("client_id, group_id")
        .in("client_id", clientIds.slice(i, i + 150)).order("client_id").order("group_id")));
    }
    return out;
  }
  async function groupNames(ids: string[]) {
    const out: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb.from("client_groups").select("id, name").in("id", ids.slice(i, i + 150));
      for (const g of data || []) out[g.id] = g.name;
    }
    return out;
  }

  async function getReport(input: Record<string, any>) {
    const f = await firmIdsFor(input.firm_name);
    if (f.error) return { error: f.error };
    const p = period(input);
    let only: string[] | undefined;
    let groupLabel: string | undefined;
    if (input.group_name) {
      const t = await resolveTarget({ group_name: input.group_name });
      if ("error" in t) return t;
      only = t.clientIds; groupLabel = t.name;
    }
    const data = await loadAll(f.ids, only && only.length <= 150 ? only : undefined);
    let atoms = Array.from(accumulateBalances({ fromDate: p.from, toDate: p.to, ...data }).values());
    if (only) { const s = new Set(only); atoms = atoms.filter(a => s.has(a.clientId)); }
    const viewBy = input.view_by || "client";
    const clientIds = Array.from(new Set(atoms.map(a => a.clientId)));
    const names = await namesOf(clientIds);
    const firms = Object.fromEntries((await firmList()).map(x => [x.id, x.name]));
    type Row = { name: string; opening: number; debit: number; credit: number; closing: number; clients?: number };
    const rows = new Map<string, Row & { _c: Set<string> }>();
    const add = (key: string, name: string, a: typeof atoms[number]) => {
      const r = rows.get(key) ?? { name, opening: 0, debit: 0, credit: 0, closing: 0, _c: new Set<string>() };
      r.opening += netOpening(a); r.debit += a.debit; r.credit += a.credit; r.closing += netClosing(a); r._c.add(a.clientId);
      rows.set(key, r);
    };
    if (viewBy === "group") {
      const mem = await membershipsOf(clientIds);
      const gn = await groupNames(Array.from(new Set(mem.map(m => m.group_id))));
      const gOf: Record<string, string[]> = {};
      for (const m of mem) if (gn[m.group_id]) (gOf[m.client_id] ??= []).push(m.group_id);
      for (const a of atoms) {
        const gs = gOf[a.clientId] ?? [];
        if (!gs.length) add("none", "Not in any group", a);
        for (const g of gs) add(g, gn[g], a);
      }
    } else if (viewBy === "firm") {
      for (const a of atoms) add(a.firmId, firms[a.firmId] ?? "—", a);
    } else {
      for (const a of atoms) add(a.clientId, names[a.clientId]?.name ?? "—", a);
    }
    let list: Row[] = Array.from(rows.values()).map(({ _c, ...r }) => ({
      ...r, opening: round2(r.opening), debit: round2(r.debit), credit: round2(r.credit), closing: round2(r.closing),
      ...(viewBy !== "client" ? { clients: _c.size } : {}),
    }));
    const bal = input.balance || "non_nil";
    if (bal === "receivable") list = list.filter(r => r.closing >= 0.5);
    else if (bal === "advance") list = list.filter(r => r.closing <= -0.5);
    else if (bal === "nil") list = list.filter(r => Math.abs(r.closing) < 0.5);
    else if (bal === "non_nil") list = list.filter(r => Math.abs(r.closing) >= 0.5 || r.debit || r.credit);
    const sort = input.sort || "closing_desc";
    list.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name)
      : sort === "closing_asc" ? a.closing - b.closing
      : sort === "debit_desc" ? b.debit - a.debit
      : sort === "credit_desc" ? b.credit - a.credit
      : b.closing - a.closing);
    // Totals count each client once (a client in two groups is not doubled).
    const tot = atoms.reduce((t, a) => ({ opening: t.opening + netOpening(a), debit: t.debit + a.debit, credit: t.credit + a.credit, closing: t.closing + netClosing(a) }), { opening: 0, debit: 0, credit: 0, closing: 0 });
    const receivable = atoms.reduce((s, a) => s + Math.max(0, netClosing(a)), 0);
    const limit = Math.min(Number(input.limit) || 25, 200);
    return {
      report: "Billing → Reports", view_by: viewBy, period: p.label, firms: f.label || "All firms", ...(groupLabel ? { group: groupLabel } : {}),
      rows_matching: list.length, rows: list.slice(0, limit),
      totals: { opening: round2(tot.opening), debit: round2(tot.debit), credit: round2(tot.credit), net_closing: round2(tot.closing), gross_receivable: round2(receivable), advances: round2(receivable - tot.closing) },
    };
  }

  async function getBillingTotals(input: Record<string, any>) {
    const f = await firmIdsFor(input.firm_name);
    if (f.error) return { error: f.error };
    const p = period(input);
    let only: string[] | undefined;
    if (input.client_name || input.group_name) {
      const t = await resolveTarget(input);
      if ("error" in t) return t;
      only = t.clientIds;
    }
    const data = await loadAll(f.ids, only && only.length <= 150 ? only : undefined);
    const keep = (r: any) => !only || only.includes(r.client_id);
    const inP = (d: string | null) => !!d && d >= p.from && d <= p.to;
    const groupBy = input.group_by || "month";
    const firms = Object.fromEntries((await firmList()).map(x => [x.id, x.name]));
    const allClientIds = new Set<string>();
    [...data.invoices, ...data.receipts, ...data.kasars].forEach(r => r.client_id && allClientIds.add(r.client_id));
    const names = groupBy === "client" ? await namesOf(Array.from(allClientIds)) : {};
    let gOf: Record<string, string[]> = {}, gn: Record<string, string> = {};
    if (groupBy === "group") {
      const mem = await membershipsOf(Array.from(allClientIds));
      gn = await groupNames(Array.from(new Set(mem.map(m => m.group_id))));
      for (const m of mem) if (gn[m.group_id]) (gOf[m.client_id] ??= []).push(m.group_id);
    }
    type T = { billed: number; credit_notes: number; received: number; tds: number; gst_tds: number; kasar: number; invoices: number };
    const zero = (): T => ({ billed: 0, credit_notes: 0, received: 0, tds: 0, gst_tds: 0, kasar: 0, invoices: 0 });
    const buckets = new Map<string, T>();
    const total = zero();
    const keysOf = (r: any, date: string): string[] => {
      if (groupBy === "month") return [date.slice(0, 7)];
      if (groupBy === "firm") return [firms[r.firm_id] ?? "—"];
      if (groupBy === "client") return [names[r.client_id]?.name ?? "—"];
      if (groupBy === "group") return (gOf[r.client_id] ?? []).map(g => gn[g]).concat(gOf[r.client_id]?.length ? [] : ["Not in any group"]);
      return [];
    };
    const bump = (r: any, date: string, fn: (t: T) => void) => {
      fn(total);
      for (const k of keysOf(r, date)) { const b = buckets.get(k) ?? zero(); fn(b); buckets.set(k, b); }
    };
    for (const i of data.invoices) if (keep(i) && inP(i.invoice_date)) {
      const amt = Number(i.total_amount || 0);
      bump(i, i.invoice_date, t => { if (i.document_type === "credit_note") t.credit_notes += amt; else { t.billed += amt; t.invoices++; } });
    }
    for (const r of data.receipts) if (keep(r) && inP(r.receipt_date)) {
      bump(r, r.receipt_date, t => { t.received += Number(r.amount_received || 0); t.tds += Number(r.tds_amount || 0); t.gst_tds += Number(r.gst_tds_amount || 0); });
    }
    for (const k of data.kasars) if (keep(k) && inP(k.kasar_date)) bump(k, k.kasar_date, t => { t.kasar += Number(k.amount || 0); });
    const r2 = (t: T) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === "invoices" ? v : round2(v)]));
    let list = Array.from(buckets.entries()).map(([k, t]) => ({ [groupBy]: k, ...r2(t) }));
    if (groupBy === "month") list.sort((a: any, b: any) => a.month.localeCompare(b.month));
    else list.sort((a: any, b: any) => b.billed - a.billed);
    return {
      period: p.label, financial_year: fyOf(p.to), firms: f.label || "All firms",
      totals: { ...r2(total), net_billed: round2(total.billed - total.credit_notes), total_settled: round2(total.received + total.tds + total.gst_tds + total.kasar) },
      ...(groupBy !== "none" ? { breakdown: list.slice(0, Math.min(Number(input.limit) || 24, 200)), breakdown_rows: list.length } : {}),
    };
  }

  async function getGroups(input: Record<string, any>) {
    const limit = Math.min(Number(input.limit) || 50, 300);
    if (input.group_name) {
      const t = await resolveTarget({ group_name: input.group_name });
      if ("error" in t) return t;
      const names = await namesOf(t.clientIds);
      const data = await loadAll(undefined, t.clientIds.length <= 150 ? t.clientIds : undefined);
      const today = todayIst();
      const atoms = Array.from(accumulateBalances({ fromDate: today, toDate: today, ...data }).values()).filter(a => t.clientIds.includes(a.clientId));
      const closing: Record<string, number> = {};
      for (const a of atoms) closing[a.clientId] = (closing[a.clientId] || 0) + netClosing(a);
      return {
        group: t.name,
        saved_contacts: {
          master_email: t.group.contact_email, master_phone: t.group.contact_phone,
          additional_emails: t.group.extra_emails || [], additional_phones: t.group.extra_phones || [],
        },
        clients: t.clientIds.map(id => ({ client: names[id]?.name ?? "—", email: names[id]?.email ?? null, closing_today: round2(closing[id] || 0) }))
          .sort((a, b) => a.client.localeCompare(b.client)).slice(0, limit),
        clients_in_group: t.clientIds.length,
      };
    }
    if (input.not_in_group) {
      const data = await loadAll();
      const today = todayIst();
      const atoms = Array.from(accumulateBalances({ fromDate: today, toDate: today, ...data }).values());
      const closing: Record<string, number> = {};
      for (const a of atoms) closing[a.clientId] = (closing[a.clientId] || 0) + netClosing(a);
      const withBal = Object.keys(closing).filter(id => Math.abs(closing[id]) >= 0.5);
      const mem = new Set((await membershipsOf(withBal)).map(m => m.client_id));
      const loose = withBal.filter(id => !mem.has(id));
      const names = await namesOf(loose);
      return {
        clients_with_balance_not_in_any_group: loose.length,
        clients: loose.map(id => ({ client: names[id]?.name ?? "—", closing: round2(closing[id]) })).sort((a, b) => b.closing - a.closing).slice(0, limit),
      };
    }
    const groups = await fetchAllPages<any>(() => sb.from("client_groups").select("id, name, contact_email, contact_phone").order("name"));
    const mem = await fetchAllPages<any>(() => sb.from("client_group_memberships").select("client_id, group_id").order("client_id").order("group_id"));
    const count: Record<string, number> = {};
    for (const m of mem) count[m.group_id] = (count[m.group_id] || 0) + 1;
    return {
      groups: groups.length,
      list: groups.map(g => ({ group: g.name, clients: count[g.id] || 0, email_saved: !!g.contact_email, phone_saved: !!g.contact_phone })).slice(0, limit),
    };
  }

  async function run(name: string, input: Record<string, any>, chatId: number): Promise<any | undefined> {
    switch (name) {
      case "send_statement": return sendStatement(chatId, input);
      case "email_statement": return emailStatement(chatId, input);
      case "get_statement": return getStatement(input);
      case "get_report": return getReport(input);
      case "get_billing_totals": return getBillingTotals(input);
      case "get_groups": return getGroups(input);
      default: return undefined;
    }
  }

  return { run, sendStatement, emailStatement, getStatement, getReport, getBillingTotals, getGroups, resolveTarget, period };
}
