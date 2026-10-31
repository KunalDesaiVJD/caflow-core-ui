-- ─────────────────────────────────────────────────────────────────────────
-- TDS custom reminders
--
-- The fixed quarterly calendar (queue-tds-reminders) only covers enabled
-- clients on 12 set dates. This adds staff-defined, per-client reminders to
-- chase TDS data from ANY client on ANY schedule:
--
--   * once      — a single reminder at a chosen date/time
--   * recurring — every N days from a start date/time, until an end date,
--                 a maximum number of sends, or (optionally) until the
--                 client's filing for that return moves past "Not Started"
--
-- "Send now" from the dialog bypasses this table and writes straight to
-- tds_email_outbox. Schedules are processed hourly by
-- queue-tds-custom-reminders, which queues an outbox row (kind 'reminder',
-- template 'reminder_custom') and flushes it via send-tds-email.
--
-- RLS: open to public — same app-layer gate as the other tds_email_* tables
-- (see 20260808180000_tds_email_reminders.sql header).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_custom_reminders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  to_email           text NOT NULL,
  cc_email           text,
  form_type          text,
  financial_year     text,
  quarter            text,
  due_date           date,                          -- shown as "Data needed by" (optional)
  subject            text NOT NULL,                 -- may contain {{variables}}
  body               text NOT NULL,                 -- may contain {{variables}}
  schedule_type      text NOT NULL DEFAULT 'once' CHECK (schedule_type IN ('once','recurring')),
  next_run_at        timestamptz NOT NULL,
  interval_days      int CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 365),
  end_date           date,
  max_sends          int CHECK (max_sends IS NULL OR max_sends >= 1),
  stop_when_started  boolean NOT NULL DEFAULT true,  -- stop once the filing leaves 'Not Started'
  sends_count        int NOT NULL DEFAULT 0,
  last_sent_at       timestamptz,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
  status_note        text,
  staff_name         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tds_custom_reminders_due
  ON public.tds_custom_reminders(next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tds_custom_reminders_client
  ON public.tds_custom_reminders(client_id);

ALTER TABLE public.tds_custom_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app manage tds_custom_reminders" ON public.tds_custom_reminders;
CREATE POLICY "app manage tds_custom_reminders"
  ON public.tds_custom_reminders FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_custom_reminders TO anon, authenticated;

-- Link each outbox row back to the schedule that produced it.
ALTER TABLE public.tds_email_outbox
  ADD COLUMN IF NOT EXISTS custom_reminder_id uuid REFERENCES public.tds_custom_reminders(id) ON DELETE SET NULL;

-- Default wording for custom reminders (editable on the Email Settings page).
INSERT INTO public.tds_email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('reminder_custom', 'Custom reminder — TDS data request', 'reminder', NULL,
 $s$Reminder: TDS data required — {{form_type}} {{quarter}} FY {{financial_year}} | {{client_name}}$s$,
 $b$This is a reminder that we are awaiting your TDS data to prepare and file your {{form_type}} return for {{quarter}} FY {{financial_year}}.

Kindly share the deductee-wise payment details, challan details and any other relevant records at the earliest. If you have already sent these, please treat this note as acknowledged.$b$, 7)
ON CONFLICT (key) DO NOTHING;

-- Hourly at :50 — queue every custom reminder whose next_run_at has passed,
-- then flush the outbox (the function invokes send-tds-email itself).
select cron.schedule('tds-queue-custom-reminders-hourly', '50 * * * *', $cron$
  select net.http_post(
    url := 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/queue-tds-custom-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
