import { describe, it, expect } from 'vitest';
import { autoLinkParties, indexEntries, reconcile, resolveLinks } from './engine';
import { nameAliases, nameSimilarity } from './names';
import { parse26asTraces, textToRows, parse26asPdfLines } from './parse26as';
import { parseLedgerRows } from './parseLedger';
import { DEFAULT_OPTIONS, type TdsEntry } from './types';
import { parseDate } from './parseUtils';

const e = (party: string, date: string, tds: number, tan?: string): TdsEntry => ({ id: '', side: 'books', party, date, tds, tan });
const none = { forced: [], manual: [], links: {} };

function run(books: TdsEntry[], as: TdsEntry[], overrides = none) {
  const b = indexEntries(books, 'books');
  const a = indexEntries(as, '26as');
  const links = resolveLinks(autoLinkParties(b, a), [], overrides.links, a);
  return reconcile(b, a, links, overrides, DEFAULT_OPTIONS);
}

describe('names', () => {
  it('strips legal-form noise', () => {
    expect(nameSimilarity('ABC Infra Pvt. Ltd.', 'ABC INFRA PRIVATE LIMITED').score).toBe(1);
    expect(nameSimilarity('M/s. Sai Traders', 'SAI TRADERS').score).toBe(1);
  });
  it('handles initials and joined words', () => {
    expect(nameSimilarity('R K Patel', 'RAMESH KUMAR PATEL').score).toBeGreaterThan(0.8);
    expect(nameSimilarity('Sai Infra', 'SAIINFRA').score).toBe(1);
  });
  it('reads proprietor aliases from the ledger name', () => {
    expect(nameAliases('Shree Krishna Ent. (Prop. Ramesh Patel)')).toContain('Ramesh Patel');
    expect(nameSimilarity('Shree Krishna Ent. (Prop. Ramesh Patel)', 'RAMESH PATEL').score).toBe(1);
    expect(nameSimilarity('Krishna Enterprises Prop: Ramesh Patel', 'RAMESH PATEL').score).toBe(1);
  });
  it('keeps unrelated names apart', () => {
    expect(nameSimilarity('Shree Krishna Traders', 'MAHAVIR STEEL').score).toBeLessThan(0.5);
  });
});

describe('parseDate', () => {
  it('is day-first', () => {
    expect(parseDate('01/04/2025')).toBe('2025-04-01');
    expect(parseDate('31-Mar-2026')).toBe('2026-03-31');
    expect(parseDate('1-Apr-25')).toBe('2025-04-01');
  });
});

describe('reconcile', () => {
  it('matches exact, near-date and rounded lines', () => {
    const r = run(
      [e('ABC Ltd', '2025-06-30', 1000), e('ABC Ltd', '2025-09-10', 500), e('ABC Ltd', '2025-12-31', 250.4)],
      [e('ABC LIMITED', '2025-06-30', 1000, 'MUMA12345B'), e('ABC LIMITED', '2025-09-30', 500, 'MUMA12345B'), e('ABC LIMITED', '2025-12-31', 250, 'MUMA12345B')],
    );
    expect(r.pairs.map((p) => p.type).sort()).toEqual(['date_diff', 'exact', 'rounding']);
    expect(r.totals.openBooks).toBe(0);
    expect(r.groups[0].status).toBe('matched');
  });

  it('matches one books line to several 26AS lines', () => {
    const r = run(
      [e('XYZ', '2025-06-30', 3000)],
      [e('XYZ', '2025-06-10', 1000, 'PNEX12345E'), e('XYZ', '2025-06-20', 2000, 'PNEX12345E')],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].type).toBe('grouped');
  });

  it('links proprietor and firm on equal totals and allows force match', () => {
    const r = run(
      [e('Shree Krishna Traders', '2025-05-01', 700), e('Shree Krishna Traders', '2025-08-01', 300)],
      [e('RAMESH PATEL', '2025-11-15', 400, 'AHMR12345A'), e('RAMESH PATEL', '2026-02-15', 600, 'AHMR12345A')],
    );
    expect(r.links[0].method).toBe('total');
    const g = r.groups[0];
    expect(g.status).toBe('total_match');
    const forced = run(
      [e('Shree Krishna Traders', '2025-05-01', 700), e('Shree Krishna Traders', '2025-08-01', 300)],
      [e('RAMESH PATEL', '2025-11-15', 400, 'AHMR12345A'), e('RAMESH PATEL', '2026-02-15', 600, 'AHMR12345A')],
      { forced: [g.key], manual: [], links: {} },
    );
    expect(forced.groups[0].status).toBe('forced');
    expect(forced.totals.openBooks).toBe(0);
  });

  it('reports amount differences and missing lines', () => {
    const r = run(
      [e('ABC', '2025-06-30', 1000), e('ABC', '2025-07-15', 800)],
      [e('ABC', '2025-06-28', 1050, 'MUMA12345B')],
    );
    expect(r.pairs[0].type).toBe('amount_diff');
    expect(r.pairs[0].diff).toBe(-50);
    expect(r.groups[0].status).toBe('difference');
    expect(r.groups[0].openBookIds).toHaveLength(1);
  });

  it('finds TDS booked under another party', () => {
    const r = run(
      [e('Alpha Corp', '2025-06-30', 1234), e('Beta Ltd', '2025-07-01', 999)],
      [e('ALPHA CORPORATION', '2025-07-01', 999, 'AAAA11111A'), e('BETA LIMITED', '2025-06-30', 1234, 'BBBB22222B')],
    );
    expect(r.pairs.filter((p) => p.type === 'cross_party')).toHaveLength(2);
  });

  it('honours a manual link', () => {
    const b = indexEntries([e('Unknown Name', '2025-06-30', 10)], 'books');
    const a = indexEntries([e('SOMEONE ELSE', '2025-06-30', 99, 'CCCC33333C')], '26as');
    const links = resolveLinks(autoLinkParties(b, a), [], { 'UNKNOWN NAME': 'CCCC33333C' }, a);
    expect(links[0].method).toBe('manual');
  });
});

