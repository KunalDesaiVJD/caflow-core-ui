/**
 * billing-reminders — Supabase Edge Function
 *
 * The billing reminder engine. For every client it resolves the effective
 * reminder policy (client → client group → firm → firm group → default, see
 * 20261021120000_billing_reminder_policies.sql), works out what is due today
 * and sends it through send-notification.
 *
 * Actions (POST body { action, firm_ids? }):
 *   effective — per-client resolved settings + where each came from (no send)
 *   preview   — what WOULD be sent today, and who is skipped and why (no send)
 *   run       — send what is due today for the given firms ("Send now")
 *   scheduled — pg_cron daily run across every firm that has a policy
 *
 * Auth: the service-role key may do anything. The project anon key (used by
 * pg_cron, like the TDS jobs) may only start a 'scheduled' run — that run is
 * idempotent for the day, so a stray call cannot spam anyone. Every other
 * action needs a signed-in user with access to each requested firm.
 *
 * What is "due":
 *   Invoice reminder — invoice unpaid with outstanding ≥ min amount, today is
 *     on/after (due date + start days), fewer than max reminders sent, and at
 *     least repeat-days since the last reminder. All of a client's due
 *     invoices go in ONE email.
 *   Statement of Account — monthly (or quarterly: Jan/Apr/Jul/Oct), on or
 *     after the chosen day, once per period, when the client's total
 *     outstanding ≥ min balance.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Policy model ─────────────────────────────────────────────────────

const POLICY_FIELDS = [
  "invoice_enabled", "invoice_start_days", "invoice_repeat_days", "invoice_max_count", "invoice_min_amount",
  "ledger_enabled", "ledger_frequency", "ledger_day", "ledger_min_balance",
  "to_emails", "send_to_responsible",
] as const;
type PolicyField = typeof POLICY_FIELDS[number];

// Safe by default: nothing is sent until some level switches it on.
const SYSTEM_DEFAULTS: Record<PolicyField, unknown> = {
  invoice_enabled: false,
  invoice_start_days: 3,
  invoice_repeat_days: 7,
  invoice_max_count: 4,
  invoice_min_amount: 1,
  ledger_enabled: false,
  ledger_frequency: "monthly",
  ledger_day: 5,
  ledger_min_balance: 1,
  to_emails: null,
  send_to_responsible: false,
};

const PER_RUN_CAP = 150;   // emails per invocation; the rest go next hourly run
const CONCURRENCY = 4;

interface Layer { level: string; label: string; policy: Record<string, any> }

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
}

/** Resolve one client's effective settings from its layers (most specific first). */
function resolvePolicy(client: Layer | null, groups: Layer[], firm: Layer | null, firmGroups: Layer[]) {
  const effective: Record<string, any> = {};
  const source: Record<string, string> = {};
  const isEnabledField = (f: string) => f === "invoice_enabled" || f === "ledger_enabled";

  const fromMany = (f: PolicyField, layers: Layer[]): Layer | null => {
    const withValue = layers.filter(l => hasValue(l.policy[f]));
    if (withValue.length === 0) return null;
    // Several groups disagree on on/off → "off" wins.
    if (isEnabledField(f)) return withValue.find(l => l.policy[f] === false) || withValue[0];
    return withValue[0];
  };

  for (const f of POLICY_FIELDS) {
    const hit =
      (client && hasValue(client.policy[f]) ? client : null) ||
      fromMany(f, groups) ||
      (firm && hasValue(firm.policy[f]) ? firm : null) ||
      fromMany(f, firmGroups);
    effective[f] = hit ? hit.policy[f] : SYSTEM_DEFAULTS[f];
    source[f] = hit ? hit.label : "Default";
  }

  // CC adds up across every level.
  const cc = new Set<string>();
  const ccSources: string[] = [];
  for (const l of [...firmGroups, ...(firm ? [firm] : []), ...groups, ...(client ? [client] : [])]) {
    const list = (l.policy.cc_emails || []) as string[];
    if (list.length) ccSources.push(l.label);
    list.forEach(e => e && cc.add(e.trim().toLowerCase()));
  }
  effective.cc_emails = [...cc];
  source.cc_emails = ccSources.join(" + ") || "—";
  return { effective, source };
}

