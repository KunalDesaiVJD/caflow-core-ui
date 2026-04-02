/**
 * classifier.js — Category classification for Tally Trial Balance rows
 *
 * Maps a ledger/group display_name to one of:
 *   asset | liability | capital | income | expense | unknown
 *
 * Matching strategy (in priority order):
 *   1. Exact match (case-insensitive)
 *   2. Starts-with match
 *   3. Contains match
 *
 * Always returns "unknown" if no match is found — never throws.
 */

// ─── Category → keyword arrays ──────────────────────────────────────────────
// Keywords are lowercase. All matching is case-insensitive.

const ASSET_KEYWORDS = [
  // Standard Tally primary groups
  'fixed assets',
  'fixed asset',
  'tangible assets',
  'intangible assets',
  'capital work in progress',
  'capital work-in-progress',
  'cwip',
  'investments',
  'investment',

  // Current assets
  'current assets',
  'current asset',
  'sundry debtors',
  'trade debtors',
  'trade receivables',
  'debtors',

  // Cash & Bank
  'cash-in-hand',
  'cash in hand',
  'cash',
  'bank accounts',
  'bank account',
  'bank balances',
  'bank balance',

  // Deposits & Advances
  'deposits (asset)',
  'deposits asset',
  'security deposit',
  'loans & advances (asset)',
  'loans and advances (asset)',
  'loans & advances',
  'loans and advances',
  'advance',
  'prepaid',

  // Stock / Inventory
  'stock-in-hand',
  'stock in hand',
  'inventory',
  'opening stock',
  'closing stock',

  // Tax receivables
  'tds receivable',
  'tcs receivable',
  'gst receivable',
  'input gst',
  'input cgst',
  'input sgst',
  'input igst',

  // Other asset groups
  'miscellaneous expenses (asset)',
  'misc. expenses (asset)',
  'deferred tax asset',
  'suspense a/c',
  'suspense',
  'branch / divisions',
];

const EXPENSE_KEYWORDS = [
  // Standard Tally primary groups
  'purchase accounts',
  'purchase account',
  'purchases',
  'direct expenses',
  'direct expense',
  'indirect expenses',
  'indirect expense',
  'manufacturing expenses',
  'manufacturing expense',

  // Common expense sub-groups
  'employee benefit expenses',
  'employee benefits',
  'payroll expenses',
  'financial expenses',
  'financial charges',
  'finance costs',
  'finance cost',
  'selling expenses',
  'administrative expenses',
  'general expenses',
  'depreciation',
  'depreciation & amortisation',
  'partner payout',
  'partner remuneration',
  'interest on capital',
  'remuneration to partner',
  'remuneration to partners',
];

const LIABILITY_KEYWORDS = [
  // Loans
  'loans (liability)',
  'loan (liability)',
  'secured loans',
  'unsecured loans',
  'term loan',
  'bank od a/c',
  'bank od accounts',
  'bank od',
  'overdraft',
  'cash credit',
  'cc account',
  'cc limit',
  'working capital loan',
  'dealer finance',

  // Current liabilities
  'current liabilities',
  'current liability',
  'other current liabilities',
  'sundry creditors',
  'trade payables',
  'trade creditors',
  'creditors',
  'duties & taxes',
  'duties and taxes',
  'gst payable',
  'tds payable',
  'tcs payable',
  'provisions',
  'provision',
  'outstanding expenses',
  'accrued liabilities',
  'deferred tax liability',
  'advance from customers',
  'advance received',
  'statutory dues',
];

const CAPITAL_KEYWORDS = [
  // Standard Tally primary groups
  'capital account',
  'partners capital',
  'partner capital',
  'proprietor capital',
  'shareholder funds',
  'shareholders funds',
  'share holder funds',
  'equity share capital',
  'share capital',
  'reserves & surplus',
  'reserve & surplus',
  'reserves and surplus',
  'reserve and surplus',
  'capital reserve',
  'general reserve',
  'quasi equity',
  'share application money',
  'directors loan',
  'director loan',
  'profit & loss a/c',
  'profit and loss a/c',
  'retained earnings',
];

const INCOME_KEYWORDS = [
  // Standard Tally primary groups
  'sales accounts',
  'sales account',
  'sales',
  'revenue',
  'turnover',
  'direct income',
  'direct incomes',
  'indirect income',
  'indirect incomes',
  'other income',
  'other incomes',
  'interest received',
  'commission received',
  'discount received',
  'job work income',
  'miscellaneous income',
  'operating income',
];

// ─── Build a priority-ordered lookup table ──────────────────────────────────
// [category, keyword] pairs sorted by keyword length DESC (longer = more specific first)
const LOOKUP = [];

function addKeywords(category, keywords) {
  for (const kw of keywords) {
    LOOKUP.push({ category, keyword: kw });
  }
}

addKeywords('asset', ASSET_KEYWORDS);
addKeywords('expense', EXPENSE_KEYWORDS);
addKeywords('liability', LIABILITY_KEYWORDS);
addKeywords('capital', CAPITAL_KEYWORDS);
addKeywords('income', INCOME_KEYWORDS);

// Sort: longer keywords match first (more specific before more general)
LOOKUP.sort((a, b) => b.keyword.length - a.keyword.length);

// ─── Main classification function ───────────────────────────────────────────

/**
 * Classify a display_name into a category.
 *
 * @param {string} displayName - Ledger or group name from Tally XML
 * @returns {'asset'|'liability'|'capital'|'income'|'expense'|'unknown'}
 */
function classifyRow(displayName) {
  if (!displayName || typeof displayName !== 'string') return 'unknown';

  const normalised = displayName.toLowerCase().trim();
  if (!normalised) return 'unknown';

  // 1. Exact match
  for (const entry of LOOKUP) {
    if (normalised === entry.keyword) return entry.category;
  }

  // 2. Starts-with match (e.g., "Fixed Assets - Plant & Machinery" → asset)
  for (const entry of LOOKUP) {
    if (normalised.startsWith(entry.keyword)) return entry.category;
  }

  // 3. Contains match (e.g., "TDS Payable - 194C" → liability)
  for (const entry of LOOKUP) {
    if (normalised.includes(entry.keyword)) return entry.category;
  }

  return 'unknown';
}

module.exports = { classifyRow };
