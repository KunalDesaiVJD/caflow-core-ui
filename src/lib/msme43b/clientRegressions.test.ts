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
import {
  detectLedgerAccountVendorNames, detectBalanceSign, applyDeterministicCorrections,
  detectGstSubtotalCorrections, detectDualAmountVouchers, rowFields,
} from './aiExtract';
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

describe('deterministic GST-subtotal correction — verified against the real Bindra Construction / Shree Navkar Trading Co ledger', () => {
  // Real extracted text (Shree Navkar Trading Co, FY 2025-26). The model had
  // been observed reading the SUB-LINE'S taxable amount ("Purchase @ 5%
  // 64,378.24 Dr") as the voucher's gross, instead of the amount actually
  // printed on the dated line itself ("...Tax Purchase 33 67,597.00"). The
  // engine's own GST split then reduced that already-net figure a SECOND
  // time, understating the disallowance (₹1,37,394 shown vs. the correct
  // ₹1,44,263 — confirmed independently against the firm's own working
  // paper). Ledger closing balance reconciliation caught the resulting drift
  // and blocked sign-off, but the root misread needs fixing at the source.
  const SHREE_NAVKAR_TEXT =
    'Bindra Construction- Partnership\nD-1002\nSun Central Place\nNr.Vakil Saheb Bridge\nAmbali\n' +
    'Ahmedabad-380058\nShree Navkar Trading Co\nLedger Account\n1, Sant Ashish Bunglows\nKathwada Fata\n' +
    'Naroda, Ahmedabad\n1-Apr-25 to 31-Mar-26\nPage 1\nDate Particulars Vch Type Vch No. Debit Credit\n' +
    '31-May-25 By (as per details) Tax Purchase 33 67,597.00\nPurchase @ 5% 64,378.24 Dr\n' +
    'SGST Input @ 2.5% 1,609.46 Dr\nCGST Input @ 2.5% 1,609.46 Dr\nRound Off 0.16 Cr\n' +
    '30-Jun-25 By (as per details) Tax Purchase 00058/2526 83,879.00\nPurchase @ 5% 79,885.09 Dr\n' +
    'SGST Input @ 2.5% 1,997.13 Dr\nCGST Input @ 2.5% 1,997.13 Dr\nRound Off 0.35 Cr\n' +
    '1,51,476.00\nTo Closing Balance 1,51,476.00\n1,51,476.00 1,51,476.00';

  // Real extracted text (Vasudev Narayan RMC Infra, same client/batch) where
  // the model read the voucher line correctly — proves the detector applies
  // the SAME real gross either way, rather than being tuned to one example.
  const VASUDEV_TEXT =
    '13-Jul-25 By (as per details) Tax Purchase VNR/25-26/0664 56,879.00\nPurchase @ 18% 48,202.59 Dr\n' +
    'SGST Input @ 9% 4,338.23 Dr\nCGST Input @ 9% 4,338.23 Dr\nRound Off 0.05 Cr';

  // Real extracted text (Indian Valves (Calcutta) Pvt Ltd, interstate supply)
  // — proves the IGST ("Inter State Purchase N%", no "@") shape is covered too.
  const INDIAN_VALVES_TEXT =
    '23-Apr-25 By (as per details) Tax Purchase IVC/019/25-26 6,66,420.00\n' +
    'Inter State Purchase 18% 5,64,763.00 Dr\nIGST Input @ 18% 1,01,657.34 Dr\nRound Off 0.34 Cr';

  it('reads the true gross off the voucher line and the taxable value off the sub-line, keyed by date + voucher number', () => {
    const found = detectGstSubtotalCorrections(SHREE_NAVKAR_TEXT);
    expect(found.get('2025-05-31|33')).toEqual({ grossAmount: 67597, taxableValue: 64378.24, gstRate: 5, reasonText: 'Purchase' });
    expect(found.get('2025-06-30|00058/2526')).toEqual({ grossAmount: 83879, taxableValue: 79885.09, gstRate: 5, reasonText: 'Purchase' });
  });

  it('covers the interstate ("Inter State Purchase N%", no "@") voucher shape identically', () => {
    const found = detectGstSubtotalCorrections(INDIAN_VALVES_TEXT);
    expect(found.get('2025-04-23|IVC/019/25-26')).toEqual({ grossAmount: 666420, taxableValue: 564763, gstRate: 18, reasonText: 'Inter State Purchase' });
  });

  it('corrects a row the model mis-read as the sub-line amount, using only the real ledger text', () => {
    // Positional (compact) row form: [date, particulars, vchType, vchNo, debit, credit, taxableValue, gstAmount, gstRate].
    // Simulates the observed failure: credit = 64378.24 (the sub-line, wrong)
    // instead of 67597 (the voucher line, correct), with no separate GST split.
    const rawLedgers: unknown[] = [{
      vendorName: 'Shree Navkar Trading Co',
      openingBalance: 0,
      closingBalance: 151476,
      rows: [
        ['2025-05-31', '(as per details) Tax Purchase', 'Tax Purchase', '33', 0, 64378.24, undefined, undefined, undefined],
      ],
    }];
    applyDeterministicCorrections(rawLedgers, SHREE_NAVKAR_TEXT);
    const row = (rawLedgers[0] as { rows: unknown[][] }).rows[0];
    expect(row[5]).toBe(67597);     // credit corrected to the true gross
    expect(row[6]).toBe(64378.24);  // taxableValue set from the sub-line
    expect(row[8]).toBe(5);         // gstRate set from the sub-line
    expect(row[7]).toBeUndefined(); // gstAmount cleared, left for splitGst to derive
  });

  it('also corrects the named-object row form', () => {
    const rawLedgers: unknown[] = [{
      vendorName: 'Shree Navkar Trading Co',
      openingBalance: 0,
      closingBalance: 151476,
      rows: [
        { date: '2025-06-30', particulars: 'Tax Purchase', vchNo: '00058/2526', debit: 0, credit: 79885.09 },
      ],
    }];
    applyDeterministicCorrections(rawLedgers, SHREE_NAVKAR_TEXT);
    const row = (rawLedgers[0] as { rows: Record<string, unknown>[] }).rows[0];
    expect(row.credit).toBe(83879);
    expect(row.taxableValue).toBe(79885.09);
    expect(row.gstRate).toBe(5);
  });

  it('is a no-op (harmless) on a row the model already read correctly', () => {
    const rawLedgers: unknown[] = [{
      vendorName: 'Vasudev Narayan RMC Infra',
      openingBalance: 0,
      closingBalance: 0,
      rows: [
        ['2025-07-13', 'Tax Purchase', 'Tax Purchase', 'VNR/25-26/0664', 0, 56879, undefined, undefined, undefined],
      ],
    }];
    applyDeterministicCorrections(rawLedgers, VASUDEV_TEXT);
    const row = (rawLedgers[0] as { rows: unknown[][] }).rows[0];
    expect(row[5]).toBe(56879);
    expect(row[6]).toBe(48202.59);
    expect(row[8]).toBe(18);
  });

  it('does not correct a date+voucher-number pair that appears more than once in the chunk (ambiguous, left unmatched)', () => {
    // The same "31-May-25 ... Tax Purchase 33 ..." voucher block repeated —
    // both would key to "2025-05-31|33", so neither is trustworthy to apply.
    const duplicated = SHREE_NAVKAR_TEXT + '\n' +
      '31-May-25 By (as per details) Tax Purchase 33 67,597.00\nPurchase @ 5% 64,378.24 Dr';
    const found = detectGstSubtotalCorrections(duplicated);
    expect(found.has('2025-05-31|33')).toBe(false);
    expect(found.has('2025-06-30|00058/2526')).toBe(true); // the untouched voucher is unaffected
  });
});

