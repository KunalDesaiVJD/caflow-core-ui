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
      { key: 'sector', label: 'Sector', type: 'dropdown', minWidth: 220 },
      { key: 'sub_sector', label: 'Sub Sector (dependent on Sector)', type: 'dropdown', dependsOnColumn: 'sector', minWidth: 280 },
      { key: 'code', label: 'Code (Auto)', type: 'readonly', width: 90 },
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
          { key: 'sector', label: 'Sector', type: 'dropdown', minWidth: 220 },
          { key: 'sub_sector', label: 'Sub Sector (dependent on Sector)', type: 'dropdown', dependsOnColumn: 'sector', minWidth: 280 },
          { key: 'code', label: 'Code (Auto)', type: 'readonly', width: 90 },
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
        dependsOn: '11a', dependsOnValue: true,
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
        dependsOn: '12', dependsOnValue: 'yes',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'PRESUMPTIVE_SECTIONS', minWidth: 200 },
          { key: 'other_section', label: 'Other Section (specify)', type: 'text', minWidth: 180,
            conditionalOn: 'section', conditionalOnValue: 'Any other relevant section' },
          { key: 'amount', label: 'Amount (Rs.)', type: 'numeric', width: 140 },
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
  },

  // ═══════ CLAUSE 13(c) — Details of change (separate, depends on 13b=Yes) ═══════
  {
    clauseNo: '13c', displayOrder: 13.6, isActive: true,
    title: 'Details of such change and effect on profit or loss',
    heading: '13(c) — Details of such change and effect on profit or loss',
    control: 'structured_table',
    dependsOn: '13b',
    dependsOnValue: true,
    annexureColumns: [
      { key: 'particulars', label: 'Particulars', type: 'text', minWidth: 220 },
      { key: 'increase', label: 'Increase in Profit (Rs.)', type: 'numeric', width: 160 },
      { key: 'decrease', label: 'Decrease in Profit (Rs.)', type: 'numeric', width: 160 },
    ],
  },

  // ═══════ CLAUSE 13(d) — ICDS Adjustment Required ═══════
  {
    clauseNo: '13d', displayOrder: 13.7, isActive: true,
    title: 'ICDS adjustment required',
    heading: 'Whether any adjustment is required to be made to the profits or loss for complying with the provisions of income computation and disclosure standards (ICDS) notified under section 145(2).',
    control: 'yes_no',
  },

  // ═══════ CLAUSE 13(e) — Details of ICDS adjustments (separate, depends on 13d=Yes) ═══════
  {
    clauseNo: '13e', displayOrder: 13.75, isActive: true,
    title: 'Details of ICDS adjustments',
    heading: 'Details of ICDS adjustments',
    control: 'structured_table',
    dependsOn: '13d',
    dependsOnValue: true,
    annexureColumns: [
      { key: 'icds', label: 'ICDS', type: 'dropdown', dropdownRef: 'ICDS', minWidth: 220 },
      { key: 'increase', label: 'Increase in Profit (₹)', type: 'numeric', width: 140 },
      { key: 'decrease', label: 'Decrease in Profit (₹)', type: 'numeric', width: 140 },
      { key: 'net_effect', label: 'Net Effect (₹)', type: 'auto_calc', width: 130, formula: 'increase - decrease' },
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
        dependsOn: '14b', dependsOnValue: true,
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text', minWidth: 200 },
          { key: 'increase', label: 'Increase in Profit (₹)', type: 'numeric', width: 140 },
          { key: 'decrease', label: 'Decrease in Profit (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 15 — Capital Asset Converted to Stock-in-Trade ═══════
  {
    clauseNo: '15', displayOrder: 15, isActive: true,
    title: 'Capital asset converted to stock-in-trade',
    heading: 'Give the following particulars of the capital asset converted into stock-in-trade:',
    control: 'not_applicable_annexure',
    notes: 'Vertical per-asset format with Add Another Asset button',
    annexureColumns: [
      { key: 'description', label: '(a) Description of capital asset', type: 'text', minWidth: 200 },
      { key: 'date_of_acquisition', label: '(b) Date of acquisition', type: 'date', width: 140 },
      { key: 'cost_of_acquisition', label: '(c) Cost of acquisition (₹)', type: 'numeric', width: 160 },
      { key: 'amount_converted', label: '(d) Amount at which converted into stock-in-trade (₹)', type: 'numeric', width: 180 },
    ],
  },

  // ═══════ CLAUSE 16 — Amounts Not Credited to P&L ═══════
  {
    clauseNo: '16', displayOrder: 16, isActive: true,
    title: 'Amounts not credited to P&L',
    heading: 'Amounts not credited to the profit and loss account, being —',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_16a', heading: '16(a) — Items falling within the scope of section 28.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'sr_no', label: 'S.N.', type: 'readonly', width: 50 },
          { key: 'description', label: 'Description', type: 'text', minWidth: 200 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_16b', heading: '16(b) — The proforma credits, drawbacks, refund of duty of customs or excise or service tax or refunds of sales tax or value added tax or Goods & Services Tax, where such credits, drawbacks or refunds are admitted as due by the authorities concerned.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'description', label: 'Description', type: 'dropdown', dropdownRef: 'REFUND_DESCRIPTION_16B', minWidth: 200 },
          { key: 'other_description', label: 'Other Description', type: 'text', minWidth: 160, conditionalOn: 'description', conditionalOnValue: 'Others' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_16c', heading: '16(c) — Escalation claims accepted during the previous year.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'sr_no', label: 'S.N.', type: 'readonly', width: 50 },
          { key: 'description', label: 'Description', type: 'text', minWidth: 200 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_16d', heading: '16(d) — Any other item of income.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'sr_no', label: 'S.N.', type: 'readonly', width: 50 },
          { key: 'description', label: 'Description', type: 'text', minWidth: 200 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
      {
        key: 'cl_16e', heading: '16(e) — Capital receipt, if any.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'sr_no', label: 'S.N.', type: 'readonly', width: 50 },
          { key: 'description', label: 'Description', type: 'text', minWidth: 200 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 17 — Land/Building Transfer Below Stamp Duty Value ═══════
  {
    clauseNo: '17', displayOrder: 17, isActive: true,
    title: 'Land/building transfer below stamp duty value',
    heading: 'Where any land or building or both is transferred during the previous year for a consideration less than value adopted or assessed or assessable by any authority of a State Government referred to in section 43CA or 50C, please furnish:',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'consideration', label: 'Consideration received or accrued (₹)', type: 'numeric', width: 160 },
      { key: 'stamp_duty_value', label: 'Value adopted/assessed/assessable (₹)', type: 'numeric', width: 180 },
      { key: 'proviso_applicable', label: 'Whether provisions of second proviso to sec 43CA or fourth proviso to sec 56(2)(x) applicable', type: 'yes_no_dropdown', width: 200 },
      { key: 'property_details', label: 'Details of property', type: 'text', minWidth: 200 },
    ],
  },

  // ═══════ CLAUSE 18 — Depreciation Allowable — IT Act ═══════
  {
    clauseNo: '18', displayOrder: 18, isActive: true,
    title: 'Depreciation allowable',
    heading: 'Particulars of depreciation allowable as per the Income-tax Act, 1961 in respect of each asset or block of assets, as the case may be, in the following form.',
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

  // ═══════ CLAUSE 19 — Amounts Admissible Under Specified Sections ═══════
  {
    clauseNo: '19', displayOrder: 19, isActive: true,
    title: 'Amounts admissible under specified sections',
    heading: 'Amount admissible under sections:- (a)33AB (b)33ABA (c)35(1)(i) (d)35(1)(ii) (e)35(1)(iia) (f)35(1)(iii) (g)35(1)(iv) (h)35(2AA) (i)35(2AB) (j)35ABB (k)35ABA (l)35AD (m)35CCA (n)35CCC (s)35CCD (t)35D (u)35DD (v)35DDA (x)35E (y) any other relevant section',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'sr_no', label: 'SN', type: 'readonly', width: 50 },
      { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'SEC_19_ADMISSIBLE', minWidth: 200 },
      { key: 'amount_debited', label: 'Amount debited to P&L (₹)', type: 'numeric', width: 150 },
      { key: 'amount_admissible', label: 'Amounts admissible as per IT Act 1961 (₹)', type: 'numeric', width: 180 },
      { key: 'other_section', label: 'Other Section', type: 'text', minWidth: 140, conditionalOn: 'section', conditionalOnValue: 'Any other relevant section' },
    ],
  },

  // ═══════ CLAUSE 20(a) — Bonus/Commission u/s 36(1)(ii) ═══════
  {
    clauseNo: '20a', displayOrder: 20, isActive: true,
    title: 'Bonus/commission u/s 36(1)(ii)',
    heading: 'Any sum paid to an employee as bonus or commission for services rendered, where such sum was otherwise payable to him as profits or dividend. [Section 36(1)(ii)]',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'description', label: 'Description', type: 'text', minWidth: 250 },
      { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
    ],
  },

  // ═══════ CLAUSE 20(b) — Employee Fund Contributions u/s 36(1)(va) ═══════
  {
    clauseNo: '20b', displayOrder: 20.5, isActive: true,
    title: 'Employee fund contributions u/s 36(1)(va)',
    heading: 'Details of contributions received from employees for various funds as referred to in section 36(1)(va).',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'sr_no', label: 'SN', type: 'readonly', width: 50 },
      { key: 'fund', label: 'Nature of Fund', type: 'dropdown', dropdownRef: 'NATURE_OF_FUND', minWidth: 180 },
      { key: 'employee_deduction', label: 'Employees\' Deduction (₹)', type: 'numeric', width: 140 },
      { key: 'employer_contribution', label: 'Employers\' Contribution (₹)', type: 'numeric', width: 150 },
      { key: 'due_date', label: 'Due Date of Payment', type: 'date', width: 130 },
      { key: 'actual_date', label: 'Actual Date of Payment', type: 'date', width: 140 },
      { key: 'disallowance', label: 'Disallowance (₹)', type: 'auto_calc', width: 130, formula: 'actual_date > due_date ? employee_deduction : 0' },
    ],
    notes: 'Disallowance auto-calculates: if Actual Date > Due Date, equals Employee Deduction; otherwise 0.',
  },

  // ═══════ CLAUSE 21 — COMPLETE REBUILD (9 sub-clauses) ═══════
  {
    clauseNo: '21', displayOrder: 21, isActive: true,
    title: 'Amounts debited to P&L — various disallowances',
    heading: 'Please furnish the details of amounts debited to the profit and loss account, being in the nature of capital, personal, advertisement expenditure etc.',
    control: 'composite',
    subClauses: [
      // ── 21(a) — 10 Independent Expenditure Line Items ──
      {
        key: 'cl_21a', heading: '21(a) — Amounts debited to P&L being capital, personal, advertisement expenditure etc.',
        control: 'composite',
        subClauses: [
          ...[
            'Capital expenditure',
            'Personal expenditure',
            'Advertisement expenditure in any souvenir, brochure, tract, pamphlet or the like published by a political party',
            'Expenditure incurred at clubs being entrance fees and subscriptions',
            'Expenditure incurred at clubs being cost for club services and facilities used',
            'Expenditure for any purpose which is an offence or is prohibited by law or expenditure by way of penalty or fine for violation of any law (enacted in India or outside India)',
            'Expenditure by way of other penalty or fine not covered above',
            'Expenditure incurred to compound an offence under any law for the time being in force, in India or outside India',
            'Expenditure incurred to provide any benefit or perquisite, in whatever form, to a person, whether or not carrying on a business or exercising a profession, and acceptance of such benefit or perquisite by such person is in violation of any law or rule or regulation or guideline, as the case may be, for the time being in force, governing the conduct of such person',
            'Expenditure incurred to settle proceedings initiated in relation to contravention under such law as notified by the Central Government in the Official Gazette in this behalf',
          ].map((label, i) => ({
            key: `cl_21a_${i + 1}`,
            heading: `(${i + 1}) ${label}`,
            control: 'not_applicable_annexure' as const,
            annexureColumns: [
              { key: 'sr_no', label: 'S.N.', type: 'readonly' as const, width: 50 },
              { key: 'particulars', label: 'Particulars', type: 'text' as const, minWidth: 200 },
              { key: 'amount', label: 'Amount in Rs.', type: 'numeric' as const, width: 140 },
            ],
          })),
        ],
      },

      // ── 21(b) — Sec 40(a) Inadmissible Payments ──
      {
        key: 'cl_21b', heading: '21(b) — Amounts inadmissible under section 40(a)',
        control: 'composite',
        subClauses: [
          // (i)(A) — Non-resident tax NOT deducted
          {
            key: 'cl_21b_iA', heading: '(i)(A) — Details of payment to non-resident on which tax is NOT deducted',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
            ],
          },
          // (i)(B) — Non-resident tax deducted but NOT paid
          {
            key: 'cl_21b_iB', heading: '(i)(B) — Details of payment to non-resident — tax deducted but NOT paid u/s 200(1)',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
              { key: 'tax_deducted', label: 'Amount of Tax Deducted (₹)', type: 'numeric' as const, width: 140 },
            ],
          },
          // (ii)(A)
          {
            key: 'cl_21b_iiA', heading: '(ii)(A) — Details of payment referred to in 40(a)(ia) — tax NOT deducted',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
            ],
          },
          // (ii)(B)
          {
            key: 'cl_21b_iiB', heading: '(ii)(B) — Details of payment referred to in 40(a)(ia) — tax deducted NOT paid before 139(1) due date',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
            ],
          },
          // (iii)(A)
          {
            key: 'cl_21b_iiiA', heading: '(iii)(A) — Details of payment referred to in 40(a)(ib) — levy NOT deducted',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
            ],
          },
          // (iii)(B)
          {
            key: 'cl_21b_iiiB', heading: '(iii)(B) — Details of payment referred to in 40(a)(ib) — levy deducted NOT paid',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
              { key: 'tax_deducted', label: 'Amount of Tax Deducted (₹)', type: 'numeric' as const, width: 140 },
              { key: 'tax_deposited', label: 'Amount deposited, if any (₹)', type: 'numeric' as const, width: 140 },
            ],
          },
          // (iv) — Single field
          { key: 'cl_21b_iv', heading: '(iv) — Fringe benefit tax under sub-clause (ic)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
          // (v) — Single field
          { key: 'cl_21b_v', heading: '(v) — Wealth tax under sub-clause (iia)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
          // (vi) — Single field
          { key: 'cl_21b_vi', heading: '(vi) — Royalty, license fee, service fee etc. under sub-clause (iib)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
          // (vii) — Salary payable
          {
            key: 'cl_21b_vii', heading: '(vii) — Salary payable outside India / to non-resident without TDS — sub-clause (iii)',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
              { key: 'aadhaar', label: 'Aadhaar', type: 'text' as const, width: 110 },
              { key: 'country', label: 'Country', type: 'text' as const, width: 100 },
              { key: 'address1', label: 'Address 1', type: 'text' as const, width: 120 },
              { key: 'address2', label: 'Address 2', type: 'text' as const, width: 120 },
              { key: 'pin_zip', label: 'Pin/Zip', type: 'text' as const, width: 80 },
              { key: 'city', label: 'City/District', type: 'text' as const, width: 100 },
              { key: 'state', label: 'State', type: 'text' as const, width: 100 },
            ],
          },
          // (viii) — Single field
          { key: 'cl_21b_viii', heading: '(viii) — Payment to PF/other fund etc. under sub-clause (iv)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
          // (ix) — Single field
          { key: 'cl_21b_ix', heading: '(ix) — Tax paid by employer for perquisites under sub-clause (v)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
          // Part A — Employee contribution deducted but not deposited in time
          {
            key: 'cl_21b_partA', heading: '21(b)(i)(A) — Employee contribution deducted but not deposited in time',
            control: 'structured_table',
            annexureColumns: [
              { key: 'fund_name', label: 'Nature of Fund', type: 'text', minWidth: 180 },
              { key: 'amount_deducted', label: 'Amount Deducted from Salary (Rs.)', type: 'numeric', width: 180 },
              { key: 'due_date', label: 'Due Date for Deposit', type: 'date', width: 130 },
              { key: 'actual_date', label: 'Date Actually Deposited', type: 'date', width: 140 },
              { key: 'amount_late', label: 'Amount Deposited Late / Not Deposited (Rs.)', type: 'numeric', width: 200 },
              { key: 'remarks', label: 'Remarks', type: 'text', width: 150 },
            ],
          },
          // Part B — Employee contribution not deducted by employer
          {
            key: 'cl_21b_partB', heading: '21(b)(i)(B) — Employee contribution not deducted by employer',
            control: 'structured_table',
            annexureColumns: [
              { key: 'fund_name', label: 'Nature of Fund', type: 'text', minWidth: 180 },
              { key: 'amount_required', label: 'Amount Required to be Deducted (Rs.)', type: 'numeric', width: 190 },
              { key: 'amount_deducted', label: 'Amount Actually Deducted (Rs.)', type: 'numeric', width: 170 },
              { key: 'short_deduction', label: 'Short Deduction (Rs.)', type: 'auto_calc', width: 150, formula: 'amount_required - amount_deducted' },
              { key: 'due_date', label: 'Due Date', type: 'date', width: 120 },
              { key: 'deposit_date', label: 'Date of Deposit', type: 'date', width: 130 },
              { key: 'remarks', label: 'Remarks', type: 'text', width: 150 },
            ],
          },
        ],
      },

      // ── 21(c) — Sec 40(b) Partner Remuneration ──
      {
        key: 'cl_21c', heading: '21(c) — Amount debited to profit and loss account being, interest, salary, bonus, commission or remuneration inadmissible under section 40(b)/40(ba) and computation thereof.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'sr_no', label: 'Sr. No.', type: 'readonly', width: 50 },
          { key: 'partner_name', label: 'Name of Partner/Member', type: 'text', minWidth: 180 },
          { key: 'interest', label: 'Interest (₹)', type: 'numeric', width: 120 },
          { key: 'salary', label: 'Salary (₹)', type: 'numeric', width: 120 },
          { key: 'total', label: 'Total (₹)', type: 'auto_calc', width: 120, formula: 'interest + salary' },
        ],
        showTotals: true,
        totalColumns: ['interest', 'salary', 'total'],
        noAnnexure: false,
      },

      // ── 21(d) — Sec 40A(3) Cash Payments ──
      {
        key: 'cl_21d', heading: '21(d) — Sec 40A(3) Cash Payments',
        control: 'composite',
        subClauses: [
          {
            key: 'cl_21d_A', heading: '21(d)(A) — Whether expenditure covered under section 40A(3) read with rule 6DD were made by account payee cheque or bank draft? If not, furnish details.',
            control: 'yes_no',
            subClauses: [{
              key: 'cl_21d_A_details', heading: 'Details of cash payments',
              control: 'structured_table', dependsOn: 'cl_21d_A', dependsOnValue: false,
              annexureColumns: [
                { key: 'date', label: 'Date of Payment', type: 'date' as const, width: 110 },
                { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
                { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 120 },
                { key: 'payee_name', label: 'Name of Payee', type: 'text' as const, minWidth: 130 },
                { key: 'pan', label: 'PAN of payee (if available)', type: 'pan' as const, width: 120 },
                { key: 'aadhaar', label: 'Aadhaar of payee (if available)', type: 'text' as const, width: 130 },
              ],
            }],
          },
          {
            key: 'cl_21d_B', heading: '21(d)(B) — Whether expenditure covered under section 40A(3A) read with rule 6DD were made by account payee cheque or bank draft? If not, furnish details.',
            control: 'yes_no',
            subClauses: [{
              key: 'cl_21d_B_details', heading: 'Details of deemed profits & gains',
              control: 'structured_table', dependsOn: 'cl_21d_B', dependsOnValue: false,
              annexureColumns: [
                { key: 'date', label: 'Date of Payment', type: 'date' as const, width: 110 },
                { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
                { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 120 },
                { key: 'payee_name', label: 'Name of Payee', type: 'text' as const, minWidth: 130 },
                { key: 'pan', label: 'PAN of payee (if available)', type: 'pan' as const, width: 120 },
                { key: 'aadhaar', label: 'Aadhaar of payee (if available)', type: 'text' as const, width: 130 },
              ],
            }],
          },
        ],
      },

      // ── 21(e) — Gratuity provision ──
      { key: 'cl_21e', heading: '21(e) — Provision for payment of gratuity not allowable under section 40A(7).', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },

      // ── 21(f) — Employer payment u/s 40A(9) ──
      { key: 'cl_21f', heading: '21(f) — Any sum paid by the assessee as an employer not allowable under section 40A(9).', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },

      // ── 21(g) — Contingent liabilities ──
      {
        key: 'cl_21g', heading: '21(g) — Particulars of any liability of a contingent nature.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'nature', label: 'Nature of Liability', type: 'text', minWidth: 250 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },

      // ── 21(h) — Sec 14A inadmissible deduction ──
      {
        key: 'cl_21h', heading: '21(h) — Amount of deduction inadmissible in terms of section 14A in respect of expenditure incurred in relation to income which does not form part of total income.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'particulars', label: 'Particulars', type: 'text', minWidth: 250 },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
        ],
      },

      // ── 21(i) — Sec 36(1)(iii) proviso ──
      { key: 'cl_21i', heading: '21(i) — Amount inadmissible under the proviso to section 36(1)(iii).', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
    ],
  },

  // ═══════ CLAUSE 22 — MSME Interest Inadmissibility ═══════
  {
    clauseNo: '22', displayOrder: 22, isActive: true,
    title: 'MSME interest inadmissible u/s 23 MSMED Act',
    heading: 'Amount of interest inadmissible under section 23 of the Micro, Small and Medium Enterprises Development Act, 2006.',
    control: 'composite',
    subClauses: [
      { key: 'cl_22_i', heading: '(i) Amount of interest inadmissible under section 23 of the MSMED Act, 2006', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
      { key: 'cl_22_ii', heading: '(ii) Total amount required to be paid to a micro or small enterprise as referred to in section 15 of the MSMED Act, during the previous year', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
      { key: 'cl_22_iii_a', heading: '(iii)(a) Of amount in (ii) above — Paid up to time given under section 15 of the MSMED Act', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
      { key: 'cl_22_iii_b', heading: '(iii)(b) Of amount in (ii) above — Not paid up to time given under section 15 of the MSMED Act and inadmissible for the previous year', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
    ],
  },

  // ═══════ CLAUSE 23 ═══════
  {
    clauseNo: '23', displayOrder: 23, isActive: true,
    title: 'Payments to specified persons',
    heading: 'Particulars of payments made to persons specified under section 40A(2)(b)',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'name', label: 'Name of Payee/s', type: 'text' },
      { key: 'relationship', label: 'Relationship', type: 'text', width: 120 },
      { key: 'nature', label: 'Nature of Payments', type: 'text' },
      { key: 'amount', label: 'Amount in Rs.', type: 'numeric', width: 130 },
    ],
  },

  // ═══════ CLAUSE 24 ═══════
  {
    clauseNo: '24', displayOrder: 24, isActive: true,
    title: 'Deemed profits u/s 32AC/32AD/33AB/33AC/33ABA',
    heading: 'Amounts deemed to be profits and gains under section 32AC or 32AD or 33AB or 33AC or 33ABA.',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'section', label: 'Section', type: 'dropdown', width: 140, dropdownRef: 'SEC_24_DEEMED' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
    ],
  },

  // ═══════ CLAUSE 25 ═══════
  {
    clauseNo: '25', displayOrder: 25, isActive: true,
    title: 'Profits chargeable u/s 41',
    heading: 'Any amounts of profits chargeable to tax under section 41 and computation thereof.',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'name', label: 'Name of Person', type: 'text' },
      { key: 'amount_credited', label: '(a) Amount of Income credited to P&L', type: 'numeric', width: 160 },
      { key: 'amount_not_credited', label: '(b) Amount of Income not credited to P&L', type: 'numeric', width: 160 },
      { key: 'total_income', label: '(c) Total Amount of Income', type: 'auto_calc', width: 150, formula: 'amount_credited + amount_not_credited' },
      { key: 'section', label: 'Section', type: 'dropdown', width: 140, dropdownRef: 'SEC_25' },
      { key: 'description', label: 'Description of Transaction', type: 'text' },
      { key: 'computation', label: 'Computation, if any', type: 'text' },
    ],
  },

  // ═══════ CLAUSE 26 ═══════
  {
    clauseNo: '26', displayOrder: 26, isActive: true,
    title: 'Amounts referred to in section 43B',
    heading: 'In respect of any sum referred to in section 43B, the liability for which:-',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_26_partA_heading', heading: 'PART A — Pre-existed on the first day of the previous year but was not allowable in the assessment of any preceding previous year and was:-',
        control: 'heading_only',
      },
      {
        key: 'cl_26iAa', heading: '26(A)(a) — Paid during the previous year',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', width: 200, dropdownRef: 'SEC_43B_PART_A' },
          { key: 'nature', label: 'Nature of Liability', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
          { key: 'date_of_payment', label: 'Date of Payment', type: 'date', width: 130 },
        ],
      },
      {
        key: 'cl_26iAb', heading: '26(A)(b) — Not paid during the previous year',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', width: 200, dropdownRef: 'SEC_43B_PART_A' },
          { key: 'nature', label: 'Nature of Liability', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
          { key: 'date_of_payment', label: 'Date of Payment', type: 'date', width: 130 },
        ],
      },
      {
        key: 'cl_26_partB_heading', heading: 'PART B — Was incurred in the previous year and for clauses other than clause (h) of section 43B was:-',
        control: 'heading_only',
      },
      {
        key: 'cl_26iBa', heading: '26(B)(a) — Paid on or before the due date for furnishing the return of income u/s 139(1)',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', width: 200, dropdownRef: 'SEC_43B_PART_B' },
          { key: 'nature', label: 'Nature of Liability', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
          { key: 'date_of_payment', label: 'Date of Payment', type: 'date', width: 130 },
        ],
      },
      {
        key: 'cl_26iBb', heading: '26(B)(b) — Not paid on or before the aforesaid date',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', width: 200, dropdownRef: 'SEC_43B_PART_B' },
          { key: 'nature', label: 'Nature of Liability', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
          { key: 'date_of_payment', label: 'Date of Payment', type: 'date', width: 130 },
        ],
      },
      {
        key: 'cl_26_footer', heading: '* State whether sales tax, goods & services tax, customs duty, excise duty or any other indirect tax, levy, cess, impost etc. is passed through the profit and loss account.',
        control: 'yes_no_text',
      },
    ],
  },

  // ═══════ CLAUSE 27 ═══════
  {
    clauseNo: '27', displayOrder: 27, isActive: true,
    title: 'CENVAT/ITC / Prior period items',
    heading: 'CENVAT/ITC details / Prior period items',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_27a', heading: '27(a) — Amount of Central Value Added Tax Credits / Input Tax Credit (ITC) availed of or utilised during the previous year and its treatment in profit and loss account and treatment of outstanding Central Value Added Tax Credits / Input Tax Credit (ITC) in accounts.',
        control: 'yes_no_structured',
        structuredRows: [
          { label: 'Opening Balance', key: 'opening_balance' },
          { label: 'Credit Availed', key: 'credit_availed' },
          { label: 'Credit Utilized', key: 'credit_utilized' },
          { label: 'Closing/Outstanding Balance', key: 'closing_balance' },
        ],
      },
      {
        key: 'cl_27b', heading: '27(b) — Particulars of income or expenditure of prior period credited or debited to the profit and loss account.',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'type', label: 'Type', type: 'dropdown', width: 160, dropdownRef: 'INCOME_EXPENDITURE_TYPE_27B' },
          { key: 'particulars', label: 'Particulars', type: 'text' },
          { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
          { key: 'year', label: 'Year (yyyy-yy)', type: 'text', width: 120 },
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
