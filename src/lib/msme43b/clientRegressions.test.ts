// MSME 43B(h) — client-reported regression suite.
//
// Each case here is anchored to a specific client complaint (Software_Queries.docx,
// 2026-08-08). Where the client's own PDF was not available, the scenario is
// reconstructed with representative round-number data that reproduces the
// STRUCTURAL bug reported — not a byte-for-byte replay of their real ledger —
// and says so in the test description. The point is that these exact failure
// SHAPES can never silently regress, not that these exact rupee figures are
// the client's real figures.

import { describe, it, expect, vi } from 'vitest';
import { analyzeVendor } from './engine';
import { classifyTxn } from './classify';
import type { VendorLedger, LedgerTxn } from './types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// aiExtract imports the Supabase client at module load; these tests exercise
// the pure row-mapping logic, so the client is stubbed rather than reached.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

function txn(date: string, particulars: string, credit: number, debit: number, extra: Partial<LedgerTxn> = {}): LedgerTxn {
  return { date, particulars, credit, debit, ...extra };
}

function ledger(fy: string, opening: number, txns: LedgerTxn[], vendorName = 'Test Vendor'): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName, financialYear: fy,
    periodFrom: `${start}-04-01`, periodTo: `${end}-03-31`,
    openingBalance: opening, closingBalance: closing, txns,
    format: 'tally', reconstructedClosing: closing, balanceReconciled: true, reconDrift: 0,
  };
}

describe('Amadius Realty — vendor mislabeling (query 1.1/1.2)', () => {
  it('never labels a header-less chunk with the uploaded file\'s name', async () => {
    // The client reported "Alpha Solution-1 – Material" and "V.J. Desai & Co."
    // both showing up in the app as "Amadius Realty" — the name of the FILE
    // they uploaded, not either real vendor. Reproduces the structural cause:
    // an AI-extraction chunk that lost its vendor header, from a file named
    // after a vendor that is not the one in this chunk.
    const { mapLedger, isUnresolvedVendor } = await import('./aiExtract');

    const alphaSolutionChunk = mapLedger(
      { openingBalance: 0, closingBalance: 50000, rows: [['2026-02-01', 'Purchase', '', '', 0, 50000, null, null, null]] },
      'Amadius Realty.pdf', false, 'page 2',
    );
    const vjDesaiChunk = mapLedger(
      { openingBalance: 0, closingBalance: 75000, rows: [['2026-02-15', 'Purchase', '', '', 0, 75000, null, null, null]] },
      'Amadius Realty.pdf', false, 'page 9',
    );

    for (const chunk of [alphaSolutionChunk, vjDesaiChunk]) {
      expect(chunk.vendorName).not.toBe('Amadius Realty');
      expect(isUnresolvedVendor(chunk.vendorName)).toBe(true);
    }
    // Different chunks of the same mislabeled file must not collide on one name
    // — that collision is exactly what merged two unrelated vendors together.
    expect(alphaSolutionChunk.vendorName).not.toBe(vjDesaiChunk.vendorName);
  });
});

describe('Skylark Corporation — provisions in the disallowance base (query 4)', () => {
  it('a provision alongside a real, fully-paid bill contributes nothing to the disallowance', () => {
    // The client's complaint: "the provision amount should not be considered
    // while calculating the disallowance." A genuine purchase (paid within the
    // s.15 window, so 0 disallowance on its own) plus a year-end provision
    // must together still show 0 disallowance — not the provision's value.
    const cy = ledger('2025-26', 0, [
      txn('2026-02-10', 'Purchase A/c', 200000, 0),
      txn('2026-03-31', 'Provision for Expenses', 45000, 0),
    ], 'Skylark Vendor');
    const fy = ledger('2026-27', 200000, [txn('2026-03-20', 'HDFC Bank', 0, 200000)], 'Skylark Vendor');

    const r = analyzeVendor(cy, fy);
    expect(r.totalDisallowedCY).toBe(0);
    expect(r.provisionExcluded).toBe(45000);
    expect(r.verified).not.toBe(false);
  });
});

