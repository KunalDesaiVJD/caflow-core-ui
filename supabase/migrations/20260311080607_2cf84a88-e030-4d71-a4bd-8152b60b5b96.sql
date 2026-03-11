
-- Fix: use IF NOT EXISTS for tables that may already exist

ALTER TABLE public.audit_engagements 
  ADD COLUMN IF NOT EXISTS re_evaluate_scrutiny boolean DEFAULT false;

-- scrutiny_rules
CREATE TABLE IF NOT EXISTS public.scrutiny_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id varchar NOT NULL UNIQUE,
  rule_name text NOT NULL,
  category text NOT NULL,
  detection_level text NOT NULL DEFAULT 'voucher',
  root_cause text,
  detection_logic jsonb DEFAULT '{}'::jsonb,
  threshold_type text NOT NULL DEFAULT 'absolute',
  threshold_value decimal,
  audit_query_template text,
  severity text NOT NULL DEFAULT 'medium',
  applicable_to jsonb DEFAULT '["company","llp","individual","firm","trust","huf","aop"]'::jsonb,
  legal_reference text,
  prior_year_needed boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  updated_at timestamp with time zone DEFAULT now(),
  rules_version timestamp with time zone DEFAULT now()
);

ALTER TABLE public.scrutiny_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_rules' AND policyname = 'authenticated_read_scrutiny_rules') THEN
    CREATE POLICY "authenticated_read_scrutiny_rules" ON public.scrutiny_rules FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_rules' AND policyname = 'admin_insert_scrutiny_rules') THEN
    CREATE POLICY "admin_insert_scrutiny_rules" ON public.scrutiny_rules FOR INSERT TO authenticated WITH CHECK (is_superadmin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_rules' AND policyname = 'admin_update_scrutiny_rules') THEN
    CREATE POLICY "admin_update_scrutiny_rules" ON public.scrutiny_rules FOR UPDATE TO authenticated USING (is_superadmin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scrutiny_rules' AND policyname = 'admin_delete_scrutiny_rules') THEN
    CREATE POLICY "admin_delete_scrutiny_rules" ON public.scrutiny_rules FOR DELETE TO authenticated USING (is_superadmin());
  END IF;
END $$;

-- carry_forward_queries
CREATE TABLE IF NOT EXISTS public.carry_forward_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_query_id uuid REFERENCES public.audit_client_queries(id) NOT NULL,
  target_engagement_id uuid REFERENCES public.audit_engagements(id) NOT NULL,
  carried_at timestamp with time zone DEFAULT now(),
  carried_by uuid REFERENCES public.users(id)
);

ALTER TABLE public.carry_forward_queries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carry_forward_queries' AND policyname = 'firm_scope_select_cf') THEN
    CREATE POLICY "firm_scope_select_cf" ON public.carry_forward_queries FOR SELECT TO authenticated
      USING (is_superadmin() OR target_engagement_id IN (SELECT id FROM public.audit_engagements WHERE firm_id = current_user_firm_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carry_forward_queries' AND policyname = 'firm_scope_insert_cf') THEN
    CREATE POLICY "firm_scope_insert_cf" ON public.carry_forward_queries FOR INSERT TO authenticated
      WITH CHECK (is_superadmin() OR target_engagement_id IN (SELECT id FROM public.audit_engagements WHERE firm_id = current_user_firm_id()));
  END IF;
END $$;

-- Seed 119 scrutiny rules (ON CONFLICT skip if already exists)
INSERT INTO public.scrutiny_rules (rule_id, rule_name, category, detection_level, root_cause, threshold_type, threshold_value, audit_query_template, severity, legal_reference, prior_year_needed, detection_logic) VALUES
('BKR-001','Abnormal Balance — Credit in Asset Account','BKR','account','Asset account showing credit balance','absolute',0,'Account "{account}" shows credit balance of ₹{amount}. Confirm nature and provide supporting documents.','high',NULL,false,'{"check":"sign_reversal","expected_sign":"debit"}'),
('BKR-002','Suspense Account Balance at Year End','BKR','account','Suspense account not cleared','absolute',1,'Suspense account "{account}" has outstanding balance ₹{amount}. Provide details.','high',NULL,false,'{"check":"keyword_balance","keywords":["suspense"],"nonzero":true}'),
('BKR-003','Unreconciled Bank Balance','BKR','account','Books vs bank statement difference','absolute',1000,'Bank account "{account}" shows unreconciled difference ₹{amount}.','medium',NULL,false,'{"check":"bank_recon_diff"}'),
('BKR-004','Stale Cheques Not Reversed','BKR','voucher','Cheques not presented >6 months','days',180,'Stale cheques in "{account}" totalling ₹{amount}. Confirm status.','medium',NULL,false,'{"check":"stale_cheques"}'),
('BKR-005','Contra Entries Without Matching','BKR','voucher','Unmatched contra entry','absolute',0,'Unmatched contra in "{account}" for ₹{amount}.','low',NULL,false,'{"check":"unmatched_contra"}'),
('BKR-006','Bank Charges Abnormally High','BKR','ratio','Bank charges exceeding normal %','percentage',0.5,'Bank charges ₹{amount} exceed 0.5% of turnover.','low',NULL,false,'{"check":"ratio_to_turnover","threshold_pct":0.5}'),
('BKR-007','Fixed Deposit Not in Investments','BKR','account','FD not classified as investment','absolute',0,'FD ₹{amount} not reflected in investments.','medium',NULL,false,'{"check":"fd_classification"}'),
('CASH-001','Cash Balance Exceeds ₹2L at Day End','CASH','account','Cash >₹2L — income tax compliance','absolute',200000,'Cash balance exceeded ₹2L (₹{amount}) on {date}. Justify per Section 269ST.','high','Section 269ST',false,'{"check":"daily_max","threshold":200000}'),
('CASH-002','Single Cash Payment >₹20,000','CASH','voucher','Cash payment >₹20K — Section 40A(3)','absolute',20000,'Cash payment ₹{amount} on {date}. Confirm Section 40A(3) compliance.','high','Section 40A(3)',false,'{"check":"single_txn","direction":"debit","threshold":20000}'),
('CASH-003','Single Cash Receipt >₹2L','CASH','voucher','Cash receipt >₹2L — Section 269ST','absolute',200000,'Cash receipt ₹{amount} on {date}. Verify Section 269ST compliance.','high','Section 269ST',false,'{"check":"single_txn","direction":"credit","threshold":200000}'),
('CASH-004','Cash Payments for Capital Expenditure','CASH','voucher','Capital items paid in cash','absolute',10000,'Cash payment ₹{amount} for capital expenditure. Verify banking channel requirement.','medium','Section 40A(3)',false,'{"check":"cash_capital_payment"}'),
('CASH-005','Round Number Cash Transactions','CASH','voucher','Suspiciously round cash transactions','absolute',50000,'Round number cash transaction ₹{amount} on {date}. Verify genuineness.','low',NULL,false,'{"check":"round_number","threshold":50000}'),
('CASH-006','Cash Discrepancy — Book vs Physical','CASH','account','Book cash vs physical cash difference','absolute',500,'Cash discrepancy ₹{amount}. Investigate.','high',NULL,false,'{"check":"cash_discrepancy"}'),
('CASH-007','Frequent Cash Withdrawals','CASH','aggregate','Multiple withdrawals suggesting structuring','count',5,'Multiple cash withdrawals ({count} times) in a week. Verify purpose.','medium',NULL,false,'{"check":"frequency","period":"week","threshold":5}'),
('SALES-001','Credit Notes >5% of Sales','SALES','ratio','Excessive credit notes','percentage',5,'Credit notes ₹{amount} ({pct}% of sales). Provide reasons.','high',NULL,false,'{"check":"ratio","threshold_pct":5}'),
('SALES-002','Sales Without GST Invoice','SALES','voucher','Revenue without GST invoice','absolute',0,'Sales ₹{amount} on {date} without GST invoice.','high','CGST Act Sec 31',false,'{"check":"missing_field","field":"gst_invoice"}'),
('SALES-003','Revenue Before Delivery','SALES','voucher','Revenue booked before dispatch','absolute',0,'Revenue ₹{amount} recorded before delivery. Verify recognition policy.','medium','Ind AS 115/AS 9',false,'{"check":"date_sequence"}'),
('SALES-004','Unbilled Revenue at Year End','SALES','account','Significant unbilled revenue','percentage',10,'Unbilled revenue ₹{amount} at year end. Confirm completeness.','medium',NULL,false,'{"check":"keyword_balance","keywords":["unbilled","accrued revenue"]}'),
('SALES-005','Sales Returns Not Netted','SALES','account','Returns shown separately','absolute',0,'Sales returns ₹{amount} not netted. Verify presentation.','low',NULL,false,'{"check":"separate_balance","keywords":["sales return"]}'),
('SALES-006','March Revenue Spike >150% Average','SALES','ratio','Unusual March revenue spike','percentage',150,'March revenue ₹{amount} is {pct}% of average. Verify cut-off.','high',NULL,false,'{"check":"month_spike","month":3,"threshold_pct":150}'),
('SALES-007','Inter-Company Sales Without Elimination','SALES','voucher','Related party sales not eliminated','absolute',0,'Inter-company sales ₹{amount}. Confirm elimination.','medium','Ind AS 110',false,'{"check":"related_party_sales"}'),
('EXP-001','Purchases Without Creditor Entry','EXP','voucher','Purchase without creditor balance','absolute',0,'Purchase ₹{amount} on {date} without creditor entry. Verify completeness.','high',NULL,false,'{"check":"no_corresponding_entry"}'),
('EXP-002','Expense Spike >200% of PY','EXP','ratio','Unusual expense increase','percentage',200,'"{account}" expense ₹{amount} is {pct}% of PY. Explain variance.','medium',NULL,true,'{"check":"py_comparison","threshold_pct":200}'),
('EXP-003','Repairs >₹5L — Should Be Capital?','EXP','voucher','Large repairs may be capital','absolute',500000,'Repair ₹{amount} in "{account}" exceeds ₹5L. Evaluate capitalization.','high','AS 10/Ind AS 16',false,'{"check":"single_txn","threshold":500000}'),
('EXP-004','Personal Expenses in Business','EXP','voucher','Non-business expenses in P&L','absolute',0,'Expense "{narration}" ₹{amount} appears personal. Verify business purpose.','high','Section 37(1)',false,'{"check":"keyword_narration","keywords":["personal","family","home","private"]}'),
('EXP-005','Duplicate Invoice Booking','EXP','voucher','Same invoice booked twice','absolute',0,'Potential duplicate ₹{amount} on {date}. Verify uniqueness.','high',NULL,false,'{"check":"duplicate_amount_date"}'),
('EXP-006','Expenses After Year End','EXP','voucher','Post-period expenses in CY','absolute',0,'Expense ₹{amount} dated {date} booked after year end. Verify cut-off.','medium',NULL,false,'{"check":"post_period_entry"}'),
('EXP-007','Misc Expenses >2% of Total','EXP','ratio','Excessive miscellaneous expenses','percentage',2,'Misc expenses ₹{amount} ({pct}% of total). Provide breakup.','medium',NULL,false,'{"check":"ratio","threshold_pct":2}'),
('DEBT-001','Debtors >180 Days','DEBT','account','Trade receivables >180 days','days',180,'Debtors in "{account}" outstanding >{threshold} days (₹{amount}). Assess recoverability.','high',NULL,false,'{"check":"ageing","threshold_days":180}'),
('DEBT-002','Debtor Exceeds Credit Limit','DEBT','account','Balance beyond credit limit','absolute',0,'"{account}" ₹{amount} exceeds credit limit. Confirm approval.','medium',NULL,false,'{"check":"credit_limit_breach"}'),
('DEBT-003','Bad Debt Write-Off Without Approval','DEBT','voucher','Write-off without board resolution','absolute',0,'Bad debt write-off ₹{amount}. Verify board approval.','high','Section 36(1)(vii)',false,'{"check":"keyword_narration","keywords":["written off","bad debt"]}'),
('DEBT-004','Revenue Without Debtor Entry','DEBT','voucher','Sales without debtor balance','absolute',0,'Sales ₹{amount} without debtor entry. Verify completeness.','medium',NULL,false,'{"check":"no_corresponding_entry"}'),
('DEBT-005','Credit Balance in Debtor','DEBT','account','Debtor showing credit — advance?','absolute',0,'Debtor "{account}" credit balance ₹{amount}. Verify.','medium',NULL,false,'{"check":"sign_reversal","expected_sign":"debit"}'),
('DEBT-006','Provision for Doubtful Debts Inadequate','DEBT','ratio','Provision too low for aged debtors','percentage',50,'Provision only {pct}% of debtors >180 days. Assess adequacy.','high','AS 29/Ind AS 37',false,'{"check":"provision_adequacy"}'),
('DEBT-007','Round-Off Adjustments in Debtors','DEBT','voucher','Frequent round-offs in receivables','count',10,'Multiple round-off adjustments ({count}) in debtors. Verify.','low',NULL,false,'{"check":"keyword_count","threshold":10}'),
('CRED-001','Creditor Debit Balance','CRED','account','Creditor showing debit — advance?','absolute',0,'Creditor "{account}" debit balance ₹{amount}. Confirm.','medium',NULL,false,'{"check":"sign_reversal","expected_sign":"credit"}'),
('CRED-002','Creditors >365 Days','CRED','account','Creditors outstanding >1 year','days',365,'Creditor "{account}" outstanding >{threshold} days (₹{amount}). Verify Section 41(1).','high','Section 41(1)',false,'{"check":"ageing","threshold_days":365}'),
('CRED-003','MSME Payment Beyond 45 Days','CRED','account','MSME payment delayed','days',45,'MSME creditor "{account}" delayed beyond 45 days (₹{amount}). Verify MSMED Act.','high','MSMED Act Sec 16',false,'{"check":"msme_payment_delay","threshold_days":45}'),
('CRED-004','Creditor Without Purchase Entry','CRED','account','Creditor balance without purchase','absolute',0,'Creditor "{account}" ₹{amount} without matching purchase.','medium',NULL,false,'{"check":"no_corresponding_entry"}'),
('CRED-005','New Creditors at Year End','CRED','aggregate','New creditors in March only','count',0,'New creditor "{account}" in March (₹{amount}). Verify genuineness.','medium',NULL,false,'{"check":"new_account_month","month":3}'),
('CRED-006','Related Party Creditor Undisclosed','CRED','account','Related party creditor without disclosure','absolute',0,'Creditor "{account}" may be related party. Verify AS 18/Ind AS 24.','high','AS 18/Ind AS 24',false,'{"check":"related_party_creditor"}'),
('CRED-007','Creditor Confirmation Not Obtained','CRED','account','Material creditor without confirmation','absolute',500000,'Creditor "{account}" ₹{amount} exceeds materiality. Obtain confirmation.','medium','SA 505',false,'{"check":"balance_exceeds","threshold":500000}'),
('LOAN-001','Loans from Directors — Sec 73','LOAN','account','Director loans may violate Sec 73','absolute',0,'Loan from director "{account}" ₹{amount}. Verify Section 73 compliance.','high','Companies Act Sec 73',false,'{"check":"keyword_balance","keywords":["director loan"]}'),
('LOAN-002','Unsecured Loans Without Resolution','LOAN','voucher','Unsecured loan without authorization','absolute',0,'Unsecured loan ₹{amount}. Verify board resolution.','high','Companies Act Sec 179/180',false,'{"check":"keyword_balance","keywords":["unsecured loan"]}'),
('LOAN-003','Loan Repayment Without Interest','LOAN','voucher','Repayment without interest booking','absolute',0,'Loan repayment without interest in "{account}". Verify computation and TDS.','high','Section 194A',false,'{"check":"repayment_without_interest"}'),
('LOAN-004','Inter-Corporate Deposits — Sec 186','LOAN','account','ICD exceeding limits','absolute',0,'ICD ₹{amount}. Verify Section 186 compliance.','high','Companies Act Sec 186',false,'{"check":"keyword_balance","keywords":["inter corporate","ICD"]}'),
('LOAN-005','Loan Interest Below Market Rate','LOAN','ratio','Below-market interest — deemed income','percentage',8,'Loan interest below market rate. Assess deemed income.','medium','Section 56(2)',false,'{"check":"interest_rate_below","threshold_pct":8}'),
('LOAN-006','Personal Guarantee for Company Loan','LOAN','account','Director guarantee — Sec 185','absolute',0,'Personal guarantee for loan. Verify Section 185.','medium','Companies Act Sec 185',false,'{"check":"guarantee_disclosure"}'),
('LOAN-007','Employee Loans Without Recovery','LOAN','account','Employee loans not being recovered','absolute',0,'Employee loan "{account}" ₹{amount} without recovery. Verify terms.','low',NULL,false,'{"check":"keyword_balance","keywords":["employee loan","staff loan"]}'),
('FA-001','Capital Expenditure Charged to P&L','FA','voucher','Capital item expensed','absolute',100000,'Expense ₹{amount} in "{account}" appears capital. Evaluate capitalization.','high','AS 10/Ind AS 16',false,'{"check":"capital_in_expense","threshold":100000}'),
('FA-002','Depreciation Rate Mismatch','FA','account','Rate differs from Schedule II','percentage',5,'Depreciation on "{account}" differs from Schedule II by {pct}%.','medium','Companies Act Sch II',false,'{"check":"dep_rate_variance","threshold_pct":5}'),
('FA-003','Asset Disposed Without Approval','FA','voucher','Disposal without authorization','absolute',0,'Asset disposal ₹{amount}. Verify board approval.','medium',NULL,false,'{"check":"keyword_narration","keywords":["disposal","sold","scrapped"]}'),
('FA-004','Impairment Not Assessed','FA','account','No impairment review done','absolute',0,'Assets may require impairment assessment per AS 28.','medium','AS 28/Ind AS 36',false,'{"check":"impairment_indicator"}'),
('FA-005','Capital WIP >2 Years','FA','account','CWIP not capitalized >2 years','days',730,'CWIP "{account}" outstanding >{threshold} days (₹{amount}). Verify project.','high',NULL,false,'{"check":"cwip_ageing","threshold_days":730}'),
('FA-006','Fully Depreciated Assets in Use','FA','account','Zero WDV assets still operating','absolute',0,'Fully depreciated assets in "{account}" still in use.','low','Ind AS 16.51',false,'{"check":"fully_depreciated_in_use"}'),
('FA-007','Assets Not Physically Verified','FA','account','No physical verification in 2 years','absolute',0,'Physical verification not conducted. SA 501 requires it.','medium','SA 501',false,'{"check":"physical_verification"}'),
('INV-001','Negative Stock Balance','INV','account','Stock showing negative','absolute',0,'Negative stock in "{account}" (₹{amount}).','high',NULL,false,'{"check":"negative_balance","keywords":["stock","inventory"]}'),
('INV-002','Slow Moving Inventory >180 Days','INV','account','Inventory not moved 180+ days','days',180,'Inventory "{account}" not moved >{threshold} days. Assess NRV.','medium','AS 2/Ind AS 2',false,'{"check":"inventory_ageing","threshold_days":180}'),
('INV-003','Inventory Valuation Inconsistency','INV','ratio','Valuation method change','percentage',10,'Inventory valuation change — {pct}% variance.','high','AS 2/Ind AS 2',false,'{"check":"valuation_method_change"}'),
('INV-004','Physical vs Book Stock Variance','INV','account','Physical count vs books difference','percentage',2,'Stock variance {pct}% (₹{amount}). Investigate.','high',NULL,false,'{"check":"stock_variance","threshold_pct":2}'),
('INV-005','Goods in Transit at Year End','INV','account','Significant goods in transit','absolute',0,'Goods in transit ₹{amount}. Verify ownership and cut-off.','medium',NULL,false,'{"check":"keyword_balance","keywords":["goods in transit","GIT"]}'),
('INV-006','Obsolete Stock Not Written Down','INV','account','Expired inventory at full value','absolute',0,'Potential obsolete stock "{account}" ₹{amount}. Verify NRV.','medium','AS 2/Ind AS 2',false,'{"check":"obsolete_stock"}'),
('INV-007','Excise/GST Not in Valuation','INV','account','Duties excluded from valuation','absolute',0,'Verify duties included in inventory valuation for "{account}".','low','AS 2 Para 11',false,'{"check":"duty_inclusion"}'),
('TDS-001','194J Without TDS','TDS','voucher','Professional fees without TDS','absolute',30000,'Payment ₹{amount} without TDS. Section 194J applies above ₹30,000.','high','Section 194J',false,'{"check":"tds_missing","section":"194J","threshold":30000}'),
('TDS-002','194C Without TDS','TDS','voucher','Contractor payment without TDS','absolute',30000,'Contractor payment ₹{amount} without TDS. Section 194C applies.','high','Section 194C',false,'{"check":"tds_missing","section":"194C","threshold":30000}'),
('TDS-003','194A Interest Without TDS','TDS','voucher','Interest without TDS','absolute',40000,'Interest ₹{amount} without TDS. Section 194A applies above ₹40,000.','high','Section 194A',false,'{"check":"tds_missing","section":"194A","threshold":40000}'),
('TDS-004','194I Rent Without TDS','TDS','voucher','Rent without TDS','absolute',240000,'Rent ₹{amount} without TDS. Section 194I applies above ₹2,40,000 p.a.','high','Section 194I',false,'{"check":"tds_missing","section":"194I","threshold":240000}'),
('TDS-005','TDS Deposited Late','TDS','voucher','Late TDS deposit','days',7,'TDS ₹{amount} deposited late. Interest u/s 201(1A) applicable.','high','Section 201(1A)',false,'{"check":"tds_late_deposit","threshold_days":7}'),
('TDS-006','Lower Deduction Certificate Invalid','TDS','voucher','Expired lower TDS certificate','absolute',0,'Lower TDS rate on ₹{amount} — verify certificate validity.','medium','Section 197',false,'{"check":"lower_tds_cert_validity"}'),
('TDS-007','TDS Return Filing Delayed','TDS','aggregate','Quarterly return not filed on time','days',0,'TDS return not filed within due date. Late fee u/s 234E.','medium','Section 234E',false,'{"check":"tds_return_delay"}'),
('RPT-001','Related Party Sales Below Market','RPT','voucher','Below-market RPT sales','percentage',10,'Sales to related party at {pct}% below market (₹{amount}). Verify arms length.','high','Section 40A(2)/Ind AS 24',false,'{"check":"below_market_rate","threshold_pct":10}'),
('RPT-002','Related Party Purchases Above Market','RPT','voucher','Above-market RPT purchases','percentage',10,'Purchases from related party above market. Verify pricing.','high','Section 40A(2)',false,'{"check":"above_market_rate","threshold_pct":10}'),
('RPT-003','RPT Without Disclosure','RPT','aggregate','Material RPTs undisclosed','absolute',0,'RPTs ₹{amount} require disclosure per AS 18/Ind AS 24.','high','AS 18/Ind AS 24',false,'{"check":"rpt_disclosure_missing"}'),
('RPT-004','Director Remuneration Exceeds Limits','RPT','account','Remuneration beyond Schedule V','percentage',11,'Director remuneration ₹{amount} may exceed Schedule V limits.','high','Companies Act Sec 197/Sch V',false,'{"check":"remuneration_limit","threshold_pct":11}'),
('RPT-005','Loans to Directors Without Approval','RPT','account','Director loans violating Sec 185','absolute',0,'Loan to director ₹{amount}. Verify Section 185/186.','high','Companies Act Sec 185',false,'{"check":"keyword_balance","keywords":["loan to director"]}'),
('RPT-006','Guarantee for Related Party','RPT','account','Corporate guarantee for related party','absolute',0,'Guarantee ₹{amount} for related party. Verify Section 186.','medium','Companies Act Sec 186',false,'{"check":"guarantee_related_party"}'),
('RPT-007','Investment in Related Party','RPT','account','Significant RPT investment','absolute',0,'Investment ₹{amount} in related party. Verify Section 186.','medium','Companies Act Sec 186',false,'{"check":"investment_related_party"}'),
('JE-001','Journal Entries on Weekends/Holidays','JE','voucher','Entries on non-working days','count',0,'JE ₹{amount} on {date} (weekend/holiday). Verify authorization.','medium',NULL,false,'{"check":"weekend_holiday_entry"}'),
('JE-002','Large JEs Near Year End','JE','voucher','Significant year-end JEs','absolute',500000,'Large JE ₹{amount} near year end. Verify purpose.','high',NULL,false,'{"check":"yearend_large_je","threshold":500000}'),
('JE-003','JE Without Narration','JE','voucher','Missing narration','absolute',0,'JE ₹{amount} on {date} without narration. Add description.','medium',NULL,false,'{"check":"blank_narration","voucher_type":"journal"}'),
('JE-004','Recurring Round Number JEs','JE','aggregate','Identical round JE amounts repeated','count',3,'Recurring JEs ₹{amount} found {count} times. Verify.','medium',NULL,false,'{"check":"recurring_round_je","threshold":3}'),
('JE-005','Reversing Entries Without Explanation','JE','voucher','Entry followed by exact reversal','absolute',0,'Reversal ₹{amount} on {date} without explanation. Verify.','medium',NULL,false,'{"check":"reversal_entry"}'),
('JE-006','Entries by Unauthorized Users','JE','voucher','Non-authorized personnel entries','absolute',0,'Entry by unauthorized user ₹{amount}. Verify access controls.','high',NULL,false,'{"check":"unauthorized_user"}'),
('JE-007','Post-Dated Entries','JE','voucher','Future-dated entries','absolute',0,'Entry dated {date} is post-dated. Verify.','medium',NULL,false,'{"check":"future_date_entry"}'),
('RAT-001','GP Ratio Change >5% from PY','RAT','ratio','Significant GP movement','percentage',5,'GP ratio changed by {pct}% from PY. Explain variance.','medium',NULL,true,'{"check":"ratio_change","ratio":"gross_profit","threshold_pct":5}'),
('RAT-002','NP Ratio Significant Change','RAT','ratio','NP ratio movement','percentage',10,'NP ratio changed by {pct}% from PY. Explain.','medium',NULL,true,'{"check":"ratio_change","ratio":"net_profit","threshold_pct":10}'),
('RAT-003','Current Ratio Below 1','RAT','ratio','Current assets < liabilities','absolute',1,'Current ratio {value} (below 1). Assess going concern.','high','SA 570',true,'{"check":"ratio_below","ratio":"current_ratio","threshold":1}'),
('RAT-004','Debt-Equity Ratio Deterioration','RAT','ratio','Leverage increased significantly','percentage',20,'Debt-equity deteriorated by {pct}%. Assess stability.','medium',NULL,true,'{"check":"ratio_change","ratio":"debt_equity","threshold_pct":20}'),
('RAT-005','Inventory Turnover Decline','RAT','ratio','Inventory moving slower','percentage',20,'Inventory turnover declined {pct}%. Assess obsolescence.','medium',NULL,true,'{"check":"ratio_change","ratio":"inventory_turnover","threshold_pct":20}'),
('RAT-006','Debtor Turnover Decline','RAT','ratio','Collection period increasing','percentage',20,'Debtor turnover declined {pct}%. Assess collection.','medium',NULL,true,'{"check":"ratio_change","ratio":"debtor_turnover","threshold_pct":20}'),
('RAT-007','Operating Cash Flow Negative','RAT','ratio','Negative OCF despite profit','absolute',0,'OCF negative (₹{amount}) despite profit. Assess going concern.','high','SA 570',false,'{"check":"negative_ocf"}'),
('PAY-001','Salary Without PF Deduction','PAY','voucher','No PF deduction','absolute',15000,'Salary ₹{amount} without PF. EPF mandatory above ₹15,000.','high','EPF Act',false,'{"check":"missing_deduction","deduction":"PF"}'),
('PAY-002','Salary Without ESI','PAY','voucher','No ESI deduction','absolute',21000,'Salary without ESI. ESIC mandatory below ₹21,000.','high','ESIC Act',false,'{"check":"missing_deduction","deduction":"ESI"}'),
('PAY-003','Bonus Not Paid','PAY','aggregate','Statutory bonus not computed','absolute',0,'Bonus liability not recorded. Verify Payment of Bonus Act.','medium','Payment of Bonus Act',false,'{"check":"missing_provision","keywords":["bonus"]}'),
('PAY-004','Gratuity Provision Inadequate','PAY','account','Gratuity understated','absolute',0,'Gratuity provision may be inadequate. Verify actuarial valuation.','medium','AS 15/Ind AS 19',false,'{"check":"provision_adequacy_keyword","keywords":["gratuity"]}'),
('PAY-005','Leave Encashment Not Provided','PAY','account','No leave encashment provision','absolute',0,'Leave encashment provision missing. Verify AS 15.','medium','AS 15',false,'{"check":"missing_provision","keywords":["leave encashment"]}'),
('PAY-006','Directors Sitting Fee Without TDS','PAY','voucher','Sitting fee without TDS','absolute',0,'Sitting fee ₹{amount} without TDS. Section 194J applies.','high','Section 194J',false,'{"check":"tds_missing","keywords":["sitting fee"]}'),
('PAY-007','Excess Partner Remuneration','PAY','account','Partner pay exceeding Sec 40(b)','absolute',0,'Partner remuneration may exceed Section 40(b) limits.','high','Section 40(b)',false,'{"check":"partner_remuneration_limit"}'),
('CAP-001','Share Capital Change Without Filing','CAP','account','Capital change without ROC filing','absolute',0,'Share capital changed by ₹{amount}. Verify ROC filing.','high','Companies Act Sec 39/64',false,'{"check":"capital_change"}'),
('CAP-002','Dividend Without Adequate Profit','CAP','account','Dividend from insufficient reserves','absolute',0,'Dividend ₹{amount}. Verify distributable profits per Sec 123.','high','Companies Act Sec 123',false,'{"check":"dividend_adequacy"}'),
('CAP-003','Securities Premium Misused','CAP','account','Premium used improperly','absolute',0,'Securities premium movement ₹{amount}. Verify per Sec 52.','medium','Companies Act Sec 52',false,'{"check":"premium_utilization"}'),
('CAP-004','Revaluation Without Valuer','CAP','account','Revaluation without registered valuer','absolute',0,'Revaluation reserve ₹{amount}. Verify valuer report.','medium','Companies Act Sec 247',false,'{"check":"keyword_balance","keywords":["revaluation reserve"]}'),
('CAP-005','Capital Reduction Without Tribunal','CAP','account','Reduction without NCLT order','absolute',0,'Capital reduction ₹{amount}. Verify NCLT order.','high','Companies Act Sec 66',false,'{"check":"capital_reduction"}'),
('CAP-006','Buy-Back Not Per Sec 68','CAP','account','Buy-back non-compliant','absolute',0,'Buy-back ₹{amount}. Verify Section 68 compliance.','high','Companies Act Sec 68',false,'{"check":"keyword_narration","keywords":["buy-back","buyback"]}'),
('CAP-007','DRR Inadequate','CAP','account','DRR below required %','percentage',25,'DRR may be inadequate. Verify per Section 71.','high','Companies Act Sec 71',false,'{"check":"drr_adequacy","required_pct":25}'),
('PROV-001','Contingent Liability Undisclosed','PROV','account','Material CL without disclosure','absolute',0,'Contingent liability ₹{amount} not disclosed. AS 29 requires it.','high','AS 29/Ind AS 37',false,'{"check":"missing_disclosure","keywords":["contingent","claim"]}'),
('PROV-002','Tax Provision Inadequate','PROV','account','Income tax provision insufficient','percentage',25,'Tax provision ₹{amount} appears low ({pct}% of PBT).','high',NULL,false,'{"check":"tax_provision_adequacy"}'),
('PROV-003','Warranty Provision Missing','PROV','account','No warranty provision','absolute',0,'No warranty provision identified. Verify AS 29.','medium','AS 29/Ind AS 37',false,'{"check":"missing_provision","keywords":["warranty"]}'),
('PROV-004','Litigation Not Provided','PROV','account','Pending cases without provision','absolute',0,'Pending litigation ₹{amount} without provision.','high','AS 29/Ind AS 37',false,'{"check":"keyword_balance","keywords":["litigation","legal"]}'),
('PROV-005','Doubtful Debt Provision Change >50%','PROV','ratio','Big change in provision policy','percentage',50,'Provision changed by {pct}% from PY. Verify consistency.','medium',NULL,true,'{"check":"py_comparison","threshold_pct":50}'),
('PROV-006','Deferred Tax Not Computed','PROV','account','No DTA/DTL computed','absolute',0,'Deferred tax not computed. AS 22/Ind AS 12 requires it.','high','AS 22/Ind AS 12',false,'{"check":"missing_provision","keywords":["deferred tax"]}'),
('PROV-007','Restructuring Without Plan','PROV','account','Restructuring provision without plan','absolute',0,'Restructuring provision ₹{amount}. Verify detailed plan.','medium','Ind AS 37',false,'{"check":"keyword_balance","keywords":["restructuring"]}'),
('COMP-001','CSR Below 2% of Net Profit','COMP','ratio','CSR spending below requirement','percentage',2,'CSR expenditure below 2%. Verify Section 135.','high','Companies Act Sec 135',false,'{"check":"csr_adequacy","required_pct":2}'),
('COMP-002','Annual Return Not Filed','COMP','aggregate','MGT-7 not filed','days',0,'Annual return not filed. Verify ROC compliance.','high','Companies Act Sec 92',false,'{"check":"filing_compliance","form":"MGT-7"}'),
('COMP-003','Board Meeting Frequency','COMP','aggregate','Less than 4 board meetings','count',4,'Board meetings ({count}) below minimum 4.','medium','Companies Act Sec 173',false,'{"check":"meeting_frequency","min_count":4}'),
('COMP-004','Statutory Registers Not Maintained','COMP','aggregate','Required registers not updated','count',0,'Statutory registers not maintained. Verify compliance.','medium','Companies Act Sec 88',false,'{"check":"register_maintenance"}'),
('COMP-005','ADT-1 Not Filed','COMP','aggregate','Auditor appointment form delayed','days',15,'ADT-1 not filed within 15 days of AGM.','medium','Companies Act Sec 139(1)',false,'{"check":"filing_compliance","form":"ADT-1"}'),
('COMP-006','RPT Register Not Updated','COMP','aggregate','MBP-4 not current','count',0,'RPT register (MBP-4) not updated. Section 189 issue.','medium','Companies Act Sec 189',false,'{"check":"register_maintenance","form":"MBP-4"}'),
('COMP-007','Charge Not Registered','COMP','voucher','Charge not filed within 30 days','days',30,'Charge ₹{amount} not registered within 30 days. Section 77.','high','Companies Act Sec 77',false,'{"check":"charge_registration","threshold_days":30}')
ON CONFLICT (rule_id) DO NOTHING;
