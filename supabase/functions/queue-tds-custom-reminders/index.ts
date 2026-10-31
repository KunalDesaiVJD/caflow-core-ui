// queue-tds-custom-reminders — processes staff-defined TDS data reminders
// (public.tds_custom_reminders), complementing the fixed quarterly calendar
// in queue-tds-reminders.
//
// For every ACTIVE schedule whose next_run_at has passed:
//   1. if stop_when_started and the client's filing for that FY/quarter has
//      left "Not Started" -> mark the schedule completed, send nothing;
//   2. otherwise render the subject/body and queue a tds_email_outbox row
//      (kind 'reminder', template 'reminder_custom');
//   3. advance the schedule: 'once' -> completed; 'recurring' -> next_run_at
//      += interval_days (skipping missed slots), completed when max_sends or
//      end_date is reached.
// Then flushes the outbox via send-tds-email so mail goes out immediately.
//
// Body: { id?: string } — process just that schedule (the dialog's "Send now"
// / "first reminder now"). Omit for the hourly cron run.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TDS_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  email: 'tds@vjdesai.com',
  phone: '',
  team: 'V. J. Desai & Co. (TDS Team)',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function renderTemplate(s: string, vars: Record<string, string>): string {
  return (s ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

/** 'YYYY-MM-DD' -> 'DD Mon YYYY' */
function fmtIsoDate(d: string | null): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** End of end_date in IST, as epoch ms. */
const endOfDayIst = (d: string) => new Date(`${d}T23:59:59+05:30`).getTime();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let onlyId: string | null = null;
  try {
    const b = await req.json();
    if (b?.id) onlyId = String(b.id);
  } catch { /* no body -> cron run */ }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();

  let q = sb
    .from('tds_custom_reminders')
    .select('*')
    .eq('status', 'active')
    .lte('next_run_at', new Date(now + 60_000).toISOString())
    .order('next_run_at')
    .limit(100);
  if (onlyId) q = q.eq('id', onlyId);
  const { data: due, error: dueErr } = await q;
  if (dueErr) return json({ error: dueErr.message }, 500);
  if (!due?.length) return json({ queued: 0, completed: 0, outboxIds: [], note: 'nothing due' });

  let queued = 0, completed = 0;
  const outboxIds: string[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const r of due) {
    const finish = async (note: string, extra: Record<string, unknown> = {}) => {
      await sb.from('tds_custom_reminders')
        .update({ status: 'completed', status_note: note, updated_at: new Date().toISOString(), ...extra })
        .eq('id', r.id);
      completed++;
    };

    // 1. Stop automatically once work on the return has begun.
    if (r.stop_when_started && r.financial_year && r.quarter) {
      const { data: filings } = await sb
        .from('tds_filings')
        .select('work_status')
        .eq('client_id', r.client_id).eq('financial_year', r.financial_year).eq('quarter', r.quarter);
      const filing = (filings ?? []).find((f) => f.work_status && !['Not Started', 'Not Applicable'].includes(f.work_status));
      if (filing) {
        await finish(`Stopped — filing is "${filing.work_status}" (data received)`);
        continue;
      }
    }

    // 2. Queue the email.
    const { data: client } = await sb
      .from('clients')
      .select('name, contact_person, tan_number')
      .eq('id', r.client_id).maybeSingle();

    const vars: Record<string, string> = {
      contact_person: client?.contact_person || client?.name || '',
      client_name: client?.name || '',
      tan: client?.tan_number ?? '',
      form_type: r.form_type ?? '',
      quarter: r.quarter ?? '',
      financial_year: r.financial_year ?? '',
      due_date: fmtIsoDate(r.due_date),
      ack_no: '', filing_date: '',
      staff_name: r.staff_name || TDS_FIRM.team,
      firm_name: TDS_FIRM.name, firm_email: TDS_FIRM.email, firm_phone: TDS_FIRM.phone,
    };
    const step = (r.sends_count ?? 0) + 1;
    const { data: row, error } = await sb.from('tds_email_outbox').insert({
      client_id: r.client_id,
      to_email: r.to_email,
      cc_email: r.cc_email,
      kind: 'reminder',
      template_key: 'reminder_custom',
      form_type: r.form_type,
      financial_year: r.financial_year,
      quarter: r.quarter,
      subject: renderTemplate(r.subject, vars),
      body: renderTemplate(r.body, vars),
      render_vars: vars,
      status: 'pending',
      reminder_step: step,
      custom_reminder_id: r.id,
      created_by: r.created_by,
    }).select('id').single();
    if (error) { errors.push({ id: r.id, error: error.message }); continue; }
    outboxIds.push(row.id as string);
    queued++;

    // 3. Advance the schedule.
    const sentAt = new Date().toISOString();
    const base = { sends_count: step, last_sent_at: sentAt };
    if (r.schedule_type !== 'recurring' || !r.interval_days) {
      await finish('Sent', base);
      continue;
    }
    if (r.max_sends && step >= r.max_sends) {
      await finish(`Completed — all ${r.max_sends} reminders sent`, base);
      continue;
    }
    const intervalMs = r.interval_days * DAY_MS;
    let next = new Date(r.next_run_at).getTime() + intervalMs;
    while (next <= now) next += intervalMs; // skip slots missed while paused/down
    if (r.end_date && next > endOfDayIst(r.end_date)) {
      await finish(`Completed — end date ${fmtIsoDate(r.end_date)} reached`, base);
      continue;
    }
    await sb.from('tds_custom_reminders')
      .update({ ...base, next_run_at: new Date(next).toISOString(), updated_at: sentAt })
      .eq('id', r.id);
  }

  // Flush now (best-effort; the hourly send-tds-email cron is the backstop).
  let sent = 0, failed = 0;
  if (outboxIds.length) {
    const { data: res } = await sb.functions.invoke('send-tds-email', { body: {} });
    sent = (res as { sent?: number })?.sent ?? 0;
    failed = (res as { failed?: number })?.failed ?? 0;
  }
  return json({ queued, completed, sent, failed, outboxIds, errors });
});
