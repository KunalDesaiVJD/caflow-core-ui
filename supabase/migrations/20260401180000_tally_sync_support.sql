-- ─────────────────────────────────────────────────────────────────────────────
-- Tally Auto-Sync: Ensure all required columns exist for the sync agent
-- ─────────────────────────────────────────────────────────────────────────────

-- ledger_import_batches: add import_type if missing
ALTER TABLE public.ledger_import_batches
  ADD COLUMN IF NOT EXISTS import_type   TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS imported_at   TIMESTAMPTZ DEFAULT NOW();

-- trial_balance_snapshots: ensure tally-sync fields exist
ALTER TABLE public.trial_balance_snapshots
  ADD COLUMN IF NOT EXISTS primary_group    TEXT,
  ADD COLUMN IF NOT EXISTS bs_pl_side       TEXT,
  ADD COLUMN IF NOT EXISTS normal_balance   TEXT DEFAULT 'Dr',
  ADD COLUMN IF NOT EXISTS source_format    TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS import_format    TEXT DEFAULT 'manual';

-- Index for fast re-sync (delete + re-insert by engagement + FY)
CREATE INDEX IF NOT EXISTS idx_tb_snap_engagement_fy
  ON public.trial_balance_snapshots (engagement_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tb_hierarchy_engagement
  ON public.tb_hierarchy_nodes (engagement_id, import_batch_id);

CREATE INDEX IF NOT EXISTS idx_ledger_batch_engagement
  ON public.ledger_import_batches (engagement_id);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
