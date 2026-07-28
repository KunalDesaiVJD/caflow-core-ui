// Parser for Tally "detailed" ledger PDF exports.
//
// Layout: columns Date | Particulars | Vch Type | Vch No. | Debit | Credit.
// Amounts are RIGHT-ALIGNED into the Debit/Credit columns (far right). Under an
// "as per details" voucher, the contra breakup is printed INDENTED (mid-page,
// each line trailing " Dr"/" Cr") — those are metadata, NOT balance movements.
//
//   1-Apr-25            Opening Balance                    37,170.00   (Credit col)
//   28-May-25 Cr        (as per details)       117 Payment 21,240.00   (Debit col)
//        Shree Manibhadra Industries   38,68,888.00 Dr   ← indented detail
//        HDFC Bank C.C A/c           1,27,69,107.00 Cr   ← indented detail
//
// There is no per-line running balance, so the oracle is:
//   closing = opening ± Σ(credit − debit)   compared to the printed "Closing Balance".

import type { TextLine, TextToken, VendorLedger, LedgerTxn, LedgerDetailLine } from './types';
import { parseAmount, leadingDate, parseLedgerDate, fyFromStart } from './parseUtils';

const AMOUNT_RE = /^[\d,]+\.\d{2}$/;
const VCH_TYPES = ['Purchase', 'Payment', 'Receipt', 'Journal', 'Contra', 'Sales',
  'Credit Note', 'Debit Note', 'Cr Note', 'Dr Note'];

interface Cols { debit: number; credit: number; vchNo: number; vchType: number; }

function findColumns(pages: TextLine[][]): Cols {
  for (const line of pages.flat()) {
    const dt = line.tokens.find((t) => /^Debit$/i.test(t.text));
    const ct = line.tokens.find((t) => /^Credit$/i.test(t.text));
    if (dt && ct) {
      // Vch No / Vch Type header may be on an adjacent line.
      const all = pages.flat().flatMap((l) => l.tokens);
      const vchNo = all.find((t) => /^No\.?$/i.test(t.text));
      const vchType = all.find((t) => /^Type$/i.test(t.text));
      return {
        debit: dt.x, credit: ct.x,
        vchNo: vchNo ? vchNo.x : 410,
        vchType: vchType ? vchType.x : 300,
      };
    }
  }
  return { debit: 482, credit: 546, vchNo: 410, vchType: 300 };
}

const center = (t: TextToken) => (t.x + t.x1) / 2;

