/**
 * QueryDraftEngine — Phase 4D
 *
 * Generates professional audit query description drafts based on:
 *   • The audit account Group/Subgroup (head)
 *   • The Ledger name (particulars)
 *   • Optional AnomalyType detected by the anomaly engine
 *   • Optional extras (amount, date) for richer anomaly-specific language
 *
 * Precedence:
 *   1. Anomaly-type template (if anomalyType provided)
 *   2. Exact group key match (lowercase)
 *   3. Partial / substring group match
 *   4. Generic professional fallback
 *
 * Usage:
 *   import { getDraftSuggestion } from "./QueryDraftEngine";
 *   const text = getDraftSuggestion("Sundry Debtors", "ABC Pvt Ltd");
 *   const text = getDraftSuggestion("", "Cash", "round_number", { amount: "5,00,000" });
 */
import type { AnomalyType } from "@/lib/anomalyEngine";

// ─── Per-Group Professional Templates ─────────────────────────────────────────
// Key = lowercase group name (or common alias); {ledger} is substituted at runtime.

const GROUP_TEMPLATES: Record<string, string> = {
  // ── Debtors ──────────────────────────────────────────────────────────────────
  "sundry debtors":
    "Kindly provide an age-wise receivables schedule for {ledger}, including party-wise outstanding balances as at year-end, balance confirmations received from debtors, and details of any disputed or doubtful amounts. If any balances have been written off during the year, please furnish the relevant management approvals.",
  "trade receivables":
    "Kindly provide an age-wise receivables schedule for {ledger}, including party-wise outstanding balances as at year-end, balance confirmations, and details of any amounts considered doubtful or written off.",
  "debtors":
    "Please provide an age-wise debtors schedule for {ledger} with party-wise outstanding balances as at year-end, balance confirmation letters, and details of any disputed, bad, or doubtful debts.",

  // ── Creditors ─────────────────────────────────────────────────────────────────
  "sundry creditors":
    "Please provide a party-wise outstanding payables schedule for {ledger} as at year-end, along with balance confirmation from the creditor. Clarify if any amounts are disputed, subject to deductions, or under legal proceedings.",
  "trade payables":
    "Please provide a party-wise outstanding payables schedule for {ledger} as at year-end, along with balance confirmation from the creditor. Clarify if any amounts are disputed or subject to legal proceedings.",
  "creditors":
    "Please provide a party-wise creditors schedule for {ledger} as at year-end with confirmation of balances. Clarify any long-outstanding or disputed creditor balances.",

  // ── Fixed Assets ──────────────────────────────────────────────────────────────
  "fixed assets":
    "Kindly share the fixed asset register for {ledger} showing opening balance, additions during the year, disposals, depreciation charged (method and rate), and closing WDV. Provide supporting documents (invoices, GST bills, purchase orders) for all capital additions.",
  "property, plant and equipment":
    "Kindly share the fixed asset register for {ledger} showing opening WDV, additions, disposals, depreciation for the year, and closing WDV. Provide invoices and authorisation (board resolution / management approval) for all capital expenditure incurred.",
  "tangible assets":
    "Please provide the fixed asset register for {ledger} with additions, disposals, and depreciation details. Provide supporting invoices and physical verification report for assets.",
  "intangible assets":
    "Please provide details of intangible asset {ledger} including cost, amortisation method, useful life, and current carrying value. Provide the basis for the amortisation policy and evidence of ownership / right.",
  "capital work in progress":
    "Please provide a detailed schedule of {ledger} showing project-wise expenditure incurred, expected date of capitalisation, and current status. Clarify any items that have been under construction for more than the expected period.",

  // ── Cash & Bank ───────────────────────────────────────────────────────────────
  "cash":
    "Please provide the cash book for {ledger} for the relevant period, along with physical cash count confirmation as at year-end certified by responsible personnel. Explain any significant cash balance held and confirm compliance with any applicable cash transaction limits.",
  "cash & bank":
    "Please provide bank statements and a bank reconciliation statement for {ledger} as at year-end, duly reconciled with the ledger balance. Provide explanations for all long-outstanding reconciling items (stale cheques, uncredited deposits).",
  "bank accounts":
    "Please provide bank statements and a bank reconciliation statement for {ledger} as at year-end, duly reconciled with the book balance. Explain all stale cheques, deposits in transit, and any unreconciled differences.",
  "bank balances":
    "Please provide bank statements for {ledger} as at year-end along with a duly certified bank reconciliation statement. Provide bank confirmation letter for year-end balance.",
  "cash and cash equivalents":
    "Please provide supporting schedules for {ledger} including bank reconciliations for all bank accounts, physical cash count confirmation, and details of any short-term investments classified under this head.",

  // ── Loans & Advances ──────────────────────────────────────────────────────────
  "loans & advances":
    "Please furnish details of the loan / advance relating to {ledger}, including the purpose, date of disbursement, terms of repayment, rate of interest, and current recovery status. Provide any agreement, board resolution, or authorisation letter for the transaction.",
  "advances":
    "Please furnish details of the advance relating to {ledger}, including purpose, date of payment, expected settlement date, and current outstanding status. Provide supporting agreements, work orders, or correspondence.",
  "short-term loans":
    "Please provide the loan agreement and repayment schedule for {ledger}. Confirm the outstanding balance as at year-end and whether any instalments are overdue.",
  "long-term loans":
    "Please provide the loan agreement, security details, and repayment schedule for {ledger}. Confirm the year-end outstanding balance and whether there has been any default in repayment.",

  // ── Investments ───────────────────────────────────────────────────────────────
  "investments":
    "Please provide details of the investment in {ledger}, including cost of acquisition, valuation basis as at year-end (cost / fair value / market value), income earned during the year, and any impairment assessment done.",
  "current investments":
    "Please provide details of {ledger} including acquisition cost, market / fair value as at year-end, and income received. Confirm the basis of classification as current investment.",
  "non-current investments":
    "Please provide details of the long-term investment in {ledger}, including cost, method of valuation, any diminution in value, and dividend / interest income received.",

  // ── Sales / Revenue ───────────────────────────────────────────────────────────
  "sales":
    "Please provide the basis of recognition of revenue for {ledger} and confirm that all invoices have been raised in the correct accounting period. Clarify any credit notes, discounts, rebates, or sales returns recorded during the year and provide supporting documentation.",
  "revenue from operations":
    "Please provide the basis of recognition of revenue for {ledger} and confirm cut-off compliance. Provide details of any significant year-on-year variation and supporting documentation for the largest transactions.",
  "other income":
    "Please provide details of {ledger} and the basis on which it has been recognised. Confirm whether the income is recurring or one-time in nature and provide supporting documentation.",

  // ── Purchases / Direct Costs ──────────────────────────────────────────────────
  "purchases":
    "Please provide supporting purchase invoices for {ledger} along with GSTR-2A / 2B reconciliation for ITC claimed. Clarify any purchases made without invoices, from unregistered vendors, or where GST has not been charged.",
  "cost of goods sold":
    "Please provide supporting purchase invoices and stock movement statements for {ledger}. Clarify any significant year-on-year variation in gross margin percentage.",
  "cost of material consumed":
    "Please provide the material consumption statement for {ledger} along with opening stock, purchases, and closing stock details. Confirm the basis of valuation and any significant write-offs.",

  // ── Inventory / Stock ─────────────────────────────────────────────────────────
  "stock":
    "Please provide the physical stock verification report for {ledger} conducted as at year-end, along with the valuation basis (lower of cost or NRV), stock statement, and any approvals for write-offs of slow-moving or obsolete inventory.",
  "inventory":
    "Please provide the physical stock verification report for {ledger} as at year-end, including details of valuation method, slow-moving / obsolete items, and any inventory write-down approvals.",
  "closing stock":
    "Please provide the closing stock statement for {ledger} duly certified by management, including details of valuation method applied, and any adjustments or write-downs made during the year.",

  // ── Capital / Equity ──────────────────────────────────────────────────────────
  "capital account":
    "Please provide details of capital introduced or withdrawn for {ledger} during the year, supported by bank statements. If remuneration, commission, or interest on capital is credited to partners/directors, provide the relevant authorisation (partnership deed / board resolution).",
  "share capital":
    "Please provide details of any changes in share capital for {ledger} during the year, including allotments, buy-backs, or cancellations. Provide board resolutions, regulatory filings, and share certificates as applicable.",
  "reserves & surplus":
    "Please provide the movement schedule for {ledger} showing opening balance, additions, utilisation, and closing balance. Provide board resolution or shareholder approval for any appropriation or transfer made during the year.",
  "retained earnings":
    "Please provide the movement schedule for {ledger} showing opening balance, profit / loss transferred, dividends, and closing balance. Provide board resolution for any dividend declared.",

  // ── Provisions & Liabilities ──────────────────────────────────────────────────
  "provisions":
    "Please provide the basis on which the provision for {ledger} has been created, including actuarial valuations, legal opinions, or management estimates as applicable. Provide comparison with prior year and explain significant changes.",
  "provision":
    "Please provide the basis and workings for the provision relating to {ledger}, including comparison with prior year. Provide actuarial report or legal opinion where applicable.",
  "other current liabilities":
    "Please provide a detailed schedule of {ledger} as at year-end with party-wise break-up and nature of each liability. Confirm whether any amounts are disputed or stale.",
  "other liabilities":
    "Please provide a detailed schedule of {ledger} as at year-end with party-wise break-up. Clarify the nature and expected settlement timeline for each outstanding item.",

  // ── Borrowings ────────────────────────────────────────────────────────────────
  "secured loans":
    "Please provide the loan agreement and latest sanction letter for {ledger}, including interest rate, repayment schedule, security details, and year-end outstanding balance confirmation from the lender / bank.",
  "unsecured loans":
    "Please provide details of the unsecured loan from {ledger}, including nature of relationship with the lender, interest rate, repayment terms, and confirmation of year-end balance. Clarify if the loan is from a related party and whether it complies with applicable provisions of law.",
  "term loans":
    "Please provide the loan agreement, sanction letter, and repayment schedule for {ledger}. Confirm the year-end outstanding balance and whether any repayment instalments are overdue.",

  // ── Expenses ──────────────────────────────────────────────────────────────────
  "direct expenses":
    "Please provide supporting invoices for {ledger} charged to the profit & loss account and clarify any significant variation compared to the prior year. Confirm that all expenses are revenue in nature and relate to the current period.",
  "indirect expenses":
    "Please provide supporting invoices for {ledger} charged to the profit & loss account and clarify any significant year-on-year variation. Confirm the business purpose and period of relevance.",
  "expenses":
    "Please provide supporting invoices for {ledger} and clarify any significant variation compared to the prior year. Confirm that all expenses are revenue in nature and properly authorised.",
  "miscellaneous expenses":
    "Please provide details of {ledger} including the nature of expenditure, the year it was incurred, amortisation policy adopted, and the current unamortised balance. Confirm the basis for treating this as a deferred revenue expenditure.",
  "finance costs":
    "Please provide details of {ledger} including the lender-wise break-up of interest, bank charges, and other finance costs. Provide supporting bank / lender confirmations and reconcile with the loan accounts.",
  "depreciation":
    "Please confirm the depreciation method and rates applied for {ledger} and provide workings showing opening WDV, depreciation for the year, and closing WDV. Confirm that the rates are in accordance with applicable accounting standards / law.",

  // ── Tax ───────────────────────────────────────────────────────────────────────
  "tds":
    "Please provide the TDS working for {ledger}, including nature of payment, section under which TDS was deducted, amounts deducted, amounts deposited, and reconciliation with Form 26AS / AIS.",
  "gst":
    "Please provide the GST reconciliation for {ledger} between books of accounts and GSTR-1 / GSTR-3B / GSTR-2A / 2B for the year. Clarify any differences and confirm that all ITC has been properly claimed / reversed.",
  "income tax":
    "Please provide the income tax computation and workings for {ledger}, including deferred tax calculation. Confirm advance tax instalments paid and reconcile with Form 26AS.",
  "taxes":
    "Please provide details of the tax liability / asset for {ledger} including the computation basis, deferred tax workings, and advance tax paid. Confirm compliance with applicable tax provisions.",
};

