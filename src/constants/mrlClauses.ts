/**
 * MRL Clause templates for Management Representation Letter (SA 580).
 * Placeholders:
 *   [CASH_AMOUNT]  — inline orange editable input (rendered in MRLTab)
 *   [BS_DATE]      — auto-derived from engagement.financial_year at component init
 *   [YEAR]         — audit end-year, auto-derived at component init
 *
 * These templates are used to initialise clause state; after derivation, [BS_DATE]
 * and [YEAR] are replaced with real values. [CASH_AMOUNT] is kept as a token so
 * MRLTab can render it as a special inline input.
 */

export interface MRLClause {
  id: string;
  title: string;
  selected: boolean;
  text: string;
  /** Mutually-exclusive radio group (e.g. "msme") */
  groupId?: string;
}

export const MRL_CLAUSES_TEMPLATE: MRLClause[] = [
  {
    id: "clause-01",
    title: "Accounting Policies & Compliance",
    selected: true,
    text: `The accounting policies are in accordance with the accounting standards and other recognized accounting practices and policies generally accepted in India and the accounts/results were drawn up in accordance with the Companies Act, 2013.`,
  },
  {
    id: "clause-02",
    title: "Accrual Basis of Accounting",
    selected: true,
    text: `The financial statements are prepared on accrual basis, *except in respect of items mentioned as a part of the accounting policies.`,
  },
  {
    id: "clause-03",
    title: "Going Concern Basis",
    selected: true,
    text: `The financial statements are prepared on a going concern basis.`,
  },
  {
    id: "clause-04",
    title: "Cash on Hand Verification",
    selected: true,
    text: `Cash on hand Rs. [CASH_AMOUNT]/- as appearing in the Cash Book of the Company as on the date of the Balance Sheet and was physically verified and found correct.`,
  },
  {
    id: "clause-05",
    title: "Directors' Disqualification Certificate",
    selected: true,
    text: `We have to certify that and on the basis of written representation received from all the directors as on [BS_DATE] and taken on records by the Board of Directors, none of directors is disqualified as on [BS_DATE] from being appointed as a director under section 164 of the Companies Act, 2013.`,
  },
  {
    id: "clause-06",
    title: "Section 40A(3) — Payments Exceeding ₹10,000",
    selected: true,
    text: `We had made every payment exceeding Rs. 10000/- relating to any expenditure covered under section 40A(3) by account payee cheques drawn on a bank or by an account payee bank draft only.`,
  },
  {
    id: "clause-07",
    title: "No Plans to Affect Asset/Liability Classification",
    selected: true,
    text: `We have no plans or intentions that may materially affect the carrying value or classification of assets and liabilities reflected in the financial statements.`,
  },
  {
    id: "clause-08",
    title: "Unrestricted Access to Information",
    selected: true,
    text: `We have provided you with:\n\n(a) Access to all information of which we are aware that is relevant to the preparation of the financial statements, such as records, documentation and other matters;\n\n(b) Additional information that you have requested from us for the purpose of the audit; and\n\n(c) Unrestricted access to persons within the entity from whom you determined it necessary to obtain audit evidence.`,
  },
  {
    id: "clause-09",
    title: "No Disputed Statutory Dues",
    selected: true,
    text: `According to the records of the company, there are no dues of Sales tax, Income tax, Custom duty, VAT, Excise duty, Service tax which have not been deposited on account of any dispute.`,
  },
  {
    id: "clause-10",
    title: "No Fraud During the Year",
    selected: true,
    text: `We hereby declare that on the basis of our assessment of the risk that the financial statements are not materially misstated as there is no incidence of fraud during the year.`,
  },
  {
    id: "clause-11",
    title: "No Preferential Allotment Under Section 88",
    selected: true,
    text: `The Company has not made any preferential allotment of shares during the year to the parties and companies covered in the Register maintained under Section 88 of the Companies Act 2013.`,
  },
  {
    id: "clause-12",
    title: "Fixed Assets — Net Book Value & Depreciation",
    selected: true,
    text: `The net book value of these fixed assets has been arrived at after writing off amounts relating to all items which have been sold or scrapped on or before the Balance Sheet date and that the book values of all fixed assets do not exceed their recoverable amount as at the balance sheet date. The provisions made for depreciation of the fixed assets are not in excess of what is considered reasonably necessary for that purpose.`,
  },
  {
    id: "clause-13",
    title: "No Borrowings from Non-Directors",
    selected: true,
    text: `The Company has not borrowed any money or funds from the person/s or parties other than directors.`,
  },
  {
    id: "clause-14",
    title: "Assets Commissioned & Depreciation",
    selected: true,
    text: `All assets of the Company which were purchased/completed during the current financial year on which prorata depreciation has been provided for in the books of account, have been installed/completed, commissioned and put to use in the relevant months from which depreciation has been charged thereon.`,
  },
  {
    id: "clause-15",
    title: "Provisions for All Known Liabilities",
    selected: true,
    text: `The Company has made provisions for all known liabilities, accrued or contingent, secured or unsecured, have been fully and correctly recorded and disclosed in the annual accounts at their actual or their estimated values as applicable.`,
  },
  {
    id: "clause-16",
    title: "Fixed Asset Records Maintained",
    selected: true,
    text: `Adequate records have been maintained for fixed assets showing inter-alia, location, type/nature of the asset, cost, and quantitative details and that such records are fully reconciled with the financial records.`,
  },
  {
    id: "clause-17",
    title: "Physical Verification of Fixed Assets",
    selected: true,
    text: `The fixed assets were physically verified by the management during the year at reasonable intervals. The company has not disposed off any substantial part of fixed assets during the year.`,
  },
  {
    id: "clause-18",
    title: "All Liabilities Fully Recorded",
    selected: true,
    text: `All known liabilities, accrued or contingent, secured or unsecured, have been fully and correctly recorded and disclosed in the annual accounts at their actual or their estimated values as applicable.`,
  },
  {
    id: "clause-19",
    title: "Internal Financial Control Framework",
    selected: true,
    text: `The company has prepared a framework to comply with the provisions of internal financial control system over financial reporting as at the end of the year.`,
  },
  {
    id: "clause-20",
    title: "No Material Subsequent Events",
    selected: true,
    text: `There have been no events subsequent to the balance sheet date which require adjustment of or disclosure in, the financial statements or notes thereto.`,
  },
  {
    id: "clause-21",
    title: "No Political Contributions",
    selected: true,
    text: `The Company has not made any contributions, directly or indirectly in cash or in kind, to any political party during the financial year ended 31st March, [YEAR] and has also not made any contribution in contravention of the Companies Act, 2013.`,
  },
  {
    id: "clause-22",
    title: "Proper Cut-Off Procedures",
    selected: true,
    text: `The Company has followed proper cut-off procedures for the purpose of the financial statements for accruing income/expenditure.`,
  },
  {
    id: "clause-23a",
    title: "MSME — Declarations Obtained & Produced (23a)",
    selected: true,
    groupId: "msme",
    text: `We have obtained the MSME status or declaration from the respective suppliers registered under the Micro, Small & Medium Enterprises Development Act, 2006 during the year and same were produced before auditors. We confirm that the information given by the auditors as mentioned in Auditors report as well as in para 22(b) of the Form-3CD are correct.`,
  },
  {
    id: "clause-23b",
    title: "MSME — Status Obtained as on Balance Sheet Date (23b)",
    selected: false,
    groupId: "msme",
    text: `We have obtained the status of the suppliers registered under the Micro, Small & Medium Enterprises Development Act, 2006 as on [BS_DATE] and information given by the auditors as mentioned in para 22(b) of the Form-3CD are confirmed by us.`,
  },
  {
    id: "clause-24",
    title: "No Unforeseen Liability",
    selected: true,
    text: `Management is of the opinion that there is no unforeseen liability which will impact considerably to the financial statement of the company.`,
  },
  {
    id: "clause-25",
    title: "No Transactions with Struck-Off Companies",
    selected: true,
    text: `The company has no transactions with the companies struck off under Section 248 of the Companies Act, 2013.`,
  },
];

/** Default opening paragraph with [YEAR] placeholder. */
export const MRL_OPENING_PARA_TEMPLATE = `In connection with the Statutory Audit of the financial statements of our company as at 31st March, [YEAR], we acknowledge our responsibility for preparation of financial statements in accordance with the requirements of the Companies Act, 2013 and recognized accounting policies and practices, including mandatory Accounting Standards referred to in section 133 of the Companies Act, 2013. We hereby, confirm to the best of our knowledge and belief, the following representations:`;
