-- Billing reminders now work per (client, invoicing firm), like Billing → Reports:
-- a client billed by two firms can get each firm's Statement of Account for the
-- same month. The "one statement per period" guard becomes per client AND firm.
DROP INDEX IF EXISTS public.uq_brl_ledger_period;
CREATE UNIQUE INDEX IF NOT EXISTS uq_brl_ledger_period
  ON public.billing_reminder_log(client_id, firm_id, period_key)
  WHERE kind = 'ledger' AND status = 'sent';
