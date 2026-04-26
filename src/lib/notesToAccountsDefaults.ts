/**
 * notesToAccountsDefaults.ts
 *
 * Single source of truth for Stage 8 → Notes to Accounts default policy text
 * (corporate entities only).
 *
 * HOW DEFAULTS WORK
 * ─────────────────
 * The stage8_nta_data JSONB column stores policy bodies as empty strings "".
 * On first open the component merges these defaults so users see complete text
 * immediately. Users can edit freely; clearing a field back to "" resets it to
 * the default on next open.
 *
 * DO NOT change key names — they must match the "id" values in the DB schema
 * (see supabase/migrations/20260426100000_stage8_nta_data.sql).
 */

// ─── Significant Accounting Policies (Note 1, Section 2) ─────────────────────

export const NTA_POLICY_DEFAULTS: Record<string, string> = {
  "2.1": `The financial statements of the Company have been prepared in accordance with the Generally Accepted Accounting Principles in India (Indian GAAP) to comply with the Accounting Standards notified under the relevant provisions of the Companies Act, 2013. The financial statements have been prepared on accrual basis under the historical cost convention. The accounting policies adopted in the preparation of the financial statements are consistent with those followed in the previous year.`,

  "2.2": `The preparation of financial statements in accordance with the generally accepted accounting principles requires the management to make estimates and assumptions that affect the reported amounts of assets and liabilities as at the Balance sheet date and the results of operations during the reporting period. The actual results could differ from these estimates. Any revision to such accounting estimates is recognized in the accounting period in which such revision takes place.`,

  "2.3": `Revenue is recognized to the extent that is probable that the economic benefits will flow to the company and the revenue can be reliably measured.\n\nSales or services excluding tax are recognized (net off returns, rate difference, trade discount etc.) on transfer of significant risk and rewards of ownership to the buyer of Goods which generally coincides with the delivery of goods or services to the customers. Interest and other income are recognized on accrual basis. Dividend & interest on income tax refund, if any are recognized on cash basis.`,

  "2.4": `Stock of inventories, if any are valued at the cost or net realizable value whichever is lower after providing for obsolescence and other losses, wherever considered necessary. Cost includes conversion cost and other overheads incurred in proportion to bringing the goods to its present condition and location.`,

  "2.5": `Freehold land is carried at historical cost. All other items of property, plant and equipment are recorded at the cost of acquisition or construction less accumulated depreciation which includes interest on borrowings and other incidental expenses incurred up to the date of its put to use. Property, plant and equipment which are completed and put to use was transferred to appropriate category of assets from WIP during the year.\n\nSubsequent expenditures related to an item of Tangible Asset are added to its book value. Only if they increase the future benefits from the existing asset beyond its previously assessed standard of performance.\n\nAssets which are not ready for their intended use are disclosed under Capital Work-in-Progress and all the cost relating to such assets are shown under work-in-progress.`,

  "2.6": `Depreciation on tangible fixed assets is provided on the written down value Method over the useful lives of assets as prescribed in the schedule II of the Companies Act, 2013. Depreciation for assets purchased sold during a period is proportionately charged. Intangible assets are amortized over their respective individual estimated useful lives on a written down value, commencing from the date the asset is available to the Company for its use.\n\nDepreciation and Amortization methods, useful lives and residual values are reviewed periodically, at each financial year end.\n\nPursuant to the enactment of Companies Act 2013, the Company has applied the estimated useful lives as specified in Schedule II.`,

  "2.7": `Tax expense comprises current and deferred tax, and this is recognized in profit and loss. Current tax is the estimated amount of tax payable on the taxable income for the year, using tax rates enacted or substantively enacted at the reporting date.\n\nDeferred tax is recognized by providing for differences between the carrying amount of assets liabilities, income or expenses, for financial reporting purposes and the amounts used for taxation purposes. Deferred tax is measured at the tax rates that are expected to be applied to timing differences when they are likely to reverse, based on the laws that have been enacted or substantively enacted by the reporting date. Deferred tax assets and liabilities are not offset unless there is a legally enforceable right to offset current tax liabilities and assets, except in special circumstances.\n\nA deferred tax asset is recognized only to the extent that it is probable that future taxable profits will be available against which the timing difference can be utilized. Deferred tax assets are reviewed at each reporting date and are reduced to the extent that it is no longer probable that the related tax benefit will be realized.`,

  "2.8": `Investments, if any are classified into current and long-term investment. Current investments are stated at lower of cost and fair value. There are no long-term investments and hence no further disclosure of accounting policies for valuation of investments is required.`,

  "2.9": `Trade and other receivables are generally measured at invoice value. An allowance for any shortfall in recovery is established if the collection of a receivable becomes doubtful. The amount of the allowance is the difference between the assets carrying amount and the estimated future cash flows. The loss allowance as also any subsequent recoveries made is recognized in the Profit and Loss. Bad debts are written off when identified.\n\nAggregate amount of Trade Receivables aging analysis report as required by the Revised Schedule III applicable from the financial year ended 31.03.2022 are separately disclosed in the format prescribed.\n\nTrade receivables are also further classified as follows:\n(i) Secured\n(ii) Unsecured\n(iii) Considered Good\n(iv) Considered Doubtful\n(v) Disputed\n(vi) Undisputed`,

  "2.10": `Cash and cash equivalents include all cash balances and short-term highly liquid investments that are readily convertible into known amounts of cash and which are subject to an insignificant risk of changes in value. Foreign Currency cash if any, and cash equivalents are measured at fair value.`,

  "2.11": `The entity prepares and presents Cash Flow from Operating Activities by adopting indirect method.`,

  "2.12": `Employee benefits as wages, salaries, paid leave and bonus are accrued in the year in which the services are rendered by the employees considering twelve months of rendering services classified as short-term employee benefits which and is recognized in the year in which the employee rendered the related services.`,

  "2.13": `Provisions involving substantial degree of estimate in measurement are recognized when there is present obligation as a result of past events, and it is probable that there will be an outflow of resources. Contingent liabilities are not recognized by the management and accordingly not provided by the company.`,

  "2.14": `The Company recognizes government grants when there is reasonable assurance that the conditions attached to them will be complied with and the grants will be received.\n\nGovernment Grants Related to Assets: These grants are recognized as deferred income in the balance sheet and amortized over the useful life of the related asset.\n\nGovernment Grants Related to Income: These grants are recognized in the profit and loss Statement over the periods in which the related expenses are incurred.`,

  "2.15": `Where events occur after the balance sheet date provide evidence of conditions that existed at the end of the reporting period, the impact of such events is adjusted with the Standalone Financial Statements. Otherwise, events after the balance sheet date of material size or nature are only disclosed.`,

  "2.16": `Basic earnings per share is calculated by dividing the net profit or loss after tax for the period attributable to the equity shareholders by the weighted average number of Equity Shares outstanding during the year adjusted for bonus elements in equity shares issued during the year.\n\nFor the purpose of calculating diluted earnings per share, the net profit or loss after tax for the period attributable to equity shareholders and the weighted average number of shares outstanding during the period, are adjusted for the effects of all dilutive potential equity shares.`,

  "2.17": `Income and expense in foreign currencies are converted at exchange rates prevailing on the date of the transaction. Foreign currency monetary assets and liabilities other than net investments in non-integral foreign operations are translated at the exchange rate prevailing on the balance sheet date and exchange gains and losses are recognised in the statement of profit and loss. Exchange difference arising on a monetary item that, in substance, forms part of an enterprise’s net investments in a non-integral foreign operation are accumulated in a foreign currency translation reserve.`,

  "2.18": `The group operates in a single segment i.e. "Manufacturing of xxxxxxxxxx" and hence does not have any additional disclosures to be made under AS - 17 Segment Reporting.`,
};