// ── Dates (IST) ──────────────────────────────────────────────────────

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}
function istDateOf(ts: string): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

/** Ledger period for today, or null when today is not a send day. */
function ledgerPeriod(today: string, frequency: string, day: number): { key: string; sendOn: string } | null {
  const [y, m] = today.split("-").map(Number);
  if (frequency === "quarterly" && ![1, 4, 7, 10].includes(m)) return null;
  const sendOn = `${today.slice(0, 8)}${String(day).padStart(2, "0")}`;
  if (today < sendOn) return null;
  const key = frequency === "quarterly" ? `${y}-Q${Math.floor((m - 1) / 3) + 1}` : today.slice(0, 7);
  return { key, sendOn };
}

// ── Data loading ─────────────────────────────────────────────────────

async function fetchAll(query: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function inChunks<T>(ids: string[], size: number, fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await fn(ids.slice(i, i + size)));
  return out;
}

const OPEN_STATUS_EXCLUDE = "(draft,cancelled,voided,converted)";

interface Planned {
  kind: "invoice" | "ledger";
  firm_id: string;
  client_id: string;
  client_name: string;
  to: string[];
  cc: string[];
  invoices: { id: string; invoice_no: string; invoice_date: string | null; due_date: string | null; outstanding: number; days_overdue: number; reminder_no: number }[];
  period_key?: string;
  amount: number;
}

