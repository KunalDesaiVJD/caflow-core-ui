import { describe, it, expect } from 'vitest';
import { classificationSensitivity, sensitivityWarnings } from './sensitivity';
import { buildReport } from './engine';
import { verifyVendor } from './verify';
import { crossCheckVendor } from './crosscheck';
import { DEFAULT_CONFIG } from './config';
import type { VendorLedger, LedgerTxn } from './types';

function txn(date: string, particulars: string, credit: number, debit: number): LedgerTxn {
  return { date, particulars, credit, debit };
}

function ledger(fy: string, opening: number, txns: LedgerTxn[]): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName: 'Narration Traders',
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

// The case the audit found. "Bill Discounting" contains "discount", so the
// classifier types it KASAR_VATAV — a non-cash write-off, compliant whatever its
// date. A payment nine months late therefore produces no disallowance at all.
const CY = ledger('2025-26', 0, [txn('2026-03-20', 'Purchase A/c', 100000, 0)]);
const FY_DISGUISED = ledger('2026-27', 100000, [txn('2026-12-15', 'Bill Discounting Charges', 0, 100000)]);
const FY_HONEST = ledger('2026-27', 100000, [txn('2026-12-15', 'HDFC Bank', 0, 100000)]);

describe('the gap the cross-check cannot see', () => {
  it('both engines agree on ZERO disallowance for a late payment narrated as a discount', () => {
    const rep = buildReport([CY], [FY_DISGUISED], DEFAULT_CONFIG);
    const v = rep.vendors[0];
    const x = crossCheckVendor(CY, FY_DISGUISED, DEFAULT_CONFIG);

    // This is the failure being documented, not a behaviour being endorsed:
    // the primary engine says nothing is disallowed...
    expect(v.totalDisallowedCY).toBe(0);
    // ...and the cross-check confirms it, to the rupee.
    expect(x.disallowedCY).toBe(0);
    expect(verifyVendor(v, CY, FY_DISGUISED, DEFAULT_CONFIG).verified).toBe(true);
  });

  it('the same payment narrated honestly IS disallowed — so the narration is the whole difference', () => {
    const rep = buildReport([CY], [FY_HONEST], DEFAULT_CONFIG);
    expect(rep.vendors[0].totalDisallowedCY).toBe(100000);
  });
});

