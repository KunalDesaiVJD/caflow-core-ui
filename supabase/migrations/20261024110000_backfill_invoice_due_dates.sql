-- Invoices were saved with payment_due_days but never a due_date, so overdue
-- status, ageing and payment reminders (which all key off due_date) skipped
-- every one of them. Fill it in once: invoice date + the invoice's own terms.
-- Triggers are paused so the period lock / Tally sync do not react to a pure
-- back-fill of a derived field.
ALTER TABLE public.invoices DISABLE TRIGGER USER;
UPDATE public.invoices
   SET due_date = invoice_date + payment_due_days
 WHERE due_date IS NULL
   AND document_type = 'invoice'
   AND status NOT IN ('draft', 'voided')
   AND invoice_date IS NOT NULL
   AND payment_due_days IS NOT NULL;
ALTER TABLE public.invoices ENABLE TRIGGER USER;
