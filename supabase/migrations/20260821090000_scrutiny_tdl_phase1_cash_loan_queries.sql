-- Scrutiny Phase 1 (from the "Tally Scrutiny by KTS & Co." TDL logic inventory): cash-law and
-- creditor/debtor-query rules expressible entirely as detection_logic on the existing engine, plus
-- two fixes to rules already seeded on 2026-03-11.
--
-- Checked first against every existing CASH-*/LOAN-*/CRED-*/DEBT-*/BKR-* rule (grep across the
-- migrations) to avoid seeding a duplicate of something already covered, or fighting a rule the
-- 2026-07-21 noise-reduction pass already tuned:
--   - CRED-001 already flags "Creditor with a debit balance" (sign_reversal) — this is the TDL's
--     Creditor Query #2/#3. Not re-added.
--   - DEBT-005 already flags "Credit balance in debtor" (sign_reversal, precision-tuned 2026-07-21)
--     — the TDL's Debtor Query #2. Not re-added.
--   - No existing rule tests "no debit/credit activity all year despite carrying a balance" (TDL
--     Query #1 on both sides), "no payment all year — ITC reversal risk" (Creditor Query #4), "no
--     receipts all year" (Debtor Query #3), a small-balance write-off candidate, cash-mode loan
--     acceptance/repayment (Sec 269SS/269T), a loan squared up within the year, or the party+day
--     cash-receipt aggregate (Sec 269ST) — these are the genuinely new rules below.
--
-- Explicitly OUT of scope for this pass: GST Compliance (>20L, no GSTIN) and Clause 44 (GST
-- expenditure breakup) from the same TDL. Neither tally_ledgers nor tally_trial_balance captures a
-- per-party GSTIN anywhere in this schema today — the Tally Sync connector would need extending to
-- pull and store it before either rule could do anything but match nothing. Not seeded rather than
-- seeded-and-silently-inert.

-- ── Fix CASH-002: wrong threshold, and no exclusion for cash-deposit/withdrawal CONTRA legs ──
--
-- Section 40A(3) was reduced to ₹10,000 by the Finance Act 2017 (from the pre-amendment ₹20,000) —
-- this rule was seeded with the stale pre-2017 figure. Also switched from "single_txn" to "expr" so
-- it can use the new scope.exclude_leg_group_keywords (this migration's detectionEngine.ts change):
-- without it, a cash withdrawal/deposit CONTRA voucher (which also touches a Bank leg) is
-- indistinguishable from a pure cash expense payment and gets misflagged.
update scrutiny_rules set
  rule_name = 'Single Cash Payment > ₹10,000',
  root_cause = 'Cash payment > ₹10K — Section 40A(3)',
  threshold_value = 10000,
  audit_query_template = 'Cash payment of ₹{amount} on {date} to "{account}" exceeds the Section 40A(3) limit of ₹10,000 — confirm the Rule 6DD exception relied on, or that this was in fact paid by account-payee cheque/DD/ECS.',
  detection_logic = '{"check":"expr","grain":"voucher","scope":{"cash_only":true,"side":"Dr","exclude_leg_group_keywords":["bank"]},"where":[{"field":"abs_amount","op":">","value":10000}],"message":"Cash payment of ₹{amount} on {date} to \"{account}\" exceeds the Section 40A(3) limit of ₹10,000 — confirm the Rule 6DD exception relied on, or that this was in fact paid by account-payee cheque/DD/ECS."}'::jsonb
where rule_id = 'CASH-002';

-- ── Fix CASH-003: same CONTRA-exclusion gap, threshold itself was already correct ──
update scrutiny_rules set
  audit_query_template = 'Cash receipt of ₹{amount} on {date} from "{account}" exceeds the Section 269ST limit of ₹2,00,000 — confirm this was not received in cash, or that an exception applies.',
  detection_logic = '{"check":"expr","grain":"voucher","scope":{"cash_only":true,"side":"Cr","exclude_leg_group_keywords":["bank"]},"where":[{"field":"abs_amount","op":">","value":200000}],"message":"Cash receipt of ₹{amount} on {date} from \"{account}\" exceeds the Section 269ST limit of ₹2,00,000 — confirm this was not received in cash, or that an exception applies."}'::jsonb
where rule_id = 'CASH-003';

insert into scrutiny_rules
  (rule_id, rule_name, category, detection_level, detection_logic, threshold_type, threshold_value, audit_query_template, severity, legal_reference, is_active, applicable_to, root_cause)
values

  -- Sec 269ST tested per party PER DAY (aggregate across every cash receipt that day), distinct
  -- from CASH-003's per-voucher test — a party paying ₹1.5L in the morning and ₹1L in the evening
  -- breaches the daily aggregate limit even though neither single voucher does.
  ('CASH-008', 'Cash Receipts From One Party Exceeding ₹2L in a Day', 'CASH', 'voucher',
   '{"check":"expr","grain":"voucher","scope":{"cash_only":true,"side":"Cr","exclude_leg_group_keywords":["bank"]},"aggregate":{"by":["party","day"],"fn":"sum","field":"abs_amount","having":{"op":">","value":200000}},"message":"Cash receipts from \"{account}\" on {date} totalled ₹{amount} in a single day — Section 269ST limits cash receipt from one person to ₹2,00,000 per day. Confirm this was not accepted in cash, or that an exception applies."}'::jsonb,
   'absolute', 200000,
   'Cash receipts from "{account}" on {date} totalled ₹{amount} in a single day — Section 269ST limits cash receipt from one person to ₹2,00,000 per day. Confirm this was not accepted in cash, or that an exception applies.',
   'high', 'Section 269ST', true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Loans 3CD Part C / general 269ST, aggregated per party per day')

  -- Cash-mode acceptance of a loan/deposit. party_ledger on a loan voucher is the lender's own
  -- ledger (a Loans group member); match_legs+ledger_keywords picks up the Cash-in-Hand leg the
  -- cash_only shortcut can't see here, since the primary ledger on the row is the loan account,
  -- not the cash ledger. side:"Cr" on that leg = the loan liability increasing = money accepted.
, ('LOAN-301', 'Loan/Deposit Accepted in Cash — Section 269SS Risk', 'LOAN', 'voucher',
   '{"check":"expr","grain":"voucher","scope":{"parent_group_keywords":["loan"],"match_legs":true,"ledger_keywords":["cash-in-hand"],"side":"Cr"},"aggregate":{"by":["ledger"],"fn":"sum","field":"abs_amount","having":{"op":">=","value":20000}},"message":"Loan/deposit totalling ₹{amount} was accepted in cash from \"{account}\" during the year — Section 269SS disallows cash acceptance of a loan, deposit or specified sum of ₹20,000 or more otherwise than by account-payee cheque, draft or ECS. Confirm the mode of receipt and the exposure under Section 271D."}'::jsonb,
   'absolute', 20000,
   'Loan/deposit totalling ₹{amount} was accepted in cash from "{account}" during the year — Section 269SS disallows cash acceptance of a loan, deposit or specified sum of ₹20,000 or more otherwise than by account-payee cheque, draft or ECS. Confirm the mode of receipt and the exposure under Section 271D.',
   'high', 'Section 269SS', true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Loans 3CD Part A')

  -- Mirror of LOAN-301 for repayment: side:"Dr" on the loan-account leg = the liability decreasing
  -- = money repaid.
, ('LOAN-302', 'Loan/Deposit Repaid in Cash — Section 269T Risk', 'LOAN', 'voucher',
   '{"check":"expr","grain":"voucher","scope":{"parent_group_keywords":["loan"],"match_legs":true,"ledger_keywords":["cash-in-hand"],"side":"Dr"},"aggregate":{"by":["ledger"],"fn":"sum","field":"abs_amount","having":{"op":">=","value":20000}},"message":"Loan/deposit repayments totalling ₹{amount} were made in cash to \"{account}\" during the year — Section 269T disallows repayment of a loan, deposit or specified advance of ₹20,000 or more otherwise than by account-payee cheque, draft or ECS. Confirm the mode of repayment and the exposure under Section 271E."}'::jsonb,
   'absolute', 20000,
   'Loan/deposit repayments totalling ₹{amount} were made in cash to "{account}" during the year — Section 269T disallows repayment of a loan, deposit or specified advance of ₹20,000 or more otherwise than by account-payee cheque, draft or ECS. Confirm the mode of repayment and the exposure under Section 271E.',
   'high', 'Section 269T', true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Loans 3CD Part B')

  -- "Squared up" — accepted and fully repaid within the same year, nil closing. Worth its own
  -- query even with a clean closing balance, per the TDL's own note: this specific pattern is what
  -- Sec 269SS/269T enforcement actually targets. amount_field:"opening" — closing is 0 by
  -- definition of the match, so the finding needs the opening figure instead.
, ('LOAN-303', 'Loan/Deposit Ledger Fully Squared Up During the Year', 'LOAN', 'account',
   '{"check":"expr","grain":"account","scope":{"parent_group_keywords":["loan"]},"where":[{"field":"opening","op":">","value":0},{"field":"closing","op":"==","value":0}],"amount_field":"opening","message":"Loan/deposit ledger \"{account}\" (opening balance ₹{amount}) was accepted and fully repaid within the year — nil closing balance. Confirm the mode of both the original acceptance and the repayment for Section 269SS/269T compliance; a loan squared up within the year is not exempt from either section."}'::jsonb,
   'absolute', NULL,
   'Loan/deposit ledger "{account}" (opening balance ₹{amount}) was accepted and fully repaid within the year — nil closing balance. Confirm the mode of both the original acceptance and the repayment for Section 269SS/269T compliance; a loan squared up within the year is not exempt from either section.',
   'medium', 'Section 269SS / 269T', true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Loans 3CD Part A "Squared Up" flag')

  -- Write-off candidate: a nonzero balance small enough that it is more likely a rounding
  -- difference than a real receivable/payable. ₹1,000 default, same shape as the TDL's own
  -- user-configurable tolerance (it defaulted to ₹100); editable per firm via the rule master panel.
, ('BKR-008', 'Small Balance — Possible Write-Off Candidate', 'BKR', 'account',
   '{"check":"expr","grain":"account","scope":{"parent_group_keywords":["creditor","debtor","payable","receivable"]},"where":[{"field":"abs_closing","op":"!=","value":0},{"field":"abs_closing","op":"<","value":1000}]}'::jsonb,
   'absolute', 1000,
   'Ledger "{account}" carries a small balance of ₹{amount}, below the ₹1,000 write-off tolerance. Confirm whether this is a rounding/kasar difference or an old balance that should be written off, and record the reason.',
   'low', NULL, true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Write Off Report')

  -- Creditor Query #1 / Debtor Query #1: a balance carried forward with literally zero activity —
  -- neither debited nor credited all year.
, ('CRED-008', 'Creditor Balance Carried Forward With Zero Activity', 'CRED', 'account',
   '{"check":"expr","grain":"account","scope":{"parent_group_keywords":["creditor"],"nonzero":true},"where":[{"field":"opening","op":"!=","value":0},{"field":"debit_amount","op":"==","value":0},{"field":"credit_amount","op":"==","value":0}]}'::jsonb,
   'absolute', NULL,
   'Creditor "{account}" carried forward an opening balance of ₹{amount} with zero debit or credit activity all year — why was there no transaction on this account? Confirm the balance is still valid and outstanding.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Creditor Query #1')

, ('DEBT-008', 'Debtor Balance Carried Forward With Zero Activity', 'DEBT', 'account',
   '{"check":"expr","grain":"account","scope":{"parent_group_keywords":["debtor"],"nonzero":true},"where":[{"field":"opening","op":"!=","value":0},{"field":"debit_amount","op":"==","value":0},{"field":"credit_amount","op":"==","value":0}]}'::jsonb,
   'absolute', NULL,
   'Debtor "{account}" carried forward an opening balance of ₹{amount} with zero debit or credit activity all year — why was there no transaction on this account?',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Debtor Query #1')

  -- Creditor Query #4: outstanding all year, zero payment activity, credits kept accruing —
  -- GST 180-day ITC reversal risk on the underlying purchases.
, ('CRED-009', 'Creditor Outstanding All Year, No Payments — Possible ITC Reversal Risk', 'CRED', 'account',
   '{"check":"expr","grain":"account","scope":{"parent_group_keywords":["creditor"]},"where":[{"field":"opening_type","op":"==","value":"Cr"},{"field":"opening","op":">","value":0},{"field":"debit_amount","op":"==","value":0},{"field":"credit_amount","op":">","value":0}]}'::jsonb,
   'absolute', NULL,
   'Creditor "{account}" (₹{amount} closing) has had zero debit/payment activity all year while credits kept accruing on an already-outstanding balance. If GST input tax credit was claimed on the underlying purchases, confirm it has not been reversed under the 180-day non-payment rule.',
   'medium', 'CGST Rule 37 (180-day ITC reversal)', true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Creditor Query #4')

  -- Debtor Query #3: sales/debits kept accruing, zero receipts posted — collectability/provisioning
  -- question.
, ('DEBT-009', 'Debtor With No Receipts All Year Despite Continuing Sales', 'DEBT', 'account',
   '{"check":"expr","grain":"account","scope":{"parent_group_keywords":["debtor"]},"where":[{"field":"opening_type","op":"==","value":"Dr"},{"field":"opening","op":">","value":0},{"field":"debit_amount","op":">","value":0},{"field":"credit_amount","op":"==","value":0}]}'::jsonb,
   'absolute', NULL,
   'Debtor "{account}" (₹{amount} closing) kept accruing debit/sales entries all year with zero receipts posted against it. Confirm collectability and whether this balance needs a provision for doubtful debts.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb,
   'TDL logic inventory Phase 1 — Debtor Query #3')

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
