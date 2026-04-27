-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 7 — Ratios tab  (UI-8)
-- Adds a single JSONB column to audit_engagements that stores:
--   cy / py  : raw input fields for all 11 ratios (22 fields each)
--   commentary : per-ratio analyst text (ratioId 1-11)
--   manual_overrides : list of field paths the user has explicitly set,
--                      so the auto-link from BS/PL skips those fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_engagements
  ADD COLUMN IF NOT EXISTS stage7_ratios jsonb DEFAULT '{
    "cy": {
      "current_assets":          null,
      "current_liabilities":     null,
      "total_debt":              null,
      "shareholders_equity":     null,
      "npat":                    null,
      "non_cash_op_exp":         null,
      "interest":                null,
      "other_non_cash_adj":      null,
      "interest_lease":          null,
      "principal_repayments":    null,
      "avg_shareholders_equity": null,
      "revenue_ops":             null,
      "avg_inventories":         null,
      "avg_trade_receivables":   null,
      "net_credit_purchases":    null,
      "avg_trade_payables":      null,
      "working_capital":         null,
      "npbt":                    null,
      "net_worth":               null,
      "lt_borrowings":           null,
      "return_profit":           null,
      "avg_investment_fund":     null
    },
    "py": {
      "current_assets":          null,
      "current_liabilities":     null,
      "total_debt":              null,
      "shareholders_equity":     null,
      "npat":                    null,
      "non_cash_op_exp":         null,
      "interest":                null,
      "other_non_cash_adj":      null,
      "interest_lease":          null,
      "principal_repayments":    null,
      "avg_shareholders_equity": null,
      "revenue_ops":             null,
      "avg_inventories":         null,
      "avg_trade_receivables":   null,
      "net_credit_purchases":    null,
      "avg_trade_payables":      null,
      "working_capital":         null,
      "npbt":                    null,
      "net_worth":               null,
      "lt_borrowings":           null,
      "return_profit":           null,
      "avg_investment_fund":     null
    },
    "commentary": [
      {"ratioId": 1,  "text": ""},
      {"ratioId": 2,  "text": ""},
      {"ratioId": 3,  "text": ""},
      {"ratioId": 4,  "text": ""},
      {"ratioId": 5,  "text": ""},
      {"ratioId": 6,  "text": ""},
      {"ratioId": 7,  "text": ""},
      {"ratioId": 8,  "text": ""},
      {"ratioId": 9,  "text": ""},
      {"ratioId": 10, "text": ""},
      {"ratioId": 11, "text": ""}
    ],
    "manual_overrides": []
  }'::jsonb;

-- Ensure existing rows without the column get the default initialised
-- (ADD COLUMN DEFAULT handles this automatically in Postgres 11+, but
--  the explicit UPDATE below is a belt-and-suspenders guard for any rows
--  that may have been inserted with a NULL default from an earlier
--  partial migration run.)
UPDATE audit_engagements
SET stage7_ratios = '{
    "cy": {
      "current_assets":          null,
      "current_liabilities":     null,
      "total_debt":              null,
      "shareholders_equity":     null,
      "npat":                    null,
      "non_cash_op_exp":         null,
      "interest":                null,
      "other_non_cash_adj":      null,
      "interest_lease":          null,
      "principal_repayments":    null,
      "avg_shareholders_equity": null,
      "revenue_ops":             null,
      "avg_inventories":         null,
      "avg_trade_receivables":   null,
      "net_credit_purchases":    null,
      "avg_trade_payables":      null,
      "working_capital":         null,
      "npbt":                    null,
      "net_worth":               null,
      "lt_borrowings":           null,
      "return_profit":           null,
      "avg_investment_fund":     null
    },
    "py": {
      "current_assets":          null,
      "current_liabilities":     null,
      "total_debt":              null,
      "shareholders_equity":     null,
      "npat":                    null,
      "non_cash_op_exp":         null,
      "interest":                null,
      "other_non_cash_adj":      null,
      "interest_lease":          null,
      "principal_repayments":    null,
      "avg_shareholders_equity": null,
      "revenue_ops":             null,
      "avg_inventories":         null,
      "avg_trade_receivables":   null,
      "net_credit_purchases":    null,
      "avg_trade_payables":      null,
      "working_capital":         null,
      "npbt":                    null,
      "net_worth":               null,
      "lt_borrowings":           null,
      "return_profit":           null,
      "avg_investment_fund":     null
    },
    "commentary": [
      {"ratioId": 1,  "text": ""},
      {"ratioId": 2,  "text": ""},
      {"ratioId": 3,  "text": ""},
      {"ratioId": 4,  "text": ""},
      {"ratioId": 5,  "text": ""},
      {"ratioId": 6,  "text": ""},
      {"ratioId": 7,  "text": ""},
      {"ratioId": 8,  "text": ""},
      {"ratioId": 9,  "text": ""},
      {"ratioId": 10, "text": ""},
      {"ratioId": 11, "text": ""}
    ],
    "manual_overrides": []
  }'::jsonb
WHERE stage7_ratios IS NULL;