describe('classificationSensitivity prices that gap instead of claiming it away', () => {
  it('quantifies the full amount that rests on the write-off narration', () => {
    const s = classificationSensitivity(CY, FY_DISGUISED, DEFAULT_CONFIG);

    expect(s.base).toBe(0);
    const wo = s.components.find((c) => c.label === 'Write-offs, discounts and notes')!;
    expect(wo).toBeDefined();
    expect(wo.ifDateTested).toBe(100000);
    expect(wo.swing).toBe(100000);
    expect(s.maxSwing).toBe(100000);
  });

  it('names the entry and the keyword that produced the classification', () => {
    const s = classificationSensitivity(CY, FY_DISGUISED, DEFAULT_CONFIG);
    const wo = s.components[0];
    expect(wo.entries).toHaveLength(1);
    expect(wo.entries[0].particulars).toBe('Bill Discounting Charges');
    expect(wo.entries[0].type).toBe('KASAR_VATAV');
    expect(wo.entries[0].matchedKeyword).toBe('discount');
  });

  it('reports nothing when there is no narration-driven reduction to depend on', () => {
    const s = classificationSensitivity(CY, FY_HONEST, DEFAULT_CONFIG);
    expect(s.components).toEqual([]);
    expect(s.maxSwing).toBe(0);
  });

  it('a genuine kasar paid within the window has no swing — the exposure is real, not a blanket warning', () => {
    // Bill 20-Mar-26 due 04-May-26. 100 written off and 99,900 paid, both in
    // time. Whichever way the ₹100 is classified, nothing is disallowed.
    const fy = ledger('2026-27', 100000, [
      txn('2026-04-10', 'Kasar Vatav', 0, 100),
      txn('2026-04-15', 'HDFC Bank', 0, 99900),
    ]);
    const s = classificationSensitivity(CY, fy, DEFAULT_CONFIG);
    expect(s.maxSwing).toBe(0);
    expect(sensitivityWarnings(s, DEFAULT_CONFIG)).toEqual([]);
  });

  it('shows no swing for TDS deducted in time — the netting changes nothing there', () => {
    // Bill 20-Mar-26, TDS deducted 25-Mar-26. Whether that ₹2,000 is treated as
    // a non-cash reduction or as a dated discharge, the date is inside the
    // window, so it is compliant either way and the figure does not move.
    const cy = ledger('2025-26', 0, [
      txn('2026-03-20', 'Purchase A/c', 100000, 0),
      txn('2026-03-25', 'TDS on Contractor 194C', 0, 2000),
    ]);
    const fy = ledger('2026-27', 98000, []); // never paid → 98,000 disallowed
    const s = classificationSensitivity(cy, fy, DEFAULT_CONFIG);

    expect(s.base).toBe(98000);
    const tds = s.components.find((c) => c.label === 'TDS netting')!;
    expect(tds.swing).toBe(0);
    expect(s.maxSwing).toBe(0);
    // Nothing at stake → nothing printed. The reviewer is not trained to skip it.
    expect(sensitivityWarnings(s, DEFAULT_CONFIG)).toEqual([]);
    // It is priced on its own axis, never folded into the write-off component.
    expect(s.components.some((c) => c.label === 'Write-offs, discounts and notes')).toBe(false);
  });

  it('does show a swing when the TDS is only booked in the following year, after the due date', () => {
    // Bill 01-Mar-26, due 15-Apr-26. ₹98,000 paid 10-Mar-26 (in time). The
    // ₹2,000 of TDS is not booked until 31-Aug-26 — after the due date and in
    // the next year. Netting it out says that ₹2,000 was never payable to the
    // vendor at all; date-testing it makes it a late discharge and disallows it.
    const cy = ledger('2025-26', 0, [
      txn('2026-03-01', 'Purchase A/c', 100000, 0),
      txn('2026-03-10', 'HDFC Bank', 0, 98000),
    ]);
    const fy = ledger('2026-27', 2000, [txn('2026-08-31', 'TDS on Contractor 194C', 0, 2000)]);
    const s = classificationSensitivity(cy, fy, DEFAULT_CONFIG);

    const tds = s.components.find((c) => c.label === 'TDS netting')!;
    expect(s.base).toBe(0);
    expect(tds.ifDateTested).toBe(2000);
    expect(tds.swing).toBe(2000);
    expect(sensitivityWarnings(s, DEFAULT_CONFIG)).toHaveLength(1);
  });

  it('a late payment settled inside the same year has nothing at stake — it nets off', () => {
    // Bill 01-Jun-25 due 16-Jul-25, paid 20-Dec-25: beyond the s.15 window, but
    // in the SAME previous year, so the disallowance and the allowance on actual
    // payment fall in one year and cancel. Documented here because it is the
    // reason the previous version of this test expected the wrong figure.
    const cy = ledger('2025-26', 0, [
      txn('2025-06-01', 'Purchase A/c', 100000, 0),
      txn('2025-12-20', 'Kasar Vatav', 0, 100000),
    ]);
    const fy = ledger('2026-27', 0, []);
    const s = classificationSensitivity(cy, fy, DEFAULT_CONFIG);
    expect(s.base).toBe(0);
    expect(s.maxSwing).toBe(0);
  });
});

describe('the sensitivity reaches the working paper', () => {
  it('is attached to the vendor result and stated in its warnings', () => {
    const rep = buildReport([CY], [FY_DISGUISED], DEFAULT_CONFIG);
    const v = rep.vendors[0];

    expect(v.narrationSwing).toBe(100000);
    expect(v.sensitivityNotes?.length).toBe(1);
    expect(v.warnings.some((w) => /Classification sensitivity/.test(w))).toBe(true);
    // The warning must say why the green cross-check tick is not reassurance here.
    expect(v.warnings.some((w) => /cannot detect a misread narration/.test(w))).toBe(true);
  });

  it('says nothing at all when nothing is at stake', () => {
    const rep = buildReport([CY], [FY_HONEST], DEFAULT_CONFIG);
    const v = rep.vendors[0];
    expect(v.narrationSwing).toBe(0);
    expect(v.warnings.some((w) => /Classification sensitivity/.test(w))).toBe(false);
  });
});
