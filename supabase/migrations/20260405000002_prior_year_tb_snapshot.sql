-- Add prior_year_tb_snapshot column to audit_engagements for persisting
-- prior-year TB leaf nodes without needing a fake UUID engagement_id.
-- The existing approach of using "${engagementId}_prior" violates the UUID FK
-- constraint on ledger_import_batches and tb_hierarchy_nodes.

ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS prior_year_tb_snapshot  jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS prior_year_tb_imported_at timestamptz;
