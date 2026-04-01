-- ─────────────────────────────────────────────────────────────────────────────
-- TDS Challans: Add all missing columns
-- Safe to run multiple times — every statement uses ADD COLUMN IF NOT EXISTS
-- ─────────────────────────────────────────────────────────────────────────────

-- Late fees u/s 234E (the field causing "column not found" error on save)
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_234e DECIMAL(12,2) DEFAULT 0;

-- Track how much of the 234E late fees have been paid/used
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_used DECIMAL(12,2) DEFAULT 0;

-- Track whether this challan's TDS balance is fully consumed
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS fully_utilized BOOLEAN DEFAULT false;

-- Store the original quarter/FY for carry-forward challans (display label)
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS origin_quarter TEXT;

ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS origin_fy TEXT;

-- ack_file_url on filings (for ACK PDF upload)
ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS ack_file_url TEXT;

-- Force PostgREST to reload its schema cache immediately
-- (so "column not found in schema cache" errors go away without restart)
NOTIFY pgrst, 'reload schema';
