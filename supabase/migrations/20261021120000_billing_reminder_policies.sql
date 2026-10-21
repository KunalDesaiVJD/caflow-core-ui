-- ─────────────────────────────────────────────────────────────────────────
-- Billing reminders v2 — one settings window, four levels.
--
-- A reminder POLICY can be set at any of four levels. For each client the
-- engine walks from the most specific level to the least and takes the first
-- value that is set (NULL = "inherit"):
--
--     client  →  client group(s)  →  firm  →  firm group(s)  →  system default
--
-- Exceptions to "first value wins":
--   • cc_emails ADD UP across every level (firm CC + group CC + client CC).
--   • When a client sits in several client groups, an explicit "off" from any
--     group wins over "on" from another (a client-level setting still wins).
--
-- SAFE BY DEFAULT: the system default for both invoice and ledger reminders is
-- OFF, so nobody receives anything until a firm (or group) switches it on.
--
-- The engine is the billing-reminders edge function. pg_cron calls it hourly
-- from 10:00 to 13:00 IST; every send is recorded in billing_reminder_log, so
-- re-runs on the same day never send twice.
--
-- RLS: open to public, matching the rest of this project (the app talks to
-- Postgres with the anon key; staff-only routing is the real gate — see
-- 20260808180000_tds_email_reminders.sql).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Groups of firms ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.firm_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.firm_group_members (
  firm_group_id uuid NOT NULL REFERENCES public.firm_groups(id) ON DELETE CASCADE,
  firm_id       uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  PRIMARY KEY (firm_group_id, firm_id)
);

-- ── 2. Reminder policies (one row per level) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_reminder_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type          text NOT NULL CHECK (scope_type IN ('firm_group','firm','client_group','client')),
  firm_group_id       uuid REFERENCES public.firm_groups(id)   ON DELETE CASCADE,
  firm_id             uuid REFERENCES public.firms(id)         ON DELETE CASCADE, -- owning firm (NULL for firm_group)
  client_group_id     uuid REFERENCES public.client_groups(id) ON DELETE CASCADE,
  client_id           uuid REFERENCES public.clients(id)       ON DELETE CASCADE,

  -- Invoice payment reminders
  invoice_enabled     boolean,
  invoice_start_days  int,      -- first reminder: days relative to due date (negative = before due)
  invoice_repeat_days int CHECK (invoice_repeat_days IS NULL OR invoice_repeat_days >= 1),
  invoice_max_count   int CHECK (invoice_max_count  IS NULL OR invoice_max_count  >= 1),
  invoice_min_amount  numeric,  -- skip invoices with less than this outstanding

  -- Statement of account (outstanding) dispatch
  ledger_enabled      boolean,
  ledger_frequency    text CHECK (ledger_frequency IS NULL OR ledger_frequency IN ('monthly','quarterly')),
  ledger_day          int  CHECK (ledger_day IS NULL OR ledger_day BETWEEN 1 AND 28),
  ledger_min_balance  numeric,  -- skip clients whose total outstanding is below this

  -- Recipients
  to_emails           text[],   -- replaces the client's own email when set
  cc_emails           text[],   -- added to CC (cumulative across levels)
  send_to_responsible boolean,  -- CC the client's responsible person

  notes               text,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CHECK (
    (scope_type = 'firm_group'   AND firm_group_id   IS NOT NULL) OR
    (scope_type = 'firm'         AND firm_id         IS NOT NULL) OR
    (scope_type = 'client_group' AND client_group_id IS NOT NULL) OR
    (scope_type = 'client'       AND client_id       IS NOT NULL)
  )
);

-- One policy per scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brp_firm_group   ON public.billing_reminder_policies(firm_group_id)   WHERE scope_type = 'firm_group';
CREATE UNIQUE INDEX IF NOT EXISTS uq_brp_firm         ON public.billing_reminder_policies(firm_id)         WHERE scope_type = 'firm';
CREATE UNIQUE INDEX IF NOT EXISTS uq_brp_client_group ON public.billing_reminder_policies(client_group_id) WHERE scope_type = 'client_group';
CREATE UNIQUE INDEX IF NOT EXISTS uq_brp_client       ON public.billing_reminder_policies(client_id)       WHERE scope_type = 'client';

