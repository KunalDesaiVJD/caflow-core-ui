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

/** A reserves (BS_EQ_RS) ledger as seen on the trial balance — only the fields
 *  the books-closed detection needs. */
export interface ReservesLedger {
  account_name:     string;
  opening_balance?: number | null;
  tally_debit?:     number | null;
  tally_credit?:    number | null;
}

/**
 * Decide whether the current-year net profit is ALREADY embedded in the
 * Reserves & Surplus ledgers (i.e. the firm has closed its books and journalled
 * the year's P&L straight into retained earnings).  When true, the FS engine
 * must NOT auto-credit net P&L to BS_EQ_RS a second time (that would double-count);
 * when false, it must auto-credit it (mirrors the closing entry Dr P&L → Cr Reserves).
 *
 * MUST be used by BOTH the COA-mapping screen (PipelineStage3) and the Financial
 * Statements engine (PipelineFinancialStatements) so the two never disagree.
 *
 * Accumulator-aware (root-cause fix): Tally's "Profit & Loss A/c" with an opening
 * balance of ~0 is the *current-year accumulator* — its closing balance IS the
 * year's profit, still PENDING transfer to reserves.  When such an accumulator
 * is present the books are, by definition, NOT closed, so the profit MUST still
 * be credited — regardless of any unrelated movement on other reserves ledgers
 * (e.g. a dividend/drawings debit to "Reserve & Surplus").  Without this short-
 * circuit a benign reserve movement produced a false "books closed" reading and
 * silently dropped the current-year profit from the Balance Sheet.
 */
export function currentYearProfitAlreadyInReserves(
  reservesLedgers: ReservesLedger[],
): boolean {
  const isUntransferredAccumulator = (a: ReservesLedger) =>
    isTallyPLAccount(a.account_name) && Math.abs(Number(a.opening_balance ?? 0)) < 0.005;

  // If the current-year profit is still parked in the P&L A/c accumulator,
  // books are not closed → profit has NOT been transferred to reserves.
  if (reservesLedgers.some(isUntransferredAccumulator)) return false;

  // Otherwise: books are closed iff a NON-accumulator reserves ledger shows
  // current-year journal movement (the profit was manually transferred in).
  return reservesLedgers.some(a => {
    if (isUntransferredAccumulator(a)) return false;
    return Math.abs(Number(a.tally_debit ?? 0)) > 0.005
        || Math.abs(Number(a.tally_credit ?? 0)) > 0.005;
  });
}
