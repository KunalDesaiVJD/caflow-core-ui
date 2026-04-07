-- ═══════════════════════════════════════════════════════════════════════
-- Tax Master JSON — adds a rich JSON blob for the full Tax Audit Master form
-- Also fixes queries_verified_by (was UUID FK, but we store a name string)
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Rich JSON for the 20-field Tax Audit Master sheet
ALTER TABLE public.audit_worksheet_master
  ADD COLUMN IF NOT EXISTS tax_master_json JSONB DEFAULT '{}'::JSONB;

-- 2. Rename queries_verified_by: drop the UUID FK, add TEXT column
--    (safe: no rows exist yet; the FK prevents saving a name string)
DO $$
BEGIN
  -- Drop the FK constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'audit_worksheet_master'
      AND constraint_name = 'audit_worksheet_master_queries_verified_by_fkey'
  ) THEN
    ALTER TABLE public.audit_worksheet_master
      DROP CONSTRAINT audit_worksheet_master_queries_verified_by_fkey;
  END IF;
END$$;

-- Change the column type to TEXT so we can store names
ALTER TABLE public.audit_worksheet_master
  ALTER COLUMN queries_verified_by TYPE TEXT USING queries_verified_by::TEXT;