describe('26AS readers', () => {
  const traces = [
    'File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee',
    '24-10-2026^ABCDE1234F^Active^2025-26^2026-27^TEST ASSESSEE',
    'PART-I - Details of Tax Deducted at Source',
    'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited^Total Tax Deducted^Total TDS Deposited',
    '1^ABC LIMITED^MUMA12345B^^^^^150000.00^15000.00^15000.00',
    '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited^Tax Deducted^TDS Deposited',
    '^1^194J^30-Jun-2025^F^31-Jul-2025^-^100000.00^10000.00^10000.00',
    '^2^194J^30-Sep-2025^F^31-Oct-2025^-^50000.00^5000.00^5000.00',
    'PART-VI - Details of Tax Collected at Source',
    'Sr. No.^Name of Collector^TAN of Collector^^^^^Total Amount Paid/ Debited^Total Tax Collected^Total TCS Deposited',
    '1^XYZ LTD^PNEX12345E^^^^^1000.00^1.00^1.00',
  ].join('\n');

  it('reads the TRACES text download and checks printed totals', () => {
    const r = parse26asTraces(textToRows(traces), '26as.txt')!;
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ party: 'ABC LIMITED', tan: 'MUMA12345B', section: '194J', date: '2025-06-30', tds: 10000, bookingStatus: 'F' });
    expect(r.assessee?.pan).toBe('ABCDE1234F');
    expect(r.warnings.some((w) => /line items add/.test(w))).toBe(false);
  });

  it('reads TRACES PDF text lines', () => {
    const r = parse26asPdfLines([
      'PART-I - Details of Tax Deducted at Source',
      '1 ABC LIMITED MUMA12345B 150000.00 15000.00 15000.00',
      '1 194J 30-Jun-2025 F 31-Jul-2025 - 100000.00 10000.00 10000.00',
      '2 194J 30-Sep-2025 F 31-Oct-2025 - 50000.00 4000.00 4000.00',
    ], '26as.pdf')!;
    expect(r.entries).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/line items add/);
  });
});

describe('ledger reader', () => {
  it('reads a Tally TDS Receivable export', () => {
    const rows = [
      ['My Company Pvt Ltd'], ['TDS Receivable'], ['1-Apr-2025 to 31-Mar-2026'],
      ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit'],
      ['1-Apr-2025', 'Opening Balance', '', '', '', ''],
      ['30-Jun-2025', 'Dr ABC Ltd', 'Journal', '12', '10,000.00', ''],
      ['', 'Being TDS on bill 45', '', '', '', ''],
      ['30-Sep-2025', 'By XYZ Traders', 'Receipt', '19', '5000', ''],
      ['31-Mar-2026', 'Provision for Income Tax', 'Journal', '99', '', '15000'],
      ['', 'Grand Total', '', '', '15000', '15000'],
    ];
    const r = parseLedgerRows(rows, 'tds.xlsx')!;
    expect(r.entries.map((x) => [x.party, x.tds])).toEqual([['ABC Ltd', 10000], ['XYZ Traders', 5000]]);
    expect(r.entries[0].ref).toContain('Being TDS');
    expect(r.excluded.map((x) => x.reason)).toEqual([expect.stringMatching(/internal tax account/)]);
  });
});

describe('360° issues', () => {
  it('flags 206AA rates, unbooked lines, books-only parties and short deposit', async () => {
    const { findIssues } = await import('./insights');
    const b = indexEntries([e('Ghost Party', '2025-06-30', 500), e('ABC', '2025-06-30', 100), e('ABC', '2025-07-01', 100)], 'books');
    const a = indexEntries([
      { id: '', side: '26as', party: 'ABC', tan: 'MUMA12345B', section: '194J', date: '2025-06-30', amountPaid: 1000, tds: 200, tdsDeposited: 150, bookingStatus: 'U' },
    ], '26as');
    const r = reconcile(b, a, resolveLinks(autoLinkParties(b, a), [], {}, a), none, DEFAULT_OPTIONS);
    const titles = findIssues(r, DEFAULT_OPTIONS, '2025-26').map((i) => i.title).join('\n');
    expect(titles).toMatch(/20% or more/);
    expect(titles).toMatch(/not finally booked/);
    expect(titles).toMatch(/Ghost Party: TDS in books but deductor not in 26AS/);
    expect(titles).toMatch(/deposited less/);
  });
});
