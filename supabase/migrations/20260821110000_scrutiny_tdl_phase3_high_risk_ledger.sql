-- Scrutiny Phase 3 (TDL logic inventory): High-Risk Ledger Analysis, HR-01 through HR-18.
--
-- Detects a Creditor/Debtor/Loan-type ledger with a cash-only routing shape — payments only,
-- receipts only, or a pay+receipt mix — and ZERO real underlying business activity (no Sales,
-- Purchase, Debit/Credit Note; Journal doesn't count as "real" either, so an interest/accrual
-- journal on a loan doesn't mask the pattern). That shape is the signature of an undisclosed loan,
-- a benami transaction, or a FEMA/Income-Tax-Act violation dressed up as a trade balance.
--
-- All 18 rules share the new check:"high_risk_ledger" handler (detectionEngine.ts / synced to
-- supabase/functions/_shared/detectionEngine.ts, unit-tested — pattern matching, both suppression
-- rules, the generic-catch-all group exclusion, and the exclude_keywords list are each covered by
-- a dedicated test). One rule row per (ledger-group × activity-pattern) combination:
--
-- | Rules       | Group                              | Patterns (pay-only / receipt-only / mix) |
-- |-------------|-------------------------------------|-------------------------------------------|
-- | HR-01/02/03 | Sundry Creditors                    | pay / receipt / mix                      |
-- | HR-04/05/06 | Sundry Debtors                      | receipt / pay / mix                      |
-- | HR-07/08/09 | Loans & Advances (Asset)             | pay / receipt / mix                      |
-- | HR-10/11/12 | Unsecured Loans                      | receipt / pay / mix                      |
-- | HR-13/14/15 | Secured Loans                        | receipt / pay / mix                      |
-- | HR-16/17/18 | Loans (Liability), any OTHER subgroup| receipt / pay / mix                      |
--
-- HR-16/17/18 use exclude_group_keywords to fall back to "any Loans(Liability) subgroup not
-- already covered by HR-10..15" (e.g. "Bank OD A/c") without re-flagging Unsecured/Secured Loans.
-- is_loan:true (HR-07 through HR-18) turns OFF the vendor-journal suppression that applies to
-- HR-01..06 — an interest journal on a loan is not "expense booked via journal, then paid".

insert into scrutiny_rules
  (rule_id, rule_name, category, detection_level, detection_logic, threshold_type, threshold_value, audit_query_template, severity, legal_reference, is_active, applicable_to, root_cause)
values

-- ── Sundry Creditors (HR-01/02/03) ──────────────────────────────────────────────────────────────
  ('HR-01', 'High-Risk Ledger: Creditor With Payments Only', 'CRED', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["creditor"]},"pattern":"only_pay","is_loan":false,"message":"Creditor \"{account}\" (₹{amount} closing) shows payments only — no purchase, credit note, or journal entry of any kind against it. Confirm this is a genuine settlement of an existing liability and not an undisclosed loan or advance disguised as a trade balance."}'::jsonb,
   'absolute', NULL,
   'Creditor "{account}" (₹{amount} closing) shows payments only — no purchase, credit note, or journal entry of any kind against it. Confirm this is a genuine settlement of an existing liability and not an undisclosed loan or advance disguised as a trade balance.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-02', 'High-Risk Ledger: Creditor With Receipts Only', 'CRED', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["creditor"]},"pattern":"only_receipt","is_loan":false,"message":"Creditor \"{account}\" (₹{amount} closing) shows receipts only — money coming IN on what is supposed to be a payable account, with no purchase or credit note behind it. Confirm the nature of these receipts."}'::jsonb,
   'absolute', NULL,
   'Creditor "{account}" (₹{amount} closing) shows receipts only — money coming IN on what is supposed to be a payable account, with no purchase or credit note behind it. Confirm the nature of these receipts.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-03', 'High-Risk Ledger: Creditor With Cash Routed Both Ways', 'CRED', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["creditor"]},"pattern":"mix","is_loan":false,"message":"Creditor \"{account}\" (₹{amount} closing) shows cash routed both in and out with no purchase, credit note, or journal entry behind any of it. Confirm the business purpose of these transactions."}'::jsonb,
   'absolute', NULL,
   'Creditor "{account}" (₹{amount} closing) shows cash routed both in and out with no purchase, credit note, or journal entry behind any of it. Confirm the business purpose of these transactions.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

