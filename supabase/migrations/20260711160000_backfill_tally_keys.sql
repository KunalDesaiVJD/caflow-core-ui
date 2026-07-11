-- Backfill client_id / firm_id / financial_year on the tally_* tables from the engagement.
--
-- ROOT CAUSE: some Tally Sync runs wrote tally_trial_balance / tally_vouchers rows with only
-- engagement_id populated (client_id / firm_id / financial_year left NULL — ~90 engagements). Any
-- read that scopes by those columns then found nothing: the AI Auditor reported "Tally Sync required"
-- and the firm-scoped RLS hid the rows from the app — even though the sync had completed. run-scrutiny-v2
-- worked only because it fetches by engagement_id alone.
--
-- FIX (data + prevention, so it never recurs for any client):
--   1. Backfill every existing tally_* row's NULL client_id / firm_id / financial_year from its
--      engagement (engagement_id is always present).
--   2. A BEFORE INSERT/UPDATE trigger backfills the same keys on every future row, regardless of what
--      the sync agent writes — the columns can never be NULL again when engagement_id is known.
--
-- SAFETY: idempotent (only touches NULL columns; CREATE OR REPLACE / DROP-then-CREATE trigger).

-- 1a. Backfill existing trial-balance rows
UPDATE public.tally_trial_balance t
SET client_id      = COALESCE(t.client_id, e.client_id),
    firm_id        = COALESCE(t.firm_id, c.firm_id),
    financial_year = COALESCE(t.financial_year, e.financial_year)
FROM public.audit_engagements e
JOIN public.clients c ON c.id = e.client_id
WHERE t.engagement_id = e.id
  AND (t.client_id IS NULL OR t.firm_id IS NULL OR t.financial_year IS NULL);

-- 1b. Backfill existing voucher rows
UPDATE public.tally_vouchers t
SET client_id      = COALESCE(t.client_id, e.client_id),
    firm_id        = COALESCE(t.firm_id, c.firm_id),
    financial_year = COALESCE(t.financial_year, e.financial_year)
FROM public.audit_engagements e
JOIN public.clients c ON c.id = e.client_id
WHERE t.engagement_id = e.id
  AND (t.client_id IS NULL OR t.firm_id IS NULL OR t.financial_year IS NULL);

-- 2. Trigger function: backfill the keys from the engagement whenever they arrive NULL.
CREATE OR REPLACE FUNCTION public.backfill_tally_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_firm   uuid;
  v_fy     text;
BEGIN
  IF NEW.engagement_id IS NOT NULL
     AND (NEW.client_id IS NULL OR NEW.firm_id IS NULL OR NEW.financial_year IS NULL) THEN
    SELECT e.client_id, c.firm_id, e.financial_year
      INTO v_client, v_firm, v_fy
      FROM public.audit_engagements e
      JOIN public.clients c ON c.id = e.client_id
     WHERE e.id = NEW.engagement_id;
    NEW.client_id      := COALESCE(NEW.client_id, v_client);
    NEW.firm_id        := COALESCE(NEW.firm_id, v_firm);
    NEW.financial_year := COALESCE(NEW.financial_year, v_fy);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_backfill_tally_keys_tb ON public.tally_trial_balance;
CREATE TRIGGER trg_backfill_tally_keys_tb
  BEFORE INSERT OR UPDATE ON public.tally_trial_balance
  FOR EACH ROW EXECUTE FUNCTION public.backfill_tally_keys();

DROP TRIGGER IF EXISTS trg_backfill_tally_keys_v ON public.tally_vouchers;
CREATE TRIGGER trg_backfill_tally_keys_v
  BEFORE INSERT OR UPDATE ON public.tally_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.backfill_tally_keys();
