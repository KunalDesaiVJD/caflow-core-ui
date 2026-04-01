-- ─────────────────────────────────────────────────────────────────────────────
-- Invoices: Add TDS section columns
-- Allows users to select a TDS section on an invoice (from tds_rate_master)
-- so TDS deductible amount is tracked per invoice and shown in all ledgers
-- Safe to run multiple times — every statement uses ADD COLUMN IF NOT EXISTS
-- ─────────────────────────────────────────────────────────────────────────────

-- Section code selected on the invoice (e.g. "194C-S", "194J(a)")
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tds_section_code TEXT;

-- TDS rate applied (percentage, e.g. 1.00, 2.00, 10.00)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tds_rate DECIMAL(10,4);

-- Calculated TDS amount on taxable value
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tds_amount DECIMAL(12,2);

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