-- ── Sundry Debtors (HR-04/05/06) ────────────────────────────────────────────────────────────────
, ('HR-04', 'High-Risk Ledger: Debtor With Receipts Only', 'DEBT', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["debtor"]},"pattern":"only_receipt","is_loan":false,"message":"Debtor \"{account}\" (₹{amount} closing) shows receipts only, with no sales entry behind them. Confirm the source of these receipts."}'::jsonb,
   'absolute', NULL,
   'Debtor "{account}" (₹{amount} closing) shows receipts only, with no sales entry behind them. Confirm the source of these receipts.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-05', 'High-Risk Ledger: Debtor With Payments Only', 'DEBT', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["debtor"]},"pattern":"only_pay","is_loan":false,"message":"Debtor \"{account}\" (₹{amount} closing) shows payments only — money going OUT on what is supposed to be a receivable account, with no sales entry behind it. Confirm the nature of these payments."}'::jsonb,
   'absolute', NULL,
   'Debtor "{account}" (₹{amount} closing) shows payments only — money going OUT on what is supposed to be a receivable account, with no sales entry behind it. Confirm the nature of these payments.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-06', 'High-Risk Ledger: Debtor With Cash Routed Both Ways', 'DEBT', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["debtor"]},"pattern":"mix","is_loan":false,"message":"Debtor \"{account}\" (₹{amount} closing) shows cash routed both in and out with no sale or journal entry behind any of it. Confirm the business purpose of these transactions."}'::jsonb,
   'absolute', NULL,
   'Debtor "{account}" (₹{amount} closing) shows cash routed both in and out with no sale or journal entry behind any of it. Confirm the business purpose of these transactions.',
   'medium', NULL, true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

-- ── Loans & Advances (Asset) (HR-07/08/09) ──────────────────────────────────────────────────────
, ('HR-07', 'High-Risk Ledger: Loan/Advance Disbursed With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["loans & advances","loans and advances"]},"pattern":"only_pay","is_loan":true,"message":"Loan/advance \"{account}\" (₹{amount} closing) was disbursed with no journal documentation of the loan. Confirm this is a genuine, approved loan/advance and not an undisclosed related-party transaction — possible FEMA/Income-Tax Act exposure if unrecorded."}'::jsonb,
   'absolute', NULL,
   'Loan/advance "{account}" (₹{amount} closing) was disbursed with no journal documentation of the loan. Confirm this is a genuine, approved loan/advance and not an undisclosed related-party transaction — possible FEMA/Income-Tax Act exposure if unrecorded.',
   'high', 'Possible FEMA / Income-Tax Act violation', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-08', 'High-Risk Ledger: Loan/Advance Recovered With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["loans & advances","loans and advances"]},"pattern":"only_receipt","is_loan":true,"message":"Loan/advance \"{account}\" (₹{amount} closing) was recovered with no journal documentation of the original disbursement. Confirm the loan/advance was properly booked and approved."}'::jsonb,
   'absolute', NULL,
   'Loan/advance "{account}" (₹{amount} closing) was recovered with no journal documentation of the original disbursement. Confirm the loan/advance was properly booked and approved.',
   'high', 'Possible FEMA / Income-Tax Act violation', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-09', 'High-Risk Ledger: Loan/Advance With Cash Routed Both Ways', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["loans & advances","loans and advances"]},"pattern":"mix","is_loan":true,"message":"Loan/advance \"{account}\" (₹{amount} closing) shows pure cash routing with no journal documentation on either side. Confirm this is a genuine, documented loan/advance — possible FEMA/Income-Tax Act exposure if unrecorded."}'::jsonb,
   'absolute', NULL,
   'Loan/advance "{account}" (₹{amount} closing) shows pure cash routing with no journal documentation on either side. Confirm this is a genuine, documented loan/advance — possible FEMA/Income-Tax Act exposure if unrecorded.',
   'high', 'Possible FEMA / Income-Tax Act violation', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

-- ── Unsecured Loans (HR-10/11/12) ───────────────────────────────────────────────────────────────
, ('HR-10', 'High-Risk Ledger: Unsecured Loan Borrowed With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["unsecured loan"]},"pattern":"only_receipt","is_loan":true,"message":"Unsecured loan \"{account}\" (₹{amount} closing) shows the loan being borrowed with no journal/documentation entry. Confirm a loan agreement exists and Section 269SS mode-of-receipt compliance."}'::jsonb,
   'absolute', NULL,
   'Unsecured loan "{account}" (₹{amount} closing) shows the loan being borrowed with no journal/documentation entry. Confirm a loan agreement exists and Section 269SS mode-of-receipt compliance.',
   'high', 'Section 269SS', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-11', 'High-Risk Ledger: Unsecured Loan Repaid With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["unsecured loan"]},"pattern":"only_pay","is_loan":true,"message":"Unsecured loan \"{account}\" (₹{amount} closing) shows the loan being repaid with no journal/documentation entry. Confirm Section 269T mode-of-repayment compliance."}'::jsonb,
   'absolute', NULL,
   'Unsecured loan "{account}" (₹{amount} closing) shows the loan being repaid with no journal/documentation entry. Confirm Section 269T mode-of-repayment compliance.',
   'high', 'Section 269T', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-12', 'High-Risk Ledger: Unsecured Loan With Cash Routed Both Ways', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["unsecured loan"]},"pattern":"mix","is_loan":true,"message":"Unsecured loan \"{account}\" (₹{amount} closing) shows cash routed both ways with no documentation. Confirm a loan agreement exists and Section 269SS/269T mode-of-receipt/repayment compliance."}'::jsonb,
   'absolute', NULL,
   'Unsecured loan "{account}" (₹{amount} closing) shows cash routed both ways with no documentation. Confirm a loan agreement exists and Section 269SS/269T mode-of-receipt/repayment compliance.',
   'high', 'Section 269SS / 269T', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

