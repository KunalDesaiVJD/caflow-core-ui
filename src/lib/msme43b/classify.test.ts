import { describe, it, expect } from 'vitest';
import { classifyTxn } from './classify';
import type { LedgerTxn } from './types';

function txn(particulars: string, debit: number, credit: number, extra: Partial<LedgerTxn> = {}): LedgerTxn {
  return { date: '2026-03-31', particulars, debit, credit, ...extra };
}

describe('classifyTxn', () => {
  it('classifies a plain TDS narration on the primary line as TDS, not needing review', () => {
    const c = classifyTxn(txn('TDS on Contractor 194C', 2000, 0));
    expect(c.type).toBe('TDS');
    expect(c.needsReview).toBe(false);
  });

  it('trusts a single contra breakup line the same as the primary narration', () => {
    // A plain 1:1 JV — one other ledger touched, no ambiguity about which
    // party's account the keyword belongs to. "As per Details Below" is Tally's
    // own generic narration for a multi-ledger voucher and matches no keyword
    // itself, so this exercises the details fallback, not the primary match.
    const c = classifyTxn(txn('As per Details Below', 7500, 0, {
      details: [{ name: 'TDS Payable 194J(B)', amount: 7500, drcr: 'Dr' }],
    }));
    expect(c.type).toBe('TDS');
    expect(c.needsReview).toBe(false);
  });

  it('flags a TDS match found only on an unrelated leg of a multi-ledger JV for review', () => {
    // The primary narration says nothing about TDS. The keyword only appears on
    // ONE of several contra lines in a multi-party journal voucher — that is not
    // evidence this vendor's own bill was netted for a TDS deduction (the actual
    // Accurate PMS complaint: the party ledger shows no TDS deducted under any
    // section, yet a stray "TDS Payable" narration on a JV leg netted the base).
    const c = classifyTxn(txn('As per Details Below', 7500, 0, {
      details: [
        { name: 'TDS Payable 194J(B)', amount: 7500, drcr: 'Dr' },
        { name: 'Round Off Suspense', amount: 100, drcr: 'Dr' },
      ],
    }));
    expect(c.type).toBe('TDS');
    expect(c.needsReview).toBe(true);
  });

  it('still classifies a multi-line JV confidently when the primary narration itself says TDS', () => {
    const c = classifyTxn(txn('TDS deducted u/s 194C', 2000, 0, {
      details: [
        { name: 'TDS Payable', amount: 2000, drcr: 'Dr' },
        { name: 'Round Off', amount: 5, drcr: 'Dr' },
      ],
    }));
    expect(c.type).toBe('TDS');
    expect(c.needsReview).toBe(false);
  });

  it('excludes a book provision credit from PURCHASE, matched before the generic fallback', () => {
    const c = classifyTxn(txn('Provision for expenses', 0, 20000));
    expect(c.type).toBe('PROVISION');
  });

  it('still classifies an ordinary purchase credit as PURCHASE', () => {
    const c = classifyTxn(txn('Purchase A/c', 0, 100000));
    expect(c.type).toBe('PURCHASE');
  });
});
