// Form 3CD — Master Clause Definitions
// To remove a clause: set isActive = false. It disappears automatically.
// To resequence: update displayOrder values. Re-sort runs automatically.
// To change content: update the ClauseDefinition — heading, columns, dropdowns update everywhere.
// To add a new clause: push a new ClauseDefinition with correct displayOrder.
// ZERO redevelopment needed for any future IT utility amendment.

import type { ClauseDefinition } from './form3cd-master';

export const FORM_3CD_CLAUSES: ClauseDefinition[] = [
  // ═══════ CLAUSE 8 ═══════
  {
    clauseNo: '8', displayOrder: 8, isActive: true,
    title: 'Relevant clause of section 44AB',
    heading: 'Indicate the relevant clause of section 44AB under which audit has been conducted.',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_8_section', heading: 'Relevant Clause of Section 44AB',
        control: 'dropdown', dropdownRef: 'SEC_44AB',
      },
      {
        key: 'cl_8_opted', heading: '8(a) Whether the assessee has opted for taxation u/s 115BA / 115BAA / 115BAB / 115BAC / 115BAD / 115BAE?',
        control: 'yes_no',
        subClauses: [
          {
            key: 'cl_8_scheme', heading: 'Section under which option exercised',
            control: 'dropdown', dropdownRef: 'TAXATION_SCHEME',
            dependsOn: 'cl_8_opted', dependsOnValue: true,
          },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 9(a) — Partners/Members Profit Sharing ═══════
  {
    clauseNo: '9a', displayOrder: 9, isActive: true,
    title: 'Partners/Members profit sharing',
    heading: 'If firm or Association of Persons, indicate names of partners/members and their profit-sharing ratios.',
    control: 'note_reference',
    annexureColumns: [
      { key: 'name', label: 'Partner / Member Name', type: 'text', minWidth: 180 },
      { key: 'profit_share', label: 'Profit Sharing %', type: 'numeric', width: 120 },
      { key: 'remarks', label: 'Remarks', type: 'text', width: 160 },
    ],
  },

  // ═══════ CLAUSE 9(b) — Change in Partners/Members ═══════
  {
    clauseNo: '9b', displayOrder: 9.5, isActive: true,
    title: 'Change in partners/members',
    heading: 'If there is any change in the partners/members or their profit-sharing ratios since the last date of preceding year, the particulars of such change.',
    control: 'yes_no',
    subClauses: [
      {
        key: 'cl_9b_details',
        heading: 'Details of change in partners/members',
        control: 'structured_table',
        dependsOn: '9b',
        dependsOnValue: true,
        annexureColumns: [
          { key: 'date_of_change', label: 'Date of Change', type: 'date', width: 130 },
          { key: 'name', label: 'Name of Partner/Member', type: 'text', minWidth: 180 },
          {
            key: 'type_of_change',
            label: 'Type of Change',
            type: 'dropdown',
            width: 210,
            options: [
              { value: 'Addition', label: 'Addition' },
              { value: 'Deletion', label: 'Deletion' },
              { value: 'Change in profit sharing ratio', label: 'Change in profit sharing ratio' }
            ]
          },
          { key: 'old_ratio', label: 'Old Profit Sharing Ratio', type: 'text', width: 170 },
          { key: 'new_ratio', label: 'New Profit Sharing Ratio', type: 'text', width: 170 },
        ],
      },
    ],
    defaultValue: 'No Change',
  },

  // ═══════ CLAUSE 10(a) — Nature of Business or Profession ═══════
  {
    clauseNo: '10a', displayOrder: 10, isActive: true,
    title: 'Nature of business or profession',
    heading: 'Nature of Business or Profession (if more than one business or profession is carried on during the previous year, nature of every business or profession).',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'sr_no', label: 'S.N.', type: 'readonly', width: 50 },
      { key: 'sector', label: 'Sector', type: 'text', minWidth: 160 },
      { key: 'sub_sector', label: 'Sub Sector', type: 'text', minWidth: 160 },
      { key: 'code', label: 'Code', type: 'text', width: 100 },
    ],
  },

  // ═══════ CLAUSE 10(b) — Change in Nature of Business ═══════
  {
    clauseNo: '10b', displayOrder: 10.5, isActive: true,
    title: 'Change in nature of business',
    heading: 'If there is any change in the nature of business or profession, the particulars of such change.',
    control: 'yes_no',
    subClauses: [
      {
        key: 'cl_10b_details', heading: 'Details of change',
        control: 'not_applicable_annexure',
        dependsOn: '10b', dependsOnValue: true,
        annexureColumns: [
          { key: 'change_type', label: 'Business', type: 'dropdown', width: 140,
            options: [{ value: 'Added', label: 'Added' }, { value: 'Discontinued', label: 'Discontinued' }] },
          { key: 'sector', label: 'Sector', type: 'text', minWidth: 160 },
          { key: 'sub_sector', label: 'Sub Sector', type: 'text', minWidth: 160 },
          { key: 'code', label: 'Code', type: 'text', width: 100 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 11(a) — Books of Account prescribed u/s 44AA ═══════
  {
    clauseNo: '11a', displayOrder: 11, isActive: true,
    title: 'Books prescribed u/s 44AA',
    heading: 'Whether books of account are prescribed under section 44AA, if yes, list of books so prescribed.',
    control: 'yes_no',
    subClauses: [
      {
        key: 'cl_11a_books', heading: 'List of books prescribed',
        control: 'structured_table',
        dependsOn: 'cl_11a', dependsOnValue: true,
        annexureColumns: [
          { key: 'book', label: 'Book of Account', type: 'dropdown', dropdownRef: 'BOOKS_LIST', minWidth: 200 },
          { key: 'specify', label: 'Specify (if Others)', type: 'text', width: 200 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 11(b) — Books maintained — Address ═══════
  {
    clauseNo: '11b', displayOrder: 11.5, isActive: true,
    title: 'Books maintained — address',
    heading: 'List of books of account maintained and the address at which the books of account are kept.',
    control: 'same_as_checkbox',
    defaultValue: 'same_as_11a',
  },

  // ═══════ CLAUSE 11(c) — Books and Documents Examined ═══════
  {
    clauseNo: '11c', displayOrder: 11.7, isActive: true,
    title: 'Books & documents examined',
    heading: 'List of books of account and nature of relevant documents examined.',
    control: 'same_as_checkbox',
    defaultValue: 'same_as_above',
  },

  // ═══════ CLAUSE 12 — Presumptive Basis Income ═══════
  {
    clauseNo: '12', displayOrder: 12, isActive: true,
    title: 'Presumptive basis income',
    heading: 'Whether the profit and loss account includes any profits and gains assessable on presumptive basis, if yes, indicate the amount and the relevant section (44AD, 44ADA, 44AE, 44AF, 44B, 44BB, 44BBA, 44BBB, 44BBC, Chapter XII-G, First Schedule or any other relevant section.)',
    control: 'yes_no_na',
    subClauses: [
      {
        key: 'cl_12_details', heading: 'Details of presumptive income',
        control: 'not_applicable_annexure',
        dependsOn: 'cl_12', dependsOnValue: 'yes',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'PRESUMPTIVE_SECTIONS', minWidth: 200 },
          { key: 'description', label: 'Description / Other Section', type: 'text', minWidth: 180 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 13(a) — Method of Accounting ═══════
  {
    clauseNo: '13a', displayOrder: 13, isActive: true,
    title: 'Method of accounting',
    heading: 'Method of accounting employed in the previous year.',
    control: 'dropdown',
    dropdownRef: 'ACCOUNTING_METHOD',
  },

  // ═══════ CLAUSE 13(b) — Change in Method ═══════
  {
    clauseNo: '13b', displayOrder: 13.5, isActive: true,
    title: 'Change in accounting method',
    heading: 'Whether there had been any change in the method of accounting employed vis-a-vis the method employed in the immediately preceding previous year.',
    control: 'yes_no',
    defaultValue: 'No change in method',
    subClauses: [
      {
        key: 'cl_13c', heading: 'Details of such change and effect on profit or loss',
        control: 'not_applicable_annexure',
        dependsOn: 'cl_13b', dependsOnValue: true,
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text', minWidth: 200 },
          { key: 'increase', label: 'Increase in Profit (₹)', type: 'numeric', width: 140 },
          { key: 'decrease', label: 'Decrease in Profit (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 13(d) — ICDS Adjustment Required ═══════
  {
    clauseNo: '13d', displayOrder: 13.7, isActive: true,
    title: 'ICDS adjustment required',
    heading: 'Whether any adjustment is required to be made to the profits or loss for complying with the provisions of income computation and disclosure standards (ICDS) notified under section 145(2).',
    control: 'yes_no',
    subClauses: [
      {
        key: 'cl_13e', heading: 'Details of ICDS adjustments',
        control: 'structured_table',
        dependsOn: 'cl_13d', dependsOnValue: true,
        annexureColumns: [
          { key: 'icds', label: 'ICDS', type: 'dropdown', dropdownRef: 'ICDS', minWidth: 220 },
          { key: 'increase', label: 'Increase in Profit (₹)', type: 'numeric', width: 140 },
          { key: 'decrease', label: 'Decrease in Profit (₹)', type: 'numeric', width: 140 },
          { key: 'net_effect', label: 'Net Effect (₹)', type: 'auto_calc', width: 130, formula: 'increase - decrease' },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 13(f) — ICDS Disclosure ═══════
  {
    clauseNo: '13f', displayOrder: 13.8, isActive: true,
    title: 'ICDS disclosure',
    heading: 'Disclosure as per ICDS.',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'icds', label: 'ICDS', type: 'dropdown', dropdownRef: 'ICDS', minWidth: 220 },
      { key: 'disclosure', label: 'Disclosure', type: 'text', minWidth: 300 },
    ],
  },

  // ═══════ CLAUSE 14(a) — Method of Valuation ═══════
  {
    clauseNo: '14a', displayOrder: 14, isActive: true,
    title: 'Method of valuation of closing stock',
    heading: 'Method of valuation of closing stock employed in the previous year.',
    control: 'dropdown',
    dropdownRef: 'STOCK_VALUATION_14',
  },

  // ═══════ CLAUSE 14(b) — Deviation from 145A ═══════
  {
    clauseNo: '14b', displayOrder: 14.5, isActive: true,
    title: 'Deviation from section 145A',
    heading: 'In case of deviation from the method of valuation prescribed under section 145A, and the effect thereof on the profit or loss, please furnish:',
    control: 'yes_no',
    defaultValue: 'Nil',
    subClauses: [
      {
        key: 'cl_14b_details', heading: 'Details of deviation',
        control: 'not_applicable_annexure',
        dependsOn: 'cl_14b', dependsOnValue: true,
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text', minWidth: 200 },
          { key: 'increase', label: 'Increase in Profit (₹)', type: 'numeric', width: 140 },
          { key: 'decrease', label: 'Decrease in Profit (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSES 15–16 ═══════
  {
    clauseNo: '15_16', displayOrder: 15, isActive: true,
    title: 'Amounts debited to P&L',
    heading: 'Amounts debited to profit and loss account — capital expenditure, personal expenditure',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_15', heading: '15 — Amounts debited to P&L not allowable u/s 36',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'text', width: 120 },
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_16', heading: '16 — Amounts debited to P&L not allowable u/s 37',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 17 ═══════
  {
    clauseNo: '17', displayOrder: 17, isActive: true,
    title: 'Capital / personal / political expenditure debited to P&L',
    heading: 'Amounts debited to P&L being capital, personal or political expenditure',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_17a', heading: '17(a) — Capital expenditure debited to P&L',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_17b', heading: '17(b) — Personal expenditure debited to P&L',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_17c', heading: '17(c) — Expenditure by way of advertisement in political party souvenir/brochure',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'party', label: 'Name of Political Party', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 18 ═══════
  {
    clauseNo: '18', displayOrder: 18, isActive: true,
    title: 'Depreciation allowable',
    heading: 'Particulars of depreciation allowable as per the Income-tax Act, 1961',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'block', label: 'Block of Assets', type: 'text', minWidth: 160 },
      { key: 'openingWDV', label: 'Opening WDV (₹)', type: 'numeric', width: 110 },
      { key: 'addOver180', label: 'Add >180 days (full rate) (₹)', type: 'numeric', width: 130 },
      { key: 'addUnder180', label: 'Add ≤180 days (half rate) (₹)', type: 'numeric', width: 130 },
      { key: 'deductions', label: 'Deductions (₹)', type: 'numeric', width: 110 },
      { key: 'rate', label: 'Rate (%)', type: 'numeric', width: 80 },
      { key: 'dep', label: 'Depreciation (₹)', type: 'auto_calc', width: 110, formula: '(openingWDV + addOver180) * rate / 100 + addUnder180 * rate / 100 * 0.5' },
      { key: 'closingWDV', label: 'Closing WDV (₹)', type: 'auto_calc', width: 110, formula: 'openingWDV + addOver180 + addUnder180 - deductions - dep' },
      { key: 'depAsPerBooks', label: 'Dep as per Books (₹)', type: 'numeric', width: 130 },
      { key: 'diff', label: 'Difference (₹)', type: 'auto_calc', width: 110, formula: 'dep - depAsPerBooks' },
    ],
    notes: 'Full rate on opening WDV + additions >180 days. Half rate on additions ≤180 days.',
  },

  // ═══════ CLAUSE 19 ═══════
  {
    clauseNo: '19', displayOrder: 19, isActive: true,
    title: 'Amounts not deductible u/s 40(a)',
    heading: 'Amounts inadmissible under section 40(a)',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'SEC_40A', width: 140 },
      { key: 'nature', label: 'Nature of Payment', type: 'text' },
      { key: 'expenditure', label: 'Amount of Expenditure (₹)', type: 'numeric', width: 140 },
      { key: 'disallowed', label: 'Amount Disallowed (₹)', type: 'numeric', width: 140 },
      { key: 'remarks', label: 'Remarks', type: 'text', width: 160 },
    ],
  },

  // ═══════ CLAUSE 20 ═══════
  {
    clauseNo: '20', displayOrder: 20, isActive: true,
    title: 'Amounts inadmissible u/s 40A',
    heading: 'Amounts inadmissible under section 40A',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_20a', heading: '20(a) — Amounts inadmissible u/s 40A',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount_paid', label: 'Amount Paid (₹)', type: 'numeric', width: 130 },
          { key: 'amount_disallowable', label: 'Amount Disallowable (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_20b', heading: '20(b) — Payments to related parties u/s 40A(2)(a)',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of Person', type: 'text' },
          { key: 'relationship', label: 'Relationship', type: 'text', width: 120 },
          { key: 'nature', label: 'Nature of Payment', type: 'text' },
          { key: 'amount_paid', label: 'Amount Paid (₹)', type: 'numeric', width: 120 },
          { key: 'market_value', label: 'Market Value (₹)', type: 'numeric', width: 120 },
          { key: 'amount_disallowable', label: 'Amount Disallowable (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_20c', heading: '20(c) — Cash payments exceeding ₹10,000 u/s 40A(3)',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name_address', label: 'Name & Address of Payee', type: 'text' },
          { key: 'date', label: 'Date of Payment', type: 'date', width: 120 },
          { key: 'nature', label: 'Nature of Payment', type: 'text' },
          { key: 'amount', label: 'Amount Paid in Cash (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_20d', heading: '20(d) — Mark-to-market loss or other anticipated loss u/s 40A(13)',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars of Loss', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 21 ═══════
  {
    clauseNo: '21', displayOrder: 21, isActive: true,
    title: 'Amounts allowable on payment basis',
    heading: 'Amounts allowable on payment basis under various sections',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_21_applicable', heading: 'Amounts allowable on payment basis',
        control: 'not_applicable_annexure',
      },
      {
        key: 'cl_21a', heading: '21(a) — Amounts allowable on actual payment u/s 43B',
        control: 'composite', dependsOn: 'cl_21_applicable',
        subClauses: [
          ...(['tax_duty|Tax, duty, cess or fee',
            'employer_pf|Employer contribution to PF/ESI/Gratuity/superannuation fund',
            'bonus_comm|Bonus or commission to employees',
            'bank_interest|Interest on loan from public financial institution / scheduled bank / NBFC',
            'leave_salary|Leave encashment / leave salary',
            'railway|Sum payable to Railways for use of railway assets',
            'msme_43bh|Sum payable to MSME u/s 43B(h)'
          ].map((item, i) => {
            const [key, label] = item.split('|');
            return {
              key: `cl_21a_${key}`,
              heading: `(${['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'][i]}) ${label}`,
              control: 'structured_table' as const,
              annexureColumns: [
                { key: 'payee', label: 'Payee Name / Details', type: 'text' as const },
                { key: 'amount_due', label: 'Amount Due (₹)', type: 'numeric' as const, width: 120 },
                { key: 'amount_paid', label: 'Amount Paid (₹)', type: 'numeric' as const, width: 120 },
                { key: 'date_payment', label: 'Date of Payment', type: 'date' as const, width: 120 },
                { key: 'delayed', label: 'Delayed? (Y/N)', type: 'yes_no_dropdown' as const, width: 90 },
              ],
            };
          })),
        ],
      },
      {
        key: 'cl_21b', heading: '21(b) — Employee contribution to PF/ESI u/s 36(1)(va)',
        control: 'structured_table',
        annexureColumns: [
          { key: 'fund', label: 'Fund Name', type: 'text' },
          { key: 'amount_deducted', label: 'Amount Deducted from Salary (₹)', type: 'numeric', width: 160 },
          { key: 'due_date', label: 'Due Date for Deposit', type: 'date', width: 120 },
          { key: 'actual_date', label: 'Date Actually Deposited', type: 'date', width: 130 },
          { key: 'delayed', label: 'Delayed? (Y/N)', type: 'yes_no_dropdown', width: 90 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 22 ═══════
  {
    clauseNo: '22', displayOrder: 22, isActive: true,
    title: 'Personal expenditure',
    heading: 'Amounts debited to P&L being expenditure of personal nature',
    control: 'structured_table',
    showTotals: true, totalColumns: ['amount'],
    annexureColumns: [
      { key: 'sr_no', label: 'Sr No', type: 'text', width: 60 },
      { key: 'particulars', label: 'Particulars of Personal Expenditure', type: 'text' },
      { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
    ],
  },

  // ═══════ CLAUSE 23 ═══════
  {
    clauseNo: '23', displayOrder: 23, isActive: true,
    title: 'Payments to specified persons',
    heading: 'Particulars of payments made to persons specified under section 40A(2)(b)',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'pan', label: 'PAN', type: 'pan', width: 120 },
      { key: 'relationship', label: 'Relationship', type: 'text', width: 120 },
      { key: 'nature', label: 'Nature of Payment', type: 'text' },
      { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 130 },
    ],
  },

  // ═══════ CLAUSES 24–25 ═══════
  {
    clauseNo: '24_25', displayOrder: 24, isActive: true,
    title: 'Deemed profits / chargeable amounts',
    heading: 'Amounts deemed as profits / Any amount chargeable to tax',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_24', heading: 'Clause 24 — Amounts deemed as profits u/s 33AB/33ABA/33AC',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'text', width: 120 },
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_25', heading: 'Clause 25 — Any amount of profit chargeable to tax under the Act',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', width: 140,
            options: ['41', '32AC', '32AD', '33AB', '33ABA', '35ABB', '40A(3A)', '43CA', '43D', 'Other'].map(v => ({ value: v, label: v })) },
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount Chargeable to Tax (₹)', type: 'numeric', width: 160 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 26 ═══════
  {
    clauseNo: '26', displayOrder: 26, isActive: true,
    title: 'Loss/expenditure disallowable',
    heading: 'Any amount of loss or expenditure inadmissible',
    control: 'composite',
    subClauses: [
      { key: 'cl_26ai', heading: '26(a)(i) — Penalty / Fine for violation of law', control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      { key: 'cl_26aii', heading: '26(a)(ii) — Penalty / Fine for violation of any enactment', control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      { key: 'cl_26aiii', heading: '26(a)(iii) — Amount disallowed u/s 37(1)', control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      { key: 'cl_26aiv', heading: '26(a)(iv) — Any expenditure by way of contribution to political party', control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 27 ═══════
  {
    clauseNo: '27', displayOrder: 27, isActive: true,
    title: 'Deemed income / prior period items',
    heading: 'Amounts received or deemed income / Prior period items / Unexplained cash credits',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_27a', heading: '27(a) — Amounts not credited to P&L but assessable',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_27b', heading: '27(b) — Prior period items credited to P&L',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'year', label: 'Year to which it relates', type: 'text', width: 120 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // Clauses 28 & 29 — OMITTED (no longer part of statutory form)
  { clauseNo: '28', displayOrder: 28, isActive: false, title: 'Omitted', heading: 'Omitted', control: 'single_field' },
  { clauseNo: '29', displayOrder: 29, isActive: false, title: 'Omitted', heading: 'Omitted', control: 'single_field' },

  // ═══════ CLAUSE 30 ═══════
  {
    clauseNo: '30', displayOrder: 30, isActive: true,
    title: 'Govt receipts / MSME / Tax paid / Hundi',
    heading: 'Amounts received from Government / MSME payments u/s 43B(h) / Tax paid / Hundi',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_30a', heading: '30(A) — MSME payments due > specified period',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of MSME Supplier', type: 'text' },
          { key: 'amount_due', label: 'Amount Due (₹)', type: 'numeric', width: 120 },
          { key: 'due_date', label: 'Due Date', type: 'date', width: 110 },
          { key: 'amount_outstanding', label: 'Amount Outstanding (₹)', type: 'numeric', width: 140 },
          { key: 'interest', label: 'Interest payable u/s 16 (₹)', type: 'numeric', width: 140 },
          { key: 'remarks', label: 'Remarks', type: 'text', width: 130 },
        ],
      },
      {
        key: 'cl_30b', heading: '30(B) — Tax paid (advance tax, TDS, TCS)',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_30c', heading: '30(C) — Hundi transactions',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 31 ═══════
  {
    clauseNo: '31', displayOrder: 31, isActive: true,
    title: 'Loans/deposits u/s 269SS/269T · Cash transactions · SFT',
    heading: 'Loans/deposits u/s 269SS/269T, Cash transactions u/s 269ST, SFT u/s 285BA',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_31a', heading: '31(a) — Loans/deposits accepted/repaid u/s 269SS/269T',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of Lender/Depositor', type: 'text' },
          { key: 'pan', label: 'PAN', type: 'pan', width: 120 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 130 },
          { key: 'nature', label: 'Nature (Loan/Deposit)', type: 'text', width: 120 },
          { key: 'accepted_repaid', label: 'Accepted/Repaid', type: 'text', width: 110 },
          { key: 'mode', label: 'Mode of Transaction', type: 'text', width: 130 },
        ],
      },
      {
        key: 'cl_31b', heading: '31(b) — Cash transactions exceeding limit u/s 269ST',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'pan', label: 'PAN', type: 'pan', width: 120 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 130 },
          { key: 'nature', label: 'Nature of Transaction', type: 'text' },
          { key: 'date', label: 'Date', type: 'date', width: 110 },
        ],
      },
      {
        key: 'cl_31c', heading: '31(c) — Statement of Financial Transactions (SFT) u/s 285BA',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'nature', label: 'Nature of SFT', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 130 },
          { key: 'filed', label: 'Whether filed (Y/N)', type: 'yes_no_dropdown', width: 100 },
          { key: 'date_filed', label: 'Date of Filing', type: 'date', width: 110 },
          { key: 'ack_no', label: 'Acknowledgement No.', type: 'text', width: 140 },
        ],
      },
      {
        key: 'cl_31d', heading: '31(d) — Deemed dividend u/s 2(22)(e)',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 32 ═══════
  {
    clauseNo: '32', displayOrder: 32, isActive: true,
    title: 'Brought forward losses / deductions',
    heading: 'Brought forward losses / Deemed deductions / Speculation & specified business losses',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_32a', heading: '32(a) — Brought forward loss / depreciation',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'nature', label: 'Nature of Loss', type: 'dropdown', dropdownRef: 'LOSS_NATURE', width: 160 },
          { key: 'ay', label: 'Assessment Year', type: 'text', width: 100 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
          { key: 'set_off', label: 'Set off this year (₹)', type: 'numeric', width: 140 },
          { key: 'carried_forward', label: 'Carried Forward (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_32b', heading: '32(b) — Deductions under Chapter VI-A',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'SEC_CHAPTER_VIA', width: 120 },
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount Claimed (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 33 ═══════
  {
    clauseNo: '33', displayOrder: 33, isActive: true,
    title: 'Deductions u/s 80G/80GGA/80GGB/80GGC',
    heading: 'Deductions claimed under sections 80G / 80GGA / 80GGB / 80GGC',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'donee_name', label: 'Name of Donee', type: 'text', minWidth: 140 },
      { key: 'address', label: 'Address', type: 'text', minWidth: 120 },
      { key: 'pan', label: 'PAN of Donee', type: 'pan', width: 110 },
      { key: 'reg_no', label: 'Reg. No.', type: 'text', width: 100 },
      { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'DONATION_SECTIONS', width: 90 },
      { key: 'amount_donated', label: 'Amount Donated (₹)', type: 'numeric', width: 120 },
      { key: 'mode', label: 'Mode of Payment', type: 'dropdown', dropdownRef: 'PAYMENT_MODE', width: 110 },
      { key: 'date', label: 'Date of Donation', type: 'date', width: 110 },
      { key: 'qualifying', label: 'Qualifying Amount (₹)', type: 'numeric', width: 120 },
      { key: 'deduction', label: 'Deduction Amount (₹)', type: 'numeric', width: 120 },
    ],
  },

  // ═══════ CLAUSE 34 ═══════
  {
    clauseNo: '34', displayOrder: 34, isActive: true,
    title: 'TDS/TCS compliance',
    heading: 'Whether TDS / TCS has been deducted / collected as per the provisions',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_34a', heading: '34(a) — Whether tax has been deducted at source as per provisions of sections 192 to 196D?',
        control: 'yes_no',
        subClauses: [
          {
            key: 'cl_34a_details', heading: 'TDS Schedule',
            control: 'structured_table', dependsOn: 'cl_34a', dependsOnValue: true,
            annexureColumns: [
              { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'TDS_SECTIONS', width: 100 },
              { key: 'nature', label: 'Nature of Payment', type: 'readonly' },
              { key: 'name', label: 'Name of Party', type: 'text' },
              { key: 'pan', label: 'PAN', type: 'pan', width: 110 },
              { key: 'amountPaid', label: 'Amount Paid (₹)', type: 'numeric', width: 110 },
              { key: 'tdsDeducted', label: 'TDS Deducted (₹)', type: 'numeric', width: 110 },
              { key: 'tdsRate', label: 'Rate (%)', type: 'numeric', width: 80 },
              { key: 'dateDeduction', label: 'Date of Deduction', type: 'date', width: 110 },
              { key: 'dateDeposit', label: 'Date of Deposit', type: 'date', width: 110 },
              { key: 'remarks', label: 'Remarks', type: 'text', width: 110 },
            ],
            showTotals: true, totalColumns: ['amountPaid', 'tdsDeducted'],
          },
        ],
      },
      {
        key: 'cl_34b', heading: '34(b) — Whether TDS has been deposited within the time prescribed?',
        control: 'yes_no',
        subClauses: [
          {
            key: 'cl_34b_details', heading: 'Late deposit details',
            control: 'structured_table', dependsOn: 'cl_34b', dependsOnValue: false,
            annexureColumns: [
              { key: 'section', label: 'Section', type: 'text', width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 110 },
              { key: 'dueDate', label: 'Due Date', type: 'date', width: 110 },
              { key: 'actualDate', label: 'Actual Date', type: 'date', width: 110 },
              { key: 'delay', label: 'Delay', type: 'auto_calc', width: 90, formula: 'date_diff(actualDate, dueDate)' },
            ],
          },
        ],
      },
      {
        key: 'cl_34c', heading: '34(c) — Whether tax has been collected at source as per provisions of sections 206C?',
        control: 'yes_no',
        subClauses: [
          {
            key: 'cl_34c_details', heading: 'TCS details',
            control: 'structured_table', dependsOn: 'cl_34c', dependsOnValue: true,
            annexureColumns: [
              { key: 'section', label: 'Section', type: 'text', width: 100 },
              { key: 'nature', label: 'Nature of Transaction', type: 'text' },
              { key: 'name', label: 'Name of Buyer', type: 'text' },
              { key: 'pan', label: 'PAN', type: 'pan', width: 110 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 110 },
              { key: 'tcs', label: 'TCS Collected (₹)', type: 'numeric', width: 110 },
              { key: 'date_collection', label: 'Date of Collection', type: 'date', width: 110 },
              { key: 'date_deposit', label: 'Date of Deposit', type: 'date', width: 110 },
            ],
          },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 35 ═══════
  {
    clauseNo: '35', displayOrder: 35, isActive: true,
    title: 'Turnover / Receipts',
    heading: 'Quantitative details of turnover / receipts',
    control: 'composite',
    subClauses: ['a', 'b'].map((sub, i) => ({
      key: `cl_35${sub}`,
      heading: `35(${sub}) — ${sub === 'a' ? 'Gross turnover / receipts' : 'Gross receipts from profession'}`,
      control: 'not_applicable_annexure' as const,
      annexureColumns: [
        { key: 'commodity', label: 'Commodity/Service', type: 'text' as const },
        { key: 'unit', label: 'Unit', type: 'dropdown' as const, dropdownRef: 'STOCK_UNITS', width: 90 },
        { key: 'openQty', label: 'Open Qty', type: 'numeric' as const, width: 90 },
        { key: 'openVal', label: 'Open Val (₹)', type: 'numeric' as const, width: 100 },
        { key: 'purchQty', label: 'Purch Qty', type: 'numeric' as const, width: 90 },
        { key: 'purchVal', label: 'Purch Val (₹)', type: 'numeric' as const, width: 100 },
        { key: 'salesQty', label: 'Sales Qty', type: 'numeric' as const, width: 90 },
        { key: 'salesVal', label: 'Sales Val (₹)', type: 'numeric' as const, width: 100 },
        { key: 'closeQty', label: 'Close Qty', type: 'numeric' as const, width: 90 },
        { key: 'closeVal', label: 'Close Val (₹)', type: 'numeric' as const, width: 100 },
      ],
      showTotals: true,
      totalColumns: ['openVal', 'purchVal', 'salesVal', 'closeVal'],
    })),
  },

  // ═══════ CLAUSE 36 ═══════
  {
    clauseNo: '36', displayOrder: 36, isActive: true,
    title: 'Amounts not credited to P&L',
    heading: 'Amounts not credited to the profit and loss account',
    control: 'composite',
    subClauses: ['a', 'b'].map(sub => ({
      key: `cl_36${sub}`,
      heading: `36(${sub}) — ${sub === 'a' ? 'Amounts not credited to P&L but taxable' : 'Other amounts not credited'}`,
      control: 'yes_no' as const,
      subClauses: [{
        key: `cl_36${sub}_details`, heading: 'Details',
        control: 'structured_table' as const, dependsOn: `cl_36${sub}`, dependsOnValue: true,
        annexureColumns: [
          { key: 'sr_no', label: 'Sr No', type: 'text' as const, width: 60 },
          { key: 'nature', label: 'Nature of Receipt / Amount', type: 'text' as const },
          { key: 'date', label: 'Date of Receipt', type: 'date' as const, width: 110 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 130 },
          { key: 'remarks', label: 'Remarks', type: 'text' as const },
        ],
      }],
    })),
  },

  // ═══════ CLAUSES 37-39 ═══════
  {
    clauseNo: '37_39', displayOrder: 37, isActive: true,
    title: 'Partner in firm / Statutory audit / Non-resident payments',
    heading: 'Partner in firm, statutory audit under other law, non-resident payments',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_37', heading: '37 — Whether the assessee is a partner in any firm or member of any AOP/BOI whose accounts have been audited u/s 44AB?',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_37_details', heading: 'Details', control: 'structured_table',
          dependsOn: 'cl_37', dependsOnValue: true,
          annexureColumns: [
            { key: 'name', label: 'Name of Firm/AOP/BOI', type: 'text' },
            { key: 'pan', label: 'PAN', type: 'pan', width: 110 },
            { key: 'profit_share', label: 'Profit Share %', type: 'numeric', width: 100 },
            { key: 'audited', label: 'Whether accounts audited', type: 'yes_no_dropdown', width: 130 },
            { key: 'date', label: 'Date of Audit Report', type: 'date', width: 120 },
          ],
        }],
      },
      {
        key: 'cl_38', heading: '38 — Whether the accounts have been audited under any law other than the IT Act?',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_38_details', heading: 'Details', control: 'structured_table',
          dependsOn: 'cl_38', dependsOnValue: true,
          annexureColumns: [
            { key: 'statute', label: 'Name of Statute', type: 'text' },
            { key: 'auditor', label: 'Name of Auditor', type: 'text' },
            { key: 'membership', label: 'Membership No.', type: 'text', width: 110 },
            { key: 'date', label: 'Date of Audit Report', type: 'date', width: 120 },
            { key: 'period', label: 'Period Covered', type: 'text', width: 110 },
            { key: 'observations', label: 'Observations', type: 'text' },
          ],
        }],
      },
      {
        key: 'cl_39', heading: '39 — Whether any tax has been deducted/withheld on income paid/credited to non-residents?',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_39_details', heading: 'Details', control: 'structured_table',
          dependsOn: 'cl_39', dependsOnValue: true,
          annexureColumns: [
            { key: 'name', label: 'Name of Non-Resident', type: 'text' },
            { key: 'country', label: 'Country', type: 'text', width: 100 },
            { key: 'pan', label: 'PAN/TAN', type: 'pan', width: 110 },
            { key: 'nature', label: 'Nature of Payment', type: 'text' },
            { key: 'amount_paid', label: 'Amount Paid (₹)', type: 'numeric', width: 120 },
            { key: 'tax_withheld', label: 'Tax Withheld (₹)', type: 'numeric', width: 120 },
            { key: 'section', label: 'Section', type: 'text', width: 90 },
          ],
        }],
      },
    ],
  },

  // ═══════ CLAUSE 40 ═══════
  {
    clauseNo: '40', displayOrder: 40, isActive: true,
    title: 'Shares issued above FMV u/s 56(2)(viib)',
    heading: 'Whether consideration received for issue of shares exceeding Fair Market Value u/s 56(2)(viib)',
    control: 'yes_no',
    subClauses: [{
      key: 'cl_40_details', heading: 'Details of share issuance', control: 'structured_table',
      dependsOn: 'cl_40', dependsOnValue: true,
      annexureColumns: [
        { key: 'name', label: 'Name of Investor', type: 'text' },
        { key: 'pan', label: 'PAN', type: 'pan', width: 110 },
        { key: 'no_shares', label: 'No. of Shares Issued', type: 'numeric', width: 120 },
        { key: 'issue_price', label: 'Issue Price/Share (₹)', type: 'numeric', width: 120 },
        { key: 'fmv', label: 'FMV/Share (₹)', type: 'numeric', width: 110 },
        { key: 'excess', label: 'Excess Amount (₹)', type: 'auto_calc', width: 120, formula: '(issue_price - fmv) * no_shares' },
        { key: 'date', label: 'Date of Issue', type: 'date', width: 110 },
      ],
    }],
  },

  // ═══════ CLAUSE 41 ═══════
  {
    clauseNo: '41', displayOrder: 41, isActive: true,
    title: 'MSME outstanding > 45 days',
    heading: 'MSME payments outstanding for more than 45 days',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'name', label: 'Name of MSME Supplier', type: 'text' },
      { key: 'amountDue', label: 'Amount of Payment Due (₹)', type: 'numeric', width: 130 },
      { key: 'dueDate', label: 'Due Date for Payment', type: 'date', width: 120 },
      { key: 'amountOver45', label: 'Amount Outstanding >45 days (₹)', type: 'numeric', width: 150 },
      { key: 'interest', label: 'Interest payable u/s 16 (₹)', type: 'numeric', width: 140 },
      { key: 'remarks', label: 'Remarks', type: 'text', width: 120 },
    ],
  },

  // ═══════ CLAUSES 42–43 ═══════
  {
    clauseNo: '42_43', displayOrder: 42, isActive: true,
    title: 'Form 61 / Form 61A',
    heading: 'Furnishing of Form 61 / Form 61A (SFT)',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_42', heading: '42 — Furnishing of Form 61?',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_42_details', heading: 'Details', control: 'structured_table',
          dependsOn: 'cl_42', dependsOnValue: true,
          annexureColumns: [
            { key: 'nature', label: 'Nature of Transaction', type: 'text' },
            { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 120 },
            { key: 'pan', label: 'PAN of Other Party', type: 'pan', width: 120 },
            { key: 'filed', label: 'Whether Form 61 filed', type: 'yes_no_dropdown', width: 110 },
            { key: 'date_filed', label: 'Date of Filing', type: 'date', width: 110 },
            { key: 'ack_no', label: 'Ack No.', type: 'text', width: 120 },
          ],
        }],
      },
      {
        key: 'cl_43', heading: '43 — Furnishing of Form 61A (SFT)?',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_43_details', heading: 'Details', control: 'structured_table',
          dependsOn: 'cl_43', dependsOnValue: true,
          annexureColumns: [
            { key: 'nature', label: 'Nature of SFT', type: 'text' },
            { key: 'threshold', label: 'Threshold Amount (₹)', type: 'numeric', width: 130 },
            { key: 'aggregate', label: 'Aggregate Value (₹)', type: 'numeric', width: 130 },
            { key: 'filed', label: 'Whether Form 61A filed', type: 'yes_no_dropdown', width: 110 },
            { key: 'date_filed', label: 'Date of Filing', type: 'date', width: 110 },
            { key: 'ack_no', label: 'Ack No.', type: 'text', width: 120 },
          ],
        }],
      },
    ],
  },

  // ═══════ CLAUSE 44 ═══════
  {
    clauseNo: '44', displayOrder: 44, isActive: true,
    title: 'GST breakup of expenditure',
    heading: 'Break-up of total expenditure of entities registered or not registered under GST',
    control: 'not_applicable_annexure',
    showTotals: true,
    totalColumns: ['totalAmount', 'regTaxable', 'regComposition', 'regExempt', 'unregistered'],
    annexureColumns: [
      { key: 'particulars', label: 'Particulars of Expenditure', type: 'text', minWidth: 200 },
      { key: 'totalAmount', label: 'Total Amount (₹)', type: 'numeric', width: 120 },
      { key: 'regTaxable', label: 'Registered GST — Taxable (₹)', type: 'numeric', width: 130 },
      { key: 'regComposition', label: 'Registered GST — Composition (₹)', type: 'numeric', width: 140 },
      { key: 'regExempt', label: 'Registered GST — Exempt/Nil Rated (₹)', type: 'numeric', width: 150 },
      { key: 'unregistered', label: 'Not Registered under GST (₹)', type: 'numeric', width: 140 },
    ],
  },
];
