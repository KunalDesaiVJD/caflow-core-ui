
-- Create tb_hierarchy_nodes table for Tally TB hierarchy storage
CREATE TABLE IF NOT EXISTS tb_hierarchy_nodes (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engagement_id     UUID REFERENCES audit_engagements(id) ON DELETE CASCADE,
  import_batch_id   UUID REFERENCES ledger_import_batches(id),
  node_id           TEXT NOT NULL,
  parent_node_id    TEXT,
  level             INTEGER NOT NULL,
  tally_group_name  TEXT NOT NULL,
  indent_value      NUMERIC,
  is_leaf           BOOLEAN DEFAULT FALSE,
  is_bold           BOOLEAN DEFAULT FALSE,
  opening_balance   NUMERIC DEFAULT 0,
  txn_debit         NUMERIC DEFAULT 0,
  txn_credit        NUMERIC DEFAULT 0,
  closing_balance   NUMERIC DEFAULT 0,
  normal_balance    TEXT CHECK (normal_balance IN ('Dr','Cr','Unknown')),
  bs_pl_side        TEXT CHECK (bs_pl_side IN ('BS','PL','Unknown')),
  primary_group     TEXT,
  row_number        INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tb_nodes_engagement ON tb_hierarchy_nodes(engagement_id);
CREATE INDEX IF NOT EXISTS idx_tb_nodes_leaf ON tb_hierarchy_nodes(engagement_id, is_leaf);

-- Add hierarchy columns to trial_balance_snapshots
ALTER TABLE trial_balance_snapshots
  ADD COLUMN IF NOT EXISTS node_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_node_id TEXT,
  ADD COLUMN IF NOT EXISTS hierarchy_level INTEGER,
  ADD COLUMN IF NOT EXISTS primary_group TEXT,
  ADD COLUMN IF NOT EXISTS tally_indent NUMERIC,
  ADD COLUMN IF NOT EXISTS normal_balance TEXT,
  ADD COLUMN IF NOT EXISTS bs_pl_side TEXT,
  ADD COLUMN IF NOT EXISTS matched_category_code TEXT,
  ADD COLUMN IF NOT EXISTS matched_keywords TEXT[],
  ADD COLUMN IF NOT EXISTS ledger_name TEXT,
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS txn_debit NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS txn_credit NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Add columns to ledger_import_batches for TB import tracking
ALTER TABLE ledger_import_batches
  ADD COLUMN IF NOT EXISTS import_type TEXT,
  ADD COLUMN IF NOT EXISTS total_rows INTEGER,
  ADD COLUMN IF NOT EXISTS leaf_rows INTEGER,
  ADD COLUMN IF NOT EXISTS processed_rows INTEGER,
  ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES firms(id),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- RLS for tb_hierarchy_nodes
ALTER TABLE tb_hierarchy_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own engagement hierarchy nodes"
  ON tb_hierarchy_nodes FOR SELECT TO authenticated
  USING (
    is_superadmin() OR
    engagement_id IN (
      SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()
    )
  );

CREATE POLICY "Users can insert hierarchy nodes"
  ON tb_hierarchy_nodes FOR INSERT TO authenticated
  WITH CHECK (
    is_superadmin() OR
    engagement_id IN (
      SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()
    )
  );

CREATE POLICY "Users can delete hierarchy nodes"
  ON tb_hierarchy_nodes FOR DELETE TO authenticated
  USING (
    is_superadmin() OR
    engagement_id IN (
      SELECT id FROM audit_engagements WHERE firm_id = current_user_firm_id()
    )
  );

-- Fix chat: Update users RLS to let superadmin see all users
DROP POLICY IF EXISTS "Same firm users can read colleagues" ON users;
CREATE POLICY "Same firm users can read colleagues" ON users
  FOR SELECT TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id());
