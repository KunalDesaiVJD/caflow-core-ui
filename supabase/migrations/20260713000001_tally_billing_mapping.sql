-- ═══════════════════════════════════════════════════════════════════════════
-- TALLY ⇄ BILLING SYNC — Phase 0: Mapping foundation
-- Created: 2026-07-13
--
-- Three mapping layers that let CAFlow Billing speak Tally's language, per firm:
--   1. tally_firm_companies  — CAFlow firm  → the firm's OWN billing Tally company
--                              (distinct from audit-client companies in tally_ledgers)
--   2. tally_party_map       — CAFlow client → Tally party (Sundry Debtor) ledger
--   3. tally_element_map     — invoice/credit-note element → Tally ledger
--                              (income / output GST / TDS / round-off / discount / bank / cash)
--
-- All rows firm-scoped + RLS. Edge functions / the desktop agent use the
-- service-role key and bypass RLS. Mappings are proposed by the matcher and
-- approved by a human (status: proposed → approved).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Shared firm-access predicate for RLS ────────────────────────────────────
CREATE OR REPLACE FUNCTION tally_billing_firm_access(fid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM users u
            WHERE u.id = auth.uid() AND (u.role = 'superadmin' OR u.firm_id = fid))
    OR EXISTS (SELECT 1 FROM user_firm_access ufa
            WHERE ufa.user_id = auth.uid() AND ufa.firm_id = fid);
$$;

-- ── Shared updated_at touch ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tally_billing_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tally_firm_companies  (firm → its billing Tally company)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tally_firm_companies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  tally_company_name text NOT NULL,                     -- exact Tally company name for billing
  aliases            text[] NOT NULL DEFAULT '{}',      -- alternate spellings for matching
  gateway_url        text NOT NULL DEFAULT 'http://localhost:9000',
  gstin              text,                               -- firm GSTIN (anchors party matching)
  is_active          boolean NOT NULL DEFAULT true,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- One active billing company per firm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tally_firm_company_active
  ON tally_firm_companies(firm_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_tally_firm_company_firm ON tally_firm_companies(firm_id);

DROP TRIGGER IF EXISTS trg_touch_tally_firm_companies ON tally_firm_companies;
CREATE TRIGGER trg_touch_tally_firm_companies BEFORE UPDATE ON tally_firm_companies
  FOR EACH ROW EXECUTE FUNCTION tally_billing_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. tally_party_map  (client → Tally party ledger)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tally_party_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tally_company_name text,                              -- which company these ledgers belong to
  tally_ledger_name  text,                              -- the matched party ledger (null until mapped)
  match_method       text NOT NULL DEFAULT 'unmatched'
                       CHECK (match_method IN ('gstin','name_exact','name_fuzzy','manual','unmatched')),
  match_confidence   numeric(5,2) NOT NULL DEFAULT 0,   -- 0-100
  candidates         jsonb NOT NULL DEFAULT '[]',       -- top alternative ledger matches for review
  status             text NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','approved','rejected')),
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_tally_party_map_firm   ON tally_party_map(firm_id);
CREATE INDEX IF NOT EXISTS idx_tally_party_map_client ON tally_party_map(client_id);
CREATE INDEX IF NOT EXISTS idx_tally_party_map_status ON tally_party_map(firm_id, status);

DROP TRIGGER IF EXISTS trg_touch_tally_party_map ON tally_party_map;
CREATE TRIGGER trg_touch_tally_party_map BEFORE UPDATE ON tally_party_map
  FOR EACH ROW EXECUTE FUNCTION tally_billing_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. tally_element_map  (invoice/credit-note element → Tally ledger)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tally_element_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  tally_company_name text,
  element_type       text NOT NULL
                       CHECK (element_type IN
                         ('income','output_cgst','output_sgst','output_igst',
                          'tds_receivable','round_off','discount','bank','cash')),
  element_key        text NOT NULL DEFAULT 'default',   -- service_master id / bank id, or 'default'
  element_label      text,                              -- human label (e.g. service name, bank name)
  tally_ledger_name  text,                              -- the mapped Tally ledger (null until mapped)
  match_method       text NOT NULL DEFAULT 'unmatched'
                       CHECK (match_method IN ('name_exact','name_fuzzy','manual','unmatched')),
  match_confidence   numeric(5,2) NOT NULL DEFAULT 0,
  candidates         jsonb NOT NULL DEFAULT '[]',
  status             text NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','approved','rejected')),
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, element_type, element_key)
);
CREATE INDEX IF NOT EXISTS idx_tally_element_map_firm ON tally_element_map(firm_id);

DROP TRIGGER IF EXISTS trg_touch_tally_element_map ON tally_element_map;
CREATE TRIGGER trg_touch_tally_element_map BEFORE UPDATE ON tally_element_map
  FOR EACH ROW EXECUTE FUNCTION tally_billing_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — firm-scoped read/write; service role bypasses
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE tally_firm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_party_map      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_element_map    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tally_firm_companies','tally_party_map','tally_element_map'] LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$s_firm_rw ON %1$s;
      CREATE POLICY %1$s_firm_rw ON %1$s FOR ALL TO authenticated
        USING (tally_billing_firm_access(firm_id))
        WITH CHECK (tally_billing_firm_access(firm_id));
    $f$, tbl);
  END LOOP;
END $$;
