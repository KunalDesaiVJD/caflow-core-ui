-- Phase 5 — automated reminder scheduler (audit H1: reminders were manual-only).
--
-- run_billing_reminders() is the server-side reminder engine, run daily by
-- pg_cron. It is SAFE BY DEFAULT: it only processes rules explicitly opted in
-- via auto_send = true, so no client receives an automated email until the firm
-- turns a rule on. It reuses every guard from the manual "Run Now":
--   • only real invoices with an outstanding balance (payment_status <> 'paid',
--     amount_due > 0) — never dun a paid client
--   • the rule's due-date window (trigger_days / trigger_direction)
--   • 2-day de-dupe via invoices.last_reminded_at — no re-spam
-- It calls the existing send-notification edge function via pg_net, passing the
-- service-role key (supplied by the cron command, never stored in the repo).

ALTER TABLE billing_reminder_rules
  ADD COLUMN IF NOT EXISTS auto_send boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.run_billing_reminders(p_service_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule  record;
  v_inv   record;
  v_url   text := 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/send-notification';
  v_count integer := 0;
BEGIN
  IF p_service_key IS NULL OR p_service_key = '' THEN
    RAISE EXCEPTION 'run_billing_reminders: service key required';
  END IF;

  FOR v_rule IN
    SELECT * FROM billing_reminder_rules
    WHERE is_active = true AND auto_send = true AND rule_type = 'invoice'
  LOOP
    FOR v_inv IN
      SELECT i.id, i.invoice_no, i.client_id, i.amount_due, i.due_date
      FROM invoices i
      WHERE i.firm_id = v_rule.firm_id
        AND i.document_type = 'invoice'
        AND i.payment_status <> 'paid'
        AND COALESCE(i.amount_due, 0) > 0
        AND i.client_id IS NOT NULL
        AND i.due_date IS NOT NULL
        AND (
          (COALESCE(v_rule.trigger_direction, 'before') = 'before'
             AND i.due_date = CURRENT_DATE + COALESCE(v_rule.trigger_days, 0))
          OR (v_rule.trigger_direction = 'after'
             AND i.due_date = CURRENT_DATE - COALESCE(v_rule.trigger_days, 0))
        )
        AND (i.last_reminded_at IS NULL OR i.last_reminded_at < NOW() - INTERVAL '2 days')
        AND (
          v_rule.filter_status IS NULL
          OR (v_rule.filter_status = 'finalized_overdue' AND i.status IN ('finalized', 'overdue'))
          OR i.status = v_rule.filter_status
        )
    LOOP
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || p_service_key),
        body    := jsonb_build_object(
                     'type', COALESCE(v_rule.template_type, 'payment_reminder'),
                     'firm_id', v_rule.firm_id,
                     'client_id', v_inv.client_id,
                     'send_to_client', COALESCE(v_rule.send_to_client, true),
                     'payload', jsonb_build_object(
                        'invoice_no', v_inv.invoice_no,
                        'amount',     v_inv.amount_due,
                        'due_date',   v_inv.due_date))
      );
      UPDATE invoices SET last_reminded_at = NOW() WHERE id = v_inv.id;
      v_count := v_count + 1;
    END LOOP;

    UPDATE billing_reminder_rules SET last_run_at = NOW() WHERE id = v_rule.id;
  END LOOP;

  RETURN v_count;
END $$;

-- Lock the function down: only the postgres/cron owner should run it (it takes
-- the service key). Not granted to anon/authenticated.
REVOKE ALL ON FUNCTION public.run_billing_reminders(text) FROM PUBLIC;
