// MSME 43B(h) — parse dispatch: TextLine pages → VendorLedger[].

import type { TextLine, VendorLedger } from './types';
import { detectFormat } from './detectFormat';
import { parseTally } from './parseTally';
import { parseExpert } from './parseExpert';

export function parseLedgerPages(pages: TextLine[][], sourceFile?: string): VendorLedger[] {
  const fmt = detectFormat(pages);
  if (fmt === 'expert') return parseExpert(pages, sourceFile);
  if (fmt === 'tally') return parseTally(pages, sourceFile);
  // Unknown: try Tally then Expert, keep whichever reconciles.
  const t = parseTally(pages, sourceFile);
  if (t.every((l) => l.balanceReconciled)) return t;
  const e = parseExpert(pages, sourceFile);
  return e.length ? e : t;
}
