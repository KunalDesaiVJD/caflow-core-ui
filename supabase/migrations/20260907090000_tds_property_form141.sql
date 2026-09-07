-- 2026-09-07 — TDS on transfer of immovable property (Form 141, Schedule B)
--
-- A PARALLEL spine to the quarterly TDS tables, not an extension of them.
--
-- From 1 April 2026 the Income-tax Act, 2025 replaces Forms 26QB/26QC/26QD/
-- 26QE with a single Form 141 carrying four schedules; property is Schedule B,
-- under s.393(1) Table Sl. No. 3(i), issued under rules 218(3) and 219(5).
-- Verified against a real filed acknowledgement (BTA0188370, CIN
-- 26090200117177ICIC, Tax Year 2026-27).
--
-- Why these tables cannot be tds_filings/tds_challans/tds_deductees:
--   * Filed under the buyer's PAN, not a TAN. tds_filings is TAN-keyed.
--   * The period is a MONTH ("Month of Deduction: Sep-2026"), not a quarter.
--     tds_filings is (client, financial_year, QUARTER, form).
--   * The challan IS the statement — no separate OLTAS mapping step, so the
--     tds_challans → tds_deductees split has nothing to model.
--   * One statement per (buyer × instalment) with one row per seller, driven
--     by a property-level transaction that both buyers read differently.
--
-- Critically, adding '141' to client_services.tds_forms_applicable would make
-- the quarterly auto-sync trigger (20260710180000_tds_filings_auto_sync.sql)
-- manufacture four empty tds_filings rows a year for a form that has no
-- quarters. Property TDS is therefore kept entirely out of that path and
-- surfaced through its own section in the TDS Management module.
--
-- All computation lives in src/lib/tds/form141.ts, form141ScheduleB.ts and
-- form141Validate.ts. These tables store INPUTS and FILED FACTS only — never
-- a derived figure that the engine would otherwise recompute, with one
-- deliberate exception noted on tds_property_filings.rows_snapshot.

-- ─── The transaction ────────────────────────────────────────────────────────
-- One row per property deal per client. Two co-buyers who are both clients of
-- the firm get one row each: the deal is shared, but the statements, the
-- apportionment and the filing PAN are not.

