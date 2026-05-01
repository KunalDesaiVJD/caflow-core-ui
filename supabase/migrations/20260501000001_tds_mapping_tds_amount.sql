-- ─────────────────────────────────────────────────────────────────────────────
-- Add tds_tds_amount to tds_tb_party_mappings
-- This stores the actual TDS deducted amount from the TDS filing (total_tds),
-- enabling auditors to verify BOTH gross amount AND TDS deducted amount match.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_tb_party_mappings
  ADD COLUMN IF NOT EXISTS tds_tds_amount numeric;

COMMENT ON COLUMN public.tds_tb_party_mappings.tds_tds_amount
  IS 'Actual TDS deducted per TDS filing (sum of tds_deductees.tds_amount for this deductee+section). Used to verify TDS amount tie-back in addition to gross amount.';
