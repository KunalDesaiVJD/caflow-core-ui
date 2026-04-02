/**
 * normalizer.js — Sign normalization for Tally Trial Balance values
 *
 * CRITICAL CONTEXT:
 * Tally XML sign conventions are NOT presentation-ready:
 *   - Assets and Expenses often appear as NEGATIVE values in the XML
 *   - Liabilities, Capital, and Income usually appear as POSITIVE values
 *
 * This module:
 *   - PRESERVES raw values unchanged
 *   - GENERATES normalized values by inverting signs for asset/expense
 *   - NEVER modifies raw data
 *   - ALWAYS records which sign rule was applied (audit trail)
 *
 * Rule:
 *   category = asset | expense  → normalized = raw * -1
 *   category = liability | capital | income → normalized = raw (unchanged)
 *   category = unknown → normalized = raw (pass-through, flagged)
 */

/**
 * Safe number parser — returns 0 for blank/null/non-numeric values.
 * Preserves decimals exactly.
 *
 * @param {*} v - Raw value from XML
 * @returns {number}
 */
function num(v) {
  if (v === null || v === undefined) return 0;
  const str = String(v).trim();
  if (str === '' || str === '-' || str === '.') return 0;
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Apply sign normalization based on account category.
 *
 * @param {number} raw - The raw numeric value from XML
 * @param {'asset'|'liability'|'capital'|'income'|'expense'|'unknown'} category
 * @returns {number} Normalized value for reporting
 */
function normalizeByCategory(raw, category) {
  switch (category) {
    case 'asset':
    case 'expense':
      // XML shows these as negative; flip to positive for reports
      return raw * -1;

    case 'liability':
    case 'capital':
    case 'income':
      // These are already in correct sign for reports
      return raw;

    case 'unknown':
    default:
      // Pass through unchanged — caller must handle unknown category
      return raw;
  }
}

/**
 * Determine the sign rule description for audit logging.
 *
 * @param {'asset'|'liability'|'capital'|'income'|'expense'|'unknown'} category
 * @returns {string}
 */
function signRuleDescription(category) {
  switch (category) {
    case 'asset':
      return 'asset: raw * -1 (Tally assets are negative in XML, flipped to positive)';
    case 'expense':
      return 'expense: raw * -1 (Tally expenses are negative in XML, flipped to positive)';
    case 'liability':
      return 'liability: raw unchanged (Tally liabilities are already positive)';
    case 'capital':
      return 'capital: raw unchanged (Tally capital accounts are already positive)';
    case 'income':
      return 'income: raw unchanged (Tally income accounts are already positive)';
    case 'unknown':
    default:
      return 'unknown: raw pass-through (category not identified — review manually)';
  }
}

/**
 * Normalize a full parsed row object.
 *
 * Input row must have:
 *   opening_balance_raw, debit_raw, credit_raw, closing_balance_raw
 *
 * Returns an object with:
 *   opening_balance_normalized, debit_normalized,
 *   credit_normalized, closing_balance_normalized,
 *   sign_rule_applied
 *
 * RAW VALUES ARE NEVER MODIFIED — they exist on the original row object.
 *
 * @param {{ opening_balance_raw: number, debit_raw: number, credit_raw: number, closing_balance_raw: number }} rawRow
 * @param {'asset'|'liability'|'capital'|'income'|'expense'|'unknown'} category
 * @returns {{ opening_balance_normalized: number, debit_normalized: number, credit_normalized: number, closing_balance_normalized: number, sign_rule_applied: string }}
 */
function normalizeRow(rawRow, category) {
  const openRaw  = num(rawRow.opening_balance_raw);
  const debitRaw = num(rawRow.debit_raw);
  const credRaw  = num(rawRow.credit_raw);
  const closeRaw = num(rawRow.closing_balance_raw);

  return {
    opening_balance_normalized:  normalizeByCategory(openRaw,  category),
    debit_normalized:            normalizeByCategory(debitRaw, category),
    credit_normalized:           normalizeByCategory(credRaw,  category),
    closing_balance_normalized:  normalizeByCategory(closeRaw, category),
    sign_rule_applied:           signRuleDescription(category),
  };
}

module.exports = { normalizeRow, normalizeByCategory, num, signRuleDescription };