-- ── Secured Loans (HR-13/14/15) ─────────────────────────────────────────────────────────────────
, ('HR-13', 'High-Risk Ledger: Secured Loan Borrowed With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["secured loan"]},"pattern":"only_receipt","is_loan":true,"message":"Secured loan \"{account}\" (₹{amount} closing) shows the loan being borrowed with no journal/documentation entry. Confirm a loan agreement exists and Section 269SS mode-of-receipt compliance."}'::jsonb,
   'absolute', NULL,
   'Secured loan "{account}" (₹{amount} closing) shows the loan being borrowed with no journal/documentation entry. Confirm a loan agreement exists and Section 269SS mode-of-receipt compliance.',
   'high', 'Section 269SS', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-14', 'High-Risk Ledger: Secured Loan Repaid With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["secured loan"]},"pattern":"only_pay","is_loan":true,"message":"Secured loan \"{account}\" (₹{amount} closing) shows the loan being repaid with no journal/documentation entry. Confirm Section 269T mode-of-repayment compliance."}'::jsonb,
   'absolute', NULL,
   'Secured loan "{account}" (₹{amount} closing) shows the loan being repaid with no journal/documentation entry. Confirm Section 269T mode-of-repayment compliance.',
   'high', 'Section 269T', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-15', 'High-Risk Ledger: Secured Loan With Cash Routed Both Ways', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["secured loan"]},"pattern":"mix","is_loan":true,"message":"Secured loan \"{account}\" (₹{amount} closing) shows cash routed both ways with no documentation. Confirm a loan agreement exists and Section 269SS/269T mode-of-receipt/repayment compliance."}'::jsonb,
   'absolute', NULL,
   'Secured loan "{account}" (₹{amount} closing) shows cash routed both ways with no documentation. Confirm a loan agreement exists and Section 269SS/269T mode-of-receipt/repayment compliance.',
   'high', 'Section 269SS / 269T', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

-- ── Loans (Liability), any other custom sub-group e.g. Bank OD A/c (HR-16/17/18) ───────────────────
, ('HR-16', 'High-Risk Ledger: Other Loan Liability Borrowed With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["loan"]},"exclude_group_keywords":["secured loan","unsecured loan","loans & advances","loans and advances"],"pattern":"only_receipt","is_loan":true,"message":"Loan-liability account \"{account}\" (₹{amount} closing) shows the loan being borrowed with no journal/documentation entry. Confirm a loan agreement exists and Section 269SS mode-of-receipt compliance."}'::jsonb,
   'absolute', NULL,
   'Loan-liability account "{account}" (₹{amount} closing) shows the loan being borrowed with no journal/documentation entry. Confirm a loan agreement exists and Section 269SS mode-of-receipt compliance.',
   'high', 'Section 269SS', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-17', 'High-Risk Ledger: Other Loan Liability Repaid With No Documentation', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["loan"]},"exclude_group_keywords":["secured loan","unsecured loan","loans & advances","loans and advances"],"pattern":"only_pay","is_loan":true,"message":"Loan-liability account \"{account}\" (₹{amount} closing) shows the loan being repaid with no journal/documentation entry. Confirm Section 269T mode-of-repayment compliance."}'::jsonb,
   'absolute', NULL,
   'Loan-liability account "{account}" (₹{amount} closing) shows the loan being repaid with no journal/documentation entry. Confirm Section 269T mode-of-repayment compliance.',
   'high', 'Section 269T', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

, ('HR-18', 'High-Risk Ledger: Other Loan Liability With Cash Routed Both Ways', 'LOAN', 'account',
   '{"check":"high_risk_ledger","scope":{"parent_group_keywords":["loan"]},"exclude_group_keywords":["secured loan","unsecured loan","loans & advances","loans and advances"],"pattern":"mix","is_loan":true,"message":"Loan-liability account \"{account}\" (₹{amount} closing) shows cash routed both ways with no documentation. Confirm a loan agreement exists and Section 269SS/269T mode-of-receipt/repayment compliance."}'::jsonb,
   'absolute', NULL,
   'Loan-liability account "{account}" (₹{amount} closing) shows cash routed both ways with no documentation. Confirm a loan agreement exists and Section 269SS/269T mode-of-receipt/repayment compliance.',
   'high', 'Section 269SS / 269T', true, '["corporate","non_corporate"]'::jsonb, 'TDL logic inventory Phase 3 — High Risk Ledger Analysis')

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
