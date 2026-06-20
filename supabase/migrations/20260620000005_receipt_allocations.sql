-- Phase 5 — multi-invoice receipt allocation.
-- Lets one receipt settle several invoices. The receipt itself stays a single
-- credit to the client ledger (invoice_id NULL = on-account); the split across
-- invoices lives in billing_receipt_allocations and feeds invoice.amount_paid.

CREATE TABLE IF NOT EXISTS billing_receipt_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  uuid NOT NULL REFERENCES billing_receipts(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount      numeric(15,2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rcpt_alloc_invoice ON billing_receipt_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_rcpt_alloc_receipt ON billing_receipt_allocations(receipt_id);

ALTER TABLE billing_receipt_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alloc_firm" ON billing_receipt_allocations;
CREATE POLICY "alloc_firm" ON billing_receipt_allocations FOR ALL TO authenticated
  USING (
    public.is_superadmin() OR EXISTS (
      SELECT 1 FROM billing_receipts r
      WHERE r.id = receipt_id AND r.firm_id IN (SELECT firm_id FROM users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_superadmin() OR EXISTS (
      SELECT 1 FROM billing_receipts r
      WHERE r.id = receipt_id AND r.firm_id IN (SELECT firm_id FROM users WHERE id = auth.uid())
    )
  );

-- Single source for an invoice's paid amount: direct receipts (net of TDS) PLUS
-- any allocations pointed at it. A receipt is EITHER direct (invoice_id set, no
-- allocations) OR on-account split via allocations (invoice_id NULL), so the two
-- sums never overlap.
CREATE OR REPLACE FUNCTION public.recalc_invoice_paid_for(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;
  UPDATE invoices SET amount_paid =
      COALESCE((SELECT SUM(COALESCE(amount_received,0) + COALESCE(tds_amount,0) + COALESCE(gst_tds_amount,0))
                FROM billing_receipts WHERE invoice_id = p_invoice_id), 0)
    + COALESCE((SELECT SUM(amount) FROM billing_receipt_allocations WHERE invoice_id = p_invoice_id), 0)
  WHERE id = p_invoice_id;
END $$;

-- Re-point the existing receipts trigger at the shared helper (now allocation-aware).
CREATE OR REPLACE FUNCTION public.recalc_invoice_amount_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_invoice_paid_for(OLD.invoice_id);
  ELSE
    PERFORM public.recalc_invoice_paid_for(NEW.invoice_id);
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM public.recalc_invoice_paid_for(OLD.invoice_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- Keep amount_paid in sync when allocations change.
CREATE OR REPLACE FUNCTION public.recalc_invoice_paid_from_alloc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_invoice_paid_for(OLD.invoice_id);
  ELSE
    PERFORM public.recalc_invoice_paid_for(NEW.invoice_id);
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM public.recalc_invoice_paid_for(OLD.invoice_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recalc_from_alloc ON billing_receipt_allocations;
CREATE TRIGGER trg_recalc_from_alloc
  AFTER INSERT OR UPDATE OR DELETE ON billing_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_paid_from_alloc();
