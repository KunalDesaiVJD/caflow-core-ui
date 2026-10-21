-- Step 1 of the precision programme: match output grain to the auditor's question.
--
-- An auditor raises ONE query per issue. Four rules emit one finding per day, per voucher or per
-- ledger, so a single behaviour became dozens of rows. Measured against live books these four
-- accounted for 3,282 of 17,626 findings (18.6% of the corpus) while describing far fewer actual
-- issues -- CASH-001 alone produced 2,115 findings across 39 engagements, 54 per engagement, and
-- not one of them ever matched a query a human auditor raised.
--
-- detection_logic.rollup collapses a rule's findings into one engagement-level summary that keeps
-- every fact (count, total, peak, date span, ledgers involved). It is opt-in, so nothing changes
-- for the checks that are already one-per-issue.

-- CASH-001: one finding per DAY the running cash balance sits above the limit.
-- 2,115 -> ~39 (one per affected engagement).
update scrutiny_rules set
  detection_logic = detection_logic || '{"rollup":{"metric":"peak","min_count":2}}'::jsonb,
  audit_query_template = 'The cash balance exceeded the Rs.2,00,000 ceiling on {count} separate days during the year, peaking at Rs.{amount}. Cash of this order held on hand is unusual for a business of this size and raises a question over whether the recorded balance physically existed at those dates. Please explain WHY such balances were carried, confirm whether cash was physically verified and counted at the year end, and provide the cash certificate. Where the balance arises because receipts were recorded but the corresponding bank deposit was not, correct the posting; where it reflects payments made but not yet recorded, book them. Also confirm no single cash payment breached section 40A(3) and no receipt breached section 269ST on those dates.'
where rule_id = 'CASH-001';

-- LOAN-003: one finding per repayment VOUCHER instead of one per loan account.
-- 841 -> ~25.
update scrutiny_rules set
  detection_logic = detection_logic || '{"rollup":{"metric":"total","min_count":2}}'::jsonb,
  audit_query_template = 'Repayments totalling Rs.{amount} were made across {count} vouchers against {accounts}, but no interest has been charged to the Profit & Loss account in respect of the borrowing. Please explain WHY -- is the loan genuinely interest-free, has interest been paid directly by a partner or director outside the books, or is the accrual simply pending? Furnish the loan agreement and the lender''s statement. An interest-free loan from a related party requires disclosure, and where the lender is a company the deemed-dividend implications under section 2(22)(e) need to be considered. If interest is payable but unbooked, provide for it before finalisation and confirm TDS under section 194A has been deducted.'
where rule_id = 'LOAN-003';

-- INV-005: one finding per goods-in-transit ledger. 236 -> ~40.
update scrutiny_rules set
  detection_logic = detection_logic || '{"rollup":{"metric":"total","min_count":2}}'::jsonb,
  audit_query_template = 'Goods in transit of Rs.{amount} are carried across {count} ledgers ({accounts}) at the year end. Please confirm WHY these consignments remained in transit at 31 March and furnish the supporting invoices and dispatch documents. Confirm that title had passed to the company at the balance-sheet date, that the corresponding liability to the supplier is recorded in the same year, and that the goods were not also counted in the physical stock -- a double count would overstate both inventory and creditors.'
where rule_id = 'INV-005';

-- LOAN-007: one finding per employee-loan ledger; a single client with 90 staff advances produced
-- 90 findings. 90 -> ~2.
update scrutiny_rules set
  detection_logic = detection_logic || '{"rollup":{"metric":"total","min_count":2}}'::jsonb,
  audit_query_template = 'Employee and staff advances totalling Rs.{amount} are outstanding across {count} ledgers ({accounts}) with no recovery recorded during the year. Please explain WHY no deduction has been made against salary and confirm the recovery terms for each advance. Where an advance is no longer recoverable it should be written off; where it has effectively become a perquisite it is taxable in the employee''s hands and attracts deduction under section 192. Confirm whether any of these balances relate to persons who have since left the organisation.'
where rule_id = 'LOAN-007';
