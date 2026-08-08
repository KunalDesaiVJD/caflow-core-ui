import { describe, it, expect } from 'vitest';
import { analyzeVendor, buildReport } from './engine';
import type { VendorLedger, LedgerTxn } from './types';
import { DEFAULT_CONFIG } from './config';

function txn(date: string, particulars: string, credit: number, debit: number, extra: Partial<LedgerTxn> = {}): LedgerTxn {
  return { date, particulars, credit, debit, ...extra };
}

function ledger(fy: string, opening: number, txns: LedgerTxn[]): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName: 'Test Vendor',
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
  };
}

describe('43B(h) two-year engine', () => {
  it('no disallowance when the year-end payable is cleared within the s.15 window', () => {
    // Bill on 20-Mar-26, due 04-May-26 (45d). Paid 10-Apr-26 → within window.
    const cy = ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [txn('2026-04-10', 'HDFC Bank', 0, 100000)]);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(0);
    expect(r.totalAllowedFY).toBe(0);
  });

  it('disallows in CY and re-allows in FY when paid late in the following year', () => {
    // Bill 20-Mar-26, due 04-May-26. Paid 20-Jun-26 → late → disallow CY, allow FY.
    const cy = ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [txn('2026-06-20', 'HDFC Bank', 0, 100000)]);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(100000);
    expect(r.totalAllowedFY).toBe(100000);
    expect(r.totalStillOutstanding).toBe(0);
  });

  it('disallows and leaves outstanding when never paid by FY end', () => {
    const cy = ledger('2025-26', 0, [txn('2026-01-10', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, []);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(100000);
    expect(r.totalAllowedFY).toBe(0);
    expect(r.totalStillOutstanding).toBe(100000);
  });

  it('nets TDS out of the disallowance base', () => {
    // Bill 100000, TDS 2000 deducted (debit), balance 98000 paid late.
    const cy = ledger('2025-26', 0, [
      txn('2026-03-20', 'Purchase A/c', 100000, 0),
      txn('2026-03-25', 'TDS on Contractor 194C', 0, 2000),
    ]);
    const fy = ledger('2026-27', 98000, [txn('2026-07-01', 'HDFC Bank', 0, 98000)]);
    const r = analyzeVendor(cy, fy);
    const bill = r.bills.find((b) => !b.bill.isOpening)!;
    expect(bill.bill.tdsAmount).toBe(2000);
    expect(bill.bill.base).toBe(98000);
    expect(r.totalDisallowedCY).toBe(98000); // only the base is disallowable
  });

  it('treats kasar/vatav as a compliant non-cash reduction (not disallowed)', () => {
    // Bill 100000, 100 kasar write-off, 99900 paid within window.
    const cy = ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [
      txn('2026-04-10', 'Kasar Vatav', 0, 100),
      txn('2026-04-15', 'HDFC Bank', 0, 99900),
    ]);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(0);
  });

  it('excludes the opening balance from CY disallowance and applies FIFO oldest-first', () => {
    // Opening 50000 (pre-CY). A CY purchase 30000 on 25-Mar. One payment 50000 on
    // 02-Apr clears the OLDER opening; the CY bill stays outstanding, due 09-May,
    // and unpaid by FY end.
    const cy = ledger('2025-26', 50000, [txn('2026-03-25', 'Purchase A/c', 30000, 0)]);
    const fy = ledger('2026-27', 30000, [txn('2026-04-02', 'HDFC Bank', 0, 50000)]);
    const r = analyzeVendor(cy, fy);
    // opening consumed by the payment; CY bill unpaid → disallowed
    expect(r.totalDisallowedCY).toBe(30000);
    expect(r.totalStillOutstanding).toBe(30000);
  });

  it('flags missing FY ledger and disallows year-end outstanding conservatively', () => {
    const cy = ledger('2025-26', 0, [txn('2026-02-01', 'Purchase A/c', 100000, 0)]);
    const r = analyzeVendor(cy, null);
    expect(r.totalDisallowedCY).toBe(100000);
    expect(r.warnings.some((w) => /Following-year ledger not provided/.test(w))).toBe(true);
  });

  it('reports a continuity break when FY opening ≠ CY closing', () => {
    const cy = ledger('2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 90000, []); // wrong opening
    const r = analyzeVendor(cy, fy);
    expect(r.continuityOk).toBe(false);
  });

  it('excludes a book provision from the disallowance base — it is not an invoice', () => {
    // A real bill (100000, paid on time → 0 disallowance) plus a year-end
    // "Provision for expenses" credit (20000) that was never an actual invoice
    // from the supplier. The provision must not become a bill the section can
    // disallow, and its reversal (if narrated as one) must not consume a real
    // settlement either.
    const cy = ledger('2025-26', 0, [
      txn('2026-03-20', 'Purchase A/c', 100000, 0),
      txn('2026-03-31', 'Provision for expenses', 20000, 0),
    ]);
    const fy = ledger('2026-27', 100000, [txn('2026-04-10', 'HDFC Bank', 0, 100000)]);
    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(0);
    expect(r.provisionExcluded).toBe(20000);
    expect(r.warnings.some((w) => /book provisions?\/accruals? excluded/i.test(w))).toBe(true);
    expect(r.verified).not.toBe(false); // the independent cross-check must agree
  });

  it('does not let a provision-only credit inflate the payable cross-checked between engines', () => {
    // Same scenario as above, isolated to confirm the primary engine and the
    // independent cross-check (crosscheck.ts) agree the provision is excluded
    // — if only one engine excluded it, this vendor would fail sign-off with a
    // spurious "failed the cross-check" blocker.
    const cy = ledger('2025-26', 0, [txn('2026-03-31', 'Provision for expenses', 20000, 0)]);
    const r = analyzeVendor(cy, null);
    expect(r.totalDisallowedCY).toBe(0);
    expect(r.verified).not.toBe(false);
  });

  it('buildReport pairs CY/FY by vendor name and aggregates', () => {
    const cy = ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('2026-27', 100000, [txn('2026-06-20', 'HDFC Bank', 0, 100000)]);
    const rep = buildReport([cy], [fy], DEFAULT_CONFIG, 'ACME');
    expect(rep.totalDisallowedCY).toBe(100000);
    expect(rep.vendors).toHaveLength(1);
    expect(rep.cyLabel).toBe('2025-26');
  });
});
