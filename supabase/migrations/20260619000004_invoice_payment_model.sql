-- Phase 2 (foundation) — self-maintaining payment model on invoices.
--
-- Problem this fixes (audit C4/C5, and the root of the wrong Outstanding /
-- Collected numbers): the app only knows "paid" vs "not paid", flipped when a
-- single receipt >= the FULL invoice total. Partial payments and TDS-settled
-- invoices (cash + TDS + GST-TDS = total) never close, so they show as fully
-- outstanding forever.
--
-- This migration adds a correct, DB-maintained settlement model:
--   amount_paid     = cash + TDS + GST-TDS actually received against the invoice
--   amount_due      = total_amount - amount_paid               (generated)
--   payment_status  = unpaid | partially_paid | paid           (generated)
--
-- amount_paid is kept in sync automatically by a trigger on billing_receipts,
-- so this is SAFE and ADDITIVE: it requires no application changes and does not
-- alter the existing `status` column or any current behaviour. Screens can move
-- onto these columns in Phase 3.
--
-- NOTE: kasar (write-off) settlement is intentionally NOT folded into
-- amount_paid here (kasars are not always invoice-linked); that is handled in
-- the Phase 2 posting-engine cutover.

-- 1) Columns -------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS amount_paid numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS amount_due numeric(15,2)
    GENERATED ALWAYS AS (COALESCE(total_amount, 0) - COALESCE(amount_paid, 0)) STORED;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_status text
    GENERATED ALWAYS AS (
      CASE
        WHEN COALESCE(amount_paid, 0) <= 0                       THEN 'unpaid'
        WHEN COALESCE(amount_paid, 0) >= COALESCE(total_amount, 0) THEN 'paid'
        ELSE 'partially_paid'
      END
    ) STORED;

-- 2) Trigger: recompute an invoice's amount_paid from its receipts ---------
CREATE OR REPLACE FUNCTION public.recalc_invoice_amount_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  -- Affected invoice id differs by operation (and can change on UPDATE).
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    UPDATE invoices i
       SET amount_paid = COALESCE((
             SELECT SUM(COALESCE(r.amount_received, 0)
                        + COALESCE(r.tds_amount, 0)
                        + COALESCE(r.gst_tds_amount, 0))
             FROM billing_receipts r
             WHERE r.invoice_id = v_invoice_id
           ), 0)
     WHERE i.id = v_invoice_id;
  END IF;

  -- On UPDATE the receipt may have been re-pointed to a different invoice;
  -- recompute the previous invoice too.
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
     AND OLD.invoice_id IS NOT NULL THEN
    UPDATE invoices i
       SET amount_paid = COALESCE((
             SELECT SUM(COALESCE(r.amount_received, 0)
                        + COALESCE(r.tds_amount, 0)
                        + COALESCE(r.gst_tds_amount, 0))
             FROM billing_receipts r
             WHERE r.invoice_id = OLD.invoice_id
           ), 0)
     WHERE i.id = OLD.invoice_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_amount_paid ON billing_receipts;
CREATE TRIGGER trg_recalc_invoice_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON billing_receipts
  FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_amount_paid();

-- 3) Backfill amount_paid for all existing invoices -----------------------
UPDATE invoices i
   SET amount_paid = COALESCE((
         SELECT SUM(COALESCE(r.amount_received, 0)
                    + COALESCE(r.tds_amount, 0)
                    + COALESCE(r.gst_tds_amount, 0))
         FROM billing_receipts r
         WHERE r.invoice_id = i.id
       ), 0);

DO $$
DECLARE v_paid integer; v_part integer; v_unpaid integer;
BEGIN
  SELECT count(*) FILTER (WHERE payment_status = 'paid'),
         count(*) FILTER (WHERE payment_status = 'partially_paid'),
         count(*) FILTER (WHERE payment_status = 'unpaid')
    INTO v_paid, v_part, v_unpaid
  FROM invoices
  WHERE document_type IN ('invoice', 'credit_note');
  RAISE NOTICE 'Payment model backfilled: % paid, % partially_paid, % unpaid.',
    v_paid, v_part, v_unpaid;
END $$;