// ─── Per-Anomaly-Type Templates ────────────────────────────────────────────────
// These are used when an AnomalyType is provided (from the Anomaly Engine).

const ANOMALY_TEMPLATES: Record<AnomalyType, string> = {
  round_number:
    "A round-number transaction of ₹{amount} has been observed in {ledger}. Please confirm the basis and authenticity of this entry and provide supporting documentation (invoice / contract / agreement) for verification.",
  late_entry:
    "A journal entry dated {date} has been passed in {ledger} after the close of the accounting year. Please explain the reason for this late entry, the authorising official, and whether it relates to the current or prior financial year.",
  credit_in_dr_ledger:
    "A credit entry has been posted in {ledger}, which is typically a debit-nature account. Please explain the reason for this reversal / contra entry and provide supporting documentation and authorisation.",
  duplicate_amount:
    "Two or more transactions of identical amount (₹{amount}) have been identified in {ledger}. Please confirm whether these represent separate valid transactions and provide distinct supporting invoices / vouchers for each.",
  no_narration:
    "Several transactions in {ledger} lack adequate narration or description. Please provide a brief explanation of the nature and business purpose for each of these entries to enable audit verification.",
  party_not_in_tb:
    "A transaction has been recorded with {ledger}, which does not appear as an independent ledger in the Trial Balance. Please confirm the nature of this party, whether the balance has been settled, and provide supporting documentation.",
  high_value:
    "A high-value transaction of ₹{amount} has been identified in {ledger}. Please provide supporting documentation (invoice / contract / board resolution) and confirm the business purpose, approval, and legitimacy of this transaction.",
  inter_group_transfer:
    "An inter-group / inter-company transfer has been identified involving {ledger}. Please provide the basis for this transfer, confirm that both sides of the entry are correctly reflected in the respective ledgers, and provide supporting documents and management approval.",
};

