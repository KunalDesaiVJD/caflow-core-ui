-- Fix: tally_* and sync_batches had RLS enabled but no SELECT policy,
-- so the frontend (anon/authenticated key) was getting 0 rows everywhere.
-- Uses DROP IF EXISTS + CREATE (idempotent) because IF NOT EXISTS is PG15+.

-- tally_groups
DROP POLICY IF EXISTS "tg_select" ON tally_groups;
CREATE POLICY "tg_select" ON tally_groups FOR SELECT USING (true);
DROP POLICY IF EXISTS "tg_insert" ON tally_groups;
CREATE POLICY "tg_insert" ON tally_groups FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "tg_update" ON tally_groups;
CREATE POLICY "tg_update" ON tally_groups FOR UPDATE USING (true);
DROP POLICY IF EXISTS "tg_delete" ON tally_groups;
CREATE POLICY "tg_delete" ON tally_groups FOR DELETE USING (true);

-- tally_ledgers
DROP POLICY IF EXISTS "tl_select" ON tally_ledgers;
CREATE POLICY "tl_select" ON tally_ledgers FOR SELECT USING (true);
DROP POLICY IF EXISTS "tl_insert" ON tally_ledgers;
CREATE POLICY "tl_insert" ON tally_ledgers FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "tl_update" ON tally_ledgers;
CREATE POLICY "tl_update" ON tally_ledgers FOR UPDATE USING (true);
DROP POLICY IF EXISTS "tl_delete" ON tally_ledgers;
CREATE POLICY "tl_delete" ON tally_ledgers FOR DELETE USING (true);

-- tally_trial_balance
DROP POLICY IF EXISTS "ttb_select" ON tally_trial_balance;
CREATE POLICY "ttb_select" ON tally_trial_balance FOR SELECT USING (true);
DROP POLICY IF EXISTS "ttb_insert" ON tally_trial_balance;
CREATE POLICY "ttb_insert" ON tally_trial_balance FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "ttb_update" ON tally_trial_balance;
CREATE POLICY "ttb_update" ON tally_trial_balance FOR UPDATE USING (true);
DROP POLICY IF EXISTS "ttb_delete" ON tally_trial_balance;
CREATE POLICY "ttb_delete" ON tally_trial_balance FOR DELETE USING (true);

-- tally_vouchers
DROP POLICY IF EXISTS "tv_select" ON tally_vouchers;
CREATE POLICY "tv_select" ON tally_vouchers FOR SELECT USING (true);
DROP POLICY IF EXISTS "tv_insert" ON tally_vouchers;
CREATE POLICY "tv_insert" ON tally_vouchers FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "tv_update" ON tally_vouchers;
CREATE POLICY "tv_update" ON tally_vouchers FOR UPDATE USING (true);
DROP POLICY IF EXISTS "tv_delete" ON tally_vouchers;
CREATE POLICY "tv_delete" ON tally_vouchers FOR DELETE USING (true);

-- sync_batches
DROP POLICY IF EXISTS "sb_select" ON sync_batches;
CREATE POLICY "sb_select" ON sync_batches FOR SELECT USING (true);
DROP POLICY IF EXISTS "sb_insert" ON sync_batches;
CREATE POLICY "sb_insert" ON sync_batches FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "sb_update" ON sync_batches;
CREATE POLICY "sb_update" ON sync_batches FOR UPDATE USING (true);
DROP POLICY IF EXISTS "sb_delete" ON sync_batches;
CREATE POLICY "sb_delete" ON sync_batches FOR DELETE USING (true);

-- Ensure anon + authenticated roles have table-level access.
GRANT SELECT, INSERT, UPDATE, DELETE ON tally_groups        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tally_ledgers       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tally_trial_balance TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tally_vouchers      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_batches        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_requests       TO anon, authenticated;
