-- The debtor-side counterparts of the CRED-004 / BKR-DUP-01 fixes. Same investigation method:
-- read what each rule was actually flagging, rather than assume a threshold needed tuning.

-- DEBT-STREAMGAP-01 "Debtor with bank/cash receipts but no sales booked" (568, 16.2/engagement)
--
-- The exact mirror of the CRED-004 defect. It looked for a revenue leg matching only
-- "sales" / "income" / "revenue", so any debtor settled against a differently-named revenue head
-- was reported as having no sales booked at all.
--
-- Verified against the books: the flagged debtors DO carry revenue legs. Across a 400-finding
-- sample the counterparts were "software as a service/subscription" (258), "sale of service
-- (export)" (149) and "trademark status alert services" (86). Note the subtlety in the second —
-- the keyword was the PLURAL "sales", and matching is substring-based, so the singular "sale of
-- service" never matched. A service business could not satisfy this rule at all.
--
-- `missing` now spans the revenue side, singular and plural, so the rule fires only where a debtor
-- received money with no revenue of any kind booked against it.
update scrutiny_rules set detection_logic = detection_logic || jsonb_build_object(
  'missing', jsonb_build_array(
    'sales','sale','income','revenue','service','services','subscription','fees','fee',
    'commission','brokerage','consultancy','professional','job work','jobwork','contract',
    'rent','interest','export','freight','charges','turnover','receipt from'
  ))
where rule_id = 'DEBT-STREAMGAP-01';

-- DEBT-005 "Credit Balance in Debtor" (475, 15.8/engagement)
--
-- A different defect: the rule is CORRECT but had no notion of size and no notion of grain.
--
-- Its own template asks "Is this an advance received from the customer?", anticipating that the
-- answer is usually yes — and at a developer it always is. Every flat buyer legitimately carries a
-- credit balance until possession, so the rule produced one finding per buyer: SUKIRTI DEVELOPERS
-- 172, ACCURATE PMS 144, ACCUPANELS 65. That is one fact about the business ("we take customer
-- advances"), not 172 separate audit issues.
--
-- The real audit point is a PRESENTATION one — Schedule III requires credit balances in trade
-- receivables to be regrouped to liabilities — and that is naturally a single query per engagement
-- quoting the total, which is what the rollup now produces. h_sign_reversal also gained an opt-in
-- min_balance (default 0, so no other sign_reversal rule changes), scaled to materiality here.
update scrutiny_rules set
  detection_logic = detection_logic || '{"min_balance":100000,"materiality":{"min_balance":0.5},"rollup":{"metric":"total","min_count":2}}'::jsonb,
  audit_query_template = 'Trade receivables include {count} party balances standing on the credit side, totalling Rs.{amount} ({accounts}). Please confirm whether these are advances received from customers against orders or work not yet billed, excess receipts awaiting adjustment, or receipts posted to the wrong party. Credit balances cannot be presented net of trade receivables: Schedule III requires them to be regrouped to "Advances from Customers" under Other Current Liabilities, so the balance sheet does not understate both receivables and liabilities. Kindly furnish the party-wise breakup with the reason for each, and confirm whether GST has been discharged on any advance that represents consideration received before supply.'
where rule_id = 'DEBT-005';
