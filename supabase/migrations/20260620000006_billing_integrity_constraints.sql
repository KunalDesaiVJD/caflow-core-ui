-- Audit follow-up — defensive data-integrity constraints on the billing tables.
-- Safe to apply: the live data was verified clean first (0 null firm_ids, 0
-- negative/zero amounts, all statuses within the known set).

-- Invoices: firm_id is mandatory (a null-firm invoice is invisible to every
-- firm report) and status must be a known value (prevents typos that break
-- overdue detection / aging).
ALTER TABLE invoices ALTER COLUMN firm_id SET NOT NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_status;
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_status
  CHECK (status IS NULL OR status IN
    ('draft','finalized','sent','overdue','paid','voided','converted'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_total_nonneg;
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_total_nonneg
  CHECK (total_amount IS NULL OR total_amount >= 0);

-- Receipts: firm_id mandatory, amount strictly positive.
ALTER TABLE billing_receipts ALTER COLUMN firm_id SET NOT NULL;

ALTER TABLE billing_receipts DROP CONSTRAINT IF EXISTS chk_receipts_amount_positive;
ALTER TABLE billing_receipts ADD CONSTRAINT chk_receipts_amount_positive
  CHECK (amount_received > 0);
