-- ─────────────────────────────────────────────────────────────────────────────
-- TDS Batch 2: missing columns for Issues 6, 7D, 7H
-- ─────────────────────────────────────────────────────────────────────────────

-- Issue 6: Late Fees tracking on challans
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_234e    DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fees_used    DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_amount   DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS others_amount     DECIMAL(12,2) DEFAULT 0;

-- Issue 7D: Track fully-utilized challans
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS fully_utilized BOOLEAN DEFAULT false;

-- Issue 7H: Track source quarter/FY for carry-forward label
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS origin_quarter TEXT,
  ADD COLUMN IF NOT EXISTS origin_fy      TEXT;

-- Issue 9 (already in prev migration, re-guard)
ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS challan_file_url TEXT;

-- Issue 7 (already in prev migration, re-guard)
ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS ack_file_url TEXT;

-- Issue 7C: Ensure tds_deductees has challan_id (should already exist)
-- ALTER TABLE public.tds_deductees
--   ADD COLUMN IF NOT EXISTS challan_id UUID REFERENCES public.tds_challans(id);
-- Note: challan_id already present in schema; commented out to avoid error
