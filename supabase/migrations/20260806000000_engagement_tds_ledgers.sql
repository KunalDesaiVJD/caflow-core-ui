-- 2026-08-06 — Persistent TDS-payable ledger confirmation (Stage 5 / P5-B)
--
-- discoverTdsLedgers() re-runs its Layer 1/2/3 heuristics on every AI
-- Mapper run, with no memory of what the auditor already confirmed. This
-- works fine for simple clients (Ray Wings' single "TDS PAY") but larger
-- clients with one payable ledger per section need the auditor to review
-- the discovered set ONCE and have that confirmation persist — otherwise
-- every re-run risks re-classifying an edge-case ledger differently.
--
-- This table stores the auditor-confirmed TDS-ledger set. When rows exist
-- for an engagement + FY, the mapper reads from here INSTEAD of re-running
-- discovery. Auditor can add/remove/edit via a small setup panel above
-- Party Mappings.

CREATE TABLE IF NOT EXISTS engagement_tds_ledgers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  financial_year  TEXT NOT NULL,
  ledger_name     TEXT NOT NULL,
  parent_group    TEXT,
  section_code    TEXT,               -- nullable: some clients use one combined ledger
  is_active       BOOLEAN NOT NULL DEFAULT true,  -- auditor can soft-disable without deleting
  confirmed_by    TEXT,
  confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT engagement_tds_ledgers_uniq
    UNIQUE (client_id, financial_year, ledger_name)
);

CREATE INDEX IF NOT EXISTS idx_engagement_tds_ledgers_lookup
  ON engagement_tds_ledgers (client_id, financial_year);

ALTER TABLE engagement_tds_ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engagement_tds_ledgers_firm_read"  ON engagement_tds_ledgers;
DROP POLICY IF EXISTS "engagement_tds_ledgers_firm_write" ON engagement_tds_ledgers;

CREATE POLICY "engagement_tds_ledgers_firm_read"
  ON engagement_tds_ledgers FOR SELECT
  USING (
    firm_id IN (SELECT users.firm_id FROM users WHERE users.id = auth.uid())
  );

CREATE POLICY "engagement_tds_ledgers_firm_write"
  ON engagement_tds_ledgers FOR ALL
  USING (
    firm_id IN (SELECT users.firm_id FROM users WHERE users.id = auth.uid())
  )
  WITH CHECK (
    firm_id IN (SELECT users.firm_id FROM users WHERE users.id = auth.uid())
  );

COMMENT ON TABLE engagement_tds_ledgers IS
  'Auditor-confirmed set of TDS-payable ledgers for an engagement + FY. '
  'When populated, the AI mapper reads from here instead of re-running '
  'the Layer 1/2/3 auto-discovery heuristics on every run.';
