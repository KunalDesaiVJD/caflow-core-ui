import { describe, it, expect } from 'vitest';
import { analyzeVendor, buildReport } from './engine';
import { crossCheckVendor } from './crosscheck';
import { splitGst, DEFAULT_CONFIG, PERMITTED_GST_RATES } from './config';
import { validateProfile, emptyProfile, RULE_SPACE } from './rules';
import { calibrate, applyProposals, type VendorGstProposal } from './calibrate';
import type { VendorLedger, LedgerTxn } from './types';
import type { ExpectedWorking } from './expected';

function txn(date: string, particulars: string, credit: number, debit: number, gst?: Partial<LedgerTxn>): LedgerTxn {
  return { date, particulars, credit, debit, ...gst };
}
function ledger(name: string, fy: string, opening: number, txns: LedgerTxn[]): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName: name, financialYear: fy,
    periodFrom: `${start}-04-01`, periodTo: `${end}-03-31`,
    openingBalance: opening, closingBalance: closing, txns,
    format: 'ai', reconstructedClosing: closing, balanceReconciled: true, reconDrift: 0,
  };
}

describe('splitGst never guesses', () => {
  it('uses the tax stated on the document', () => {
    const s = splitGst(118000, { taxableValue: 100000, gstAmount: 18000, gstRate: 18 });
    expect(s).toMatchObject({ gstAmount: 18000, taxableValue: 100000, source: 'ledger' });
  });

  it('derives from a rate stated on the line', () => {
    const s = splitGst(118000, { gstRate: 18 });
    expect(s.taxableValue).toBeCloseTo(100000, 0);
    expect(s.source).toBe('ledger');
  });

  it('uses a declared rate only when the document is silent', () => {
    const s = splitGst(118000, undefined, 18);
    expect(s.taxableValue).toBeCloseTo(100000, 0);
    expect(s.source).toBe('declared-rate');
    // A document value always wins over the declaration.
    const doc = splitGst(118000, { gstAmount: 5000 }, 18);
    expect(doc).toMatchObject({ gstAmount: 5000, source: 'ledger' });
  });

  it('returns the gross UNCHANGED and says so when nothing is known', () => {
    const s = splitGst(118000);
    expect(s).toMatchObject({ gstAmount: 0, taxableValue: 118000, taxableRatio: 1, source: 'unavailable' });
  });

  it('distinguishes "no GST" from "GST unknown"', () => {
    expect(splitGst(1000, { gstAmount: 0, gstRate: 0 }).source).toBe('no-gst');
    expect(splitGst(1000, {}).source).toBe('unavailable');
    expect(splitGst(1000, undefined, 0).source).toBe('no-gst');
  });
});

describe('the disallowance is stated on the taxable value', () => {
  // ₹1,18,000 invoice = ₹1,00,000 + 18% GST, unpaid past the due date.
  const cy = [ledger('Alpha Steels', '2025-26', 0, [
    txn('2026-03-01', 'Purchase A/c', 118000, 0, { taxableValue: 100000, gstAmount: 18000, gstRate: 18 }),
  ])];
  const fy = [ledger('Alpha Steels', '2026-27', 118000, [txn('2026-08-01', 'HDFC Bank', 0, 118000)])];

  it('disallows the taxable value, not the invoice', () => {
    const r = buildReport(cy, fy);
    expect(r.totalDisallowedCY).toBeCloseTo(100000, 0);
    expect(r.totalGstExcluded).toBeCloseTo(18000, 0);
    expect(r.totalGstUnidentified).toBe(0);
  });

  it('keeps disallowed = allowedFY + stillOutstanding after the GST split', () => {
    const r = buildReport(cy, fy);
    expect(r.totalDisallowedCY).toBeCloseTo(r.totalAllowedFY + r.totalStillOutstanding, 1);
    expect(r.vendors[0].verified).toBe(true);
  });

  it('the independent cross-check agrees on the taxable figure', () => {
    const p = analyzeVendor(cy[0], fy[0]);
    const x = crossCheckVendor(cy[0], fy[0]);
    expect(x.disallowedCY).toBeCloseTo(p.totalDisallowedCY, 1);
    expect(x.allowedFY).toBeCloseTo(p.totalAllowedFY, 1);
  });

  it('the grossInvoice rule disallows the whole invoice instead', () => {
    const r = buildReport(cy, fy, { ...DEFAULT_CONFIG, disallowanceBase: 'grossInvoice' });
    expect(r.totalDisallowedCY).toBeCloseTo(118000, 0);
    expect(r.totalGstExcluded).toBe(0);
  });

  it('splits a PART payment proportionately', () => {
    // Half the invoice paid within time, half late.
    const fyPart = [ledger('Alpha Steels', '2026-27', 118000, [txn('2026-08-01', 'HDFC Bank', 0, 59000)])];
    const r = buildReport(cy, fyPart);
    expect(r.totalDisallowedCY).toBeCloseTo(100000, 0);
    expect(r.totalAllowedFY).toBeCloseTo(50000, 0);
    expect(r.totalStillOutstanding).toBeCloseTo(50000, 0);
  });
});

