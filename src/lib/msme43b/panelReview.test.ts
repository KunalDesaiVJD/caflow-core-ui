import { describe, it, expect } from 'vitest';
import { buildEvidence } from './panelReview';
import { buildReport } from './engine';
import { calibrate } from './calibrate';
import { DEFAULT_CONFIG } from './config';
import { RULE_SPACE, emptyProfile } from './rules';
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

const CY = [ledger('Alpha Steels', '2025-26', 0, [txn('2026-03-01', 'Purchase A/c', 100000, 0)])];
const FY = [ledger('Alpha Steels', '2026-27', 100000, [txn('2026-04-10', 'HDFC Bank', 0, 100000)])];

describe('panel evidence pack', () => {
  const report = buildReport(CY, FY);

  it('discloses every interpretation in force, with its basis', () => {
    const ev = buildEvidence({ report, config: DEFAULT_CONFIG });
    expect(ev.interpretationApplied).toHaveLength(RULE_SPACE.length);
    for (const row of ev.interpretationApplied) {
      expect(row.question).toBeTruthy();
      expect(row.positionTaken).toBeTruthy();
      expect(row.statedBasis).toBeTruthy();
    }
  });

  it('marks a learned position as learned, not as the standard one', () => {
    const ev = buildEvidence({ report, config: { ...DEFAULT_CONFIG, windowDays: 15 } });
    const window = ev.interpretationApplied.find((r) => r.positionTaken === '15 days');
    expect(window?.source).toMatch(/learned/);
    const dayCount = ev.interpretationApplied.find((r) => r.question.includes('invoice date itself'));
    expect(dayCount?.source).toBe('standard position');
  });

  it('carries the assurance already performed so the panel reviews reasoning, not arithmetic', () => {
    const ev = buildEvidence({ report, config: DEFAULT_CONFIG });
    expect(ev.assuranceAlreadyPerformed.allLedgersReconciledToPrintedClosingBalance).toBe(true);
    expect(ev.assuranceAlreadyPerformed.independentCrossCheckAgreed).toBe(report.vendors.length);
    expect(ev.assuranceAlreadyPerformed.independentCrossCheckFlagged).toEqual([]);
  });

  it('states the matching interpretation explicitly — it is a judgement, not data', () => {
    const ev = buildEvidence({ report, config: DEFAULT_CONFIG });
    expect(ev.methodNotes.join(' ')).toMatch(/no bill-wise references/);
    expect(ev.methodNotes.join(' ')).toMatch(/does not determine MSME status/);
  });

  it('includes per-vendor window declarations with their basis', () => {
    const profile = emptyProfile();
    profile.vendorWindows = [{ key: 'alphasteels', vendorName: 'Alpha Steels', windowDays: 15, basis: 'none', at: 'now' }];
    const ev = buildEvidence({ report, config: DEFAULT_CONFIG, profile });
    expect(ev.perVendorDeclarations).toEqual([
      { vendor: 'Alpha Steels', window: '15 days', basis: 'no written agreement declared' },
    ]);
  });

  it('omits the reviewer comparison when no calibration was run', () => {
    const ev = buildEvidence({ report, config: DEFAULT_CONFIG });
    expect('comparisonWithReviewersWorking' in ev).toBe(false);
  });

  it('surfaces what no rule could explain, rather than hiding it from the panel', () => {
    const expected: ExpectedWorking = {
      source: 'xlsx', fileName: 'reviewer.xlsx', warnings: [],
      rows: [{ vendorName: 'Alpha Steels', disallowedCY: 55555 }],
    };
    const cal = calibrate({ cyLedgers: CY, fyLedgers: FY, expected, baseConfig: DEFAULT_CONFIG });
    const ev = buildEvidence({ report, config: DEFAULT_CONFIG, calibration: cal });
    const cmp = (ev as Record<string, any>).comparisonWithReviewersWorking;
    expect(cmp.differencesNoRuleCouldExplain).toHaveLength(1);
    expect(cmp.differencesNoRuleCouldExplain[0]).toMatchObject({ vendor: 'Alpha Steels', reviewerFigure: 55555 });
  });
});
