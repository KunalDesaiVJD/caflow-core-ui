/**
 * tallyDetection — small helpers for recognising special Tally ledgers
 * by ledger name, so the FS engine can apply correct treatment regardless
 * of how the ledger was labelled in the source data.
 *
 * Bug 4 / Bug 8 — Detect Tally's accumulated P&L account ("Profit & Loss A/c"
 * or its many spellings) so its closing balance is read from OPENING balance
 * only when mapped to BS_EQ_RS (avoids double-counting current-year profit
 * already captured via PL_REV / PL_EXP codes).
 */

/**
 * Returns true when the given ledger name is the Tally retained-earnings
 * carrier (profit & loss a/c, p&l a/c, retained earnings, accumulated profit/loss).
 *
 * Matches case-insensitively, ignores leading/trailing whitespace, and
 * tolerates common spelling variants (& vs and, A/c vs Account vs nothing).
 */
export function isTallyPLAccount(ledgerName: string | null | undefined): boolean {
  if (!ledgerName) return false;
  const n = ledgerName.trim().toLowerCase();
  if (!n) return false;

  // Direct lookups — fastest path, covers ~95% of real-world cases.
  const direct = new Set([
    "profit & loss a/c",
    "profit and loss a/c",
    "profit & loss account",
    "profit and loss account",
    "p & l a/c",
    "p&l a/c",
    "p & l account",
    "p&l account",
    "retained earnings",
    "accumulated profit",
    "accumulated loss",
    "accumulated profit/loss",
    "accumulated profits",
    "accumulated losses",
  ]);
  if (direct.has(n)) return true;

  // Pattern fallbacks for whitespace / punctuation variants.
  const patterns = [
    /^profit\s*(&|and)\s*loss(\s*(a\/?c|account))?$/,
    /^p\s*(&|and)\s*l(\s*(a\/?c|account))?$/,
    /^retained\s+earnings?$/,
    /^accumulated\s+(profit|loss|profits|losses)(\s*\/\s*(profit|loss))?$/,
  ];
  return patterns.some(p => p.test(n));
}
