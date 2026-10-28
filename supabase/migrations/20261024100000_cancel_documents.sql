-- ─────────────────────────────────────────────────────────────────────────
-- Cancel Invoice / Credit Note (status 'voided', shown as "Cancelled").
--
-- A cancelled document stays on file — so its number can never be allocated
-- again (allocate_doc_number counts every row, and the seq index covers it) —
-- but contributes nothing to any ledger, report or balance:
--   • its client_ledger_entries row is removed;
--   • every report reads only finalized/sent/overdue/paid documents.
--
-- Cancellation is refused while a receipt is applied to the document: reverse
-- the receipt first, otherwise the client's balance would silently go wrong.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid;

CREATE OR REPLACE FUNCTION public.cancel_billing_document(p_invoice_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_inv invoices%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to cancel a document';
  END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v_inv.document_type NOT IN ('invoice', 'credit_note') THEN
    RAISE EXCEPTION 'Only an invoice or credit note can be cancelled';
  END IF;
  IF v_inv.status = 'voided' THEN RAISE EXCEPTION 'This document is already cancelled'; END IF;
  IF v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'A draft has no number on the books — delete it instead of cancelling';
  END IF;
  IF EXISTS (SELECT 1 FROM billing_receipts WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Receipts are applied to this document. Delete those receipts first, then cancel it.';
  END IF;

  UPDATE invoices
     SET status = 'voided', voided_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid()
   WHERE id = p_invoice_id;
  DELETE FROM client_ledger_entries
   WHERE document_id = p_invoice_id AND entry_type IN ('invoice', 'credit_note');
END $function$;

GRANT EXECUTE ON FUNCTION public.cancel_billing_document(uuid, text) TO authenticated;

-- A cancelled document is frozen: it cannot be reinstated, renumbered or re-valued,
-- and (below) cannot be deleted — its number stays retired for good.
CREATE OR REPLACE FUNCTION public.guard_voided_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'voided' THEN
      RAISE EXCEPTION 'A cancelled document cannot be deleted — its number stays reserved.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'voided' AND (
       NEW.status IS DISTINCT FROM 'voided'
    OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
    OR NEW.seq_number IS DISTINCT FROM OLD.seq_number
    OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.document_type IS DISTINCT FROM OLD.document_type
  ) THEN
    RAISE EXCEPTION 'A cancelled document cannot be changed.';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS invoices_guard_voided ON public.invoices;
CREATE TRIGGER invoices_guard_voided
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_voided_invoice();

-- No receipt may be recorded against a cancelled document.
CREATE OR REPLACE FUNCTION public.guard_receipt_on_voided()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status = 'voided') THEN
    RAISE EXCEPTION 'This document is cancelled — a receipt cannot be recorded against it.';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS billing_receipts_guard_voided ON public.billing_receipts;
CREATE TRIGGER billing_receipts_guard_voided
  BEFORE INSERT ON public.billing_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_on_voided();
