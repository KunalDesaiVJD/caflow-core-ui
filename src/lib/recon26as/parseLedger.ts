// Books-side reader: a TDS Receivable ledger, or any ledger / register that
// shows TDS party-wise and date-wise, exported to Excel or CSV.
//
// The usual file is Tally's Ledger Vouchers export of "TDS Receivable":
//   Date | Particulars | Vch Type | Vch No. | Debit | Credit
// where Particulars is the customer who deducted the tax, a debit is TDS
// booked and a credit is a reversal. A register with an explicit TDS column
// (Date | Party | Bill amount | TDS) is read from that column instead.
//
// Rows that are not a party's TDS — opening / closing balances, totals, the
// year-end transfer to the income-tax account — are excluded and listed, never
// silently dropped.

import type { ExcludedRow, ParseResult, TdsEntry } from './types';
import { parseAmount, parseDate, round2, TAN_RE } from './parseUtils';
import { findHeader, type ColumnMap, type Row } from './tabular';

export type LedgerNature = 'auto' | 'debit' | 'credit';

const str = (c: unknown) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').trim());

const FURNITURE = /^(opening|closing) balance|^(sub ?|grand )?total\b|^carried (over|forward)|^brought forward|^[bc]\s*\/\s*f\b|^balance (b\/d|c\/d)/i;
const INTERNAL = /provision for (income )?tax|\bincome[ -]?tax\b|advance tax|self[ -]assessment|tax paid|tds (adjust|set ?off|claimed)|current (tax|year tax)|^capital\b|drawings|^tds receivable|^tds (on|recoverable)|^suspense/i;

/** Strip Tally's "To" / "By" / "Dr" / "Cr" prefix from a particulars cell. */
export function cleanParticulars(s: string): string {
  return s.replace(/^(to|by|dr\.?|cr\.?)\s+/i, '').replace(/\s+/g, ' ').trim();
}

export interface LedgerParseOptions {
  /** explicit columns, e.g. from the AI mapper, with the header row index */
  mapping?: { headerRow: number; map: ColumnMap };
  nature?: LedgerNature;
}

export function parseLedgerRows(rows: Row[], file: string, opts: LedgerParseOptions = {}): ParseResult | null {
  const h = opts.mapping ? { index: opts.mapping.headerRow, map: opts.mapping.map } : findHeader(rows);
  if (!h) return null;
  const { map } = h;
  const body = rows.slice(h.index + 1);
  const excluded: ExcludedRow[] = [];
  const warnings: string[] = [];

  // Which side carries TDS: an explicit TDS column wins; otherwise the side
  // with the larger total (a TDS Receivable ledger is debit-heavy).
  let nature = opts.nature ?? 'auto';
  if (map.tds === undefined && nature === 'auto') {
    let dr = 0, cr = 0;
    for (const r of body) {
      if (FURNITURE.test(cleanParticulars(str(r[map.party!])))) continue;
      dr += map.debit !== undefined ? Math.abs(parseAmount(r[map.debit]) ?? 0) : 0;
      cr += map.credit !== undefined ? Math.abs(parseAmount(r[map.credit]) ?? 0) : 0;
    }
    nature = cr > dr ? 'credit' : 'debit';
    if (map.debit === undefined && map.credit === undefined && map.amount !== undefined) nature = 'debit';
  }

  const entries: TdsEntry[] = [];
  let lastDate: string | null = null;
  for (const r of body) {
    const cells = r.map(str);
    if (!cells.some(Boolean)) continue;
    const rawParty = cleanParticulars(cells[map.party!] || '');
    const date = parseDate(r[map.date!]) ?? null;

    let tds: number | null;
    if (map.tds !== undefined) {
      tds = parseAmount(r[map.tds]);
    } else if (map.debit !== undefined || map.credit !== undefined) {
      const dr = map.debit !== undefined ? parseAmount(r[map.debit]) : null;
      const cr = map.credit !== undefined ? parseAmount(r[map.credit]) : null;
      if (dr === null && cr === null) tds = null;
      else tds = nature === 'credit' ? (cr ?? 0) - (dr ?? 0) : (dr ?? 0) - (cr ?? 0);
    } else {
      tds = parseAmount(r[map.amount!]);
    }

    if (tds === null || tds === 0) {
      // a line with text but no amount is the narration of the line above
      const text = [rawParty, map.narration !== undefined ? cells[map.narration] : ''].filter(Boolean).join(' ');
      if (text && !date && entries.length && !FURNITURE.test(text)) {
        const prev = entries[entries.length - 1];
        prev.ref = [prev.ref, text].filter(Boolean).join(' · ').slice(0, 200);
      }
      continue;
    }
    if (!rawParty) {
      excluded.push({ file, text: cells.filter(Boolean).join(' | '), reason: 'amount with no party' });
      continue;
    }
    if (FURNITURE.test(rawParty)) {
      excluded.push({ file, text: `${rawParty} ${tds}`, reason: 'opening / closing balance or total' });
      continue;
    }
    if (INTERNAL.test(rawParty)) {
      excluded.push({ file, text: `${rawParty} ${tds}`, reason: 'transfer to an internal tax account, not a party\'s TDS' });
      continue;
    }

    const rowDate = date ?? lastDate;
    if (date) lastDate = date;
    const tan = map.tan !== undefined ? cells[map.tan].toUpperCase() : '';
    const ref = [
      map.vchType !== undefined ? cells[map.vchType] : '',
      map.vchNo !== undefined ? cells[map.vchNo] : '',
      map.narration !== undefined ? cells[map.narration] : '',
    ].filter(Boolean).join(' · ');
    entries.push({
      id: '',
      side: 'books',
      party: rawParty,
      tan: TAN_RE.test(tan) ? tan : undefined,
      section: map.section !== undefined ? cells[map.section] || undefined : undefined,
      date: rowDate,
      amountPaid: map.tds !== undefined && map.amount !== undefined ? parseAmount(r[map.amount]) ?? undefined : undefined,
      tds: round2(tds),
      ref: ref || undefined,
      file,
    });
  }

  if (!entries.length) return null;
  const negatives = entries.filter((e) => e.tds < 0).length;
  if (negatives) warnings.push(`${negatives} line(s) in ${file} reduce TDS (reversals / credit notes) and are reconciled as negatives.`);
  if (map.tds === undefined && (map.debit !== undefined || map.credit !== undefined)) {
    warnings.push(`${file}: TDS read from the ${nature} column.`);
  }
  return { entries, excluded, warnings, method: 'tabular' };
}
