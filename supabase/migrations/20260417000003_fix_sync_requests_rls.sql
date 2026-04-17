-- Fix sync_requests RLS: drop overly-restrictive policies, add permissive ones.
-- Root cause: INSERT policy used auth.role()='authenticated' which blocked
-- the React frontend's anon-key requests even for logged-in users.

DROP POLICY IF EXISTS "Authenticated users can read sync_requests"   ON sync_requests;
DROP POLICY IF EXISTS "Authenticated users can insert sync_requests" ON sync_requests;
DROP POLICY IF EXISTS "Service role can update sync_requests"        ON sync_requests;
DROP POLICY IF EXISTS "sr_select" ON sync_requests;
DROP POLICY IF EXISTS "sr_insert" ON sync_requests;
DROP POLICY IF EXISTS "sr_update" ON sync_requests;

CREATE POLICY "sr_select" ON sync_requests FOR SELECT USING (true);
CREATE POLICY "sr_insert" ON sync_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "sr_update" ON sync_requests FOR UPDATE USING (true);

-- Also ensure tally_company column exists (idempotent guard)
ALTER TABLE tally_groups        ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE tally_ledgers       ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE tally_vouchers      ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE tally_trial_balance ADD COLUMN IF NOT EXISTS tally_company TEXT;
ALTER TABLE sync_batches        ADD COLUMN IF NOT EXISTS tally_company TEXT;
