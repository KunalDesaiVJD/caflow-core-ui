-- Add tb_node_overrides JSONB to audit_engagements for persisting
-- user-made ledger reclassifications (original vs new group/bsPlSide).
ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS tb_node_overrides jsonb DEFAULT '{}';
