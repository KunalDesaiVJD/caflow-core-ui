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
import { detectLedgerAccountVendorNames, detectBalanceSign, applyDeterministicCorrections } from './aiExtract';
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

describe('deterministic corrections — verified against real client PDFs (round 2, still-failing-after-prompt-fix)', () => {
  // These are NOT reconstructed approximations — this is the exact text (from
  // pdfplumber) of the real ledger PDFs the client uploaded, after the prompt
  // fix (#63) was deployed and the vendor name STILL came back as "AMADIUS
  // REALTY" for the Omega Elevator ledger. A prompt instruction is not
  // reliable enough for figures a CA firm signs off on, so these patterns are
  // now enforced in code and tested against the literal real text — not a
  // model's compliance with an instruction.

  const OMEGA_ELEVATOR_HEADER =
    'AMADIUS REALTY\n{PAN: ABYFA4842P}\nReg.Office No.FF/04, Ankur Shopping Center,\n' +
    'Bh. VIP International School,Nikol,\nAhmedabad\nOMEGA ELEVATOR\nLedger Account\n' +
    '1-Apr-25 to 31-Mar-26\nPage 1\nDate Particulars Vch Type Vch No. Debit Credit\n' +
    '1-Apr-25 To Opening Balance 10,10,000.00\n';

  const VJ_DESAI_SKYLARK_FOOTER =
    '2,64,000.00 7,39,200.00\nTo Closing Balance 4,75,200.00\n7,39,200.00 7,39,200.00\n';

  it('detects "OMEGA ELEVATOR" (not the "AMADIUS REALTY" letterhead) from the real header text', () => {
    expect(detectLedgerAccountVendorNames(OMEGA_ELEVATOR_HEADER)).toEqual(['OMEGA ELEVATOR']);
  });

  it('detects the real Omega Elevator opening balance as debit/advance (negative)', () => {
    expect(detectBalanceSign(OMEGA_ELEVATOR_HEADER, 'Opening')).toBe(-1);
  });

  it('detects the real Skylark V.J. Desai & Co. closing-balance plug as credit/payable (positive), not the negative a naive "To" reading would give', () => {
    expect(detectBalanceSign(VJ_DESAI_SKYLARK_FOOTER, 'Closing')).toBe(1);
  });

  it('corrects a wrong vendorName the model returned, using only the real header text — proves the fix does not depend on the model complying', () => {
    // Reproduces exactly what was observed in production after #63 deployed:
    // the model returned the reporting company's own name despite the prompt
    // instruction telling it not to.
    const rawLedgers: Array<Record<string, unknown>> = [
      { vendorName: 'AMADIUS REALTY', openingBalance: 1010000, closingBalance: 1400000, rows: [] },
    ];
    applyDeterministicCorrections(rawLedgers, OMEGA_ELEVATOR_HEADER);
    expect(rawLedgers[0].vendorName).toBe('OMEGA ELEVATOR');
    // The model also got the opening sign backwards (positive instead of the
    // real debit/advance balance) — corrected from the text, not trusted.
    expect(rawLedgers[0].openingBalance).toBe(-1010000);
  });

  it('does not touch vendorName when the chunk has more than one ledger and the header count does not line up (avoids a wrong correlation)', () => {
    const rawLedgers: Array<Record<string, unknown>> = [
      { vendorName: 'Model Guess A', openingBalance: 0, closingBalance: 0, rows: [] },
      { vendorName: 'Model Guess B', openingBalance: 0, closingBalance: 0, rows: [] },
    ];
    // Only one "Ledger Account" heading in this text, but two ledger objects —
    // an unsafe 1:2 correlation, so nothing should be overridden.
    applyDeterministicCorrections(rawLedgers, OMEGA_ELEVATOR_HEADER);
    expect(rawLedgers[0].vendorName).toBe('Model Guess A');
    expect(rawLedgers[1].vendorName).toBe('Model Guess B');
  });
});

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
    expect(src).toMatch(/TRAP 2/);
    expect(src).toMatch(/not evidence either/i);
    expect(src).toMatch(/leave vendorName as ""/);
    // The per-message filename mentions must also carry the caveat inline,
    // not just the system prompt — the model reads that context too.
    expect(src).toMatch(/filename only, not evidence of the vendor name/i);
  });

  // A real Amadius Realty / Elenza Callista / Revti Infra export prints the
  // REPORTING COMPANY's own name and address FIRST, then the true vendor name
  // right above the words "Ledger Account" — verified against 27 real ledger
  // PDFs across 4 clients, and 100% consistent. This is a separate, more
  // precise root cause than the filename-anchoring one above: the model was
  // very likely picking the client's own prominent letterhead instead of the
  // party name one line below it.
  it('instructs the model to read the vendor name from the line before "Ledger Account", not the company letterhead above it', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../../supabase/functions/msme-extract-ledger/index.ts');
    const src = readFileSync(path, 'utf8');
    expect(src).toMatch(/line immediately before "Ledger Account"/);
    expect(src).toMatch(/reporting company/i);
  });
});

describe('msme-extract-ledger prompt — opening/closing balance sign guardrail (V.J. Desai & Co. / Omega Elevator root cause)', () => {
  // Verified against real Amadius Realty exports: Omega Elevator opens with
  // "To Opening Balance 10,10,000.00" — printed in the DEBIT column (confirmed
  // by x-coordinate against a known debit row) — meaning openingBalance must be
  // NEGATIVE (-1010000), not the positive default a model would likely assume
  // for a creditor ledger. Separately, V.J. Desai & Co. (recurring across
  // Amadius, Skylark and Sweni) prints "To Closing Balance 4,61,340.00" — also
  // on the debit side, but as Tally's BALANCING PLUG, which means the ledger
  // truly closes CREDIT/payable (+461340), the OPPOSITE of what the "To"
  // prefix would suggest for an ordinary transaction. Getting either sign
  // wrong produces a large reconstructedClosing vs. printed-closingBalance
  // drift — i.e. exactly the "ledger did not reconcile / could not run"
  // failure reported for V.J. Desai & Co. in three different clients.
  it('instructs the model on the To/By opening-balance convention, with the verified 10,10,000 example', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../../supabase/functions/msme-extract-ledger/index.ts');
    const src = readFileSync(path, 'utf8');
    expect(src).toMatch(/openingBalance = -1010000/);
  });

  it('instructs the model that the closing-balance plug is inverted relative to its printed side, with the verified 4,61,340 example', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../../supabase/functions/msme-extract-ledger/index.ts');
    const src = readFileSync(path, 'utf8');
    expect(src).toMatch(/BALANCING FIGURE, NOT A TRANSACTION/);
    expect(src).toMatch(/closingBalance = \+461340/);
  });
});