describe('Accurate PMS / Enviro Technologies — TDS netting off a stray JV leg (query 6)', () => {
  // Screenshot evidence: a sensitivity warning fired citing entry
  // '194J(B) - TDS Payable ₹7,500' dated 2026-06-17 as the narration the TDS
  // netting rested on, while the client's own review of the party ledger found
  // no TDS actually deducted under any section. Reconstructed here with round
  // figures — the real ledger's bill-level numbers were not available to this
  // session — to lock in the structural fix: a keyword found only via an
  // unrelated leg of a multi-line JV must be flagged, not applied silently.

  it('nets TDS silently when the deduction is on the vendor\'s own bill narration (single-line JV)', () => {
    const c = classifyTxn(txn('2026-06-17', '194J(B) - TDS Payable', 0, 7500, { details: [
      { name: 'TDS Payable 194J(B)', amount: 7500, drcr: 'Dr' },
    ] }));
    expect(c.type).toBe('TDS');
    expect(c.needsReview).toBe(false);
  });

  it('flags TDS netting for review when the only evidence is an unrelated leg of a multi-vendor JV', () => {
    // This is the actual Accurate PMS/Enviro Technologies shape: a generic JV
    // narration with NO mention of TDS on the primary line, and "TDS Payable"
    // appearing only as one of several contra breakup lines — exactly the
    // pattern that let a party ledger with no real TDS deduction still get
    // netted for one.
    const c = classifyTxn(txn('2026-06-17', 'As per Details Below', 0, 7500, { details: [
      { name: 'TDS Payable 194J(B)', amount: 7500, drcr: 'Dr' },
      { name: 'Round Off Suspense', amount: 100, drcr: 'Dr' },
    ] }));
    expect(c.type).toBe('TDS');
    expect(c.needsReview).toBe(true);
  });

  it('an end-to-end vendor with only a stray-JV TDS match surfaces a review item, not a silent net-off', () => {
    const cy = ledger('2025-26', 0, [
      txn('2026-02-06', 'Purchase A/c', 654310, 0),
      // A multi-ledger JV whose primary narration says nothing about TDS.
      txn('2026-06-17', 'As per Details Below', 0, 7500, { details: [
        { name: 'TDS Payable 194J(B)', amount: 7500, drcr: 'Dr' },
        { name: 'Round Off Suspense', amount: 100, drcr: 'Dr' },
      ] }),
    ], 'Enviro Technologies');
    const fy = ledger('2026-27', 646810, [txn('2026-04-01', 'HDFC Bank', 0, 646810)], 'Enviro Technologies');

    const r = analyzeVendor(cy, fy);
    // The bill itself must still classify as needing review — surfaced, not lost.
    expect(r.reviewCount).toBeGreaterThan(0);
  });
});

describe('msme-extract-ledger prompt — anti-filename-anchoring guardrail (query 1.1/1.2 root cause)', () => {
  // The client's mislabeling bug ultimately traced to the extraction prompt
  // telling the model the uploaded file's name, which it then echoed as
  // vendorName for OTHER vendors in a merged export. This is a pure text
  // regression check on the deployed edge function's system prompt: if that
  // instruction is ever edited away, this test fails loudly rather than the
  // bug quietly coming back.
  it('instructs the model that the filename is never evidence of the vendor name', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../../supabase/functions/msme-extract-ledger/index.ts');
    const src = readFileSync(path, 'utf8');
    expect(src).toMatch(/filename is NOT evidence of the vendor name/i);
    expect(src).toMatch(/leave vendorName as ""/);
    // The per-message filename mentions must also carry the caveat inline,
    // not just the system prompt — the model reads that context too.
    expect(src).toMatch(/filename only, not evidence of the vendor name/i);
  });
});
