import { describe, it, expect } from 'vitest';
import { analyzeVendor, buildReport } from './engine';
import { calibrate, applyProposals, type GoldenCase, type RuleProposal } from './calibrate';
import { assertNoAmountValued, validateProfile, RULE_SPACE, emptyProfile, configFromProfile, disclosedAssumptions } from './rules';
import { diffAgainstExpected } from './diff';
import { DEFAULT_CONFIG } from './config';
import type { VendorLedger, LedgerTxn } from './types';
import type { ExpectedWorking } from './expected';

function txn(date: string, particulars: string, credit: number, debit: number): LedgerTxn {
  return { date, particulars, credit, debit };
}
function ledger(name: string, fy: string, opening: number, txns: LedgerTxn[]): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName: name, financialYear: fy,
    periodFrom: `${start}-04-01`, periodTo: `${end}-03-31`,
    openingBalance: opening, closingBalance: closing, txns,
    format: 'tally', reconstructedClosing: closing, balanceReconciled: true, reconDrift: 0,
  };
}
function working(rows: Array<[string, number]>): ExpectedWorking {
  return {
    source: 'xlsx', fileName: 'reviewer.xlsx', warnings: [],
    rows: rows.map(([vendorName, disallowedCY]) => ({ vendorName, disallowedCY })),
  };
}

// A bill outstanding at 31-March, paid 10-Apr. Compliant on a 45-day window
// (due 15-Apr), late on a 15-day window (due 16-Mar).
const CY = [ledger('Alpha Steels', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)])];
const FY = [ledger('Alpha Steels', '2026-27', 100000, [txn('2026-04-10', 'HDFC Bank', 0, 100000)])];

describe('anti-cheat: the rule space cannot express an amount', () => {
  it('every rule value is a boolean, an enum string, or a whitelisted day/materiality count', () => {
    expect(assertNoAmountValued()).toEqual([]);
  });

  it('no rule is vendor-scoped — rules apply to the whole population', () => {
    for (const rule of RULE_SPACE) {
      expect(String(rule.key).toLowerCase()).not.toMatch(/vendor|party|name/);
    }
  });

  it('a profile carrying a value outside the rule space is refused', () => {
    const p = emptyProfile();
    (p.overrides as Record<string, unknown>).windowDays = 37; // not 15 or 45
    expect(validateProfile(p)).toHaveLength(1);
    expect(validateProfile(p)[0]).toMatch(/not one of the permitted positions/);
  });

  it('a profile carrying a key that is not a rule is refused', () => {
    const p = emptyProfile();
    (p.overrides as Record<string, unknown>).secretAdjustment = 84105;
    expect(validateProfile(p)[0]).toMatch(/not a rule in the rule space/);
  });

  it('a per-vendor window may only ever be 15 or 45, consistent with its stated basis', () => {
    const p = emptyProfile();
    p.vendorWindows = [{ key: 'x', vendorName: 'X', windowDays: 30, basis: 'agreement', at: 'now' }];
    expect(validateProfile(p).join(' ')).toMatch(/not permitted/);

    p.vendorWindows = [{ key: 'x', vendorName: 'X', windowDays: 15, basis: 'agreement', at: 'now' }];
    expect(validateProfile(p).join(' ')).toMatch(/written agreement supports 45 days/);

    p.vendorWindows = [{ key: 'x', vendorName: 'X', windowDays: 45, basis: 'agreement', at: 'now' }];
    expect(validateProfile(p)).toEqual([]);
  });
});

