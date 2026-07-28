// Parser for "Expert"-style creditors-ledger PDF exports.
//
// Layout (fixed-width, one row per transaction, may contain MANY vendor ledgers
// in one file):
//
//   Creditors Ledger
//   From 01/04/2025 To 31/03/2026
//   ------------------------------------------------------------
//   Date       Particulars            Dr.Amount   Cr.Amount   Balance
//   ------------------------------------------------------------
//   RONAK AUXI CHEM
//   ------------------------------------------------------------
//   01/04/2025 *** OPENING BALANCE ***             82600.00   82600.00C
//   07/04/2025 Purchase A/c                        38940.00  121540.00C
//   12/05/2025 KOTAK MAHINDRA BANK-C/A  82600.00             119180.00C
//   31/03/2026 *** CLOSING BALANCE ***  999460.00 1040760.00  41300.00C
//
// The Balance column carries a trailing C (credit) / D (debit) marker, so we
// derive each row's Dr/Cr from the *movement* of the signed balance — the
// running balance IS the built-in oracle.

import type { TextLine, VendorLedger, LedgerTxn } from './types';
import { parseAmount, parseLedgerDate, fyFromStart } from './parseUtils';

const BALANCE_TOK = /^[\d,]+\.\d{2}[CcDd]$/;
const AMOUNT_TOK = /^[\d,]+\.\d{2}$/;

interface FlatLine {
  text: string;
  tokens: { x: number; text: string }[];
}

export function parseExpert(pages: TextLine[][], sourceFile?: string): VendorLedger[] {
  const flat: FlatLine[] = pages.flat().map((l) => ({
    text: l.text,
    tokens: l.tokens.map((t) => ({ x: t.x, text: t.text })),
  }));

  // Period (financial year) from the "From dd/mm/yyyy To dd/mm/yyyy" header.
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  for (const l of flat) {
    const m = l.text.match(/From\s+(\d{2}\/\d{2}\/\d{4})\s+To\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (m) {
      periodFrom = parseLedgerDate(m[1]) || undefined;
      periodTo = parseLedgerDate(m[2]) || undefined;
      break;
    }
  }
  const fy = periodFrom ? fyFromStart(periodFrom) : undefined;

  const ledgers: VendorLedger[] = [];
  let candidateName = '';
  let current: VendorLedger | null = null;
  let signedBal = 0; // +ve = credit (payable) balance

  const isDashed = (t: string) => /^-{5,}$/.test(t.replace(/\s/g, ''));
  const isNameLike = (t: string) => {
    const s = t.trim();
    if (!s || isDashed(s)) return false;
    if (/\d{2}\/\d{2}\/\d{4}/.test(s)) return false;
    if (BALANCE_TOK.test(s.replace(/\s/g, ''))) return false;
    const low = s.toLowerCase();
    const skip = ['creditors ledger', 'debtors ledger', 'sundry', 'page no',
      'dr.amount', 'cr.amount', 'balance', 'particulars', 'opening balance',
      'closing balance', 'from ', ' to '];
    if (skip.some((k) => low.includes(k))) return false;
    return /[a-z]/i.test(s);
  };

  const finish = () => {
    if (current) {
      current.closingBalance = current.closingBalance || signedBal;
      current.reconstructedClosing = signedBal;
      ledgers.push(current);
      current = null;
    }
  };

  for (const l of flat) {
    const t = l.text.trim();
    if (!t) continue;

    const low = t.toLowerCase();
    const isOpening = low.includes('opening balance');
    const isClosing = low.includes('closing balance');
    const date = parseLedgerDate((t.match(/^(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '');

    // Track a potential vendor-name header (last name-like line before OPENING).
    if (!date && !isOpening && !isClosing && isNameLike(t)) {
      candidateName = t;
      continue;
    }

    const balTokRaw = l.tokens.map((x) => x.text).find((x) => BALANCE_TOK.test(x));
    const amountToks = l.tokens
      .map((x) => x.text)
      .filter((x) => AMOUNT_TOK.test(x));

    if (isOpening) {
      finish();
      const side = balTokRaw && /d$/i.test(balTokRaw) ? -1 : 1;
      const bal = balTokRaw ? parseAmount(balTokRaw) * side : (amountToks[0] ? parseAmount(amountToks[0]) : 0);
      signedBal = bal;
      current = {
        vendorName: candidateName || 'Unknown Vendor',
        periodFrom, periodTo, financialYear: fy,
        openingBalance: bal,
        closingBalance: 0,
        txns: [],
        format: 'expert',
        sourceFile,
        warnings: [],
      };
      candidateName = '';
      continue;
    }

    if (!current) continue;

    if (isClosing) {
      const side = balTokRaw && /d$/i.test(balTokRaw) ? -1 : 1;
      current.closingBalance = balTokRaw ? parseAmount(balTokRaw) * side : signedBal;
      finish();
      continue;
    }

    if (!date) continue; // narration wrap or noise

    // Derive Dr/Cr from balance movement.
    const side = balTokRaw && /d$/i.test(balTokRaw) ? -1 : 1;
    const newBal = balTokRaw ? parseAmount(balTokRaw) * side : signedBal;
    const delta = newBal - signedBal;
    const printedAmt = amountToks.length ? parseAmount(amountToks[amountToks.length - 1]) : Math.abs(delta);

    const particulars = t
      .replace(/^\d{2}\/\d{2}\/\d{4}\s*/, '')
      .replace(/\s+[\d,]+\.\d{2}[CcDd]?\s*$/g, '')
      .replace(/\s+[\d,]+\.\d{2}\s*$/g, '')
      .trim();

    const txn: LedgerTxn = {
      date,
      particulars,
      credit: delta > 0 ? Math.abs(delta) : 0,
      debit: delta < 0 ? Math.abs(delta) : 0,
      printedBalance: Math.abs(newBal),
      printedBalanceSide: newBal >= 0 ? 'C' : 'D',
      raw: t,
    };
    // If the balance column was missing, fall back to the printed amount as a credit.
    if (!balTokRaw && printedAmt) {
      txn.credit = printedAmt;
      txn.debit = 0;
    }
    current.txns.push(txn);
    signedBal = balTokRaw ? newBal : signedBal + printedAmt;
  }

  finish();

  // Reconciliation: reconstruct opening ± movements and compare to closing.
  for (const led of ledgers) {
    const recon = led.txns.reduce((acc, x) => acc + x.credit - x.debit, led.openingBalance);
    led.reconstructedClosing = recon;
    led.reconDrift = Math.round((recon - led.closingBalance) * 100) / 100;
    led.balanceReconciled = Math.abs(led.reconDrift) <= 1;
  }

  return ledgers;
}