async function buildPlan(admin: any, firmIds: string[]) {
  const today = todayIST();

  const [firms, clients, clientGroups, fgMembers] = await Promise.all([
    admin.from("firms").select("id, name").in("id", firmIds).then((r: any) => r.data || []),
    fetchAll(() => admin.from("clients")
      .select("id, name, email, firm_id, is_active, is_draft, deleted_at, responsible_person_id")
      .in("firm_id", firmIds).is("deleted_at", null).order("name")),
    admin.from("client_groups").select("id, name, firm_id").in("firm_id", firmIds).order("name").then((r: any) => r.data || []),
    admin.from("firm_group_members").select("firm_group_id, firm_id").in("firm_id", firmIds).then((r: any) => r.data || []),
  ]);
  const activeClients = clients.filter((c: any) => c.is_active !== false && c.is_draft !== true);

  const groupIds = clientGroups.map((g: any) => g.id);
  const memberships = groupIds.length
    ? await fetchAll(() => admin.from("client_group_memberships").select("client_id, group_id").in("group_id", groupIds))
    : [];
  const firmGroupIds = [...new Set(fgMembers.map((m: any) => m.firm_group_id))] as string[];
  const firmGroups = firmGroupIds.length
    ? (await admin.from("firm_groups").select("id, name").in("id", firmGroupIds).order("name")).data || []
    : [];

  const policies = await fetchAll(() => admin.from("billing_reminder_policies").select("*")
    .or([
      `firm_id.in.(${firmIds.join(",")})`,
      ...(firmGroupIds.length ? [`firm_group_id.in.(${firmGroupIds.join(",")})`] : []),
      ...(groupIds.length ? [`client_group_id.in.(${groupIds.join(",")})`] : []),
    ].join(",")));

  const byScope = new Map<string, any>();
  for (const p of policies) {
    const id = p.scope_type === "firm_group" ? p.firm_group_id
      : p.scope_type === "firm" ? p.firm_id
      : p.scope_type === "client_group" ? p.client_group_id : p.client_id;
    byScope.set(`${p.scope_type}:${id}`, p);
  }
  const firmName = new Map(firms.map((f: any) => [f.id, f.name]));
  const groupName = new Map(clientGroups.map((g: any) => [g.id, g.name]));
  const groupsOfClient = new Map<string, string[]>();
  for (const m of memberships) {
    if (!groupsOfClient.has(m.client_id)) groupsOfClient.set(m.client_id, []);
    groupsOfClient.get(m.client_id)!.push(m.group_id);
  }
  const fgName = new Map(firmGroups.map((g: any) => [g.id, g.name]));
  const fgOfFirm = new Map<string, string[]>();
  for (const m of fgMembers) {
    if (!fgOfFirm.has(m.firm_id)) fgOfFirm.set(m.firm_id, []);
    fgOfFirm.get(m.firm_id)!.push(m.firm_group_id);
  }

  // Open invoices (outstanding), all firms.
  const invoices = await fetchAll(() => admin.from("invoices")
    .select("id, invoice_no, client_id, firm_id, amount_due, total_amount, invoice_date, due_date, last_reminded_at, status, payment_status")
    .in("firm_id", firmIds)
    .eq("document_type", "invoice")
    .not("client_id", "is", null)
    .not("status", "in", OPEN_STATUS_EXCLUDE)
    .or("payment_status.is.null,payment_status.neq.paid")
    .order("due_date", { ascending: true }));
  const outstandingOf = (i: any) => Number(i.amount_due ?? i.total_amount ?? 0);
  const openInvoices = invoices.filter((i: any) => outstandingOf(i) > 0);

  // Reminder history per invoice.
  const sentLog = await inChunks(openInvoices.map((i: any) => i.id), 200, async (chunk) =>
    (await admin.from("billing_reminder_log").select("invoice_id, sent_at")
      .eq("kind", "invoice").eq("status", "sent").in("invoice_id", chunk)).data || []);
  const history = new Map<string, { count: number; last: string | null }>();
  for (const r of sentLog as any[]) {
    const h = history.get(r.invoice_id) || { count: 0, last: null };
    h.count++;
    if (!h.last || r.sent_at > h.last) h.last = r.sent_at;
    history.set(r.invoice_id, h);
  }

  // Ledger periods already sent.
  const ledgerSent = new Set<string>();
  const thisMonth = today.slice(0, 7);
  const thisQuarter = `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;
  for (const r of await fetchAll(() => admin.from("billing_reminder_log").select("client_id, period_key")
    .eq("kind", "ledger").eq("status", "sent").in("firm_id", firmIds).in("period_key", [thisMonth, thisQuarter]))) {
    ledgerSent.add(`${r.client_id}:${r.period_key}`);
  }

  // Responsible-person emails.
  const rpIds = [...new Set(activeClients.map((c: any) => c.responsible_person_id).filter(Boolean))] as string[];
  const rpEmail = new Map<string, string>();
  if (rpIds.length) {
    const { data } = await admin.from("users").select("id, email").in("id", rpIds);
    for (const u of data || []) if (u.email) rpEmail.set(u.id, u.email);
  }

  const invByClient = new Map<string, any[]>();
  for (const i of openInvoices) {
    if (!invByClient.has(i.client_id)) invByClient.set(i.client_id, []);
    invByClient.get(i.client_id)!.push(i);
  }

  const effectiveRows: any[] = [];
  const planned: Planned[] = [];
  const skipped: { client_id: string; client_name: string; firm_id: string; kind: string; reason: string }[] = [];

  for (const c of activeClients) {
    const layer = (scope: string, id: string, label: string): Layer | null => {
      const p = byScope.get(`${scope}:${id}`);
      return p ? { level: scope, label, policy: p } : null;
    };
    const clientLayer = layer("client", c.id, "Client");
    const groupLayers = (groupsOfClient.get(c.id) || [])
      .map(g => layer("client_group", g, `Group: ${groupName.get(g)}`)).filter(Boolean) as Layer[];
    groupLayers.sort((a, b) => a.label.localeCompare(b.label));
    const firmLayer = layer("firm", c.firm_id, `Firm: ${firmName.get(c.firm_id)}`);
    const fgLayers = (fgOfFirm.get(c.firm_id) || [])
      .map(g => layer("firm_group", g, `Firm group: ${fgName.get(g)}`)).filter(Boolean) as Layer[];
    fgLayers.sort((a, b) => a.label.localeCompare(b.label));

    const { effective: e, source } = resolvePolicy(clientLayer, groupLayers, firmLayer, fgLayers);

    const to: string[] = hasValue(e.to_emails) ? e.to_emails : (c.email ? [c.email] : []);
    const cc = new Set<string>(e.cc_emails);
    if (e.send_to_responsible && c.responsible_person_id && rpEmail.get(c.responsible_person_id)) {
      cc.add(rpEmail.get(c.responsible_person_id)!.toLowerCase());
    }
    to.forEach(t => cc.delete(t.toLowerCase()));
    const ccList = [...cc];

    const clientInvoices = invByClient.get(c.id) || [];
    const totalOutstanding = clientInvoices.reduce((s, i) => s + outstandingOf(i), 0);

    effectiveRows.push({
      client_id: c.id, client_name: c.name, firm_id: c.firm_id, firm_name: firmName.get(c.firm_id),
      groups: (groupsOfClient.get(c.id) || []).map(g => groupName.get(g)),
      settings: e, source, to, cc: ccList,
      outstanding: totalOutstanding, open_invoices: clientInvoices.length,
      has_client_policy: !!clientLayer,
    });

    const skip = (kind: string, reason: string) =>
      skipped.push({ client_id: c.id, client_name: c.name, firm_id: c.firm_id, kind, reason });

    // ── Invoice reminders ──
    if (e.invoice_enabled && clientInvoices.length) {
      const due: Planned["invoices"] = [];
      let notYet = 0, maxed = 0, recent = 0, small = 0;
      for (const i of clientInvoices) {
        if (!i.due_date) continue;
        const amt = outstandingOf(i);
        if (amt < Number(e.invoice_min_amount ?? 0)) { small++; continue; }
        if (today < addDays(i.due_date, Number(e.invoice_start_days ?? 0))) { notYet++; continue; }
        const h = history.get(i.id) || { count: 0, last: null };
        if (h.count >= Number(e.invoice_max_count)) { maxed++; continue; }
        const lastTs = [h.last, i.last_reminded_at].filter(Boolean).sort().pop() as string | undefined;
        if (lastTs && daysBetween(istDateOf(lastTs), today) < Number(e.invoice_repeat_days)) { recent++; continue; }
        due.push({
          id: i.id, invoice_no: i.invoice_no, invoice_date: i.invoice_date, due_date: i.due_date,
          outstanding: amt, days_overdue: daysBetween(i.due_date, today), reminder_no: h.count + 1,
        });
      }
      if (due.length) {
        if (to.length === 0) skip("invoice", "No email address for client");
        else planned.push({
          kind: "invoice", firm_id: c.firm_id, client_id: c.id, client_name: c.name, to, cc: ccList,
          invoices: due, amount: due.reduce((s, i) => s + i.outstanding, 0),
        });
      } else if (notYet + maxed + recent + small > 0) {
        const bits = [
          notYet && `${notYet} not yet due for a reminder`,
          recent && `${recent} reminded recently`,
          maxed && `${maxed} reached max reminders`,
          small && `${small} below minimum amount`,
        ].filter(Boolean);
        skip("invoice", bits.join(", "));
      }
    } else if (!e.invoice_enabled && clientInvoices.length) {
      skip("invoice", `Invoice reminders off (${source.invoice_enabled})`);
    }

    // ── Statement of Account (outstanding invoices) ──
    if (e.ledger_enabled) {
      const period = ledgerPeriod(today, e.ledger_frequency, Number(e.ledger_day));
      if (!period) continue;
      if (ledgerSent.has(`${c.id}:${period.key}`)) continue;
      if (totalOutstanding < Number(e.ledger_min_balance ?? 0)) {
        if (clientInvoices.length) skip("ledger", "Outstanding below minimum balance");
        continue;
      }
      if (to.length === 0) { skip("ledger", "No email address for client"); continue; }
      planned.push({
        kind: "ledger", firm_id: c.firm_id, client_id: c.id, client_name: c.name, to, cc: ccList,
        period_key: period.key, amount: totalOutstanding,
        invoices: clientInvoices.map(i => ({
          id: i.id, invoice_no: i.invoice_no, invoice_date: i.invoice_date, due_date: i.due_date,
          outstanding: outstandingOf(i), days_overdue: i.due_date ? daysBetween(i.due_date, today) : 0,
          reminder_no: 0,
        })),
      });
    }
  }

  return { today, firms, effectiveRows, planned, skipped };
}

// ── Sending ──────────────────────────────────────────────────────────

async function sendOne(admin: any, p: Planned, runId: string, trigger: string, today: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lines = p.invoices.map(i => ({
    invoice_no: i.invoice_no, invoice_date: fmtDate(i.invoice_date), due_date: fmtDate(i.due_date), outstanding: i.outstanding,
  }));
  const oldest = p.invoices.reduce((m, i) => Math.max(m, i.days_overdue), 0);
  const body = {
    type: p.kind === "invoice" ? "payment_reminder" : "ledger_statement",
    firm_id: p.firm_id,
    client_id: p.client_id,
    send_to_client: true,
    custom_cc: p.cc,
    payload: {
      client_name: p.client_name,
      custom_email: p.to.join(", "),
      invoice_no: p.invoices.map(i => i.invoice_no).join(", "),
      amount: p.amount,
      due_date: fmtDate(p.invoices[0]?.due_date ?? null),
      days_overdue: oldest,
      statement_date: fmtDate(today),
      invoice_lines: lines,
      ...(p.kind === "ledger" ? { custom_subject: `Statement of Account as on ${fmtDate(today)}` } : {}),
    },
  };

  let ok = false, error: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const email = data?.results?.client?.email;
    ok = res.ok && email?.status === "sent";
    if (!ok) error = email?.error || data?.results?.client?.error || data?.error || `HTTP ${res.status}`;
  } catch (e: any) {
    error = e.message;
  }

  const base = {
    run_id: runId, firm_id: p.firm_id, client_id: p.client_id, kind: p.kind,
    status: ok ? "sent" : "failed", to_emails: p.to, cc_emails: p.cc, error, trigger,
  };
  if (p.kind === "invoice") {
    await admin.from("billing_reminder_log").insert(p.invoices.map(i => ({ ...base, invoice_id: i.id, amount: i.outstanding })));
    if (ok) {
      await admin.from("invoices").update({ last_reminded_at: new Date().toISOString() })
        .in("id", p.invoices.map(i => i.id));
    }
  } else {
    await admin.from("billing_reminder_log").insert({ ...base, period_key: p.period_key, amount: p.amount });
  }
  return ok;
}

async function executeRun(admin: any, firmIds: string[], trigger: string, userId: string | null) {
  // Overlap lock: one run at a time.
  const { data: busy } = await admin.from("billing_reminder_runs").select("id")
    .is("finished_at", null).gte("started_at", new Date(Date.now() - 10 * 60 * 1000).toISOString()).limit(1);
  if (busy && busy.length) return { busy: true };

  const { data: run } = await admin.from("billing_reminder_runs")
    .insert({ trigger, firm_id: firmIds.length === 1 ? firmIds[0] : null, started_by: userId })
    .select("id").single();
  const runId = run.id as string;

  let sent = 0, failed = 0, pending = 0, runError: string | null = null;
  try {
    const { planned, today } = await buildPlan(admin, firmIds);
    const batch = planned.slice(0, PER_RUN_CAP);
    pending = planned.length - batch.length;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const results = await Promise.all(batch.slice(i, i + CONCURRENCY).map(p => sendOne(admin, p, runId, trigger, today)));
      results.forEach(ok => ok ? sent++ : failed++);
    }
  } catch (e: any) {
    runError = e.message;
  }
  await admin.from("billing_reminder_runs")
    .update({ finished_at: new Date().toISOString(), sent, failed, pending, error: runError })
    .eq("id", runId);
  return { run_id: runId, sent, failed, pending, error: runError };
}

// ── Main handler ─────────────────────────────────────────────────────

function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return json.role ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { action = "preview", firm_ids } = await req.json().catch(() => ({}));
    if (!["effective", "preview", "run", "scheduled"].includes(action)) {
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isService = bearer.length > 0 && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // ── Scheduled run (pg_cron) ──
    if (action === "scheduled") {
      // verify_jwt=true means the platform has already checked the signature;
      // the anon key may start this (idempotent) run and nothing else.
      const role = jwtRole(bearer);
      if (!isService && role !== "anon" && role !== "service_role") {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const policies = await fetchAll(() => admin.from("billing_reminder_policies")
        .select("scope_type, firm_id, firm_group_id")
        .or("invoice_enabled.eq.true,ledger_enabled.eq.true"));
      const ids = new Set<string>(policies.filter((p: any) => p.firm_id).map((p: any) => p.firm_id));
      const fgIds = policies.filter((p: any) => p.scope_type === "firm_group").map((p: any) => p.firm_group_id);
      if (fgIds.length) {
        const { data } = await admin.from("firm_group_members").select("firm_id").in("firm_group_id", fgIds);
        (data || []).forEach((m: any) => ids.add(m.firm_id));
      }
      if (ids.size === 0) return jsonResponse({ success: true, sent: 0, message: "No reminder policies switched on" });
      return jsonResponse({ success: true, ...await executeRun(admin, [...ids], "scheduled", null) });
    }

    // ── User actions ──
    const requested: string[] = Array.isArray(firm_ids) ? firm_ids.filter(Boolean) : [];
    if (requested.length === 0) return jsonResponse({ error: "firm_ids required" }, 400);

    let userId: string | null = null;
    if (!isService) {
      if (!bearer) return jsonResponse({ error: "Unauthorized" }, 401);
      const { data: userData, error: authErr } = await admin.auth.getUser(bearer);
      if (authErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
      userId = userData.user.id;
      const { data: caller } = await admin.from("users").select("firm_id, role").eq("id", userId).maybeSingle();
      if (caller?.role !== "superadmin") {
        const { data: grants } = await admin.from("user_firm_access").select("firm_id").eq("user_id", userId);
        const allowed = new Set<string>([caller?.firm_id, ...(grants || []).map((g: any) => g.firm_id)].filter(Boolean));
        const denied = requested.filter(f => !allowed.has(f));
        if (denied.length) return jsonResponse({ error: "Forbidden: not authorized for this firm" }, 403);
      }
    }

    if (action === "run") {
      return jsonResponse({ success: true, ...await executeRun(admin, requested, "manual", userId) });
    }

    const plan = await buildPlan(admin, requested);
    if (action === "effective") {
      return jsonResponse({ success: true, today: plan.today, clients: plan.effectiveRows });
    }
    return jsonResponse({
      success: true,
      today: plan.today,
      per_run_cap: PER_RUN_CAP,
      planned: plan.planned.map(p => ({
        kind: p.kind, firm_id: p.firm_id, client_id: p.client_id, client_name: p.client_name,
        to: p.to, cc: p.cc, amount: p.amount, period_key: p.period_key ?? null,
        invoices: p.invoices.map(i => ({ invoice_no: i.invoice_no, due_date: i.due_date, outstanding: i.outstanding, days_overdue: i.days_overdue, reminder_no: i.reminder_no })),
      })),
      skipped: plan.skipped,
    });
  } catch (err: any) {
    console.error("billing-reminders error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});
