-- 2026-08-05 — Auditor-confirmed TDS rate overrides
--
-- Sections 194C (1 % / 2 %) and 194J (2 % / 10 %) each have TWO valid rates
-- depending on the payee's classification (individual vs company, or
-- professional vs technical service). 26Q filings frequently record the
-- WRONG nature_of_payment / deductee_type, which then propagates into the
-- reconciliation engine and produces spurious "short deduction" / "over
-- deduction" flags. To eliminate this class of false-positive, the auditor
-- is now prompted to confirm the applicable rate for every 194C / 194J
-- party BEFORE running reconciliation. The chosen rate is persisted here
-- so subsequent recon runs read from this table.
--
-- Unique constraint: one override per (engagement × TB ledger × deductee ×
-- section). The same TB ledger can carry two overrides across sections
-- (e.g. a firm billed under both 194C and 194J in the same FY).

CREATE TABLE IF NOT EXISTS tds_party_rate_overrides (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id           UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  financial_year    TEXT NOT NULL,
  tb_ledger_name    TEXT NOT NULL,
  tds_deductee_name TEXT NOT NULL,
  section_code      TEXT NOT NULL,
  applicable_rate   NUMERIC(6, 3) NOT NULL,
  applicable_nature TEXT,
  set_by            TEXT,
  set_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_party_rate_overrides_uniq
    UNIQUE (client_id, financial_year, tb_ledger_name, tds_deductee_name, section_code)
);

CREATE INDEX IF NOT EXISTS idx_tds_party_rate_overrides_lookup
  ON tds_party_rate_overrides (client_id, financial_year, section_code);

-- RLS follows the same pattern as tds_tb_party_mappings (firm-scoped)
ALTER TABLE tds_party_rate_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tds_rate_overrides_firm_read"  ON tds_party_rate_overrides;
DROP POLICY IF EXISTS "tds_rate_overrides_firm_write" ON tds_party_rate_overrides;

CREATE POLICY "tds_rate_overrides_firm_read"
  ON tds_party_rate_overrides FOR SELECT
  USING (
    firm_id IN (
      SELECT users.firm_id FROM users WHERE users.id = auth.uid()
    )
  );

CREATE POLICY "tds_rate_overrides_firm_write"
  ON tds_party_rate_overrides FOR ALL
  USING (
    firm_id IN (
      SELECT users.firm_id FROM users WHERE users.id = auth.uid()
    )
  )
  WITH CHECK (
    firm_id IN (
      SELECT users.firm_id FROM users WHERE users.id = auth.uid()
    )
  );

COMMENT ON TABLE tds_party_rate_overrides IS
  'Auditor-confirmed applicable TDS rate for each party under 194C/194J. '
  'Consulted by the reconciliation engine BEFORE auto-detection so the '
  'auditor''s judgement is authoritative on sub-classification.';
