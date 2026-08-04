-- ─────────────────────────────────────────────────────────────────────────────
-- Re-apply: late_fees_234e and related tds_challans/tds_filings columns
--
-- 20260401150000_tds_late_fees_fix.sql and 20260401220000_tds_challans_add_
-- missing_cols.sql both claim to add these columns and are both recorded as
-- "applied" in supabase_migrations.schema_migrations (with the real ALTER
-- TABLE statements stored, not a blank repair) — yet a direct
-- information_schema.columns query against the live database on 2026-08-04
-- confirmed NONE of late_fees_234e, late_fees_used, fully_utilized,
-- origin_quarter, origin_fy (on tds_challans) or ack_file_url (on
-- tds_filings) actually exist. No later migration ever DROPs any of them —
-- grepped every migration file for DROP COLUMN referencing these names, none
-- found — so they were never removed after being added; they were simply
-- never present, most likely from a database restore to a point before
-- 2026-04-01 whose migration-history bookkeeping was never reconciled with
-- the actual (older) schema it restored.
--
-- The app has been silently degrading around this the whole time: Late Fees
-- 234E entries in Data Entry hit a save-fallback that drops the field
-- (TdsDataEntry.tsx's "Try with late_fees_234e first; if the column doesn't
-- exist yet in DB" comment) rather than erroring, and TdsFilingsManager.tsx
-- already treats tds_ack_files as more trustworthy than filing.ack_file_url
-- for the same reason — so nothing crashed, but no late fee amount entered
-- via that field has ever actually been saved anywhere.
--
-- Re-applying with IF NOT EXISTS is safe regardless of the true root cause.

ALTER TABLE public.tds_challans
  ADD COLUMN IF NOT EXISTS late_fees_234e  DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fees_used  DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fully_utilized  BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin_quarter  TEXT,
  ADD COLUMN IF NOT EXISTS origin_fy       TEXT;

ALTER TABLE public.tds_filings
  ADD COLUMN IF NOT EXISTS ack_file_url TEXT;

NOTIFY pgrst, 'reload schema';
