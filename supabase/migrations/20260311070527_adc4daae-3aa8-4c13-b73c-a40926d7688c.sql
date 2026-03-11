
-- Add new columns to tds_entries
ALTER TABLE public.tds_entries
  ADD COLUMN IF NOT EXISTS form_type text DEFAULT '26Q',
  ADD COLUMN IF NOT EXISTS section_code text,
  ADD COLUMN IF NOT EXISTS nature_of_payment text,
  ADD COLUMN IF NOT EXISTS deductee_pan text,
  ADD COLUMN IF NOT EXISTS lower_cert_no text,
  ADD COLUMN IF NOT EXISTS lower_cert_rate numeric,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS validation_messages jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS challan_bsr_code text,
  ADD COLUMN IF NOT EXISTS challan_serial_no text,
  ADD COLUMN IF NOT EXISTS challan_date date,
  ADD COLUMN IF NOT EXISTS challan_amount numeric,
  ADD COLUMN IF NOT EXISTS country_of_residence text,
  ADD COLUMN IF NOT EXISTS trc_available boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_treaty_section text,
  ADD COLUMN IF NOT EXISTS salary_amount numeric,
  ADD COLUMN IF NOT EXISTS standard_deduction numeric,
  ADD COLUMN IF NOT EXISTS taxable_salary numeric,
  ADD COLUMN IF NOT EXISTS designation text;

-- Add new columns to tds_filings
ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS prn_no text,
  ADD COLUMN IF NOT EXISTS assigned_staff uuid,
  ADD COLUMN IF NOT EXISTS last_updated_by uuid,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS tan text;