describe('deterministic dual-amount voucher split — verified against the real Amadius Realty / V.J. Desai & Co. ledger', () => {
  // Real extracted text (V.J. Desai & Co., FY 2025-26). The 31-Mar-26 "Journal
  // 285" voucher prints BOTH a Debit (23,300.00, the TDS netted) and a Credit
  // (2,33,000.00, this year's fee re-invoice) amount on the SAME line — the
  // exact pattern reported as "unable to run" for V.J. Desai & Co. in three
  // different clients (Amadius Realty, Skylark Corporation, Sweni
  // Corporation). Verified by full-ledger reconciliation arithmetic: every
  // OTHER row's contribution to the printed column totals (Debit 2,56,300.00
  // / Credit 7,17,640.00) leaves exactly 23,300.00 / 2,33,000.00 unaccounted
  // for — which only balances if the first trailing amount is this row's
  // Debit-column entry and the second is its Credit-column entry.
  const VJ_DESAI_TEXT =
    'AMADIUS REALTY\n{PAN: ABYFA4842P}\nReg.Office No.FF/04, Ankur Shopping Center,\n' +
    'Bh. VIP International School,Nikol,\nAhmedabad\nV J DESAI & CO.\nLedger Account\n' +
    '1-Apr-25 to 31-Mar-26\nPage 1\nDate Particulars Vch Type Vch No. Debit Credit\n' +
    '1-Apr-25 By Opening Balance 2,09,700.00\n1-Apr-25 To (as per details) Journal 3 2,33,000.00\n' +
    'PROFESSIONAL FEES - 18% 50,000.00 Cr\nAUDIT FEES - 18% 1,83,000.00 Cr\n' +
    '16-Jul-25 By (as per details) Purchase 065/2025-26 2,74,940.00\nAUDIT FEES - 18% 1,83,000.00 Dr\n' +
    'PROFESSIONAL FEES - 18% 50,000.00 Dr\nINPUT CGST 20,970.00 Dr\nINPUT SGST 20,970.00 Dr\n' +
    'ROUND OFF - PURCHASE\n31-Mar-26 To (as per details) Journal 285 23,300.00 2,33,000.00\n' +
    'AUDIT FEES - 18% 1,83,000.00 Dr\nPROFESSIONAL FEES - 18% 50,000.00 Dr\n' +
    'TDS - 194J PROFESSIONAL FEES 23,300.00 Cr\n2,56,300.00 7,17,640.00\n' +
    'To Closing Balance 4,61,340.00\n7,17,640.00 7,17,640.00';

  it('reads the debit and credit amounts off the dual-amount voucher line, keyed by date + voucher number', () => {
    const found = detectDualAmountVouchers(VJ_DESAI_TEXT);
    expect(found.get('2026-03-31|285')).toEqual({
      date: '2026-03-31', vchNo: '285', particulars: '(as per details) Journal',
      debitAmount: 23300, creditAmount: 233000,
    });
    // Ordinary single-amount lines (opening balance, the two other vouchers) never match.
    expect(found.size).toBe(1);
  });

  it('replaces whatever the model returned for that voucher number with exactly two clean rows — simulating a dropped Debit side', () => {
    // Simulates the observed failure: the model kept only the Credit leg
    // (233,000) and silently dropped the Debit/TDS-netting leg (23,300),
    // which is exactly what breaks reconciliation and the s.43B(h) base.
    const rawLedgers: unknown[] = [{
      vendorName: 'V J DESAI & CO.',
      openingBalance: -209700,
      closingBalance: 461340,
      rows: [
        ['2025-01-01', '(as per details) Journal', 'Journal', '3', 0, 233000, undefined, undefined, undefined],
        ['2025-07-16', '(as per details) Purchase', 'Purchase', '065/2025-26', 0, 274940, undefined, undefined, undefined],
        ['2026-03-31', '(as per details) Journal', 'Journal', '285', 0, 233000, undefined, undefined, undefined],
      ],
    }];
    applyDeterministicCorrections(rawLedgers, VJ_DESAI_TEXT);
    const rows = (rawLedgers[0] as { rows: unknown[][] }).rows;
    // The two untouched vouchers (3, 065/2025-26) survive unchanged.
    expect(rows).toHaveLength(4);
    const voucher285 = rows.filter((r) => r[3] === '285');
    expect(voucher285).toHaveLength(2);
    expect(voucher285).toContainEqual(['2026-03-31', '(as per details) Journal', '', '285', 23300, 0, undefined, undefined, undefined]);
    expect(voucher285).toContainEqual(['2026-03-31', '(as per details) Journal', '', '285', 0, 233000, undefined, undefined, undefined]);
  });

  it('also replaces a merged single-net row that started in the named-object form', () => {
    // Simulates a different failure: the model merged both legs into one
    // net figure (233,000 − 23,300 = 209,700) instead of two rows. The
    // ORIGINAL row is object-shaped; the two rows it's replaced with are
    // always emitted in the compact (positional) form applyDeterministic
    // Corrections uses elsewhere — mixing shapes within one rows array is
    // fine, since mapLedger reads either shape per-row via rowFields.
    const rawLedgers: unknown[] = [{
      vendorName: 'V J DESAI & CO.',
      openingBalance: -209700,
      closingBalance: 461340,
      rows: [
        { date: '2026-03-31', particulars: 'Journal', vchNo: '285', debit: 0, credit: 209700 },
      ],
    }];
    applyDeterministicCorrections(rawLedgers, VJ_DESAI_TEXT);
    const rows = (rawLedgers[0] as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(2);
    const fields = rows.map((row) => rowFields(row));
    expect(fields.some((f) => f.debit === 23300 && f.credit === 0)).toBe(true);
    expect(fields.some((f) => f.debit === 0 && f.credit === 233000)).toBe(true);
  });

  it('does not touch a voucher number this ledger has no row for (avoids leaking another vendor’s amounts across a multi-vendor chunk)', () => {
    const rawLedgers: unknown[] = [{
      vendorName: 'Some Other Vendor',
      openingBalance: 0,
      closingBalance: 0,
      rows: [
        ['2026-01-05', 'Purchase', 'Purchase', '999', 0, 5000, undefined, undefined, undefined],
      ],
    }];
    applyDeterministicCorrections(rawLedgers, VJ_DESAI_TEXT);
    const rows = (rawLedgers[0] as { rows: unknown[][] }).rows;
    expect(rows).toHaveLength(1); // untouched — voucher "285" never appears in this ledger's own rows
  });

  it('does not split a date+voucher-number pair that appears more than once in the chunk (ambiguous, left unmatched)', () => {
    const duplicated = VJ_DESAI_TEXT + '\n' +
      '31-Mar-26 To (as per details) Journal 285 23,300.00 2,33,000.00';
    const found = detectDualAmountVouchers(duplicated);
    expect(found.has('2026-03-31|285')).toBe(false);
  });
});

describe('generalized GST-subtotal detector — verified against real Amadius Realty ledgers with a different breakdown phrasing than Bindra', () => {
  // Real extracted text (Alpha Solution, FY 2025-26) — the client's own
  // stock-item name ("FIRE FIGHTING MATERIAL - 18%") replaces the generic
  // "Purchase @ N%" wording the detector was first built against. Reported
  // by the user as "Alpha ledger is not matching for disallowance figures"
  // after the Bindra-only fix shipped — proves the phrasing, not the bug
  // mechanism, was what the original regex missed.
  const ALPHA_SOLUTION_TEXT =
    'AMADIUS REALTY\n{PAN: ABYFA4842P}\nReg.Office No.FF/04, Ankur Shopping Center,\n' +
    'Bh. VIP International School,Nikol,\nAhmedabad\nALPHA SOLUTION\nLedger Account\n' +
    '1-Apr-25 to 31-Mar-26\nPage 1\nDate Particulars Vch Type Vch No. Debit Credit\n' +
    '1-Apr-25 By Opening Balance 11,60,000.00\n30-Jul-25 To ICICI BANK LTD Payment 165 7,00,000.00\n' +
    'A/C\n-346705002058\n1-Dec-25 By (as per details) Purchase AS/129/25-25 7,08,000.00\n' +
    'FIRE FIGHTING MATERIAL - 18% 6,00,000.00 Dr\nINPUT CGST 54,000.00 Dr\nINPUT SGST 54,000.00 Dr\n' +
    '9-Mar-26 By (as per details) Purchase AS/179/25-26 21,36,980.00\n' +
    'FIRE FIGHTING MATERIAL - 18% 18,11,000.00 Dr\nINPUT CGST 1,62,990.00 Dr\nINPUT SGST 1,62,990.00 Dr\n' +
    '7,00,000.00 40,04,980.00\nTo Closing Balance 33,04,980.00\n40,04,980.00 40,04,980.00';

  // Real extracted text (Omega Elevator, FY 2025-26) — same phrasing pattern
  // ("LIFT PURCHASE - 18%"), the ledger the user separately reported as
  // "the purchase is not being recorded according to its closing balance".
  const OMEGA_ELEVATOR_VOUCHER_TEXT =
    '27-Apr-25 By (as per details) Purchase GJ/2526/00440 13,23,960.00\n' +
    'LIFT PURCHASE - 18% 11,22,000.00 Dr\nINPUT CGST 1,00,980.00 Dr\nINPUT SGST 1,00,980.00 Dr';

  it('reads the true gross and taxable value off the Alpha Solution ledger, matching the firm\'s own working paper (₹6,00,000 and ₹18,11,000)', () => {
    const found = detectGstSubtotalCorrections(ALPHA_SOLUTION_TEXT);
    expect(found.get('2025-12-01|AS/129/25-25')).toEqual({
      grossAmount: 708000, taxableValue: 600000, gstRate: 18, reasonText: 'FIRE FIGHTING MATERIAL',
    });
    expect(found.get('2026-03-09|AS/179/25-26')).toEqual({
      grossAmount: 2136980, taxableValue: 1811000, gstRate: 18, reasonText: 'FIRE FIGHTING MATERIAL',
    });
  });

  it('reads the true gross and taxable value off the Omega Elevator ledger\'s "LIFT PURCHASE" phrasing', () => {
    const found = detectGstSubtotalCorrections(OMEGA_ELEVATOR_VOUCHER_TEXT);
    expect(found.get('2025-04-27|GJ/2526/00440')).toEqual({
      grossAmount: 1323960, taxableValue: 1122000, gstRate: 18, reasonText: 'LIFT PURCHASE',
    });
  });

  it('does NOT treat a "Cr" reversal/provision breakdown line on a Journal voucher as a GST-subtotal to strip', () => {
    // The V.J. Desai "Journal 3" reversal has the same "text N% amount"
    // shape but ends in "Cr", not "Dr", and its voucher line says "Journal"
    // rather than "Purchase" — both must independently exclude it, since a
    // real GST-bearing purchase invoice's breakdown line is always "Dr".
    const text =
      '1-Apr-25 To (as per details) Journal 3 2,33,000.00\n' +
      'PROFESSIONAL FEES - 18% 50,000.00 Cr\nAUDIT FEES - 18% 1,83,000.00 Cr';
    const found = detectGstSubtotalCorrections(text);
    expect(found.size).toBe(0);
  });

  it('replaces a generic "(as per details)" particulars with the sub-line\'s real reason, so a provision hidden in the breakdown is no longer classified as an ordinary purchase', () => {
    // Synthetic but structurally identical to the real ledgers above: a
    // "(as per details) Purchase" voucher whose actual reason — a book
    // provision, not a real invoice — only appears in the breakdown
    // sub-line. classify.ts only ever reads particulars + vchType (never
    // the sub-lines), so without this correction such a row silently
    // defaults to PURCHASE, which is what the firm reported as "provisions
    // are still considering as purchase".
    const text =
      '31-Mar-26 By (as per details) Purchase JV/44 1,18,000.00\n' +
      'PROVISION FOR AUDIT FEES - 18% 1,00,000.00 Dr\nINPUT CGST 9,000.00 Dr\nINPUT SGST 9,000.00 Dr';
    const rawLedgers: unknown[] = [{
      vendorName: 'Some Vendor',
      openingBalance: 0,
      closingBalance: 118000,
      rows: [
        { date: '2026-03-31', particulars: '(as per details)', vchType: 'Purchase', vchNo: 'JV/44', debit: 0, credit: 100000 },
      ],
    }];
    applyDeterministicCorrections(rawLedgers, text);
    const row = rowFields((rawLedgers[0] as { rows: unknown[] }).rows[0]);
    expect(row.particulars).toBe('PROVISION FOR AUDIT FEES');
    expect(row.credit).toBe(118000);
    expect(row.taxableValue).toBe(100000);
  });

  it('leaves a particulars the model already read as something specific untouched', () => {
    const rawLedgers: unknown[] = [{
      vendorName: 'Alpha Solution',
      openingBalance: 0,
      closingBalance: 708000,
      rows: [
        { date: '2025-12-01', particulars: 'Fire Fighting Material Purchase', vchType: 'Purchase', vchNo: 'AS/129/25-25', debit: 0, credit: 600000 },
      ],
    }];
    applyDeterministicCorrections(rawLedgers, ALPHA_SOLUTION_TEXT);
    const row = rowFields((rawLedgers[0] as { rows: unknown[] }).rows[0]);
    expect(row.particulars).toBe('Fire Fighting Material Purchase');
    expect(row.credit).toBe(708000); // the amount is still corrected
  });
});