CREATE TABLE IF NOT EXISTS tds_property_transactions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Form 141 Schedule B "Transaction Details"
  property_type             TEXT NOT NULL,               -- LAND / BUILDING / … (portal list not enumerated)
  property_address          TEXT NOT NULL,
  property_pin              TEXT,
  date_of_agreement         DATE NOT NULL,
  total_sale_consideration  NUMERIC(18,2) NOT NULL,
  total_stamp_duty_value    NUMERIC(18,2),               -- nullable: often only on the Index-II page
  payment_mode              TEXT NOT NULL DEFAULT 'lumpsum'
                              CHECK (payment_mode IN ('lumpsum', 'instalments')),

  -- Which buyer this client is. The statement is filed under this PAN, and it
  -- must appear among the buyer parties — enforced in form141Validate.ts
  -- rather than by a constraint, so the user can save a part-built draft.
  filing_buyer_pan          TEXT,

  -- Denormalised from the FIRST instalment's payment date purely so the
  -- listing can filter by year without joining. The engine always re-derives
  -- the real Tax Year per instalment; a deal whose instalments straddle
  -- 31 March legitimately produces statements in two Tax Years.
  tax_year                  TEXT,

  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'ready', 'filed', 'archived')),
  -- How the data got here, so an extracted transaction stays distinguishable
  -- from a hand-keyed one long after the fact.
  source                    TEXT NOT NULL DEFAULT 'manual'
                              CHECK (source IN ('manual', 'agreement_upload')),
  notes                     TEXT,

  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_property_consideration_positive
    CHECK (total_sale_consideration > 0),
  CONSTRAINT tds_property_sdv_non_negative
    CHECK (total_stamp_duty_value IS NULL OR total_stamp_duty_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tds_property_txn_client
  ON tds_property_transactions (client_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_tds_property_txn_firm
  ON tds_property_transactions (firm_id, status);

-- ─── Parties ────────────────────────────────────────────────────────────────
-- Buyers and sellers in one table: they carry the same identity and share
-- columns, the form lists them in parallel blocks, and every apportionment
-- reads both sides together. Splitting them would duplicate the share
-- validation in two places.

CREATE TABLE IF NOT EXISTS tds_property_parties (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  transaction_id            UUID NOT NULL REFERENCES tds_property_transactions(id) ON DELETE CASCADE,

  party_role                TEXT NOT NULL CHECK (party_role IN ('buyer', 'seller')),
  seq                       INTEGER NOT NULL,            -- the form's own Sl. No.

  pan                       TEXT,                        -- null = no PAN, which drives the 20% rate
  name                      TEXT NOT NULL,
  contact                   TEXT,
  email                     TEXT,
  -- "Proportion of total sale consideration to be paid/received (%)"
  share_pct                 NUMERIC(7,4) NOT NULL,

  -- Sellers only. A non-resident seller takes the payment out of s.393(1)
  -- entirely and into s.195 / Form 27Q — blocked by the engine, not stored
  -- as a filterable state.
  residential_status        TEXT NOT NULL DEFAULT 'resident'
                              CHECK (residential_status IN ('resident', 'non_resident')),

  -- Lower/nil deduction certificate under s.395(1) (the 1961 Act's s.197).
  section_395_certificate_no TEXT,
  section_395_rate           NUMERIC(6,3),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_property_parties_seq_uniq UNIQUE (transaction_id, party_role, seq),
  CONSTRAINT tds_property_share_range CHECK (share_pct > 0 AND share_pct <= 100)
);

CREATE INDEX IF NOT EXISTS idx_tds_property_parties_txn
  ON tds_property_parties (transaction_id, party_role, seq);

-- ─── Instalments ────────────────────────────────────────────────────────────
-- One row per payment this buyer makes. Each produces exactly one Form 141
-- Schedule B statement, under its own Tax Year and Month of Deduction — which
-- is why a schedule straddling 31 March is ordinary rather than exceptional.

CREATE TABLE IF NOT EXISTS tds_property_instalments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  transaction_id            UUID NOT NULL REFERENCES tds_property_transactions(id) ON DELETE CASCADE,

  seq                       INTEGER NOT NULL,
  -- Total this buyer paid in this instalment, across ALL sellers. Apportioned
  -- by seller share at computation time.
  amount_paid_by_buyer      NUMERIC(18,2) NOT NULL,

  date_paid_or_credited     DATE NOT NULL,
  date_of_deduction         DATE NOT NULL,
  date_of_deposit           DATE,                        -- null while unpaid
  date_of_filing            DATE,                        -- null while unfiled

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_property_instalments_seq_uniq UNIQUE (transaction_id, seq),
  CONSTRAINT tds_property_instalment_positive CHECK (amount_paid_by_buyer > 0)
);

CREATE INDEX IF NOT EXISTS idx_tds_property_instalments_txn
  ON tds_property_instalments (transaction_id, seq);

-- ─── Filings ────────────────────────────────────────────────────────────────
-- One filed (or draft) Form 141 Schedule B statement. Holds the facts the
-- government returns — acknowledgement number, CIN, BSR code, challan number
-- — which no computation can produce, plus the amounts actually paid.

CREATE TABLE IF NOT EXISTS tds_property_filings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  transaction_id            UUID NOT NULL REFERENCES tds_property_transactions(id) ON DELETE CASCADE,
  instalment_id             UUID NOT NULL REFERENCES tds_property_instalments(id) ON DELETE CASCADE,

  tax_year                  TEXT NOT NULL,               -- "2026-27"
  month_of_deduction        TEXT NOT NULL,               -- "Sep-2026", as the form prints it
  due_date                  DATE NOT NULL,               -- 30 days from end of deduction month

  -- Government-returned identifiers.
  acknowledgement_number    TEXT,                        -- e.g. BTA0188370
  cin                       TEXT,                        -- e.g. 26090200117177ICIC
  bsr_code                  TEXT,
  challan_no                TEXT,
  bank_reference_number     TEXT,
  bank_name                 TEXT,
  payment_mode              TEXT,
  date_of_deposit           DATE,

  -- Part C. Stored as filed, so a later change to the engine can never
  -- silently restate a figure that was actually paid to the government.
  total_amount_liable       NUMERIC(18,2),
  total_tds                 NUMERIC(18,2),
  interest_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  fee_amount                NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_payable             NUMERIC(18,2),

  -- The 13-column deductee rows exactly as they went to the portal. The one
  -- deliberate derived-data exception in this schema: once a statement is
  -- filed, what it SAID is a historical fact independent of the inputs, and
  -- the inputs can legitimately be corrected afterwards.
  rows_snapshot             JSONB,

  -- TDS certificate to the seller. Reported as Form 132 under the new Act
  -- from a single secondary source (see UNVERIFIED_CITATIONS in form141.ts),
  -- so the column is named neutrally rather than after a form number this
  -- codebase has not confirmed.
  certificate_issued_at     DATE,
  certificate_reference     TEXT,

  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'paid', 'filed')),
  filed_at                  TIMESTAMPTZ,
  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tds_property_filings_instalment_uniq UNIQUE (instalment_id)
);

CREATE INDEX IF NOT EXISTS idx_tds_property_filings_txn
  ON tds_property_filings (transaction_id);
CREATE INDEX IF NOT EXISTS idx_tds_property_filings_due
  ON tds_property_filings (firm_id, status, due_date);

-- ─── Documents ──────────────────────────────────────────────────────────────
-- The sale agreement, the Index-II page, and the challan receipt/statement
-- pair. extraction_json is populated in a later phase; the column exists now
-- so an uploaded document has somewhere to put its reading without a second
-- migration, and stays NULL for a purely manual transaction.

