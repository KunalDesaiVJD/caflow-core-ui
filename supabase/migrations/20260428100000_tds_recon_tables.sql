-- ─────────────────────────────────────────────────────────────────────────────
-- Phase TDS-1  ·  TDS Analytics & Reconciliation — Database Foundation
-- Tables:
--   1. tds_tb_party_mappings  — AI-matched TB ledger ↔ TDS deductee pairs
--   2. tds_recon_flags        — Discrepancy flags raised by the recon engine
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tds_tb_party_mappings ─────────────────────────────────────────────────
-- Stores the AI (or manually confirmed) match between a Trial Balance party
-- ledger and a TDS deductee record from the TDS Management module.
-- Each (client_id, financial_year, tb_ledger_name, tds_deductee_name) is unique.

CREATE TABLE IF NOT EXISTS tds_tb_party_mappings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  client_id          uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id            uuid        NOT NULL,
  financial_year     text        NOT NULL,     -- e.g. "2025-26"

  -- TB side
  tb_ledger_name     text        NOT NULL,
  tb_parent_group    text,
  tb_total_debit     numeric,                  -- aggregate debit turnover from TB

  -- TDS module side
  tds_deductee_name  text        NOT NULL,
  tds_section_code   text,                     -- e.g. "194C", "194J"
  tds_total_amount   numeric,                  -- aggregate TDS-liable amount from filings
  tds_filing_ids     uuid[]      DEFAULT '{}', -- linked tds_filings rows

  -- Match quality
  match_confidence   integer     CHECK (match_confidence BETWEEN 0 AND 100),
  match_method       text,
  -- 'ai_name_similarity' | 'ai_amount_ratio' | 'ai_section_context' |
  -- 'manual_confirm' | 'manual_override'
  ai_reasoning       text,

  -- Lifecycle
  mapping_status     text        NOT NULL DEFAULT 'pending',
  -- 'pending' | 'confirmed' | 'rejected' | 'needs_review'
  mapped_by          text,                     -- user email or 'ai'
  notes              text,

  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),

  UNIQUE (client_id, financial_year, tb_ledger_name, tds_deductee_name)
);

CREATE INDEX IF NOT EXISTS tds_tb_party_mappings_client_fy
  ON tds_tb_party_mappings (client_id, financial_year);

CREATE INDEX IF NOT EXISTS tds_tb_party_mappings_status
  ON tds_tb_party_mappings (client_id, financial_year, mapping_status);

-- ── 2. tds_recon_flags ───────────────────────────────────────────────────────
-- Stores every discrepancy/flag found by the three reconciliation engines:
--   Goal 1 — entry_in_books_not_in_tds / entry_in_tds_not_in_books
--   Goal 2 — short_deduction / over_deduction
--   Goal 3 — missing_tds_obligation

CREATE TABLE IF NOT EXISTS tds_recon_flags (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  client_id          uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id            uuid        NOT NULL,
  financial_year     text        NOT NULL,

  -- Flag classification
  flag_type          text        NOT NULL,
  -- 'entry_in_books_not_in_tds'  — TB entry missing from TDS module
  -- 'entry_in_tds_not_in_books'  — TDS module entry missing from ledgers
  -- 'short_deduction'            — TDS deducted < what Act requires
  -- 'over_deduction'             — TDS deducted > applicable rate
  -- 'missing_tds_obligation'     — Unmapped ledger likely liable for TDS
  goal_number        integer     CHECK (goal_number IN (1, 2, 3)),

  -- Ledger / deductee pointers
  tb_ledger_name     text,
  tds_deductee_name  text,
  section_code       text,                     -- e.g. "194C"
  nature_of_payment  text,                     -- human-readable description

  -- Amounts (Goal 1 — book vs TDS module)
  book_amount        numeric,                  -- amount per TB / ledger entries
  tds_amount         numeric,                  -- amount per TDS module

  -- Rates (Goal 2 — short/over deduction)
  expected_tds       numeric,                  -- TDS liability per Act
  actual_tds         numeric,                  -- TDS actually deducted
  variance_amount    numeric,                  -- expected_tds - actual_tds
  expected_rate      numeric,                  -- applicable rate (%)
  actual_rate        numeric,                  -- rate actually applied (%)
  threshold_amount   numeric,                  -- basic exemption threshold

  -- Source evidence
  voucher_ids        uuid[]      DEFAULT '{}', -- tally_vouchers rows used
  deductee_ids       uuid[]      DEFAULT '{}', -- tds_deductees rows used
  mapping_id         uuid        REFERENCES tds_tb_party_mappings(id),

  -- AI metadata
  ai_reasoning       text,
  ai_confidence      integer     CHECK (ai_confidence BETWEEN 0 AND 100),
  sample_narrations  text[]      DEFAULT '{}', -- up to 3 sample voucher narrations

  -- Lifecycle
  flag_status        text        NOT NULL DEFAULT 'pending',
  -- 'pending' | 'query_raised' | 'disregarded' | 'accepted'
  query_id           uuid,                     -- linked query in audit_queries
  actioned_by        uuid,                     -- user id
  actioned_at        timestamptz,
  action_note        text,

  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tds_recon_flags_client_fy_type
  ON tds_recon_flags (client_id, financial_year, flag_type, flag_status);

CREATE INDEX IF NOT EXISTS tds_recon_flags_client_fy_goal
  ON tds_recon_flags (client_id, financial_year, goal_number, flag_status);

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE tds_tb_party_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_recon_flags       ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (edge functions use service role)
CREATE POLICY "service_role_all_mappings"
  ON tds_tb_party_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_flags"
  ON tds_recon_flags FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: firm-scoped access
CREATE POLICY "auth_firm_mappings"
  ON tds_tb_party_mappings FOR ALL TO authenticated
  USING (
    firm_id IN (
      SELECT firm_id FROM firm_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    firm_id IN (
      SELECT firm_id FROM firm_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "auth_firm_flags"
  ON tds_recon_flags FOR ALL TO authenticated
  USING (
    firm_id IN (
      SELECT firm_id FROM firm_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    firm_id IN (
      SELECT firm_id FROM firm_users WHERE user_id = auth.uid()
    )
  );

-- ── updated_at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tds_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER tds_tb_party_mappings_updated_at
  BEFORE UPDATE ON tds_tb_party_mappings
  FOR EACH ROW EXECUTE FUNCTION tds_set_updated_at();

CREATE TRIGGER tds_recon_flags_updated_at
  BEFORE UPDATE ON tds_recon_flags
  FOR EACH ROW EXECUTE FUNCTION tds_set_updated_at();