-- ── 3. Send log (also the de-dupe state) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_reminder_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid,
  firm_id     uuid NOT NULL,
  client_id   uuid REFERENCES public.clients(id)  ON DELETE CASCADE,
  invoice_id  uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('invoice','ledger')),
  period_key  text,              -- ledger: 'YYYY-MM' (monthly) / 'YYYY-Qn' (quarterly)
  status      text NOT NULL CHECK (status IN ('sent','failed')),
  to_emails   text[],
  cc_emails   text[],
  amount      numeric,
  error       text,
  trigger     text,              -- 'scheduled' | 'manual'
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brl_invoice ON public.billing_reminder_log(invoice_id) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_brl_firm    ON public.billing_reminder_log(firm_id, sent_at DESC);
-- Never send the same client two statements for one period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brl_ledger_period
  ON public.billing_reminder_log(client_id, period_key)
  WHERE kind = 'ledger' AND status = 'sent';

-- ── 4. Run history (last-run display + overlap lock) ────────────────────
CREATE TABLE IF NOT EXISTS public.billing_reminder_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger      text NOT NULL,    -- 'scheduled' | 'manual'
  firm_id      uuid,             -- NULL = all firms
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  sent         int NOT NULL DEFAULT 0,
  failed       int NOT NULL DEFAULT 0,
  pending      int NOT NULL DEFAULT 0, -- due but deferred to the next run (per-run cap)
  error        text,
  started_by   uuid
);
CREATE INDEX IF NOT EXISTS idx_brr_started ON public.billing_reminder_runs(started_at DESC);

-- ── RLS: open to public (app-layer gate, see header) ────────────────────
ALTER TABLE public.firm_groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_group_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_reminder_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_reminder_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_reminder_runs     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app manage firm_groups" ON public.firm_groups;
CREATE POLICY "app manage firm_groups" ON public.firm_groups FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "app manage firm_group_members" ON public.firm_group_members;
CREATE POLICY "app manage firm_group_members" ON public.firm_group_members FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "app manage billing_reminder_policies" ON public.billing_reminder_policies;
CREATE POLICY "app manage billing_reminder_policies" ON public.billing_reminder_policies FOR ALL TO public USING (true) WITH CHECK (true);
-- Log + runs are written only by the edge function (service role); the app reads them.
DROP POLICY IF EXISTS "app read billing_reminder_log" ON public.billing_reminder_log;
CREATE POLICY "app read billing_reminder_log" ON public.billing_reminder_log FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "app read billing_reminder_runs" ON public.billing_reminder_runs;
CREATE POLICY "app read billing_reminder_runs" ON public.billing_reminder_runs FOR SELECT TO public USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_groups               TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_group_members        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_reminder_policies TO anon, authenticated;
GRANT SELECT ON public.billing_reminder_log  TO anon, authenticated;
GRANT SELECT ON public.billing_reminder_runs TO anon, authenticated;

-- ── 5. Schedule ─────────────────────────────────────────────────────────
-- Retire any hand-made job that ran the old SQL engine, so clients are never
-- reminded by both engines.
SELECT cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%run_billing_reminders%';

-- 04:30–07:30 UTC (10:00–13:00 IST), hourly. The first run does the day's
-- work; later runs only pick up anything deferred by the per-run cap or a
-- transient failure — the log makes them no-ops otherwise. Auth uses the
-- project's publishable anon key, exactly like the TDS jobs
-- (20260808183000_tds_email_cron.sql); the function only allows the anon key
-- to start a 'scheduled' run.
SELECT cron.schedule('billing-reminders-daily', '30 4-7 * * *', $cron$
  select net.http_post(
    url := 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/billing-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc"}'::jsonb,
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 150000
  );
$cron$);
