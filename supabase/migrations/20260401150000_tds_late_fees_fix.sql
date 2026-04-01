-- ─────────────────────────────────────────────────────────────────────────────
-- TDS Fix: Ensure late_fees_234e and related challan columns exist
-- This is the authoritative migration — safe to run multiple times (IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_234e  DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fees_used  DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fully_utilized  BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin_quarter  TEXT,
  ADD COLUMN IF NOT EXISTS origin_fy       TEXT;

-- Notify PostgREST to reload schema so new columns are visible immediately
NOTIFY pgrst, 'reload schema';