describe('GST that cannot be established is flagged, not assumed', () => {
  const cy = [ledger('Beta Alloys', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 118000, 0)])];
  const fy = [ledger('Beta Alloys', '2026-27', 118000, [])];

  it('states the disallowance on gross and says the tax is unidentified', () => {
    const r = buildReport(cy, fy);
    expect(r.totalDisallowedCY).toBeCloseTo(118000, 0);
    expect(r.totalGstUnidentified).toBeCloseTo(118000, 0);
    expect(r.vendors[0].warnings.join(' ')).toMatch(/GST could not be identified/);
    expect(r.vendors[0].warnings.join(' ')).toMatch(/OVERSTATED/);
  });

  it('a declared rate resolves it', () => {
    const r = buildReport(cy, fy, DEFAULT_CONFIG, undefined, { vendorGstRate: { betaalloys: 18 } });
    expect(r.totalDisallowedCY).toBeCloseTo(100000, 0);
    expect(r.totalGstUnidentified).toBe(0);
    expect(r.vendors[0].declaredGstRate).toBe(18);
  });

  it('an opening balance carries no GST assumption', () => {
    const openingOnly = [ledger('Beta Alloys', '2025-26', 500000, [])];
    const r = buildReport(openingOnly, [], { ...DEFAULT_CONFIG, openingDisallowance: 'include' },
      undefined, { vendorGstRate: { betaalloys: 18 } });
    // The opening is a carried-forward net figure, so no rate is applied to it.
    expect(r.totalDisallowedCY).toBeCloseTo(500000, 0);
  });
});

describe('the GST rate is a declaration, not a dial', () => {
  it('only statutory rates are accepted', () => {
    const p = emptyProfile();
    p.vendorGstRates = [{ key: 'x', vendorName: 'X', gstRate: 13.7, at: 'now' }];
    expect(validateProfile(p).join(' ')).toMatch(/not a statutory rate/);

    p.vendorGstRates = [{ key: 'x', vendorName: 'X', gstRate: 18, at: 'now' }];
    expect(validateProfile(p)).toEqual([]);
  });

  it('the permitted set is exactly the statutory rates', () => {
    expect([...PERMITTED_GST_RATES]).toEqual([0, 5, 12, 18, 28]);
  });

  it('the disallowance base is an ordinary rule with a stated legal basis', () => {
    const rule = RULE_SPACE.find((r) => r.key === 'disallowanceBase');
    expect(rule).toBeDefined();
    expect(rule!.legalBasis).toMatch(/deduction/i);
    expect(rule!.options.map((o) => o.value)).toEqual(['taxableValue', 'grossInvoice']);
  });
});

describe('calibration can propose a GST rate to reconcile a reviewer', () => {
  it('recovers the rate from the reviewer\'s figure and requires confirmation', () => {
    const cy = [ledger('Gamma Corp', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 118000, 0)])];
    const fy = [ledger('Gamma Corp', '2026-27', 118000, [])];
    // Reviewer disallowed the taxable value at 18%.
    const expected: ExpectedWorking = {
      source: 'xlsx', fileName: 'reviewer.xlsx', warnings: [],
      rows: [{ vendorName: 'Gamma Corp', disallowedCY: 100000 }],
    };

    const res = calibrate({ cyLedgers: cy, fyLedgers: fy, expected, matchTolerance: 1 });
    const gst = res.proposals.find((p): p is VendorGstProposal => p.kind === 'vendor-gst');
    expect(gst).toBeDefined();
    expect(gst).toMatchObject({ vendorName: 'Gamma Corp', gstRate: 18, requiresDeclaration: true });
    expect(res.unexplained).toHaveLength(0);

    const { profile, errors } = applyProposals(null, [gst!], { by: 'CA Reviewer' });
    expect(errors).toEqual([]);
    const rerun = buildReport(cy, fy, DEFAULT_CONFIG, undefined, { vendorGstRate: { gammacorp: 18 } });
    expect(rerun.totalDisallowedCY).toBeCloseTo(100000, 0);
    expect(profile.vendorGstRates[0].gstRate).toBe(18);
  });

  it('does not invent a rate for a figure no statutory rate produces', () => {
    const cy = [ledger('Delta Ltd', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 118000, 0)])];
    const fy = [ledger('Delta Ltd', '2026-27', 118000, [])];
    const expected: ExpectedWorking = {
      source: 'xlsx', fileName: 'reviewer.xlsx', warnings: [],
      rows: [{ vendorName: 'Delta Ltd', disallowedCY: 93777 }], // ~25.8%, not a real rate
    };
    const res = calibrate({ cyLedgers: cy, fyLedgers: fy, expected, matchTolerance: 1 });
    expect(res.proposals.some((p) => p.kind === 'vendor-gst')).toBe(false);
    expect(res.unexplained).toHaveLength(1);
  });
});
