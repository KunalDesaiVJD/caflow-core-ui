-- ─────────────────────────────────────────────────────────────────────────
-- Billing period lock.
--
-- A firm with firms.settings.invoice_lock_day = N closes each month on day N
-- of the FOLLOWING month: e.g. with N = 20, September invoices cannot be
-- changed or deleted after 20 October (India time). Superadmins are exempt.
--
-- Scope: issued tax invoices and credit notes (document_type 'invoice' /
-- 'credit_note', status other than 'draft'). Quotations, proformas and drafts
-- are never locked.
--
-- Blocked in a closed month (non-superadmin):
--   • DELETE of the document, and of its invoice / credit-note ledger rows
--   • UPDATE of anything that changes the document: number, date, client,
--     firm, type, amounts, taxes, line items, billing party, place of supply,
--     TDS, currency, reference — or moving it back to draft / cancelling /
--     voiding it
--   • INSERT (or re-dating) of an issued document into a closed month
-- Still allowed: payment status / amount due / paid date, sent date, reminder
-- stamps, notes — so receipts, emailing and reminders keep working.
--
-- The UI applies the same rule (src/lib/invoiceLock.ts) so users see a
-- read-only document instead of a failed save.
-- ─────────────────────────────────────────────────────────────────────────

-- Turn the lock on for V J Desai & Co. LLP (20th of the following month).
UPDATE public.firms
SET settings = COALESCE(settings, '{}'::jsonb) || '{"invoice_lock_day": 20}'::jsonb
WHERE id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b';

-- True when a document dated p_date of firm p_firm is in a closed month.
CREATE OR REPLACE FUNCTION public.invoice_period_locked(p_date date, p_firm uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
           > (date_trunc('month', p_date) + interval '1 month')::date
             + ((f.settings->>'invoice_lock_day')::int - 1)
    FROM firms f
    WHERE f.id = p_firm
      AND p_date IS NOT NULL
      AND (f.settings->>'invoice_lock_day') ~ '^([1-9]|1[0-9]|2[0-8])$'
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.enforce_invoice_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  locked_old boolean := false;
  locked_new boolean := false;
  msg text := 'This month is closed for billing: only a superadmin can change or delete this document.';
BEGIN
  IF public.is_superadmin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.document_type IN ('invoice', 'credit_note')
     AND COALESCE(OLD.status, 'draft') <> 'draft' THEN
    locked_old := public.invoice_period_locked(OLD.invoice_date, OLD.firm_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.document_type IN ('invoice', 'credit_note')
     AND COALESCE(NEW.status, 'draft') <> 'draft' THEN
    locked_new := public.invoice_period_locked(NEW.invoice_date, NEW.firm_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF locked_old THEN
      RAISE EXCEPTION '%', msg USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF locked_new THEN
      RAISE EXCEPTION '%', msg USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: block only changes to the document itself.
  IF (locked_old OR locked_new) AND (
       NEW.invoice_no        IS DISTINCT FROM OLD.invoice_no
    OR NEW.invoice_date      IS DISTINCT FROM OLD.invoice_date
    OR NEW.client_id         IS DISTINCT FROM OLD.client_id
    OR NEW.firm_id           IS DISTINCT FROM OLD.firm_id
    OR NEW.document_type     IS DISTINCT FROM OLD.document_type
    OR NEW.amount            IS DISTINCT FROM OLD.amount
    OR NEW.subtotal          IS DISTINCT FROM OLD.subtotal
    OR NEW.gst_amount        IS DISTINCT FROM OLD.gst_amount
    OR NEW.total_cgst        IS DISTINCT FROM OLD.total_cgst
    OR NEW.total_sgst        IS DISTINCT FROM OLD.total_sgst
    OR NEW.total_igst        IS DISTINCT FROM OLD.total_igst
    OR NEW.total_amount      IS DISTINCT FROM OLD.total_amount
    OR NEW.line_items        IS DISTINCT FROM OLD.line_items
    OR NEW.to_name           IS DISTINCT FROM OLD.to_name
    OR NEW.to_address        IS DISTINCT FROM OLD.to_address
    OR NEW.to_gstin          IS DISTINCT FROM OLD.to_gstin
    OR NEW.to_pan            IS DISTINCT FROM OLD.to_pan
    OR NEW.place_of_supply   IS DISTINCT FROM OLD.place_of_supply
    OR NEW.is_intra_state    IS DISTINCT FROM OLD.is_intra_state
    OR NEW.invoice_type      IS DISTINCT FROM OLD.invoice_type
    OR NEW.tds_amount        IS DISTINCT FROM OLD.tds_amount
    OR NEW.tds_rate          IS DISTINCT FROM OLD.tds_rate
    OR NEW.tds_section_code  IS DISTINCT FROM OLD.tds_section_code
    OR NEW.exchange_rate     IS DISTINCT FROM OLD.exchange_rate
    OR NEW.export_currency   IS DISTINCT FROM OLD.export_currency
    OR NEW.reference_no      IS DISTINCT FROM OLD.reference_no
    OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('draft', 'cancelled', 'voided'))
  ) THEN
    RAISE EXCEPTION '%', msg USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoices_period_lock ON public.invoices;
CREATE TRIGGER invoices_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_period_lock();

-- The app deletes a document's ledger rows before the document itself; stop
-- that first step too, so a blocked delete never leaves a half-deleted invoice.
CREATE OR REPLACE FUNCTION public.enforce_invoice_ledger_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.entry_type IN ('invoice', 'credit_note') AND OLD.document_id IS NOT NULL
     AND NOT public.is_superadmin()
     AND EXISTS (
       SELECT 1 FROM invoices i
       WHERE i.id = OLD.document_id
         AND i.document_type IN ('invoice', 'credit_note')
         AND COALESCE(i.status, 'draft') <> 'draft'
         AND public.invoice_period_locked(i.invoice_date, i.firm_id)
     ) THEN
    RAISE EXCEPTION 'This month is closed for billing: only a superadmin can change or delete this document.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS client_ledger_entries_period_lock ON public.client_ledger_entries;
CREATE TRIGGER client_ledger_entries_period_lock
  BEFORE DELETE ON public.client_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_ledger_period_lock();
