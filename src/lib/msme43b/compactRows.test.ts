import { describe, it, expect, vi } from 'vitest';

// aiExtract imports the Supabase client at module load; these tests exercise the
// pure row mapping, so the client is stubbed rather than reached.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const { rowFields, mapLedger, isUnresolvedVendor } = await import('./aiExtract');

// The exact example given to the model in the system prompt. If the prompt and
// the parser ever drift apart, this fails.
const EXAMPLE_ROW = ['2026-03-20', 'Purchase A/c', 'Purchase', 'INV-441', 0, 118000, 100000, 18000, 18];

describe('compact positional rows', () => {
  it('maps every element of the documented order to the right field', () => {
    expect(rowFields(EXAMPLE_ROW)).toEqual({
      date: '2026-03-20',
      particulars: 'Purchase A/c',
      vchType: 'Purchase',
      vchNo: 'INV-441',
      debit: 0,
      credit: 118000,
      taxableValue: 100000,
      gstAmount: 18000,
      gstRate: 18,
    });
  });

  it('reads a ledger sent as compact rows', () => {
    const led = mapLedger({
      vendorName: 'Compact Traders',
      financialYear: '2025-26',
      periodFrom: '2025-04-01',
      periodTo: '2026-03-31',
      openingBalance: 0,
      closingBalance: 118000,
      rows: [EXAMPLE_ROW],
    }, 'ledger.pdf', false);

    expect(led.vendorName).toBe('Compact Traders');
    expect(led.txns).toHaveLength(1);
    expect(led.txns[0].credit).toBe(118000);
    expect(led.txns[0].taxableValue).toBe(100000);
    expect(led.txns[0].gstAmount).toBe(18000);
    expect(led.txns[0].gstRate).toBe(18);
    expect(led.closingBalance).toBe(118000);
  });

  it('still reads the older named form — a model may ignore a format instruction', () => {
    const led = mapLedger({
      vendorName: 'Legacy Traders',
      openingBalance: 0,
      closingBalance: 5000,
      txns: [{ date: '2026-01-05', particulars: 'HDFC Bank', debit: 5000, credit: 0 }],
    }, 'ledger.pdf', false);

    expect(led.txns).toHaveLength(1);
    expect(led.txns[0].debit).toBe(5000);
  });

  it('keeps "tax not shown" distinct from "tax is nil" through the array form', () => {
    // nulls in the last three positions mean the document did not state a split.
    const notShown = mapLedger({
      vendorName: 'V', openingBalance: 0, closingBalance: 1000,
      rows: [['2026-01-05', 'Purchase', '', '', 0, 1000, null, null, null]],
    }, 'f.pdf', false);
    expect(notShown.txns[0].taxableValue).toBeUndefined();
    expect(notShown.txns[0].gstAmount).toBeUndefined();
    expect(notShown.txns[0].gstRate).toBeUndefined();

    // An explicit zero rate is a FACT and must survive as 0, not become undefined.
    const zeroRated = mapLedger({
      vendorName: 'V', openingBalance: 0, closingBalance: 1000,
      rows: [['2026-01-05', 'Purchase', '', '', 0, 1000, 1000, 0, 0]],
    }, 'f.pdf', false);
    expect(zeroRated.txns[0].gstAmount).toBe(0);
    expect(zeroRated.txns[0].gstRate).toBe(0);
  });

  it('discards a tax split that does not add up, rather than using it', () => {
    // 90,000 + 18,000 ≠ 118,000. An inconsistent split would understate the
    // disallowance, so it is dropped and the vendor is flagged for a declaration.
    const led = mapLedger({
      vendorName: 'V', openingBalance: 0, closingBalance: 118000,
      rows: [['2026-03-20', 'Purchase', '', '', 0, 118000, 90000, 18000, 18]],
    }, 'f.pdf', false);
    expect(led.txns[0].taxableValue).toBeUndefined();
    expect(led.txns[0].gstAmount).toBeUndefined();
  });

  it('drops a short or malformed row instead of inventing zeros for a real bill', () => {
    const led = mapLedger({
      vendorName: 'V', openingBalance: 0, closingBalance: 0,
      rows: [
        ['2026-03-20'],                                      // truncated mid-row
        [],                                                  // empty
        ['2026-03-21', 'Purchase', '', '', 0, 5000, null, null, null], // good
      ],
    }, 'f.pdf', false);

    // Only the complete row survives — a row with no amount is not a transaction.
    expect(led.txns).toHaveLength(1);
    expect(led.txns[0].date).toBe('2026-03-21');
    expect(led.txns[0].credit).toBe(5000);
  });

  it('tolerates numbers arriving as strings, as they sometimes do', () => {
    const led = mapLedger({
      vendorName: 'V', openingBalance: 0, closingBalance: 1000,
      rows: [['2026-01-05', 'Purchase', '', '', '0', '1,000', null, null, null]],
    }, 'f.pdf', false);
    expect(led.txns[0].credit).toBe(1000);
    expect(led.txns[0].debit).toBe(0);
  });

  it('flags a missing vendor name instead of guessing it from the filename', () => {
    // A chunk that lost its header (e.g. the vendor row fell in an earlier
    // chunk of a merged multi-vendor export) must NEVER be silently relabelled
    // with the uploaded file's name — that produced exactly this bug: three
    // unrelated vendors in "Amadius Realty.pdf" all showing up as "Amadius
    // Realty" and getting merged into one corrupted ledger.
    const led = mapLedger({
      openingBalance: 0, closingBalance: 5000,
      rows: [['2026-01-05', 'Purchase', '', '', 0, 5000, null, null, null]],
    }, 'Amadius Realty.pdf', false, 'page 4');

    expect(led.vendorName).not.toBe('Amadius Realty');
    expect(isUnresolvedVendor(led.vendorName)).toBe(true);
    expect(led.vendorName).toContain('page 4');
    expect(led.warnings.some((w) => /could not be read/i.test(w))).toBe(true);
  });

  it('gives two unresolved fragments from different chunks distinct names', () => {
    // Two vendors that both lost their header in the SAME file must not collide
    // on one placeholder name — that would merge them into a single ledger.
    const a = mapLedger({ openingBalance: 0, closingBalance: 1000, rows: [] }, 'f.pdf', false, 'page 1');
    const b = mapLedger({ openingBalance: 0, closingBalance: 2000, rows: [] }, 'f.pdf', false, 'page 5');
    expect(a.vendorName).not.toBe(b.vendorName);
  });
});
