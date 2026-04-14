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
      { key: 'rate', label: 'Rate (%)', type: 'numeric', width: 80 },
      { key: 'openingWDV', label: 'Opening WDV (₹)', type: 'numeric', width: 120 },
      { key: 'addOver180', label: 'Addition/Deduction >180 days (full rate) (₹)', type: 'numeric', width: 180 },
      { key: 'addUnder180', label: 'Addition/Deduction <180 days (half rate) (₹)', type: 'numeric', width: 180 },
      { key: 'closingWDVBeforeDep', label: 'Closing WDV before Dep (₹)', type: 'auto_calc', width: 140, formula: 'openingWDV + addOver180 + addUnder180' },
      { key: 'dep', label: 'Depreciation Allowable (₹)', type: 'auto_calc', width: 140, formula: '(openingWDV + addOver180) * rate / 100 + addUnder180 * rate / 100 * 0.5' },
      { key: 'closingWDV', label: 'Closing WDV after Dep (₹)', type: 'auto_calc', width: 140, formula: 'closingWDVBeforeDep - dep' },
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
          // (i)(A)
          {
            key: 'cl_21b_iA', heading: '(i)(A) — Details of payment on which tax is not deducted — under section 40(a)(i)',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
            ],
          },
          // (i)(B)
          {
            key: 'cl_21b_iB', heading: '(i)(B) — Details of payment on which tax has been deducted but NOT paid — under section 40(a)(i)',
            control: 'not_applicable_annexure',
            annexureColumns: [
              { key: 'sr_no', label: 'SN', type: 'readonly' as const, width: 40 },
              { key: 'date', label: 'Date', type: 'date' as const, width: 100 },
              { key: 'amount', label: 'Amount (₹)', type: 'numeric' as const, width: 110 },
              { key: 'nature', label: 'Nature of Payment', type: 'text' as const, minWidth: 140 },
              { key: 'payee_name', label: 'Payee Name', type: 'text' as const, minWidth: 120 },
              { key: 'pan', label: 'PAN', type: 'pan' as const, width: 110 },
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
            ],
          },
          // (iv) FBT — abolished by Finance Act 2009 — REMOVED
          // (v) Wealth Tax — repealed w.e.f. 1 Apr 2016 — REMOVED
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
            ],
          },
          // (viii) — Single field
          { key: 'cl_21b_viii', heading: '(viii) — Payment to PF/other fund etc. under sub-clause (iv)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
          // (ix) — Single field
          { key: 'cl_21b_ix', heading: '(ix) — Tax paid by employer for perquisites under sub-clause (v)', control: 'single_field', defaultValue: 'Nil', fieldType: 'number' },
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
    title: 'Hundi borrowings u/s 69D',
    heading: 'Hundi: Whether any amount is borrowed on hundi from any person or repaid to any person on hundi otherwise than through an account payee cheque?',
    control: 'yes_no',
    subClauses: [
      {
        key: 'cl_30_details',
        heading: 'Details of hundi borrowings / repayments',
        control: 'structured_table',
        annexureColumns: [
          { key: 'sr_no', label: 'S.No', type: 'readonly', width: 60 },
          { key: 'person_name', label: 'Name of the person', type: 'text', minWidth: 200 },
          { key: 'pan', label: 'PAN', type: 'text', width: 130 },
          { key: 'amount_borrowed', label: 'Amount borrowed', type: 'numeric', width: 150 },
          { key: 'date_of_borrowing', label: 'Date of borrowing', type: 'text', width: 150 },
          { key: 'amount_due_including_interest', label: 'Amount due including interest', type: 'numeric', width: 190 },
          { key: 'amount_repaid', label: 'Amount repaid', type: 'numeric', width: 150 },
          { key: 'date_of_repayment', label: 'Date of repayment', type: 'text', width: 150 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 30A ═══════
  {
    clauseNo: '30A', displayOrder: 30.1, isActive: true,
    title: 'Primary adjustment / 94B / GAAR',
    heading: 'Transfer pricing adjustments, Interest limitation u/s 94B, GAAR u/s 96',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_30a',
        heading: 'Whether primary adjustment to transfer price, as referred to in sub-section (1) of section 92C, has been made during the previous year?',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'clause_92ce', label: 'Under which clause of sub-section (1) of section 92CE', type: 'dropdown', dropdownRef: 'SEC_92CE_CLAUSE', minWidth: 320 },
          { key: 'primary_adj_amount', label: 'Amount of primary adjustment (Rs.)', type: 'numeric', width: 200 },
          { key: 'repatriation_reqd', label: 'Whether excess money required to be repatriated', type: 'yes_no_dropdown', width: 200 },
          { key: 'repatriated_in_time', label: 'Whether excess money repatriated within prescribed time', type: 'yes_no_dropdown', width: 220 },
          { key: 'imputed_interest', label: 'Amount of imputed interest on unrepatriated amount (Rs.)', type: 'numeric', width: 240 },
        ],
      },
      {
        key: 'cl_30b',
        heading: 'Whether the assessee has incurred expenditure during the previous year by way of interest or of similar nature exceeding one crore rupees as referred to in sub-section (1) of section 94B?',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'interest_expenditure', label: 'Amount of expenditure by way of interest or similar nature (Rs.)', type: 'numeric', width: 240 },
          { key: 'ebitda', label: 'EBITDA (Rs.)', type: 'numeric', width: 160 },
          { key: 'excess_30pct', label: 'Amount of interest exceeding 30% of EBITDA (Rs.)', type: 'numeric', width: 240 },
          { key: 'bf_ay', label: 'Interest brought forward — Assessment Year', type: 'dropdown', dropdownRef: 'AY_YEARS', width: 160 },
          { key: 'bf_amount', label: 'Interest brought forward — Amount (Rs.)', type: 'numeric', width: 200 },
          { key: 'cf_ay', label: 'Interest carried forward — Assessment Year', type: 'dropdown', dropdownRef: 'AY_YEARS', width: 160 },
          { key: 'cf_amount', label: 'Interest carried forward — Amount (Rs.)', type: 'numeric', width: 200 },
        ],
      },
      {
        key: 'cl_30c',
        heading: 'Whether the assessee has entered into an impermissible avoidance arrangement, as referred to in section 96, during the previous year?',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'nature', label: 'Nature of the impermissible avoidance arrangement', type: 'dropdown', dropdownRef: 'GAAR_NATURE', minWidth: 320 },
          { key: 'specify_others', label: 'Specify Others', type: 'text', width: 200 },
          { key: 'tax_benefit_amount', label: 'Amount (in Rs.) of tax benefit in the previous year', type: 'numeric', width: 220 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 31 ═══════
  {
    clauseNo: '31', displayOrder: 31, isActive: true,
    title: 'Loans/deposits u/s 269SS/269T',
    heading: 'Loans, deposits and specified sums u/s 269SS / 269T',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_31a',
        heading: 'Particulars of each loan or deposit in an amount exceeding the limit specified in section 269SS taken or accepted during the previous year:-',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of lender/depositor', type: 'text', minWidth: 160 },
          { key: 'pan', label: 'PAN of lender/depositor', type: 'pan', width: 130 },
          { key: 'amount', label: 'Amount of loan or deposit taken or accepted (Rs.)', type: 'numeric', width: 180 },
          { key: 'squared_up', label: 'Whether loan/deposit was squared up during the year', type: 'yes_no_dropdown', width: 160 },
          { key: 'max_outstanding', label: 'Maximum amount outstanding at any time during the year (Rs.)', type: 'numeric', width: 200 },
          { key: 'code_a_to_l', label: 'Code of nature of such amount', type: 'dropdown', dropdownRef: 'CODE_A_TO_L', width: 180 },
          { key: 'cheque_mode', label: 'Whether taken/accepted otherwise than by A/c payee cheque/draft', type: 'dropdown', dropdownRef: 'CHEQUE_MODE', width: 200 },
          { key: 'acpayee', label: 'Whether account payee cheque or bank draft', type: 'dropdown', dropdownRef: 'ACPAYEE_MODE', width: 160 },
        ],
      },
      {
        key: 'cl_31b',
        heading: 'Particulars of each specified sum in an amount exceeding the limit specified in section 269SS taken or accepted during the previous year:-',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of lender/depositor', type: 'text', minWidth: 160 },
          { key: 'pan', label: 'PAN', type: 'pan', width: 130 },
          { key: 'amount', label: 'Amount (Rs.)', type: 'numeric', width: 140 },
          { key: 'code_a_to_l', label: 'Code of nature of such amount', type: 'dropdown', dropdownRef: 'CODE_A_TO_L', width: 180 },
          { key: 'cheque_mode', label: 'Whether taken/repaid otherwise than A/c payee', type: 'dropdown', dropdownRef: 'CHEQUE_MODE', width: 200 },
          { key: 'acpayee', label: 'Whether account payee cheque or bank draft', type: 'dropdown', dropdownRef: 'ACPAYEE_MODE', width: 160 },
        ],
      },
      {
        key: 'cl_31c',
        heading: 'Particulars of each repayment of loan or deposit or any specified advance in an amount exceeding the limit specified in section 269T made during the previous year:-',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of Payee', type: 'text', minWidth: 160 },
          { key: 'pan', label: 'PAN of Payee', type: 'pan', width: 130 },
          { key: 'amount', label: 'Amount of repayment (Rs.)', type: 'numeric', width: 160 },
          { key: 'max_outstanding', label: 'Maximum amount outstanding at any time during the previous year (Rs.)', type: 'numeric', width: 220 },
          { key: 'code_a_to_l', label: 'Code of nature', type: 'dropdown', dropdownRef: 'CODE_A_TO_L', width: 180 },
          { key: 'cheque_mode', label: 'Whether repayment made by cheque/ECS', type: 'dropdown', dropdownRef: 'CHEQUE_MODE', width: 200 },
          { key: 'acpayee', label: 'Whether account payee', type: 'dropdown', dropdownRef: 'ACPAYEE_MODE', width: 160 },
        ],
      },
      {
        key: 'cl_31d',
        heading: 'Particulars of repayment of loan or deposit or any specified advance in an amount exceeding the limit specified in section 269T received otherwise than by a cheque or bank draft or use of electronic clearing system through a bank account during the previous year',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of the Payee', type: 'text', minWidth: 160 },
          { key: 'pan', label: 'PAN of the Payee', type: 'pan', width: 130 },
          { key: 'amount', label: 'Amount of repayment (Rs.)', type: 'numeric', width: 160 },
        ],
      },
      {
        key: 'cl_31e',
        heading: 'Particulars of repayment of loan or deposit or any specified advance in an amount exceeding the limit specified in section 269T received by a cheque or bank draft which is not an account payee cheque or account payee bank draft during the previous year',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'name', label: 'Name of Payee', type: 'text', minWidth: 160 },
          { key: 'pan', label: 'PAN of Payee', type: 'pan', width: 130 },
          { key: 'amount', label: 'Amount of repayment (Rs.)', type: 'numeric', width: 160 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 32 ═══════
  {
    clauseNo: '32', displayOrder: 32, isActive: true,
    title: 'Brought forward losses / depreciation',
    heading: 'Details of brought forward loss or depreciation allowance, speculation and specified business losses',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_32a',
        heading: 'Details of brought forward loss or depreciation allowance, in the following manner, to the extent available:',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'ay', label: 'Assessment Year', type: 'text', width: 110 },
          { key: 'nature', label: 'Nature of loss/allowance', type: 'dropdown', dropdownRef: 'NATURE_LOSS_32A', minWidth: 240 },
          { key: 'amount_returned', label: 'Amount as returned', type: 'text', width: 140 },
          { key: 'not_allowed_115', label: 'All losses/allowances not allowed under section 115BAA/115BAC/115BAD', type: 'text', width: 220 },
          { key: 'adjusted_depreciation', label: 'Amount adjusted by withdrawal of additional depreciation on account of opting for sec 115BAC/115BAD', type: 'text', width: 260 },
          { key: 'amount_assessed', label: 'Amounts as assessed (give reference to relevant order)', type: 'text', width: 220 },
          { key: 'remarks', label: 'Remarks', type: 'text', width: 150 },
        ],
      },
      {
        key: 'cl_32b',
        heading: 'Whether a change in shareholding of the company has taken place in the previous year due to which the losses incurred prior to the previous year cannot be allowed to be carried forward in terms of section 79.',
        control: 'yes_no_na',
        subClauses: [
          {
            key: 'cl_32b_details',
            heading: 'Provide details',
            control: 'single_field',
            fieldType: 'textarea',
            dependsOn: 'cl_32b',
            dependsOnValue: 'yes',
          },
        ],
      },
      {
        key: 'cl_32c',
        heading: 'Whether the assessee has incurred any speculation loss referred to in section 73 during the previous year.',
        control: 'yes_no',
        subClauses: [
          {
            key: 'cl_32c_details',
            heading: 'Please furnish the details of the same.',
            control: 'single_field',
            fieldType: 'textarea',
            dependsOn: 'cl_32c',
            dependsOnValue: 'yes',
          },
        ],
      },
      {
        key: 'cl_32d',
        heading: 'Whether the assessee has incurred any loss referred to in section 73A in respect of any specified business during the previous year.',
        control: 'yes_no',
        subClauses: [
          {
            key: 'cl_32d_details',
            heading: 'Please furnish the details of the same.',
            control: 'single_field',
            fieldType: 'textarea',
            dependsOn: 'cl_32d',
            dependsOnValue: 'yes',
          },
        ],
      },
      {
        key: 'cl_32e',
        heading: 'In case of a company, please state whether the company is deemed to be carrying on a speculation business as referred in explanation to section 73.',
        control: 'yes_no_na',
        subClauses: [
          {
            key: 'cl_32e_details',
            heading: 'Provide speculation loss details',
            control: 'single_field',
            fieldType: 'textarea',
            dependsOn: 'cl_32e',
            dependsOnValue: 'yes',
          },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 33 ═══════
  {
    clauseNo: '33', displayOrder: 33, isActive: true,
    title: 'Deductions under Chapter VIA / 10A / 10AA',
    heading: 'Section-wise details of deductions, if any, admissible under Chapter VIA or Chapter III (Section 10A, Section 10AA).',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'SEC_CHAPTER_VIA', minWidth: 160 },
      { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
    ],
  },

  // ═══════ CLAUSE 34 ═══════
  {
    clauseNo: '34', displayOrder: 34, isActive: true,
    title: 'TDS/TCS compliance',
    heading: 'Whether the assessee is required to deduct or collect tax as per the provisions of Chapter XVII-B or Chapter XVII-BB, if yes please furnish:',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_34a',
        heading: '34(a) — Whether the assessee is required to deduct or collect tax as per the provisions of Chapter XVII-B or Chapter XVII-BB, if yes please furnish:',
        control: 'not_applicable_annexure',
        notes: 'Matrix format (Annexure-6 style). TAN auto-fetched from client. Rows = fixed labels, Columns = per TDS/TCS section.',
        annexureColumns: [
          { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'TDS_SECTIONS', minWidth: 200 },
          { key: 'nature_of_payment', label: 'Nature of Payment', type: 'text', minWidth: 180 },
          { key: 'total_payment', label: 'Total amount of payment or receipt (₹)', type: 'numeric', width: 200 },
          { key: 'total_required', label: 'Total amount on which tax was required to be deducted or collected (₹)', type: 'numeric', width: 240 },
          { key: 'total_at_specified', label: 'Total amount on which tax was deducted or collected at specified rate (₹)', type: 'numeric', width: 260 },
          { key: 'tax_deducted_collected', label: 'Amount of tax deducted or collected (₹)', type: 'numeric', width: 200 },
          { key: 'total_at_less', label: 'Total amount on which tax was deducted or collected at less than specified rate (₹)', type: 'numeric', width: 280 },
          { key: 'tax_at_less', label: 'Amount of tax deducted or collected on above (₹)', type: 'numeric', width: 220 },
          { key: 'tax_not_deposited', label: 'Amount of tax deducted or collected not deposited to Central Government (₹)', type: 'numeric', width: 280 },
        ],
      },
      {
        key: 'cl_34b',
        heading: '34(b) — Whether the assessee has furnished the statement of tax deducted or tax collected within the prescribed time. If not, please furnish the details:',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'tan', label: 'TAN', type: 'readonly', width: 120 },
          { key: 'form_type', label: 'Type of Form', type: 'dropdown', dropdownRef: 'TDS_FORM_TYPES', width: 100 },
          { key: 'due_date', label: 'Due date for furnishing', type: 'date', width: 140 },
          { key: 'date_furnished', label: 'Date of furnishing if furnished', type: 'date', width: 160 },
          { key: 'all_reported', label: 'Whether statement contains all transactions required', type: 'yes_no_dropdown', width: 200 },
        ],
      },
      {
        key: 'cl_34c',
        heading: '34(c) — Whether the assessee is liable to pay interest under section 201(1A) or section 206C(7). If yes, please furnish:',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'tan', label: 'TAN', type: 'readonly', width: 120 },
          { key: 'section', label: 'Section', type: 'dropdown', dropdownRef: 'TDS_SECTIONS', minWidth: 180 },
          { key: 'interest_payable', label: 'Amount of interest u/s 201(1A)/206C(7) payable (₹)', type: 'numeric', width: 220 },
          { key: 'amount_paid', label: 'Amount paid out of above (₹)', type: 'numeric', width: 160 },
          { key: 'date_of_payment', label: 'Date of payment', type: 'date', width: 130 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 35 ═══════
  {
    clauseNo: '35', displayOrder: 35, isActive: true,
    title: 'Quantitative details — trading / manufacturing',
    heading: 'Quantitative details of principal items of goods traded (35a) and raw materials, finished products and by-products (35b).',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_35a',
        heading: '35(a) — Trading Concern: Quantitative details of principal items of goods traded',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'item_name', label: 'Item Name', type: 'text', minWidth: 180 },
          { key: 'unit', label: 'Unit', type: 'dropdown', dropdownRef: 'UNIT_DROPDOWN_35', width: 120 },
          { key: 'opening_stock', label: 'Opening Stock', type: 'numeric', width: 130 },
          { key: 'purchases', label: 'Purchases during previous year', type: 'numeric', width: 160 },
          { key: 'sales', label: 'Sales during previous year', type: 'numeric', width: 150 },
          { key: 'closing_stock', label: 'Closing Stock', type: 'auto_calc', width: 130, formula: 'opening_stock + purchases - sales' },
          { key: 'shortage_excess', label: 'Shortage/Excess if any', type: 'numeric', width: 150 },
        ],
      },
      {
        key: 'cl_35bA',
        heading: '35(b)(A) — Manufacturing Concern: Raw Materials',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'item_name', label: 'Item Name', type: 'text', minWidth: 180 },
          { key: 'unit', label: 'Unit', type: 'dropdown', dropdownRef: 'UNIT_DROPDOWN_35', width: 120 },
          { key: 'opening_stock', label: 'Opening Stock', type: 'numeric', width: 120 },
          { key: 'purchases', label: 'Purchases', type: 'numeric', width: 120 },
          { key: 'consumption', label: 'Consumption during previous year', type: 'numeric', width: 160 },
          { key: 'sales', label: 'Sales', type: 'numeric', width: 110 },
          { key: 'closing_stock', label: 'Closing Stock', type: 'numeric', width: 120 },
          { key: 'yield_finished', label: 'Yield of finished products', type: 'numeric', width: 150 },
          { key: 'yield_pct', label: 'Percentage of yield', type: 'numeric', width: 130 },
          { key: 'shortage_excess', label: 'Shortage/Excess', type: 'numeric', width: 130 },
        ],
      },
      {
        key: 'cl_35bB',
        heading: '35(b)(B) — Manufacturing Concern: Finished Products',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'item_name', label: 'Item Name', type: 'text', minWidth: 180 },
          { key: 'unit', label: 'Unit', type: 'dropdown', dropdownRef: 'UNIT_DROPDOWN_35', width: 120 },
          { key: 'opening_stock', label: 'Opening Stock', type: 'numeric', width: 120 },
          { key: 'purchases', label: 'Purchases', type: 'numeric', width: 120 },
          { key: 'qty_manufactured', label: 'Quantity manufactured', type: 'numeric', width: 150 },
          { key: 'sales', label: 'Sales', type: 'numeric', width: 110 },
          { key: 'closing_stock', label: 'Closing Stock', type: 'numeric', width: 120 },
          { key: 'shortage_excess', label: 'Shortage/Excess', type: 'numeric', width: 130 },
        ],
      },
      {
        key: 'cl_35bC',
        heading: '35(b)(C) — Manufacturing Concern: By-products',
        control: 'not_applicable_annexure',
        annexureColumns: [
          { key: 'item_name', label: 'Item Name', type: 'text', minWidth: 180 },
          { key: 'unit', label: 'Unit', type: 'dropdown', dropdownRef: 'UNIT_DROPDOWN_35', width: 120 },
          { key: 'opening_stock', label: 'Opening Stock', type: 'numeric', width: 120 },
          { key: 'purchases', label: 'Purchases', type: 'numeric', width: 120 },
          { key: 'qty_manufactured', label: 'Quantity manufactured', type: 'numeric', width: 150 },
          { key: 'sales', label: 'Sales', type: 'numeric', width: 110 },
          { key: 'closing_stock', label: 'Closing Stock', type: 'numeric', width: 120 },
          { key: 'shortage_excess', label: 'Shortage/Excess', type: 'numeric', width: 130 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 36 ═══════
  {
    clauseNo: '36', displayOrder: 36, isActive: true,
    title: 'Deemed dividend / Buyback of shares',
    heading: 'Deemed dividend u/s 2(22)(e) and Buyback of shares u/s 2(22)(f)',
    control: 'composite',
    subClauses: [
      {
        key: 'cl_36A',
        heading: '36(A) — Whether the assessee has received any amount in the nature of dividend as referred to in sub-clause (e) of clause (22) of section 2? If yes, please furnish the following details:',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_36A_details', heading: 'Details of deemed dividend received',
          control: 'structured_table', dependsOn: 'cl_36A', dependsOnValue: true,
          annexureColumns: [
            { key: 'amount_received', label: 'Amount received (₹)', type: 'numeric' as const, width: 160 },
            { key: 'date_of_receipt', label: 'Date of receipt', type: 'date' as const, width: 130 },
          ],
        }],
      },
      {
        key: 'cl_36B',
        heading: '36(B) — Whether the assessee has received any amount for buyback of shares as referred to in sub-clause (f) of clause (22) of section 2?',
        control: 'yes_no',
        subClauses: [{
          key: 'cl_36B_details', heading: 'Details of buyback',
          control: 'structured_table', dependsOn: 'cl_36B', dependsOnValue: true,
          annexureColumns: [
            { key: 'amount_received', label: 'Amount received (₹)', type: 'numeric' as const, width: 160 },
            { key: 'cost_of_acquisition', label: 'Cost of acquisition of shares bought back (₹)', type: 'numeric' as const, width: 220 },
          ],
        }],
      },
    ],
  },

  // ═══════ CLAUSE 37 ═══════
  {
    clauseNo: '37', displayOrder: 37, isActive: true,
    title: 'Cost audit',
    heading: 'Whether any cost audit was carried out? If yes, give the details, if any, of disqualification or disagreement on any matter/item/value/quantity as may be reported/identified by the cost auditor.',
    control: 'yes_no_na',
    subClauses: [
      {
        key: 'cl_37_details',
        heading: 'Provide details of disqualification or disagreement',
        control: 'single_field',
        fieldType: 'textarea',
        dependsOn: '37',
        dependsOnValue: 'yes',
      },
    ],
  },

  // ═══════ CLAUSE 38 ═══════
  {
    clauseNo: '38', displayOrder: 38, isActive: true,
    title: 'Audit under Central Excise Act',
    heading: 'Whether any audit was conducted under the Central Excise Act, 1944? If yes, give the details, if any, of disqualification or disagreement on any matter/item/value/quantity as may be reported/identified by the auditor.',
    control: 'yes_no_na',
    subClauses: [
      {
        key: 'cl_38_details',
        heading: 'Provide details of disqualification or disagreement',
        control: 'single_field',
        fieldType: 'textarea',
        dependsOn: '38',
        dependsOnValue: 'yes',
      },
    ],
  },

  // ═══════ CLAUSE 39 ═══════
  {
    clauseNo: '39', displayOrder: 39, isActive: true,
    title: 'Audit under Finance Act 1994 sec 72A',
    heading: 'Whether any audit was conducted under section 72A of the Finance Act, 1994 in relation to valuation of taxable services? If yes, give the details, if any, of disqualification or disagreement on any matter/item/value/quantity as may be reported/identified by the auditor.',
    control: 'yes_no_na',
    subClauses: [
      {
        key: 'cl_39_details',
        heading: 'Provide details of disqualification or disagreement',
        control: 'single_field',
        fieldType: 'textarea',
        dependsOn: '39',
        dependsOnValue: 'yes',
      },
    ],
  },

  // ═══════ CLAUSE 40 ═══════
  {
    clauseNo: '40', displayOrder: 40, isActive: true,
    title: 'Turnover, gross profit, etc.',
    heading: 'Details regarding turnover, gross profit, etc., for the previous year and preceding previous year:',
    control: 'fixed_vertical_table' as any,
    notes: 'Fixed 5-row vertical table: turnover, GP%, NP%, stock ratio, material consumed %.',
  },

  // ═══════ CLAUSE 41 ═══════
  {
    clauseNo: '41', displayOrder: 41, isActive: true,
    title: 'Demand raised / Refund under other tax laws',
    heading: 'Please furnish the details of demand raised or refund issued during the previous year under any tax laws other than Income-tax Act, 1961 and Wealth-tax Act, 1957 alongwith details of relevant proceedings.',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'financial_year', label: 'Financial Year', type: 'dropdown', dropdownRef: 'FY_YEARS', width: 130 },
      { key: 'tax_law', label: 'Name of other tax law', type: 'dropdown', dropdownRef: 'TAX_LAW_41', minWidth: 200 },
      { key: 'type', label: 'Type', type: 'dropdown', dropdownRef: 'DEMAND_REFUND_TYPE', width: 140 },
      { key: 'date', label: 'Date of demand raised / refund received', type: 'date', width: 170 },
      { key: 'amount', label: 'Amount (₹)', type: 'numeric', width: 140 },
    ],
  },

  // ═══════ CLAUSE 42 ═══════
  {
    clauseNo: '42', displayOrder: 42, isActive: true,
    title: 'Form 61 / 61A / 61B',
    heading: 'Whether the assessee is required to furnish statement in Form No. 61 or Form No. 61A or Form No. 61B, If yes, please furnish:',
    control: 'not_applicable_annexure',
    annexureColumns: [
      { key: 'reporting_entity_id', label: 'Income-tax Department Reporting Entity Identification Number', type: 'text', minWidth: 220 },
      { key: 'form_type', label: 'Type of Form', type: 'dropdown', dropdownRef: 'FORM_61_TYPES', width: 130 },
      { key: 'due_date', label: 'Due date for furnishing', type: 'date', width: 140 },
      { key: 'date_furnished', label: 'Date of furnishing if furnished', type: 'date', width: 160 },
      { key: 'all_reported', label: 'Whether form contains all details/transactions required', type: 'yes_no_dropdown', width: 220 },
      { key: 'not_reported', label: 'If not, list of details/transactions not reported', type: 'text', minWidth: 220 },
    ],
  },

  // ═══════ CLAUSE 43 ═══════
  {
    clauseNo: '43', displayOrder: 43, isActive: true,
    title: 'CbCR reporting u/s 286',
    heading: 'Whether the assessee or its parent entity or alternate reporting entity is liable to furnish the report as referred to in sub-section (2) of section 286, if yes, please furnish the following details:',
    control: 'yes_no_notdue',
    subClauses: [
      {
        key: 'cl_43_details',
        heading: 'CbCR reporting details',
        control: 'structured_table',
        annexureColumns: [
          { key: 'reporter', label: 'Whether report has been furnished by', type: 'dropdown', dropdownRef: 'CbCR_REPORTER', minWidth: 280 },
          { key: 'parent_name', label: 'Name of parent entity', type: 'text', minWidth: 180 },
          { key: 'alternate_name', label: 'Name of alternate reporting entity if applicable', type: 'text', minWidth: 200 },
          { key: 'date_furnished', label: 'Date of furnishing of report', type: 'date', width: 150 },
        ],
      },
    ],
  },

  // ═══════ CLAUSE 44 ═══════
  {
    clauseNo: '44', displayOrder: 44, isActive: true,
    title: 'GST breakup of expenditure',
    heading: 'Break-up of total expenditure of entities registered or not registered under the GST:',
    control: 'not_applicable_annexure',
    notes: 'Single summary row format. Total payment to registered entities auto-calculates.',
    annexureColumns: [
      { key: 'total_expenditure', label: 'Total amount of Expenditure incurred during the year (₹)', type: 'numeric', width: 220 },
      { key: 'exempt_gst', label: 'Expenditure — Relating to goods or services exempt from GST (₹)', type: 'numeric', width: 240 },
      { key: 'composition_gst', label: 'Expenditure — Relating to entities falling under composition scheme (₹)', type: 'numeric', width: 260 },
      { key: 'other_registered', label: 'Expenditure — Relating to other registered entities (₹)', type: 'numeric', width: 240 },
      { key: 'total_registered', label: 'Total payment to registered entities (₹)', type: 'auto_calc', width: 200, formula: 'exempt_gst + composition_gst + other_registered' },
      { key: 'not_registered', label: 'Expenditure relating to entities NOT registered under GST (₹)', type: 'numeric', width: 260 },
    ],
  },
];
