-- ─────────────────────────────────────────────────────────────────────────
-- Billing reminders v3 — more rule options + due-date fix.
--
-- 1. New rule options on billing_reminder_policies (NULL = inherit, as before):
--      invoice_timing        'interval' (first + repeat every + max) or
--                            'schedule' (fixed list of days, below)
--      invoice_schedule_days e.g. {-3,7,15,30}: one reminder on each of these
--                            days relative to the due date (negative = before)
--      escalate_after        from this reminder number on, also CC escalate_cc
--      escalate_cc           e.g. the partner's address
--      send_weekdays         0=Sun … 6=Sat; reminders wait for an allowed day
--      paused_until          send nothing to the client until after this date
--    Conflicts between levels are checked by src/lib/billingReminderRules.ts
--    (the UI blocks the save; the engine skips the client).
--
-- 2. Invoices saved from the app never had due_date filled (only
--    payment_due_days), so the reminder engine skipped every one of them.
--    Backfill it from invoice_date + payment_due_days. The app now writes it
--    on every save, and the engine falls back to the same rule.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.billing_reminder_policies
  ADD COLUMN IF NOT EXISTS invoice_timing        text,
  ADD COLUMN IF NOT EXISTS invoice_schedule_days int[],
  ADD COLUMN IF NOT EXISTS escalate_after        int,
  ADD COLUMN IF NOT EXISTS escalate_cc           text[],
  ADD COLUMN IF NOT EXISTS send_weekdays         int[],
  ADD COLUMN IF NOT EXISTS paused_until          date;

DO $$ BEGIN
  ALTER TABLE public.billing_reminder_policies
    ADD CONSTRAINT brp_invoice_timing_chk CHECK (invoice_timing IS NULL OR invoice_timing IN ('interval','schedule'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.billing_reminder_policies
    ADD CONSTRAINT brp_escalate_after_chk CHECK (escalate_after IS NULL OR escalate_after >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.billing_reminder_policies
    ADD CONSTRAINT brp_send_weekdays_chk CHECK (send_weekdays IS NULL OR send_weekdays <@ ARRAY[0,1,2,3,4,5,6]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Client groups are usually global (firm_id NULL — the client wizard and the
-- customer sync create them that way), so a client-group rule may have no
-- owning firm. The scope CHECK already allows that; nothing to change.

-- ── Due-date backfill ───────────────────────────────────────────────────
UPDATE public.invoices
SET due_date = invoice_date + COALESCE(NULLIF(payment_due_days, 0), 45)
WHERE due_date IS NULL
  AND invoice_date IS NOT NULL
  AND document_type = 'invoice';
