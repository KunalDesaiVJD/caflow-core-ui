// queue-tds-reminders — server-side reminder generator (single source of truth,
// used by both the "Queue due reminders" button and the daily cron).
//
// Unlike the GST sibling feature (which re-sends on a staff-configurable
// interval), TDS reminders are anchored to a FIXED quarterly calendar the
// firm already follows — there is nothing to "elapse", just a check of
// whether TODAY is one of the 3 scheduled reminder dates for whichever
// quarter is currently due:
//   Q1 (Apr-Jun) -> reminders  8/11/14 July
//   Q2 (Jul-Sep) -> reminders  8/11/14 October
//   Q3 (Oct-Dec) -> reminders  8/11/14 January (following calendar year)
//   Q4 (Jan-Mar) -> reminders  1/5/10 May (following calendar year)
// (all four reminder months have 31 days, so "filing due" is always shown as
// the 31st of the reminder month.)
//
// For every client with reminders enabled whose filing for that (FY, quarter)
// is still "Not Started", queue the day's reminder step if it hasn't already
// been queued. Writes `pending` rows to tds_email_outbox; send-tds-email
// delivers them.
//
// Body: { staffName?: string, date?: "YYYY-MM-DD" }. `date` overrides "today"
// for testing — omit it in production (cron never sends it).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TDS_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  email: 'tds@vjdesai.com',
  phone: '',
  team: 'V. J. Desai & Co. (TDS Team)',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function renderTemplate(s: string, vars: Record<string, string>): string {
  return (s ?? '').replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;

// entry.fyOffset: the calendar-year delta between the reminder MONTH and the
// financial year's own start year. Q1/Q2 remind in the same calendar year
// their quarter started in (offset 0); Q3/Q4 remind in the NEXT calendar year
// (offset -1, i.e. FY start year = reminder year - 1).
const SCHEDULE = [
  { month: 7, quarter: 'Q1', fyOffset: 0, days: [8, 11, 14] },
  { month: 10, quarter: 'Q2', fyOffset: 0, days: [8, 11, 14] },
  { month: 1, quarter: 'Q3', fyOffset: -1, days: [8, 11, 14] },
  { month: 5, quarter: 'Q4', fyOffset: -1, days: [1, 5, 10] },
] as const;

interface DueReminder { quarter: string; financialYear: string; step: number; dueDate: Date }

function todaysReminder(now: Date): DueReminder | null {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const entry = SCHEDULE.find((e) => e.month === month && (e.days as readonly number[]).includes(day));
  if (!entry) return null;
  const step = entry.days.indexOf(day as never) + 1;
  const fyStartYear = now.getFullYear() + entry.fyOffset;
  const financialYear = `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
  const dueDate = new Date(now.getFullYear(), month - 1, 31);
  return { quarter: entry.quarter, financialYear, step, dueDate };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let staffName: string | null = null;
  let forceDate: Date | null = null;
  try {
    const b = await req.json();
    if (b?.staffName) staffName = String(b.staffName);
    if (b?.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) forceDate = new Date(`${b.date}T00:00:00`);
  } catch { /* no body -> defaults */ }

  const now = forceDate ?? new Date();
  const reminder = todaysReminder(now);
  if (!reminder) return json({ queued: 0, skipped: 0, note: 'no reminder scheduled for today' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: settings } = await sb
    .from('tds_client_reminder_settings')
    .select('client_id')
    .eq('enabled', true);
  const enabledIds = (settings ?? []).map((s) => s.client_id as string);
  if (!enabledIds.length) return json({ queued: 0, skipped: 0, reminder, note: 'no clients enabled' });

  const { data: filings } = await sb
    .from('tds_filings')
    .select('id, client_id, tds_forms, work_status')
    .eq('financial_year', reminder.financialYear)
    .eq('quarter', reminder.quarter)
    .eq('work_status', 'Not Started')
    .in('client_id', enabledIds);
  if (!filings?.length) return json({ queued: 0, skipped: 0, reminder, note: 'nothing Not Started' });

  const key = reminder.step === 1 ? 'reminder_1' : reminder.step === 2 ? 'reminder_2' : 'reminder_final';
  const { data: tpl } = await sb
    .from('tds_email_templates')
    .select('subject, body, is_active')
    .eq('key', key)
    .maybeSingle();
  if (!tpl || tpl.is_active === false) return json({ queued: 0, skipped: filings.length, reminder, note: 'template inactive' });

  let queued = 0, skipped = 0;
  for (const f of filings) {
    const formType = (f.tds_forms && (f.tds_forms as string[])[0]) || '26Q';

    // Never double-queue the SAME reminder step for the same filing (manual
    // "Queue due reminders" click landing on the same day the cron already ran).
    const { data: already } = await sb
      .from('tds_email_outbox')
      .select('id')
      .eq('client_id', f.client_id).eq('form_type', formType)
      .eq('financial_year', reminder.financialYear).eq('quarter', reminder.quarter)
      .eq('kind', 'reminder').eq('reminder_step', reminder.step)
      .limit(1);
    if (already?.length) { skipped++; continue; }

    const { data: client } = await sb
      .from('clients')
      .select('name, email, contact_person, tan_number')
      .eq('id', f.client_id).maybeSingle();
    if (!client?.email) { skipped++; continue; }

    const vars: Record<string, string> = {
      contact_person: client.contact_person || client.name || '',
      client_name: client.name || '', tan: client.tan_number ?? '',
      form_type: formType, quarter: reminder.quarter, financial_year: reminder.financialYear,
      due_date: fmtDate(reminder.dueDate), ack_no: '', filing_date: '',
      staff_name: staffName || TDS_FIRM.team, firm_name: TDS_FIRM.name,
      firm_email: TDS_FIRM.email, firm_phone: TDS_FIRM.phone,
    };
    const { error } = await sb.from('tds_email_outbox').insert({
      client_id: f.client_id, to_email: client.email, kind: 'reminder', template_key: key,
      form_type: formType, financial_year: reminder.financialYear, quarter: reminder.quarter,
      subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars),
      render_vars: vars, status: 'pending', reminder_step: reminder.step, filing_id: f.id,
    });
    if (error) { skipped++; continue; }
    queued++;
  }
  return json({ queued, skipped, reminder });
});