CREATE TABLE IF NOT EXISTS tds_property_documents (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                   UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  transaction_id            UUID NOT NULL REFERENCES tds_property_transactions(id) ON DELETE CASCADE,

  doc_kind                  TEXT NOT NULL CHECK (doc_kind IN (
                              'sale_agreement', 'index_ii', 'challan_receipt',
                              'challan_statement', 'certificate', 'other')),
  file_url                  TEXT NOT NULL,
  file_name                 TEXT,
  mime_type                 TEXT,

  -- { fields: {...}, queries: [...] } — every field carrying value,
  -- confidence, page and source snippet. Extraction NEVER writes straight to
  -- the transaction: a human confirms each figure through the same validation
  -- gate a hand-keyed one passes.
  extraction_json           JSONB,
  extraction_status         TEXT CHECK (extraction_status IN (
                              'pending', 'extracted', 'confirmed', 'failed')),

  uploaded_by               UUID REFERENCES users(id),
  uploaded_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_property_documents_txn
  ON tds_property_documents (transaction_id, doc_kind);

-- ─── updated_at ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tds_property_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tds_property_transactions_touch ON tds_property_transactions;
CREATE TRIGGER trg_tds_property_transactions_touch
  BEFORE UPDATE ON tds_property_transactions
  FOR EACH ROW EXECUTE FUNCTION tds_property_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tds_property_parties_touch ON tds_property_parties;
CREATE TRIGGER trg_tds_property_parties_touch
  BEFORE UPDATE ON tds_property_parties
  FOR EACH ROW EXECUTE FUNCTION tds_property_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tds_property_instalments_touch ON tds_property_instalments;
CREATE TRIGGER trg_tds_property_instalments_touch
  BEFORE UPDATE ON tds_property_instalments
  FOR EACH ROW EXECUTE FUNCTION tds_property_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tds_property_filings_touch ON tds_property_filings;
CREATE TRIGGER trg_tds_property_filings_touch
  BEFORE UPDATE ON tds_property_filings
  FOR EACH ROW EXECUTE FUNCTION tds_property_touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Firm scoping mirrors tds_deductees and engagement_tds_ledgers exactly: a
-- user sees their own firm's rows, a superadmin sees all.

ALTER TABLE tds_property_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_property_parties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_property_instalments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_property_filings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_property_documents    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tds_property_transactions',
    'tds_property_parties',
    'tds_property_instalments',
    'tds_property_filings',
    'tds_property_documents'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_firm_read',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_firm_write', t);

    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT
      USING (is_superadmin() OR firm_id = current_user_firm_id())
    $f$, t || '_firm_read', t);

    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR ALL
      USING (is_superadmin() OR firm_id = current_user_firm_id())
      WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id())
    $f$, t || '_firm_write', t);
  END LOOP;
END $$;

-- ─── Documentation ──────────────────────────────────────────────────────────

COMMENT ON TABLE tds_property_transactions IS
  'Form 141 Schedule B — one property transfer per client. TDS on transfer of '
  'immovable property under s.393(1) Table Sl. No. 3(i), Income-tax Act 2025, '
  'effective 1-Apr-2026. Replaces Form 26QB. Deliberately separate from the '
  'quarterly tds_filings spine: PAN-keyed not TAN-keyed, monthly not quarterly.';

COMMENT ON COLUMN tds_property_transactions.tax_year IS
  'Denormalised from the first instalment for listing/filtering only. The '
  'engine re-derives the Tax Year per instalment — a schedule crossing 31 '
  'March legitimately files in two Tax Years.';

COMMENT ON COLUMN tds_property_transactions.filing_buyer_pan IS
  'Which buyer this client is. The statement is filed under this PAN. Must be '
  'among the buyer parties — enforced by form141Validate.ts so a part-built '
  'draft can still be saved.';

COMMENT ON COLUMN tds_property_parties.share_pct IS
  'Proportion of TOTAL sale consideration. Buyer shares and seller shares must '
  'each total 100%; the engine never re-normalises them, so a mistake surfaces '
  'as a blocking finding rather than a plausible wrong number.';

COMMENT ON COLUMN tds_property_filings.rows_snapshot IS
  'The 13-column deductee rows exactly as filed. Kept because what a filed '
  'statement SAID is a historical fact independent of inputs that may later be '
  'corrected.';

COMMENT ON COLUMN tds_property_filings.certificate_reference IS
  'TDS certificate issued to the seller. Named neutrally: the new Act''s '
  'replacement for Form 16B is reported as Form 132 on a single secondary '
  'source only — see UNVERIFIED_CITATIONS in src/lib/tds/form141.ts.';

COMMENT ON COLUMN tds_property_documents.extraction_json IS
  'Agreement/Index-II extraction output: { fields, queries }, each field with '
  'value, confidence, page and source snippet. Never written straight to the '
  'transaction — a human confirms each figure through the same validation gate '
  'a hand-keyed value passes.';