describe('calibration learns a real rule', () => {
  it('recovers a 15-day window from the reviewer\'s figures and then agrees exactly', () => {
    // Default (45-day) says nil; the reviewer says the whole bill is disallowed.
    expect(buildReport(CY, FY).totalDisallowedCY).toBe(0);

    const res = calibrate({ cyLedgers: CY, fyLedgers: FY, expected: working([['Alpha Steels', 100000]]) });

    const rule = res.proposals.find((p): p is RuleProposal => p.kind === 'rule' && p.key === 'windowDays');
    expect(rule).toBeDefined();
    expect(rule!.to).toBe(15);
    expect(rule!.fixes).toContain('Alpha Steels');
    expect(res.after.matched).toBe(1);
    expect(res.unexplained).toHaveLength(0);

    // The proposed config, applied to the real engine, actually reproduces it.
    const rerun = buildReport(CY, FY, res.proposedConfig);
    expect(rerun.totalDisallowedCY).toBe(100000);
  });

  it('the accepted proposal survives the profile guard rails and round-trips', () => {
    const res = calibrate({ cyLedgers: CY, fyLedgers: FY, expected: working([['Alpha Steels', 100000]]) });
    const { profile, errors } = applyProposals(null, res.proposals, { by: 'CA Reviewer', reason: 'No written agreement on file.' });
    expect(errors).toEqual([]);
    expect(profile.overrides.windowDays).toBe(15);
    expect(profile.revision).toBe(1);
    expect(profile.history[0].reason).toBe('No written agreement on file.');
    expect(buildReport(CY, FY, configFromProfile(profile)).totalDisallowedCY).toBe(100000);
  });
});

describe('anti-cheat: calibration cannot invent an answer', () => {
  it('reports an unreachable figure as unexplained instead of forcing agreement', () => {
    // Every permitted interpretation of this ledger yields 0 or 100000.
    const res = calibrate({ cyLedgers: CY, fyLedgers: FY, expected: working([['Alpha Steels', 55555]]) });

    expect(res.after.matched).toBe(0);
    expect(res.unexplained).toHaveLength(1);
    expect(res.unexplained[0].vendorName).toBe('Alpha Steels');
    expect(res.unexplainedAmount).toBeGreaterThan(0);
    expect(res.honestNotes.join(' ')).toMatch(/cannot be reconciled by any position/);

    // And no proposal claims to have fixed it.
    for (const p of res.proposals) {
      if (p.kind === 'rule') expect(p.fixes).not.toContain('Alpha Steels');
    }
    // The engine under the proposed config still does not produce their number.
    const rerun = buildReport(CY, FY, res.proposedConfig);
    expect(Math.abs(rerun.totalDisallowedCY - 55555)).toBeGreaterThan(1);
  });

  it('a vendor with no uploaded ledger is reported, not fabricated', () => {
    const res = calibrate({
      cyLedgers: CY, fyLedgers: FY,
      expected: working([['Alpha Steels', 0], ['Ghost Traders', 250000]]),
    });
    expect(res.after.onlyTheirs).toBe(1);
    expect(res.unexplained.some((v) => v.vendorName === 'Ghost Traders')).toBe(true);
    expect(res.honestNotes.join(' ')).toMatch(/no uploaded ledger/);
  });
});

describe('anti-cheat: the bar for agreement is fixed', () => {
  it('the engine\'s materiality rule cannot widen what counts as a match', () => {
    // A ₹900 gap. If the search could raise the comparison bar via the engine's
    // own materiality rule (₹1000 is a permitted position), it would "agree".
    const cy = [ledger('Beta Alloys', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)])];
    const fy = [ledger('Beta Alloys', '2026-27', 100000, [])];
    const res = calibrate({
      cyLedgers: cy, fyLedgers: fy,
      expected: working([['Beta Alloys', 99100]]),
      matchTolerance: 1,
    });
    expect(res.matchTolerance).toBe(1);
    expect(res.after.matched).toBe(0);
    expect(res.unexplained).toHaveLength(1);
  });
});

