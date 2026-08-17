-- ────────────────────────────────────────────────────────────────────────────
-- nce_capital_account — Fixed Capital / Current Capital split (LLP)
--
-- LLPs disclose Fixed Capital and Current Capital as two separate schedules
-- (LLP Act / ROC filings), unlike a general Partnership which tracks a single
-- capital movement per partner. Adds `capital_type` so both schedules can
-- coexist per partner under the same (engagement, financial_year, partner_no)
-- identity. Existing rows default to 'current' — before this migration every
-- balance (opening, introduced, remuneration, interest, withdrawals, profit
-- share) was tracked in one undifferentiated row, which is exactly what
-- "current capital" represents; no Fixed Capital rows existed prior to this.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE nce_capital_account
  ADD COLUMN IF NOT EXISTS capital_type TEXT NOT NULL DEFAULT 'current';

ALTER TABLE nce_capital_account
  DROP CONSTRAINT IF EXISTS nce_capital_account_capital_type_check;
ALTER TABLE nce_capital_account
  ADD CONSTRAINT nce_capital_account_capital_type_check
  CHECK (capital_type IN ('fixed', 'current'));

-- Replace the old (engagement, fy, partner_no) uniqueness with one that also
-- keys on capital_type, so a partner can carry one Fixed row and one Current
-- row without colliding.
DROP INDEX IF EXISTS idx_nce_cap_acct_partner;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nce_cap_acct_partner
  ON nce_capital_account (engagement_id, financial_year, partner_no, capital_type);

COMMENT ON COLUMN nce_capital_account.capital_type IS
  'LLP Capital Account split: ''fixed'' (Opening/Introduced/Withdrawals only) or ''current'' (full breakup incl. remuneration/interest/profit share). Non-LLP entities (Partnership/Proprietorship) only ever write ''current'' rows.';