// ─── General Notes (numbered 1–9, appended after policies) ───────────────────

export const NTA_GENERAL_NOTES_DEFAULTS: string[] = [
  /* 1 */ `The figures in respect of previous year have been regrouped/rearranged whenever necessary to confirm to this year’s classification. The Accounting figures have been rounded off to nearest hundreds or thousands.`,

  /* 2 */ `The debit and credit balance appearing in the Balance Sheet are subject to confirmation from the respective parties.`,

  /* 3 */ `No loans or advances in the nature of loans are granted during the year to promoters, directors, KMPS and the related parties (as defined under Companies Act,2013) either severally or jointly with any other person, that are repayable on demand or without specifying any terms or period of repayment.`,

  /* 4 */ `In the opinion of Board of Directors, the current assets, Loans and Advances are approximately of the value stated, if realized in the ordinary course of business and that the provisions for all known and ascertained liabilities are adequate and not in excess of the amount reasonably necessary.`,

  /* 5 */ `In the opinion of Board of Directors, the current assets, Loans and Advances are approximately of the value stated, if realized in the ordinary course of business and that the provisions for all known and ascertained liabilities are adequate and not in excess of the amount reasonably necessary.`,

  /* 6 */ `The Company obtained information from their Suppliers regarding their status under the Micro, small & Medium Enterprises Development Act, 2006. Hence, disclosures, if any, relating to amounts unpaid as at the balance sheet date together with interest paid or payable as per the requirement under the said Act, have been given.`,

  /* 7 */ `Where external evidence in the form of vouchers towards expenses are not available, we have relied upon the said expenditure as recorded in the books of accounts and authenticated by the management.`,

  /* 8 */ `As informed by the Management, the company has no transactions with the companies struck off under Section 248 of the Companies Act, 2013.`,

  /* 9 */ `Disclosure of the Accounting Ratio is attached as per Note-XX.`,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the display text for a policy, falling back to the default when the
 * stored body is empty or null.
 */
export function resolvePolicy(id: string, storedBody: string | null | undefined): string {
  return storedBody?.trim() ? storedBody : (NTA_POLICY_DEFAULTS[id] ?? "");
}

/**
 * Returns the display text for a general note (0-indexed), falling back to
 * the default when the stored body is empty or null.
 */
export function resolveGeneralNote(
  idx: number,
  storedBody: string | null | undefined,
): string {
  return storedBody?.trim()
    ? storedBody
    : (NTA_GENERAL_NOTES_DEFAULTS[idx] ?? "");
}

// ─── Types (re-exported for consumers) ───────────────────────────────────────

export interface NtaPolicy {
  id:    string;   // "2.1" … "2.18"
  title: string;
  body:  string;   // "" = use default; non-empty = user-edited
}

export interface NtaGeneralNote {
  id:   number;   // 1 … 9
  body: string;   // "" = use default; non-empty = user-edited
}

export interface NtaOverview {
  registered_address_override: string | null;
  business_activity_override:  string | null;
}

export interface Stage8NtaData {
  overview:      NtaOverview;
  policies:      NtaPolicy[];
  general_notes: NtaGeneralNote[];
}

/** Ordered list of policy IDs and titles — drives the left-sidebar rendering. */
export const NTA_POLICY_META: Array<{ id: string; title: string }> = [
  { id: "2.1",  title: "Basis of Preparation of Financial statements" },
  { id: "2.2",  title: "Use of Estimates" },
  { id: "2.3",  title: "Revenues recognition" },
  { id: "2.4",  title: "Inventories" },
  { id: "2.5",  title: "Property Plant and Equipment" },
  { id: "2.6",  title: "Depreciation /Amortization and Impairment" },
  { id: "2.7",  title: "Taxes on Income" },
  { id: "2.8",  title: "Investments" },
  { id: "2.9",  title: "Trade and Other Receivables" },
  { id: "2.10", title: "Cash and Cash Equivalents" },
  { id: "2.11", title: "Cash Flow Statements" },
  { id: "2.12", title: "Employee Benefits" },
  { id: "2.13", title: "Provisions and Contingencies" },
  { id: "2.14", title: "Government Grants" },
  { id: "2.15", title: "Events after reporting date" },
  { id: "2.16", title: "Earnings per Share" },
  { id: "2.17", title: "Foreign currency transactions" },
  { id: "2.18", title: "Segment Reporting" },
];
