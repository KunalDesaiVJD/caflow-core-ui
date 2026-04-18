-- ────────────────────────────────────────────────────────────────────────────
-- Migration: NCE Stage 8 — Capital Account, Financial Notes, PPE Schedule
-- ────────────────────────────────────────────────────────────────────────────
-- Creates three tables used exclusively by Non-Corporate Entity (NCE)
-- engagements in Stage 8 (Notes to Accounts):
--
--   1. nce_capital_account  — Partner-wise capital account entries
--   2. nce_financial_notes  — All financial notes as flexible JSONB rows
--   3. nce_ppe_schedule     — PPE / depreciation schedule rows
--
-- All statements are idempotent (IF NOT EXISTS) — safe to re-run.
-- RLS is enabled on all three tables; the policy mirrors the pattern used
-- in stage7_ifc_data: allow ALL for users whose firm owns the engagement.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. nce_capital_account ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nce_capital_account (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       UUID        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  financial_year      TEXT        NOT NULL,
  partner_no          INTEGER     NOT NULL,          -- 1, 2, 3, 4 …
  partner_name        TEXT,
  profit_share_pct    NUMERIC,                       -- Share of profit/loss (%)
  opening_balance_cy  NUMERIC     DEFAULT 0,
  opening_balance_py  NUMERIC     DEFAULT 0,
  introduced_cy       NUMERIC     DEFAULT 0,         -- Capital introduced during year
  introduced_py       NUMERIC     DEFAULT 0,
  remuneration_cy     NUMERIC     DEFAULT 0,         -- Remuneration paid during year
  remuneration_py     NUMERIC     DEFAULT 0,
  interest_cy         NUMERIC     DEFAULT 0,         -- Interest on capital
  interest_py         NUMERIC     DEFAULT 0,
  withdrawals_cy      NUMERIC     DEFAULT 0,         -- Drawings / withdrawals
  withdrawals_py      NUMERIC     DEFAULT 0,
  profit_share_cy     NUMERIC     DEFAULT 0,         -- Allocated share of profit/loss
  profit_share_py     NUMERIC     DEFAULT 0,
  -- closing_balance is computed by the application:
  --   opening + introduced + remuneration + interest - withdrawals + profit_share
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- One row per (engagement, financial_year, partner) — prevents duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_nce_cap_acct_partner
  ON nce_capital_account (engagement_id, financial_year, partner_no);

COMMENT ON TABLE nce_capital_account IS
  'Partner-wise capital account schedule for NCE (non-corporate entity) engagements — Stage 8.';

ALTER TABLE nce_capital_account ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NCE capital account — firm members only" ON nce_capital_account;
CREATE POLICY "NCE capital account — firm members only"
  ON nce_capital_account
  FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON nce_capital_account TO anon, authenticated;


-- ── 2. nce_financial_notes ────────────────────────────────────────────────
-- Stores each financial note's CY and PY amounts as JSONB objects keyed by
-- row ID, allowing each note type to have its own row structure without
-- requiring separate columns per line item.
CREATE TABLE IF NOT EXISTS nce_financial_notes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  financial_year  TEXT        NOT NULL,
  note_type       TEXT        NOT NULL,
    -- Valid values (mirrors NCE Balance Sheet / P&L structure):
    --   'borrowings'       — Note 3: Long-term borrowings
    --   'other_lt_liab'    — Note 4: Other long-term liabilities
    --   'provisions'       — Note 5: Long-term provisions
    --   'trade_payables'   — Note 7: Trade payables
    --   'other_cl'         — Note 8: Other current liabilities
    --   'st_provisions'    — Note 9: Short-term provisions
    --   'cwip'             — Note 11: Capital work-in-progress
    --   'investments'      — Note 13: Non-current investments
    --   'loans_advances'   — Note 14: Long-term loans and advances
    --   'other_nc_assets'  — Note 15: Other non-current assets
    --   'inventories'      — Note 17: Inventories
    --   'trade_receivables'— Note 18: Trade receivables
    --   'cash_bank'        — Note 19: Cash and bank balances
    --   'other_ca'         — Note 21: Other current assets
    --   'revenue_ops'      — Note 22: Revenue from operations
    --   'other_income'     — Note 23: Other income
    --   'cogs'             — Note 24: Cost of goods sold
    --   'employee_exp'     — Note 25: Employee benefits expense
    --   'finance_costs'    — Note 26: Finance costs
    --   'other_expenses'   — Note 28: Other expenses
  cy_data         JSONB       NOT NULL DEFAULT '{}',   -- { row_id: amount, ... }
  py_data         JSONB       NOT NULL DEFAULT '{}',   -- { row_id: amount, ... }
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- One row per (engagement, financial_year, note_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nce_fin_notes
  ON nce_financial_notes (engagement_id, financial_year, note_type);

CREATE INDEX IF NOT EXISTS idx_nce_fin_notes_engagement
  ON nce_financial_notes (engagement_id);

COMMENT ON TABLE nce_financial_notes IS
  'Flexible JSONB store for all financial notes (borrowings, trade payables, cash & bank, etc.) for NCE engagements — Stage 8.';

ALTER TABLE nce_financial_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NCE financial notes — firm members only" ON nce_financial_notes;
CREATE POLICY "NCE financial notes — firm members only"
  ON nce_financial_notes
  FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON nce_financial_notes TO anon, authenticated;


-- ── 3. nce_ppe_schedule ───────────────────────────────────────────────────
-- One row per asset line in the PPE / depreciation schedule.
-- total and closing_balance are computed by the application:
--   total           = opening_balance + additions_pre + additions_post
--   closing_balance = total - depreciation
CREATE TABLE IF NOT EXISTS nce_ppe_schedule (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       UUID        NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  financial_year      TEXT        NOT NULL,
  asset_category      TEXT        NOT NULL CHECK (asset_category IN ('tangible', 'intangible')),
  asset_name          TEXT        NOT NULL,   -- e.g. 'Freehold Land', 'Buildings', 'Computers'
  rate_pct            NUMERIC,               -- Depreciation rate %
  opening_balance     NUMERIC     DEFAULT 0,
  additions_pre       NUMERIC     DEFAULT 0, -- Acquired on or before 29 Sep
  additions_post      NUMERIC     DEFAULT 0, -- Acquired after 29 Sep
  total               NUMERIC     DEFAULT 0, -- computed: opening + additions_pre + additions_post
  depreciation        NUMERIC     DEFAULT 0,
  closing_balance     NUMERIC     DEFAULT 0, -- computed: total - depreciation
  sort_order          INTEGER     DEFAULT 0,  -- display order within category
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nce_ppe_engagement
  ON nce_ppe_schedule (engagement_id, financial_year, asset_category);

COMMENT ON TABLE nce_ppe_schedule IS
  'PPE and intangible asset depreciation schedule rows for NCE engagements — Stage 8.';

ALTER TABLE nce_ppe_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NCE PPE schedule — firm members only" ON nce_ppe_schedule;
CREATE POLICY "NCE PPE schedule — firm members only"
  ON nce_ppe_schedule
  FOR ALL
  USING (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    engagement_id IN (
      SELECT ae.id FROM audit_engagements ae
      WHERE ae.firm_id IN (
        SELECT u.firm_id FROM users u WHERE u.id = auth.uid()
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON nce_ppe_schedule TO anon, authenticated;
