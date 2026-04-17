-- Fix: tally_* and sync_batches had RLS enabled but no SELECT policy,
-- so the frontend (anon/authenticated key) was getting 0 rows everywhere.

-- tally_groups
CREATE POLICY IF NOT EXISTS "tg_select" ON tally_groups FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "tg_insert" ON tally_groups FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "tg_update" ON tally_groups FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "tg_delete" ON tally_groups FOR DELETE USING (true);

-- tally_ledgers
CREATE POLICY IF NOT EXISTS "tl_select" ON tally_ledgers FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "tl_insert" ON tally_ledgers FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "tl_update" ON tally_ledgers FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "tl_delete" ON tally_ledgers FOR DELETE USING (true);

-- tally_trial_balance
CREATE POLICY IF NOT EXISTS "ttb_select" ON tally_trial_balance FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "ttb_insert" ON tally_trial_balance FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "ttb_update" ON tally_trial_balance FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "ttb_delete" ON tally_trial_balance FOR DELETE USING (true);

-- tally_vouchers
CREATE POLICY IF NOT EXISTS "tv_select" ON tally_vouchers FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "tv_insert" ON tally_vouchers FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "tv_update" ON tally_vouchers FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "tv_delete" ON tally_vouchers FOR DELETE USING (true);

-- sync_batches
CREATE POLICY IF NOT EXISTS "sb_select" ON sync_batches FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "sb_insert" ON sync_batches FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "sb_update" ON sync_batches FOR UPDATE USING (true);
CREATE POLICY IF NOT EXISTS "sb_delete" ON sync_batches FOR DELETE USING (true);
