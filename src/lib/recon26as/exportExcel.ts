// Working-paper export for the 26AS vs Books reconciliation.

import * as XLSX from 'xlsx';
import type { ReconResult, TdsEntry } from './types';
import { MATCH_LABEL } from './engine';
import { CATEGORY_LABEL, type Issue } from './insights';
import type { AiReview } from './ingest';

export const STATUS_LABEL = {
  matched: 'Matched',
  total_match: 'Totals agree — lines open',
  forced: 'Force matched',
  difference: 'Difference',
  books_only: 'In books, not in 26AS',
  as_only: 'In 26AS, not in books',
} as const;

export function buildWorkbook(r: ReconResult, meta: { client?: string; fy?: string }, issues: Issue[] = [], review: AiReview | null = null): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const pairOf = new Map<string, (typeof r.pairs)[number]>();
  for (const p of r.pairs) for (const id of [...p.bookIds, ...p.asIds]) pairOf.set(id, p);

  const summary = [
    ['26AS vs Books — TDS reconciliation'],
    ['Client', meta.client || ''],
    ['Financial year', meta.fy || ''],
    ['Prepared', new Date().toLocaleString('en-IN')],
    [],
    ['', 'Books', '26AS', 'Difference (Books − 26AS)'],
    ['TDS total', r.totals.books, r.totals.as26, r.totals.diff],
    ['Lines', r.books.length, r.as26.length],
    ['Lines matched', r.totals.matchedBooks, r.totals.matchedAs],
    ['Lines open', r.totals.openBooks, r.totals.openAs],
    [],
    ['Party status', 'Count', 'Books TDS', '26AS TDS', 'Difference'],
    ...Object.entries(STATUS_LABEL).map(([k, label]) => {
      const gs = r.groups.filter((g) => g.status === k);
      return [label, gs.length, sum(gs.map((g) => g.booksTotal)), sum(gs.map((g) => g.asTotal)), sum(gs.map((g) => g.diff))];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const issueRows: (string | number)[][] = [
    ['Severity', 'Area', 'Issue', 'Detail', 'Amount', 'Action', 'Lines'],
    ...issues.map((i) => [i.severity, CATEGORY_LABEL[i.category], i.title, i.detail, i.amount ?? '', i.action, (i.entryIds ?? []).join(', ')]),
  ];
  if (review) {
    issueRows.push([], ['AI reviewer'], [review.summary]);
    for (const f of review.findings) issueRows.push([f.severity, 'AI', f.title, f.detail, '', f.action]);
    review.next_steps.forEach((s, i) => issueRows.push([`Step ${i + 1}`, '', s]));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(issueRows), 'Issues 360');

  const party = [
    ['26AS deductor', 'TAN', 'Books party(s)', 'Link', 'Link confidence', 'Books TDS', '26AS TDS', 'Difference', 'Books lines', '26AS lines', 'Books open', '26AS open', 'Status', 'Unbooked 26AS lines'],
    ...r.groups.map((g) => [
      g.deductorName || '', g.tan || '', g.bookParties.join('; '), g.link?.reason || '', g.link?.confidence ?? '',
      g.booksTotal, g.asTotal, g.diff, g.booksCount, g.asCount, g.openBookIds.length, g.openAsIds.length,
      STATUS_LABEL[g.status], g.unbookedAs || '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(party), 'Party-wise');

  const entryRow = (e: TdsEntry) => {
    const p = pairOf.get(e.id);
    return [
      e.side === 'books' ? 'Books' : '26AS', e.id, e.party, e.tan || '', e.section || '', e.date || '',
      e.amountPaid ?? '', e.tds, e.tdsDeposited ?? '', e.bookingStatus || '', e.ref || '',
      p ? MATCH_LABEL[p.type] : 'OPEN', p ? p.id : '', p ? p.diff : '', p?.dayGap ?? '', p?.note || '',
    ];
  };
  const entryHead = ['Side', 'Line', 'Party', 'TAN', 'Section', 'Date', 'Amount paid', 'TDS', 'TDS deposited', 'Booking status', 'Ref / narration', 'Match', 'Match id', 'Match difference', 'Day gap', 'Note'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([entryHead, ...[...r.books, ...r.as26].map(entryRow)]), 'Entry-wise');

  const open = (xs: TdsEntry[]) => xs.filter((e) => !pairOf.has(e.id));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([entryHead, ...open(r.books).map(entryRow)]), 'In books not in 26AS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([entryHead, ...open(r.as26).map(entryRow)]), 'In 26AS not in books');

  const byId = new Map([...r.books, ...r.as26].map((e) => [e.id, e]));
  const diffs = r.pairs.filter((p) => Math.abs(p.diff) > 0.005 || (p.dayGap ?? 0) > 0);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Match', 'Books lines', 'Books dates', 'Books TDS', '26AS lines', '26AS dates', '26AS TDS', 'Difference', 'Day gap', 'Note'],
    ...diffs.map((p) => [
      MATCH_LABEL[p.type],
      p.bookIds.map((id) => byId.get(id)?.party).join('; '),
      p.bookIds.map((id) => byId.get(id)?.date).join('; '),
      p.booksAmount,
      p.asIds.map((id) => byId.get(id)?.party).join('; '),
      p.asIds.map((id) => byId.get(id)?.date).join('; '),
      p.asAmount, p.diff, p.dayGap ?? '', p.note || '',
    ]),
  ]), 'Matched with differences');

  return wb;
}

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

export function downloadWorkbook(r: ReconResult, meta: { client?: string; fy?: string }, issues: Issue[] = [], review: AiReview | null = null) {
  const wb = buildWorkbook(r, meta, issues, review);
  const name = `26AS_Recon_${(meta.client || 'client').replace(/[^A-Za-z0-9]+/g, '_')}_${meta.fy || ''}.xlsx`;
  XLSX.writeFile(wb, name);
}
