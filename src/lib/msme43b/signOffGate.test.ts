import { describe, it, expect } from 'vitest';
import { buildReport, deriveBlockers } from './engine';
import { DEFAULT_CONFIG } from './config';
import type { VendorLedger, LedgerTxn, VendorResult } from './types';

function txn(date: string, particulars: string, credit: number, debit: number): LedgerTxn {
  return { date, particulars, credit, debit };
}

function ledger(
  vendorName: string,
  fy: string,
  opening: number,
  txns: LedgerTxn[],
  over: Partial<VendorLedger> = {},
): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName,
    financialYear: fy,
    periodFrom: `${start}-04-01`,
    periodTo: `${end}-03-31`,
    openingBalance: opening,
    closingBalance: closing,
    txns,
    format: 'tally',
    reconstructedClosing: closing,
    balanceReconciled: true,
    reconDrift: 0,
    ...over,
  };
}

/** A vendor whose CY ledger did not agree to its printed closing balance. */
function brokenLedger(vendorName: string, amount: number): VendorLedger {
  return ledger(vendorName, '2025-26', 0, [txn('2026-01-10', 'Purchase A/c', amount, 0)], {
    // The printed closing says something else — the extraction lost a line.
    closingBalance: amount + 7500,
    reconstructedClosing: amount,
    balanceReconciled: false,
    reconDrift: 7500,
  });
}

describe('sign-off gate — an unreconciled ledger is quantified, not quietly used', () => {
  it('blocks sign-off and names the vendor when a CY ledger does not reconcile', () => {
    const rep = buildReport([brokenLedger('Doubtful Traders', 100000)], [], DEFAULT_CONFIG, 'ACME');

    expect(rep.blocksSignOff).toBe(true);
    expect(rep.unreconciledVendors).toEqual(['Doubtful Traders']);
    expect(rep.clean).toBe(false);
    expect(rep.blockingReasons.some((r) => /did not agree to their printed closing balance/.test(r))).toBe(true);
  });

  it('keeps the unreconciled figure IN the total — dropping it would understate the disallowance', () => {
    const rep = buildReport([brokenLedger('Doubtful Traders', 100000)], [], DEFAULT_CONFIG, 'ACME');

    // The whole point: the amount is still added back, AND separately disclosed.
    expect(rep.totalDisallowedCY).toBe(100000);
    expect(rep.unreconciledDisallowed).toBe(100000);
  });

  it('states the exposure separately from the total when only some ledgers are broken', () => {
    const goodCy = ledger('Clean Supplies', '2025-26', 0, [txn('2026-01-10', 'Purchase A/c', 40000, 0)]);
    const goodFy = ledger('Clean Supplies', '2026-27', 40000, []);
    const rep = buildReport(
      [goodCy, brokenLedger('Doubtful Traders', 100000)],
      [goodFy],
      DEFAULT_CONFIG,
      'ACME',
    );

    expect(rep.totalDisallowedCY).toBe(140000);
    expect(rep.unreconciledDisallowed).toBe(100000); // 71% of the headline is unreliable
    expect(rep.unreconciledVendors).toEqual(['Doubtful Traders']);
    expect(rep.blocksSignOff).toBe(true);
  });

  it('does not block when every ledger reconciles and continuity holds', () => {
    const cy = ledger('Clean Supplies', '2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Clean Supplies', '2026-27', 100000, [txn('2026-06-20', 'HDFC Bank', 0, 100000)]);
    const rep = buildReport([cy], [fy], DEFAULT_CONFIG, 'ACME');

    expect(rep.blocksSignOff).toBe(false);
    expect(rep.blockingReasons).toEqual([]);
    expect(rep.unreconciledDisallowed).toBe(0);
    expect(rep.clean).toBe(true);
  });

  it('blocks on a broken year-on-year continuity even though both ledgers reconcile', () => {
    const cy = ledger('Clean Supplies', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Clean Supplies', '2026-27', 90000, []); // opening ≠ CY closing
    const rep = buildReport([cy], [fy], DEFAULT_CONFIG, 'ACME');

    expect(rep.blocksSignOff).toBe(true);
    expect(rep.blockingReasons.some((r) => /opening balance that does not equal/.test(r))).toBe(true);
    // Reconciliation itself was fine, so nothing is attributed to that cause.
    expect(rep.unreconciledVendors).toEqual([]);
  });

  it('clean is no longer a tautology — a low-confidence entry alone stops it', () => {
    const cy = ledger('Clean Supplies', '2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Clean Supplies', '2026-27', 100000, [
      // A debit whose narration matches no keyword: the classifier assumes it is
      // a payment but flags itself, which is exactly the case that must not be
      // reported as a clean working paper.
      txn('2026-06-20', 'Zzqx 7741', 0, 100000),
    ]);
    const rep = buildReport([cy], [fy], DEFAULT_CONFIG, 'ACME');

    expect(rep.vendors[0].reviewCount).toBeGreaterThan(0);
    expect(rep.clean).toBe(false);
    // Nothing is BLOCKED by it, though — a flagged narration is a review item,
    // not a failed control, so the export gate stays open.
    expect(rep.blocksSignOff).toBe(false);
  });
});

describe('deriveBlockers is a pure function of the vendor results', () => {
  const vendor = (over: Partial<VendorResult>): VendorResult => ({
    vendorName: 'V', format: 'tally',
    cyReconciled: true, fyReconciled: true,
    cyClosing: 0, fyOpening: 0, continuityOk: true,
    bills: [], totalDisallowedCY: 0, totalAllowedFY: 0, totalStillOutstanding: 0,
    warnings: [], reviewCount: 0, gstExcluded: 0, gstUnidentifiedValue: 0,
    ...over,
  });

  it('reports nothing for a clean set', () => {
    expect(deriveBlockers([vendor({})])).toEqual({
      unreconciledVendors: [], unreconciledDisallowed: 0,
      blocksSignOff: false, blockingReasons: [],
    });
  });

  it('reports a cross-check failure separately from a reconciliation failure', () => {
    const b = deriveBlockers([
      vendor({ vendorName: 'A', cyReconciled: false, totalDisallowedCY: 500 }),
      vendor({ vendorName: 'B', verified: false }),
    ]);
    expect(b.unreconciledVendors).toEqual(['A']);
    expect(b.unreconciledDisallowed).toBe(500);
    expect(b.blockingReasons).toHaveLength(2);
    expect(b.blockingReasons[1]).toMatch(/failed the cross-check/);
  });

  it('a report saved before these fields existed can be rehydrated from its vendors', () => {
    // What a legacy stored report looks like: vendor detail present, no blockers.
    const legacyVendors = [vendor({ vendorName: 'A', cyReconciled: false, totalDisallowedCY: 1234 })];
    const rehydrated = { ...deriveBlockers(legacyVendors) };
    // Crucially NOT "blocksSignOff: false" — the exception survives the round trip.
    expect(rehydrated.blocksSignOff).toBe(true);
    expect(rehydrated.unreconciledDisallowed).toBe(1234);
  });
});