describe('anti-cheat: regression guard protects signed-off runs', () => {
  it('discards a rule that would change an answer the firm already blessed', () => {
    // The golden was blessed under the 45-day default: nil disallowance.
    const golden: GoldenCase = {
      label: 'FY 2024-25 signed off',
      cyLabel: '2024-25',
      cyLedgers: [ledger('Gamma Corp', '2024-25', 0, [txn('2025-03-01', 'Purchase A/c', 500000, 0)])],
      fyLedgers: [ledger('Gamma Corp', '2025-26', 500000, [txn('2025-04-10', 'HDFC Bank', 0, 500000)])],
      blessed: { gammacorp: 0 },
    };

    const res = calibrate({
      cyLedgers: CY, fyLedgers: FY,
      expected: working([['Alpha Steels', 100000]]),
      goldens: [golden],
    });

    // Switching to 15 days for everyone would fix today's file but changes the
    // blessed run, so it is discarded and recorded as such.
    expect(res.proposals.some((p) => p.kind === 'rule' && p.key === 'windowDays')).toBe(false);
    expect(res.rejectedForRegression.some((r) => r.goldens.includes('FY 2024-25 signed off'))).toBe(true);
    // No global rule reconciles it, so the config alone still disagrees...
    expect(res.after.matched).toBe(0);
    // ...and the difference is escalated to a declaration a human must confirm,
    // never applied silently.
    expect(res.proposals.some((p) => p.kind === 'vendor-window' && p.vendorName === 'Alpha Steels')).toBe(true);
    expect(res.honestNotes.join(' ')).toMatch(/replayed under every candidate/);
  });

  it('a per-vendor declaration resolves it without touching the blessed run', () => {
    const golden: GoldenCase = {
      label: 'FY 2024-25 signed off',
      cyLabel: '2024-25',
      cyLedgers: [ledger('Gamma Corp', '2024-25', 0, [txn('2025-03-01', 'Purchase A/c', 500000, 0)])],
      fyLedgers: [ledger('Gamma Corp', '2025-26', 500000, [txn('2025-04-10', 'HDFC Bank', 0, 500000)])],
      blessed: { gammacorp: 0 },
    };
    const res = calibrate({
      cyLedgers: CY, fyLedgers: FY,
      expected: working([['Alpha Steels', 100000]]),
      goldens: [golden],
    });

    const decl = res.proposals.find((p) => p.kind === 'vendor-window');
    expect(decl).toBeDefined();
    expect(decl).toMatchObject({ vendorName: 'Alpha Steels', windowDays: 15, requiresDeclaration: true });

    const { profile, errors } = applyProposals(null, [decl!], { by: 'CA Reviewer' });
    expect(errors).toEqual([]);

    // Alpha now uses 15 days; Gamma's blessed answer is untouched.
    const rep = buildReport(CY, FY, DEFAULT_CONFIG, undefined, { vendorWindowDays: { alphasteels: 15 } });
    expect(rep.totalDisallowedCY).toBe(100000);
    const goldenRerun = buildReport(golden.cyLedgers, golden.fyLedgers, DEFAULT_CONFIG, undefined, {
      vendorWindowDays: { alphasteels: 15 },
    });
    expect(goldenRerun.totalDisallowedCY).toBe(0);
    expect(profile.vendorWindows[0].basis).toBe('none');
  });
});

