import { describe, it, expect } from 'vitest';
import { analyzeVendor } from './engine';
import { crossCheckVendor } from './crosscheck';
import type { VendorLedger, LedgerTxn } from './types';

function txn(date: string, particulars: string, credit: number, debit: number): LedgerTxn {
  return { date, particulars, credit, debit };
}
function ledger(fy: string, opening: number, txns: LedgerTxn[]): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName: 'Test Vendor', financialYear: fy,
    periodFrom: `${start}-04-01`, periodTo: `${end}-03-31`,
    openingBalance: opening, closingBalance: closing, txns,
    format: 'tally', reconstructedClosing: closing, balanceReconciled: true, reconDrift: 0,
  };
}

describe('day-count boundary — exclusive of invoice date (firm-blessed)', () => {
  // Bill 17-Mar-2026, 45-day window → last compliant day is 01-May-2026.
  it('payment ON the 45th day (01-May) is within time — no disallowance', () => {
    const cy = ledger('2025-26', 0, [txn('2026-03-17', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [txn('2026-05-01', 'HDFC Bank', 0, 100000)]);
    expect(analyzeVendor(cy, fy).totalDisallowedCY).toBe(0);
  });
  it('payment on 02-May (one day late) is disallowed CY, allowed FY', () => {
    const cy = ledger('2025-26', 0, [txn('2026-03-17', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [txn('2026-05-02', 'HDFC Bank', 0, 100000)]);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(100000);
    expect(r.totalAllowedFY).toBe(100000);
  });
});

describe('independent cross-check agrees with the primary engine', () => {
  const cases: Array<[string, VendorLedger, VendorLedger | null]> = [
    ['within window',
      ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]),
      ledger('2026-27', 100000, [txn('2026-04-10', 'HDFC Bank', 0, 100000)])],
    ['late in FY',
      ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]),
      ledger('2026-27', 100000, [txn('2026-06-20', 'HDFC Bank', 0, 100000)])],
    ['unpaid',
      ledger('2025-26', 0, [txn('2026-01-10', 'Purchase A/c', 100000, 0)]),
      ledger('2026-27', 100000, [])],
    ['TDS net-out',
      ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0), txn('2026-03-25', 'TDS 194C', 0, 2000)]),
      ledger('2026-27', 98000, [txn('2026-07-01', 'HDFC Bank', 0, 98000)])],
    ['kasar compliant',
      ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]),
      ledger('2026-27', 100000, [txn('2026-04-10', 'Kasar Vatav', 0, 100), txn('2026-04-15', 'HDFC Bank', 0, 99900)])],
    ['opening + FIFO',
      ledger('2025-26', 50000, [txn('2026-03-25', 'Purchase A/c', 30000, 0)]),
      ledger('2026-27', 30000, [txn('2026-04-02', 'HDFC Bank', 0, 50000)])],
    ['multiple bills, partial late',
      ledger('2025-26', 0, [txn('2026-02-01', 'Purchase A/c', 40000, 0), txn('2026-03-10', 'Purchase A/c', 60000, 0)]),
      ledger('2026-27', 100000, [txn('2026-04-05', 'HDFC Bank', 0, 40000), txn('2026-07-20', 'HDFC Bank', 0, 60000)])],
  ];
  for (const [name, cy, fy] of cases) {
    it(name, () => {
      const p = analyzeVendor(cy, fy);
      const x = crossCheckVendor(cy, fy);
      expect(x.disallowedCY).toBeCloseTo(p.totalDisallowedCY, 1);
      expect(x.allowedFY).toBeCloseTo(p.totalAllowedFY, 1);
      expect(x.stillOutstanding).toBeCloseTo(p.totalStillOutstanding, 1);
      expect(p.verified).toBe(true);
    });
  }
});

describe('invariants hold', () => {
  it('disallowed == allowedFY + stillOutstanding, all non-negative', () => {
    const cy = ledger('2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [txn('2026-06-01', 'HDFC Bank', 0, 40000)]);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBeCloseTo(r.totalAllowedFY + r.totalStillOutstanding, 1);
    expect(r.totalDisallowedCY).toBeGreaterThanOrEqual(0);
    expect(r.verified).toBe(true);
  });
});
