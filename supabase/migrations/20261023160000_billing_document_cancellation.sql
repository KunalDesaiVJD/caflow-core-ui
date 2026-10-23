-- ─────────────────────────────────────────────────────────────────────────
-- Cancelling an issued invoice / credit note.
--
-- A cancelled document keeps its row with status 'voided' (shown as
-- "Cancelled" in the app), so:
--   • its document number stays taken: get_next_invoice_seq /
--     allocate_doc_number count every row, and the manual-number duplicate
--     check still finds it;
--   • it drops out of every ledger and report: its own ledger row is removed
--     here, and every report on the invoices table already filters to live
--     statuses (v_billing_reconciliation, receivables, reminders);
--   • Tally is told to delete the voucher (trg_tally_sync_invoice already
--     handles the move to 'voided').
--
-- This migration enforces the rules in the database, matching the app
-- (src/lib/billingCancellation.ts):
--   1. cancelling stamps cancelled_at / cancelled_by and removes the
--      document's invoice / credit-note ledger row;
--   2. drafts cannot be cancelled (delete them), and nothing with receipts or
--      kasars against it can be cancelled until those are removed;
--   3. a cancelled document cannot be un-cancelled, edited or deleted —
--      deleting it would release its number;
--   4. no ledger row, receipt or kasar can be posted against a cancelled
--      document afterwards.
-- The existing period lock still applies: a non-superadmin cannot cancel a
-- document in a closed month.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

CREATE OR REPLACE FUNCTION public.enforce_billing_document_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'voided' AND OLD.document_type IN ('invoice', 'credit_note') THEN
      RAISE EXCEPTION 'A cancelled document cannot be deleted: it stays on record so its number is never reused.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.document_type NOT IN ('invoice', 'credit_note') THEN
    RETURN NEW;
  END IF;

  -- Being cancelled now.
  IF NEW.status = 'voided' AND COALESCE(OLD.status, 'draft') <> 'voided' THEN
    IF COALESCE(OLD.status, 'draft') = 'draft' THEN
      RAISE EXCEPTION 'A draft cannot be cancelled; delete it instead.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM billing_receipts WHERE invoice_id = OLD.id)
       OR EXISTS (SELECT 1 FROM billing_kasars WHERE invoice_id = OLD.id) THEN
      RAISE EXCEPTION 'This document has receipts or kasar entries against it. Delete or reallocate them before cancelling.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
    RETURN NEW;
  END IF;

  -- Already cancelled: frozen.
  IF OLD.status = 'voided' AND (
       NEW.status          IS DISTINCT FROM OLD.status
    OR NEW.invoice_no      IS DISTINCT FROM OLD.invoice_no
    OR NEW.seq_number      IS DISTINCT FROM OLD.seq_number
    OR NEW.document_series IS DISTINCT FROM OLD.document_series
    OR NEW.financial_year  IS DISTINCT FROM OLD.financial_year
    OR NEW.document_type   IS DISTINCT FROM OLD.document_type
    OR NEW.firm_id         IS DISTINCT FROM OLD.firm_id
    OR NEW.client_id       IS DISTINCT FROM OLD.client_id
    OR NEW.invoice_date    IS DISTINCT FROM OLD.invoice_date
    OR NEW.amount          IS DISTINCT FROM OLD.amount
    OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
    OR NEW.gst_amount      IS DISTINCT FROM OLD.gst_amount
    OR NEW.total_amount    IS DISTINCT FROM OLD.total_amount
    OR NEW.line_items      IS DISTINCT FROM OLD.line_items
  ) THEN
    RAISE EXCEPTION 'This document is cancelled and cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoices_cancellation_guard ON public.invoices;
CREATE TRIGGER invoices_cancellation_guard
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_billing_document_cancellation();

-- Remove the cancelled document's own ledger row (the app does this too; the
-- trigger makes it impossible to leave one behind).
CREATE OR REPLACE FUNCTION public.clear_cancelled_document_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM client_ledger_entries
  WHERE document_id = NEW.id
    AND entry_type IN ('invoice', 'credit_note');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS invoices_cancel_clear_ledger ON public.invoices;
CREATE TRIGGER invoices_cancel_clear_ledger
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided'
        AND NEW.document_type IN ('invoice', 'credit_note'))
  EXECUTE FUNCTION public.clear_cancelled_document_ledger();

-- Nothing may be posted against a cancelled document afterwards.
CREATE OR REPLACE FUNCTION public.block_posting_to_cancelled_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc uuid;
BEGIN
  IF TG_TABLE_NAME = 'client_ledger_entries' THEN
    IF NEW.entry_type NOT IN ('invoice', 'credit_note') THEN
      RETURN NEW;
    END IF;
    v_doc := NEW.document_id;
  ELSE
    v_doc := NEW.invoice_id;
  END IF;

  IF v_doc IS NOT NULL AND EXISTS (SELECT 1 FROM invoices WHERE id = v_doc AND status = 'voided') THEN
    RAISE EXCEPTION 'This document is cancelled: nothing can be posted against it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_ledger_entries_cancelled_guard ON public.client_ledger_entries;
CREATE TRIGGER client_ledger_entries_cancelled_guard
  BEFORE INSERT OR UPDATE OF document_id, entry_type ON public.client_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.block_posting_to_cancelled_document();

DROP TRIGGER IF EXISTS billing_receipts_cancelled_guard ON public.billing_receipts;
CREATE TRIGGER billing_receipts_cancelled_guard
  BEFORE INSERT OR UPDATE OF invoice_id ON public.billing_receipts
  FOR EACH ROW EXECUTE FUNCTION public.block_posting_to_cancelled_document();

DROP TRIGGER IF EXISTS billing_kasars_cancelled_guard ON public.billing_kasars;
CREATE TRIGGER billing_kasars_cancelled_guard
  BEFORE INSERT OR UPDATE OF invoice_id ON public.billing_kasars
  FOR EACH ROW EXECUTE FUNCTION public.block_posting_to_cancelled_document();