describe('rule changes actually move the engine (no dead knobs)', () => {
  const bill = ledger('Delta Ltd', '2025-26', 0, [
    txn('2026-03-01', 'Purchase A/c', 100000, 0),
    txn('2026-03-05', 'TDS 194C', 0, 2000),
  ]);
  const pay = ledger('Delta Ltd', '2026-27', 98000, [txn('2026-06-01', 'HDFC Bank', 0, 98000)]);

  it('windowDays', () => {
    expect(analyzeVendor(bill, pay, { ...DEFAULT_CONFIG, windowDays: 45 }).totalDisallowedCY).toBe(98000);
    const cy = ledger('Delta Ltd', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Delta Ltd', '2026-27', 100000, [txn('2026-04-10', 'HDFC Bank', 0, 100000)]);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, windowDays: 45 }).totalDisallowedCY).toBe(0);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, windowDays: 15 }).totalDisallowedCY).toBe(100000);
  });

  it('dayCountBasis shifts the boundary by exactly one day', () => {
    // Bill 17-Mar + 45 days = 01-May (exclusive) / 30-Apr (inclusive).
    const cy = ledger('Delta Ltd', '2025-26', 0, [txn('2026-03-17', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Delta Ltd', '2026-27', 100000, [txn('2026-05-01', 'HDFC Bank', 0, 100000)]);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, dayCountBasis: 'exclusive' }).totalDisallowedCY).toBe(0);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, dayCountBasis: 'inclusive' }).totalDisallowedCY).toBe(100000);
  });

  it('acceptanceGraceDays moves the clock start', () => {
    const cy = ledger('Delta Ltd', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Delta Ltd', '2026-27', 100000, [txn('2026-04-20', 'HDFC Bank', 0, 100000)]);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, acceptanceGraceDays: 0 }).totalDisallowedCY).toBe(100000);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, acceptanceGraceDays: 7 }).totalDisallowedCY).toBe(0);
  });

  it('netOfTds decides whether TDS must clear within the window', () => {
    expect(analyzeVendor(bill, pay, { ...DEFAULT_CONFIG, netOfTds: true }).totalDisallowedCY).toBe(98000);
    expect(analyzeVendor(bill, pay, { ...DEFAULT_CONFIG, netOfTds: false }).totalDisallowedCY).toBe(98000);
    // With TDS booked after year-end it becomes timing-sensitive.
    const late = ledger('Delta Ltd', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)]);
    const lateFy = ledger('Delta Ltd', '2026-27', 100000, [txn('2026-06-01', 'TDS 194C', 0, 2000), txn('2026-06-01', 'HDFC Bank', 0, 98000)]);
    expect(analyzeVendor(late, lateFy, { ...DEFAULT_CONFIG, netOfTds: true }).totalDisallowedCY).toBe(98000);
    expect(analyzeVendor(late, lateFy, { ...DEFAULT_CONFIG, netOfTds: false }).totalDisallowedCY).toBe(100000);
  });

  it('kasarTreatment decides whether a discount is timing-sensitive', () => {
    const cy = ledger('Delta Ltd', '2025-26', 0, [txn('2026-01-01', 'Purchase A/c', 100000, 0)]);
    const fy = ledger('Delta Ltd', '2026-27', 100000, [txn('2026-06-01', 'Kasar Vatav', 0, 100000)]);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, kasarTreatment: 'nonCash' }).totalDisallowedCY).toBe(0);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, kasarTreatment: 'cashTiming' }).totalDisallowedCY).toBe(100000);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, kasarTreatment: 'ignore' }).totalDisallowedCY).toBe(100000);
  });

  it('allocation decides which bill a payment clears', () => {
    // Two bills; one payment covering only the first. FIFO clears the old bill
    // (leaving the new one open); LIFO clears the new one.
    const cy = ledger('Delta Ltd', '2025-26', 0, [
      txn('2026-01-01', 'Purchase A/c', 60000, 0),
      txn('2026-03-20', 'Purchase A/c', 40000, 0),
    ]);
    const fy = ledger('Delta Ltd', '2026-27', 100000, [txn('2026-04-05', 'HDFC Bank', 0, 60000)]);
    const fifo = analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, allocation: 'FIFO' });
    const lifo = analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, allocation: 'LIFO' });
    expect(fifo.totalDisallowedCY).not.toBe(lifo.totalDisallowedCY);
  });

  it('openingDisallowance decides whether a brought-forward payable is tested again', () => {
    const cy = ledger('Delta Ltd', '2025-26', 500000, []);
    const fy = ledger('Delta Ltd', '2026-27', 500000, []);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, openingDisallowance: 'exclude' }).totalDisallowedCY).toBe(0);
    expect(analyzeVendor(cy, fy, { ...DEFAULT_CONFIG, openingDisallowance: 'include' }).totalDisallowedCY).toBe(500000);
  });
});

describe('diff', () => {
  it('matches vendors whose names are spelled differently', () => {
    const report = buildReport(CY, FY);
    const d = diffAgainstExpected(report, working([['M/s. Alpha Steels Pvt Ltd', 0]]));
    expect(d.matched).toBe(1);
    expect(d.vendors[0].fuzzyMatched).toBe(true);
  });

  it('does not silently drop a vendor that only one side has', () => {
    const report = buildReport(CY, FY);
    const d = diffAgainstExpected(report, working([['Someone Else', 5000]]));
    expect(d.onlyOurs).toBe(1);
    expect(d.onlyTheirs).toBe(1);
  });
});

describe('assumptions disclosure', () => {
  it('lists every rule in force and flags the non-default ones', () => {
    const rows = disclosedAssumptions({ ...DEFAULT_CONFIG, windowDays: 15 });
    expect(rows).toHaveLength(RULE_SPACE.length);
    expect(rows.find((r) => r.title === 'Payment window')).toMatchObject({ position: '15 days', isDefault: false });
    expect(rows.find((r) => r.title === 'Day count')).toMatchObject({ isDefault: true });
  });
});