export function parseTally(pages: TextLine[][], sourceFile?: string): VendorLedger[] {
  const cols = findColumns(pages);
  const mainMinX = Math.min(cols.debit, cols.credit) - 90; // left edge of the amount band
  const split = (cols.debit + cols.credit) / 2;
  const flatLines = pages.flat();

  // ── header: vendor name (line before "Ledger Account") + period ──
  let vendorName = '';
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  for (let i = 0; i < flatLines.length; i++) {
    const txt = flatLines[i].text.trim();
    if (/^Ledger Account$/i.test(txt) || /^Ledger$/i.test(txt)) {
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const cand = flatLines[j].text.trim();
        if (cand && !/^Ledger/i.test(cand) && !/\d{4}/.test(cand)) { vendorName = cand; break; }
      }
    }
    const pm = txt.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i);
    if (pm && !periodFrom) {
      periodFrom = parseLedgerDate(pm[1]) || undefined;
      periodTo = parseLedgerDate(pm[2]) || undefined;
    }
  }
  if (!vendorName && sourceFile) {
    vendorName = sourceFile.replace(/\.[Pp][Dd][Ff]$/, '').replace(/[_ ]?\d{4}[-_]?\d{2}.*$/, '').trim();
  }
  const fy = periodFrom ? fyFromStart(periodFrom) : undefined;

  const txns: LedgerTxn[] = [];
  let opening = 0;
  let printedClosing: number | null = null;
  let lastDate: string | null = null;
  let pendingVchType = '';
  let pendingParticulars = '';
  const warnings: string[] = [];

  for (const line of flatLines) {
    const txt = line.text.trim();
    if (!txt) continue;

    const amtToks = line.tokens.filter((t) => AMOUNT_RE.test(t.text));
    const mainAmts = amtToks.filter((t) => center(t) >= mainMinX);
    const mainAmt = mainAmts[0];
    const detailAmt = amtToks.find((t) => center(t) < mainMinX);
    const drcrTok = line.tokens.find((t) => /^(Dr|Cr)\.?$/i.test(t.text));
    const ld = leadingDate(txt);
    if (ld) lastDate = ld;

    const low = txt.toLowerCase();

    // ── control / subtotal lines ──
    // "Carried Over" / "Brought Over" / "Carried Forward" page-break subtotals,
    // and grand-total rows, print TWO column totals (debit + credit). Any line
    // carrying two main-band amounts is a total row, never a single posting.
    if (low.includes('carried') || low.includes('brought') || low.includes('grand total')) {
      continue;
    }
    if (mainAmts.length >= 2 && !low.includes('opening balance') && !low.includes('closing balance')) {
      continue;
    }
    if (low.includes('opening balance') && mainAmt) {
      const side = center(mainAmt) >= split ? 1 : -1; // credit(+) / debit(-)
      opening = parseAmount(mainAmt.text) * side;
      continue;
    }
    if (low.includes('closing balance')) {
      const amt = amtToks[0] || mainAmt;
      if (amt) printedClosing = parseAmount(amt.text);
      continue;
    }

    // ── indented contra detail line → attach to last txn ──
    if (detailAmt && !mainAmt) {
      const name = txt.replace(/[\d,]+\.\d{2}.*/, '').replace(/\b(Dr|Cr)\b\.?/gi, '').trim();
      const dl: LedgerDetailLine = {
        name,
        amount: parseAmount(detailAmt.text),
        drcr: drcrTok && /cr/i.test(drcrTok.text) ? 'Cr' : 'Dr',
      };
      if (txns.length) (txns[txns.length - 1].details ||= []).push(dl);
      continue;
    }

    // capture a pending Vch Type / particulars from a narrative line
    if (!mainAmt) {
      const vt = VCH_TYPES.find((v) => new RegExp(`\\b${v}\\b`, 'i').test(txt));
      if (vt) pendingVchType = vt;
      const partText = txt.replace(/\((as per details)\)/i, '').replace(/\b(Dr|Cr)\b\.?/gi, '').trim();
      if (partText && !/^\d/.test(partText)) pendingParticulars = partText;
      continue;
    }

    // ── a main posting line ──
    const side = center(mainAmt) >= split ? 'credit' : 'debit';
    const amount = parseAmount(mainAmt.text);
    const vchNoTok = line.tokens.find(
      (t) => !AMOUNT_RE.test(t.text) && Math.abs(center(t) - cols.vchNo) < 45 &&
        /[\d/]/.test(t.text) && !/^(Dr|Cr)$/i.test(t.text));
    const vt = VCH_TYPES.find((v) => new RegExp(`\\b${v}\\b`, 'i').test(txt)) || pendingVchType;

    let particulars = txt
      .replace(/^\d{1,2}-[A-Za-z]{3}-\d{2,4}/, '')
      .replace(/\((as per details)\)/i, '')
      .replace(/[\d,]+\.\d{2}/g, '')
      .replace(/\b(Dr|Cr)\b\.?/gi, '')
      .replace(new RegExp(`\\b(${VCH_TYPES.join('|')})\\b`, 'gi'), '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!particulars) particulars = pendingParticulars || vt || '';

    txns.push({
      date: lastDate || periodFrom || '',
      particulars,
      vchType: vt || undefined,
      vchNo: vchNoTok ? vchNoTok.text : undefined,
      credit: side === 'credit' ? amount : 0,
      debit: side === 'debit' ? amount : 0,
      raw: txt,
    });
    pendingVchType = '';
    pendingParticulars = '';
  }

  const reconstructed = txns.reduce((a, x) => a + x.credit - x.debit, opening);
  const closing = printedClosing != null ? printedClosing : Math.abs(reconstructed);
  const drift = Math.round((Math.abs(reconstructed) - closing) * 100) / 100;

  const ledger: VendorLedger = {
    vendorName: vendorName || 'Unknown Vendor',
    periodFrom, periodTo, financialYear: fy,
    openingBalance: opening,
    closingBalance: reconstructed, // signed
    txns,
    format: 'tally',
    sourceFile,
    reconstructedClosing: reconstructed,
    reconDrift: drift,
    balanceReconciled: Math.abs(drift) <= 1,
    warnings,
  };
  return [ledger];
}
