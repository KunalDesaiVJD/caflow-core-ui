-- Scrutiny Phase 2 (TDL logic inventory): the running-balance walk primitive, and the two rules it
-- unlocks — Cash Negative and Clause 31's "Max Outstanding" figure. Neither is expressible on
-- h_expr: an account-grain expr sees only the opening/closing snapshot, and an aggregate is a
-- groupby-reduce with no memory of chronological order, so neither can answer "did the balance ever
-- dip negative" or "what's the highest point this ledger reached at any moment during the year".
--
-- Both rules share one new check kind (check:"running_balance", added to detectionEngine.ts /
-- supabase/functions/_shared/detectionEngine.ts in the same commit) — a single date-ordered walk
-- per ledger, parameterised by which extremum to track:
--   mode:"min_negative" — cash-book integrity (a cash ledger should never legitimately go credit).
--   mode:"max_abs"      — the Form 3CD Clause 31 "Maximum amount outstanding" disclosure figure.

insert into scrutiny_rules
  (rule_id, rule_name, category, detection_level, detection_logic, threshold_type, threshold_value, audit_query_template, severity, legal_reference, is_active, applicable_to, root_cause)
values

  ('CASH-009', 'Cash Ledger Went Into Credit (Negative) Balance During the Year', 'CASH', 'account',
   '{"check":"running_balance","scope":{"parent_group_keywords":["cash"]},"sign":"dr_positive","mode":"min_negative","threshold":0,"message":"Cash ledger \"{account}\" shows a running balance that went into credit (₹{amount} negative) on {date} — a cash account cannot legitimately go negative. Investigate whether this reflects unrecorded receipts, entries posted out of sequence, or a genuine cash shortage."}'::jsonb,
   'absolute', 0,
   'Cash ledger "{account}" shows a running balance that went into credit (₹{amount} negative) on {date} — a cash account cannot legitimately go negative. Investigate whether this reflects unrecorded receipts, entries posted out of sequence, or a genuine cash shortage.',
   'high', NULL, true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 2 — Cash Negative report')

, ('LOAN-304', 'Loan/Deposit Ledger Reached a High Outstanding Balance During the Year', 'LOAN', 'account',
   '{"check":"running_balance","scope":{"parent_group_keywords":["loan"]},"sign":"cr_positive","mode":"max_abs","threshold":100000,"message":"Loan/deposit ledger \"{account}\" reached a peak outstanding balance of ₹{amount} on {date} during the year — this may be materially higher than the closing balance suggests. Confirm this figure is captured in the Form 3CD Clause 31 \"Maximum amount outstanding\" disclosure, regardless of how the account settled by year end."}'::jsonb,
   'absolute', 100000,
   'Loan/deposit ledger "{account}" reached a peak outstanding balance of ₹{amount} on {date} during the year — this may be materially higher than the closing balance suggests. Confirm this figure is captured in the Form 3CD Clause 31 "Maximum amount outstanding" disclosure, regardless of how the account settled by year end.',
   'medium', 'Section 269SS / 269T — Form 3CD Clause 31 disclosure', true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 2 — Loans 3CD Max Outstanding')

on conflict (rule_id) do update set
  rule_name = excluded.rule_name,
  category = excluded.category,
  detection_level = excluded.detection_level,
  detection_logic = excluded.detection_logic,
  threshold_type = excluded.threshold_type,
  threshold_value = excluded.threshold_value,
  audit_query_template = excluded.audit_query_template,
  severity = excluded.severity,
  legal_reference = excluded.legal_reference,
  is_active = true,
  applicable_to = excluded.applicable_to,
  root_cause = excluded.root_cause;
