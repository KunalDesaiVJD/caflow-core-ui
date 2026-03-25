// Form 3CD — Centralised Dropdown Library
// All dropdown options referenced by clauses are defined here.
// To update options for any clause, edit only this file.

export const DROPDOWN_LIBRARY: Record<string, { value: string; label: string }[]> = {

  SEC_44AB: [
    { value: '44AB_a', label: 'Clause 44AB(a) -- Total sales/turnover/gross receipts of business exceeding specified limits' },
    { value: '44AB_a_prov', label: 'Clause 44AB(a) -- Proviso -- Where cash receipts and cash payments do not exceed the specified percentage of total transactions, but turnover exceeds the specified limit' },
    { value: '44AB_b', label: 'Clause 44AB(b) -- Gross receipts of profession exceeding specified limits' },
    { value: '44AB_c_i', label: 'Clause 44AB(c)(i) -- Profits and gains lower than deemed profit u/s 44AE' },
    { value: '44AB_c_ii', label: 'Clause 44AB(c)(ii) -- Profits and gains lower than deemed profit u/s 44BB' },
    { value: '44AB_c_iii', label: 'Clause 44AB(c)(iii) -- Profits and gains lower than deemed profit u/s 44BBB' },
    { value: '44AB_d', label: 'Clause 44AB(d) -- Profits and gains lower than deemed profit u/s 44ADA' },
    { value: '44AB_e', label: 'Clause 44AB(e) -- When provisions of section 44AD(4) are applicable' },
    { value: '44AB_third_prov', label: 'Third Proviso to section 44AB -- Audited under any other law' },
  ],

  TAXATION_SCHEME: [
    { value: '115BA', label: '115BA' },
    { value: '115BAA', label: '115BAA' },
    { value: '115BAB', label: '115BAB' },
    { value: '115BAC', label: '115BAC' },
    { value: '115BAD', label: '115BAD' },
    { value: '115BAE', label: '115BAE' },
  ],

  BOOKS_LIST: [
    { value: 'cash_book', label: 'Cash Book' },
    { value: 'bank_book', label: 'Bank Book' },
    { value: 'purchase_register', label: 'Purchase Register' },
    { value: 'sales_register', label: 'Sales Register' },
    { value: 'general_ledger', label: 'General Ledger' },
    { value: 'journal', label: 'Journal' },
    { value: 'inventory_register', label: 'Inventory/Stock Register' },
    { value: 'others', label: 'Others (specify)' },
  ],

  ACCOUNTING_METHOD: [
    { value: 'mercantile', label: 'Mercantile System (Accrual Basis)' },
    { value: 'cash', label: 'Cash System (Cash Basis)' },
    { value: 'hybrid', label: 'Hybrid / Mixed Method' },
    { value: 'other', label: 'Other (specify)' },
  ],

  PRESUMPTIVE_SECTIONS: [
    '44AD', '44ADA', '44AE', '44AF', '44B', '44BB', '44BBA', '44BBB', '44BBC',
    'Chapter XII-G', 'First Schedule', 'Any other relevant section'
  ].map(v => ({ value: v, label: v })),

  STOCK_VALUATION_14: [
    { value: 'at_cost', label: 'At Cost' },
    { value: 'at_market', label: 'At Market Price' },
    { value: 'lower', label: 'Lower of Cost or Market rate' },
    { value: 'na', label: 'N.A.' },
  ],

  ICDS: [
    'ICDS I - Accounting Policies', 'ICDS II - Valuation of Inventories',
    'ICDS III - Construction Contracts', 'ICDS IV - Revenue Recognition',
    'ICDS V - Tangible Fixed Assets', 'ICDS VI - Changes in Foreign Exchange Rates',
    'ICDS VII - Governments Grants', 'ICDS VIII - Securities',
    'ICDS IX - Borrowing Costs', 'ICDS X - Provisions, Contingent Liabilities and Contingent Assets'
  ].map(v => ({ value: v, label: v })),

  SEC_40A: [
    '40(a)(i)', '40(a)(ia)', '40(a)(ib)', '40(a)(ii)', '40(a)(iia)',
    '40(a)(iii)', '40(a)(iv)', '40(a)(v)'
  ].map(v => ({ value: v, label: v })),

  SEC_19_ADMISSIBLE: [
    '32AC', '32AD', '33AB', '33ABA', '35(1)(i)', '35(1)(ii)', '35(1)(iia)', '35(1)(iii)',
    '35(1)(iv)', '35(2AA)', '35(2AB)', '35ABA', '35ABB', '35AC', '35AD', '35CCA',
    '35CCC', '35CCD', '35D', '35DD', '35DDA', '35E', 'Any other relevant section'
  ].map(v => ({ value: v, label: v })),

  NATURE_OF_FUND: [
    { value: 'pf', label: 'Provident Fund' },
    { value: 'superannuation', label: 'Superannuation Fund' },
    { value: 'gratuity', label: 'Gratuity Fund' },
    { value: 'esi', label: 'Any Fund set up under the provisions of ESI Act, 1948' },
    { value: 'other_welfare', label: 'Any other welfare fund' },
  ],

  SEC_24_DEEMED: [
    { value: '32AC', label: '32AC' }, { value: '32AD', label: '32AD' },
    { value: '33AB', label: '33AB' }, { value: '33ABA', label: '33ABA' },
    { value: '33AC', label: '33AC' },
  ],

  SEC_25: [
    { value: '41(1)(a)', label: 'Sec. 41(1)(a)' }, { value: '41(1)(b)', label: 'Sec. 41(1)(b)' },
    { value: '41(2)', label: 'Sec. 41(2)' }, { value: '41(3)', label: 'Sec. 41(3)' },
    { value: '41(4)', label: 'Sec. 41(4)' }, { value: '41(4A)', label: 'Sec. 41(4A)' },
    { value: '41(5)', label: 'Sec. 41(5)' },
  ],

  SEC_43B_PART_A: [
    'Sec 43B(a) -- tax, duty, cess, fee etc',
    'Sec 43B(b) -- provident/superannuation/gratuity/other fund',
    'Sec 43B(c) -- sum referred to u/s 36(1)(ii)',
    'Sec 43B(d) -- interest from public financial institution etc',
    'Sec 43B(da) -- interest from deposit taking NBFC or non deposit taking SI-NBFC',
    'Sec 43B(e) -- interest on loan from scheduled bank',
    'Sec 43B(f) -- leave encashment',
    'Sec 43B(g) -- Indian railways for use of railway assets',
    'Sec 43B -- Proviso to clause (c) of Rule 5 of First Schedule',
    'Sec 43B(h) -- any sum payable to a micro or small enterprise beyond section 15 of MSMED Act, 2006',
  ].map(v => ({ value: v, label: v })),

  SEC_43B_PART_B: [
    'Sec 43B(a)', 'Sec 43B(b)', 'Sec 43B(c)', 'Sec 43B(d)',
    'Sec 43B(da)', 'Sec 43B(e)', 'Sec 43B(f)', 'Sec 43B(g)',
    'Sec 43B -- Proviso to clause (c) of Rule 5 of First Schedule',
  ].map(v => ({ value: v, label: v })),

  SECTION_43B: [
    '43B(a)', '43B(b)', '43B(c)', '43B(d)', '43B(e)', '43B(f)', '43B(h)'
  ].map(v => ({ value: v, label: v })),

  CODE_A_TO_L: [
    { value: 'A', label: 'A -- Cash payment' },
    { value: 'B', label: 'B -- Cash receipt' },
    { value: 'C', label: 'C -- Payment through non account payee cheque' },
    { value: 'D', label: 'D -- Receipt through non account payee cheque' },
    { value: 'E', label: 'E -- Transfer of asset' },
    { value: 'F', label: 'F -- Transfer of liability' },
    { value: 'G', label: 'G -- Conversion of assets' },
    { value: 'H', label: 'H -- Conversion of liabilities' },
    { value: 'I', label: 'I -- Journal entry (Debit)' },
    { value: 'J', label: 'J -- Journal entry (Credit)' },
    { value: 'K', label: 'K -- Any other mode (Debit)' },
    { value: 'L', label: 'L -- Any other mode (Credit)' },
  ],

  NATURE_LOSS_32A: [
    'House property loss', 'Loss from business other than speculative and specified',
    'Loss from speculative business', 'Loss from specified business',
    'Short-term capital loss', 'Long-term capital loss',
    'Loss from owning and maintaining race horses',
    'Unabsorbed depreciation', 'Unabsorbed allowance under section 35(4)',
  ].map(v => ({ value: v, label: v })),

  SEC_CHAPTER_VIA: [
    '10A', '10AA', '80C', '80CCC', '80CCD', '80CCF', '80CCG', '80CCH',
    '80D', '80DD', '80DDB', '80E', '80EE', '80EEA', '80EEB',
    '80G', '80GG', '80GGA', '80GGB',
    '80IAB', '80IAC', '80IB', '80IBA', '80IC', '80ID', '80IE',
    '80JJA', '80JJAA', '80LA', '80M', '80P', '80PA',
    '80QQB', '80RRB', '80TTA', '80TTB', '80U'
  ].map(v => ({ value: v, label: v })),

  TDS_SECTIONS: [
    { value: '192', label: '192 - Salary' },
    { value: '192A', label: '192A - PF Withdrawal' },
    { value: '193', label: '193 - Interest on Securities' },
    { value: '194', label: '194 - Dividend' },
    { value: '194A', label: '194A - Interest other than Securities' },
    { value: '194B', label: '194B - Lottery Winnings' },
    { value: '194BB', label: '194BB - Horse Race Winnings' },
    { value: '194C', label: '194C - Contractor Payments' },
    { value: '194D', label: '194D - Insurance Commission' },
    { value: '194DA', label: '194DA - Life Insurance Maturity' },
    { value: '194E', label: '194E - Non-resident Sportsman' },
    { value: '194EE', label: '194EE - NSS Payments' },
    { value: '194F', label: '194F - Repurchase by Mutual Fund' },
    { value: '194G', label: '194G - Commission on Lottery' },
    { value: '194H', label: '194H - Commission/Brokerage' },
    { value: '194I', label: '194I - Rent' },
    { value: '194IA', label: '194IA - Transfer of Immovable Property' },
    { value: '194IB', label: '194IB - Rent by Individual' },
    { value: '194IC', label: '194IC - Joint Development Agreement' },
    { value: '194J', label: '194J - Professional/Technical Fees' },
    { value: '194K', label: '194K - Income from Units' },
    { value: '194LA', label: '194LA - Compensation on Compulsory Acquisition' },
    { value: '194LB', label: '194LB - Interest from Infrastructure Bond' },
    { value: '194LC', label: '194LC - Interest from Indian Company' },
    { value: '194LD', label: '194LD - Interest on Rupee Bond' },
    { value: '194M', label: '194M - Payment by Individual/HUF to Contractor' },
    { value: '194N', label: '194N - Cash Withdrawal' },
    { value: '194O', label: '194O - E-commerce' },
    { value: '194P', label: '194P - Senior Citizen' },
    { value: '194Q', label: '194Q - Purchase of Goods' },
    { value: '194R', label: '194R - Benefit/Perquisite' },
    { value: '194S', label: '194S - Cryptocurrency' },
    { value: '195', label: '195 - Non-resident Payments' },
    { value: '196B', label: '196B - Income from offshore fund' },
    { value: '196C', label: '196C - Income from foreign currency bonds' },
    { value: '196D', label: '196D - Income of FII from securities' },
  ],

  TDS_FORM_TYPES: [
    { value: '24Q', label: '24Q' }, { value: '26Q', label: '26Q' }, { value: '27EQ', label: '27EQ' },
  ],

  DONATION_SECTIONS: [
    { value: '80G', label: '80G' }, { value: '80GGA', label: '80GGA' },
    { value: '80GGB', label: '80GGB' }, { value: '80GGC', label: '80GGC' },
  ],

  PAYMENT_MODE: [
    { value: 'Cash', label: 'Cash' }, { value: 'Cheque', label: 'Cheque' },
    { value: 'DD', label: 'Demand Draft' }, { value: 'Online', label: 'Online Transfer' },
  ],

  STOCK_UNITS: [
    'KG', 'MT', 'Nos', 'Ltrs', 'Sq Ft', 'Sq Mt', 'Meters',
    'Pairs', 'Sets', 'Bundles', 'Pieces', 'Other'
  ].map(v => ({ value: v, label: v })),

  UNIT_DROPDOWN_35: [
    'gms', 'kilograms', 'litre', 'kilolitre', 'metre', 'kilometre', 'numbers',
    'quintal', 'ton', 'pound', 'milligrams', 'carat', 'numbers (1000s)', 'watt',
    'inch', 'feet', 'sqft', 'acre', 'cubic ft', 'centimetre', 'cubic metre', 'residual'
  ].map(v => ({ value: v, label: v })),

  TAX_LAW_41: [
    'Central Excise Duty', 'Central Custom Duty', 'Service Tax', 'Sales Tax/VAT',
    'State Excise Duty', 'Goods & Services Tax', 'Other Indirect Tax/duty'
  ].map(v => ({ value: v, label: v })),

  FORM_61_TYPES: [
    { value: 'form_61', label: 'Form No. 61' },
    { value: 'form_61A', label: 'Form No. 61A' },
    { value: 'form_61B', label: 'Form No. 61B' },
  ],

  CbCR_REPORTER: [
    { value: 'assessee', label: 'Assessee' },
    { value: 'parent', label: 'Parent entity' },
    { value: 'alternate', label: 'Alternate reporting entity' },
  ],

  GAAR_NATURE: [
    { value: 'a', label: '(a) creates rights or obligations not ordinarily created between arm\'s length persons' },
    { value: 'b', label: '(b) results in misuse or abuse of provisions of this Act' },
    { value: 'c', label: '(c) lacks commercial substance or deemed to lack under section 97' },
    { value: 'd', label: '(d) entered into by means not ordinarily employed for bona fide purposes' },
    { value: 'e', label: '(e) Others' },
  ],

  SEC_92CE_CLAUSE: [
    { value: 'i', label: '(i) made suo motu by assessee in his return of income' },
    { value: 'ii', label: '(ii) made by Assessing Officer and accepted by assessee' },
    { value: 'iii', label: '(iii) determined by an advance pricing agreement u/s 92CC' },
    { value: 'iv', label: '(iv) made as per safe harbour rules u/s 92CB' },
    { value: 'v', label: '(v) arising from resolution by mutual agreement procedure u/s 90 or 90A' },
  ],

  LIABILITY_NATURE: [
    'Interest', 'Penalty', 'Fine', 'Litigation expenses',
    'Contribution to political party', 'Other'
  ].map(v => ({ value: v, label: v })),

  LOSS_NATURE: [
    'Business Loss', 'Speculation Loss', 'Capital Loss', 'House Property Loss', 'Other'
  ].map(v => ({ value: v, label: v })),

  YES_NO: [
    { value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' },
  ],

  FRINGE_BENEFIT_CATEGORIES: [
    'Motor Car', 'Telephone', 'Club', 'Travel', 'Medical',
    'Entertainment', 'Guest House', 'Festival', 'Other'
  ].map(v => ({ value: v, label: v })),
};
