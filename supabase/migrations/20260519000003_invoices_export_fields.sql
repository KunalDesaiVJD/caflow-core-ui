-- Export invoice fields: invoice type, foreign currency, exchange rate, LUT number.
-- Applied manually via Supabase SQL Editor.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type    TEXT    DEFAULT 'domestic',
  ADD COLUMN IF NOT EXISTS export_currency TEXT,
  ADD COLUMN IF NOT EXISTS exchange_rate   NUMERIC(15, 6),
  ADD COLUMN IF NOT EXISTS lut_number      TEXT;

COMMENT ON COLUMN public.invoices.invoice_type    IS 'domestic | export_with_igst | export_without_igst';
COMMENT ON COLUMN public.invoices.export_currency IS 'ISO 4217 code, e.g. USD, EUR, GBP';
COMMENT ON COLUMN public.invoices.exchange_rate   IS '1 unit of export_currency = this many INR';
COMMENT ON COLUMN public.invoices.lut_number      IS 'LUT/Bond number; mandatory for export_without_igst';