// ─── Interpolation Helper ─────────────────────────────────────────────────────

function interpolate(
  template: string,
  ledger:   string,
  extras?:  { amount?: string; date?: string },
): string {
  return template
    .replace(/\{ledger\}/g, ledger || "the ledger")
    .replace(/\{amount\}/g, extras?.amount || "the noted amount")
    .replace(/\{date\}/g,   extras?.date   || "the noted date");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a professional audit query description draft.
 *
 * @param head         Group / Subgroup  (e.g. "Sundry Debtors")
 * @param ledger       Ledger name       (e.g. "ABC Pvt Ltd")
 * @param anomalyType  Optional anomaly type from the anomaly engine
 * @param extras       Optional amount / date for anomaly-specific context
 */
export function getDraftSuggestion(
  head:         string,
  ledger:       string,
  anomalyType?: AnomalyType,
  extras?:      { amount?: string; date?: string },
): string {
  // 1. Anomaly-type template takes highest precedence
  if (anomalyType && ANOMALY_TEMPLATES[anomalyType]) {
    return interpolate(ANOMALY_TEMPLATES[anomalyType], ledger || head, extras);
  }

  // 2. Exact lowercase key match
  const headKey = (head || "").trim().toLowerCase();
  if (headKey && GROUP_TEMPLATES[headKey]) {
    return interpolate(GROUP_TEMPLATES[headKey], ledger || head, extras);
  }

  // 3. Partial / substring match (head contains key or key contains head)
  if (headKey) {
    const matched = Object.keys(GROUP_TEMPLATES).find(
      k => headKey.includes(k) || k.includes(headKey),
    );
    if (matched) {
      return interpolate(GROUP_TEMPLATES[matched], ledger || head, extras);
    }
  }

  // 4. Generic professional fallback
  const subject = ledger || head || "the ledger / account";
  return `Please provide supporting documentation for transactions in ${subject} during the financial year under audit. Include relevant vouchers, invoices, agreements, reconciliation statements, or any other evidence necessary to substantiate the entries recorded.`;
}
