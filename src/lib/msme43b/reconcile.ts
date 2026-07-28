// MSME 43B(h) — the reconciliation oracle (the safety gate).
//
// A ledger is trustworthy only if reconstructing its running balance from the
// transactions equals the printed closing balance. This holds regardless of HOW
// the ledger was produced — deterministic parser OR Claude/AI extraction — so a
// wrong read (a misparsed column, an AI-misread digit, a skipped row) is FLAGGED,
// never silently used. This is what makes AI extraction safe for a tax workpaper.

import type { VendorLedger } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconstruct closing = opening + Σ(credit − debit) and compare to the printed
 * closing. Mutates and returns the ledger with reconstructedClosing / reconDrift
 * / balanceReconciled populated. Tolerance is ₹1 (rounding noise).
 */
export function reconcileLedger(led: VendorLedger, toleranceRupees = 1): VendorLedger {
  const reconstructed = r2(
    led.txns.reduce((acc, t) => acc + (t.credit || 0) - (t.debit || 0), led.openingBalance || 0),
  );
  led.reconstructedClosing = reconstructed;
  led.reconDrift = r2(reconstructed - (led.closingBalance || 0));
  led.balanceReconciled = Math.abs(led.reconDrift) <= toleranceRupees;
  return led;
}
