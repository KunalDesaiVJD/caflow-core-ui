-- Editable payment-terms window (days) per invoice/quotation.
-- Drives the printed line "PAYMENT IS DUE WITHIN <N> DAYS FROM THE INVOICE DATE".
-- Defaults to 45 to preserve existing behaviour for historical invoices.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_due_days INTEGER DEFAULT 45;

COMMENT ON COLUMN public.invoices.payment_due_days IS 'Payment-due window in days; printed on the invoice as "PAYMENT IS DUE WITHIN N DAYS FROM THE INVOICE DATE". Default 45.';
