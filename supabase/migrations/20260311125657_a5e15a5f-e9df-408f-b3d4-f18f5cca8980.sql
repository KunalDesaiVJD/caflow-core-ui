
-- Add account_type and closing_balance_signed to trial_balance_snapshots
ALTER TABLE trial_balance_snapshots
  ADD COLUMN IF NOT EXISTS account_type TEXT,
  ADD COLUMN IF NOT EXISTS closing_balance_signed NUMERIC DEFAULT 0;

-- Add keywords_ledger_synonyms to scrutiny_rules for ledger matching
ALTER TABLE scrutiny_rules
  ADD COLUMN IF NOT EXISTS keywords_ledger_synonyms TEXT;

-- Seed keywords_ledger_synonyms for existing rule categories
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'bank,cash,petty cash,cash in hand,current account,savings account,overdraft,od account,cash credit' WHERE category = 'BKR' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'cash,petty cash,cash in hand' WHERE category = 'CASH' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'fixed asset,furniture,vehicle,plant,machinery,computer,building,land,equipment,office equipment' WHERE category = 'FA' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'tds,tax deducted,194c,194j,194a,192b,194q,194h,tds payable,tds receivable' WHERE category = 'TDS' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'gst,cgst,sgst,igst,gst payable,gst receivable,input gst,output gst' WHERE category = 'GST' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'salary,wages,payroll,staff salary,director salary,bonus,gratuity,pf,provident fund,esi,employee' WHERE category = 'PAY' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'purchase,raw material,material consumed,trading,cost of goods' WHERE category = 'PURCH' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'sales,revenue,turnover,income from operations,service income,service revenue' WHERE category = 'SALES' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'sundry debtor,trade debtor,accounts receivable,customer outstanding,receivable' WHERE category = 'DEBT' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'sundry creditor,trade creditor,accounts payable,vendor outstanding,payable' WHERE category = 'CRED' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'expense,professional fee,audit fee,legal fee,rent,repair,maintenance,insurance,telephone,travel,conveyance,printing,stationery,advertisement,commission,brokerage,interest,depreciation,amortization' WHERE category = 'EXP' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'loan,unsecured loan,secured loan,term loan,working capital,borrowing' WHERE category = 'LOAN' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'investment,mutual fund,fixed deposit,fd,debenture,share,equity' WHERE category = 'INV' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'provision,reserve,contingent,liability provision' WHERE category = 'PROV' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'capital,share capital,equity,partner capital,proprietor capital,reserves,surplus,retained earning' WHERE category = 'CAP' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'depreciation,amortization,impairment' WHERE category = 'DEP' AND keywords_ledger_synonyms IS NULL;
UPDATE scrutiny_rules SET keywords_ledger_synonyms = 'interest,bank interest,interest on loan,interest expense,interest income,finance cost' WHERE category = 'INT' AND keywords_ledger_synonyms IS NULL;
