// MSME 43B(h) — verification layer.
//
// Runs the independent cross-check engine and a set of invariants against the
// primary engine's result for a vendor. Any failure is surfaced (verified=false
// + notes) so the UI/workpaper can flag it instead of silently trusting a figure.

import type { VendorResult, VendorLedger } from './types';
import { DEFAULT_CONFIG, Msme43bConfig } from './config';
import { crossCheckVendor } from './crosscheck';

export interface VerifyOutcome {
  verified: boolean;
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function verifyVendor(
  primary: VendorResult,
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig = DEFAULT_CONFIG,
): VerifyOutcome {
  const notes: string[] = [];
  const tol = Math.max(cfg.toleranceRupees, 2);

  // ── 1. Independent cross-check must agree with the primary engine ──
  const x = crossCheckVendor(cy, fy, cfg, primary.declaredGstRate);
  const cmp = (label: string, a: number, b: number) => {
    if (Math.abs(a - b) > tol) notes.push(`${label}: engine ₹${r2(a)} vs cross-check ₹${r2(b)} (diff ₹${r2(a - b)})`);
  };
  cmp('Disallowed CY', primary.totalDisallowedCY, x.disallowedCY);
  cmp('Allowed FY', primary.totalAllowedFY, x.allowedFY);
  cmp('Still outstanding', primary.totalStillOutstanding, x.stillOutstanding);

  // ── 2. Invariants (implementation-independent) ──
  const d = primary.totalDisallowedCY, a = primary.totalAllowedFY, s = primary.totalStillOutstanding;
  if (d < -tol || a < -tol || s < -tol) notes.push('Negative total (disallowance/allowance/outstanding must be ≥ 0).');
  if (Math.abs(d - (a + s)) > tol) notes.push(`Identity broken: disallowed (₹${r2(d)}) ≠ allowedFY + stillOutstanding (₹${r2(a + s)}).`);
  // Cannot disallow more than was outstanding to the vendor at CY year-end.
  const closingPayable = Math.max(0, cy.closingBalance);
  if (d > closingPayable + tol) notes.push(`Disallowed CY (₹${r2(d)}) exceeds CY closing payable (₹${r2(closingPayable)}).`);
  // Allowed-in-FY cannot exceed total FY payments to the vendor.
  if (fy) {
    const fyPayments = fy.txns.reduce((acc, t) => acc + (t.debit || 0), 0);
    if (a > fyPayments + tol) notes.push(`Allowed FY (₹${r2(a)}) exceeds total FY payments (₹${r2(fyPayments)}).`);
  }

  return { verified: notes.length === 0, notes };
}
