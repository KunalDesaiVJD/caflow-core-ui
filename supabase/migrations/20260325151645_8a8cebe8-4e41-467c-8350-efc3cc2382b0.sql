-- Migration 4: Extend invoices table for document types

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS document_series text NOT NULL DEFAULT 'inv',
  ADD COLUMN IF NOT EXISTS seq_number integer,
  ADD COLUMN IF NOT EXISTS financial_year text,
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_to_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_turnover numeric(15,2),
  ADD COLUMN IF NOT EXISTS remarks_conditions text,
  ADD COLUMN IF NOT EXISTS conversion_date timestamptz;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_document_type_check
  CHECK (document_type IN ('invoice', 'credit_note', 'quotation', 'proforma'));

ALTER TABLE invoices
  ADD CONSTRAINT invoices_document_series_check
  CHECK (document_series IN ('inv', 'cn', 'pi'));

-- Populate financial_year from invoice_date for existing rows
UPDATE invoices
SET financial_year = CASE
  WHEN EXTRACT(MONTH FROM invoice_date) >= 4
    THEN EXTRACT(YEAR FROM invoice_date)::text || '-' || LPAD(((EXTRACT(YEAR FROM invoice_date)::int % 100) + 1)::text, 2, '0')
  ELSE (EXTRACT(YEAR FROM invoice_date)::int - 1)::text || '-' || LPAD((EXTRACT(YEAR FROM invoice_date)::int % 100)::text, 2, '0')
END
WHERE invoice_date IS NOT NULL AND financial_year IS NULL;

-- Unique index on (firm_id, document_series, financial_year, seq_number)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_series_fy_seq
  ON invoices (firm_id, document_series, financial_year, seq_number)
  WHERE seq_number IS NOT NULL;
