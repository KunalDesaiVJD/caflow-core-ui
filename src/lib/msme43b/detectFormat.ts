// Detect which accounting-software export a ledger PDF came from.

import type { TextLine, LedgerFormat } from './types';

/**
 * Tally exports show a "Vch No." / "Vch Type" column header and a right-aligned
 * Debit/Credit pair. Expert (and similar) exports show a fixed-width
 * "Dr.Amount   Cr.Amount   Balance" header with a running C/D balance column
 * and dashed rule lines. We sniff the first ~2 pages.
 */
export function detectFormat(pages: TextLine[][]): LedgerFormat {
  const head = pages.slice(0, 2).flat().map((l) => l.text.toLowerCase()).join('\n');

  const expertSignals =
    (head.includes('dr.amount') || head.includes('dr amount')) &&
    (head.includes('cr.amount') || head.includes('cr amount'));
  const expertRule = head.includes('opening balance') && /-{10,}/.test(head);

  if (expertSignals || (expertRule && head.includes('balance'))) return 'expert';

  const tallySignals =
    head.includes('vch no') || head.includes('vch type') || head.includes('ledger account');
  if (tallySignals) return 'tally';

  return 'unknown';
}
