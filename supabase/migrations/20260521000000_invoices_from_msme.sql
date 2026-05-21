-- Add MSME (Udyam) registration number to invoice snapshot so it can be
-- displayed below the Invoice No on the printed/PDF invoice. Sourced from
-- the firm's settings.msme_no at invoice creation time.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS from_msme TEXT;

COMMENT ON COLUMN public.invoices.from_msme IS 'Firm MSME / Udyam registration no. snapshot, e.g. UDYAM-GJ-01-0065300';
