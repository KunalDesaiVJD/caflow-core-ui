// Header-row detection for spreadsheet / CSV exports.
//
// A Tally export puts the company name, the ledger name and the period above
// the real header, and other software does the same with its own furniture, so
// the header is looked for in the first rows rather than assumed to be row 1.

export type Cell = string | number | Date | null | undefined;
export type Row = Cell[];

export type ColumnRole =
  | 'date' | 'party' | 'debit' | 'credit' | 'tds' | 'amount'
  | 'vchNo' | 'vchType' | 'narration' | 'tan' | 'section' | 'deposited' | 'status';

export type ColumnMap = Partial<Record<ColumnRole, number>>;

const PATTERNS: Array<[ColumnRole, RegExp]> = [
  // order matters: the first role to claim a column keeps it
  ['tan', /^tan\b|tan of deductor|deductor tan/],
  ['deposited', /deposited/],
  ['tds', /\btds\b|tax deducted|tds amount|tax amount/],
  ['status', /status of booking|booking status/],
  ['section', /^section|\bsection\b|\bsec\b/],
  ['date', /^date$|^dt\.?$|vch\.? date|voucher date|txn date|transaction date|bill date|invoice date|date of (payment|credit)|^date\b/],
  ['debit', /^debit|^dr\.?$|debit amount|dr\.? amount|^withdrawal/],
  ['credit', /^credit|^cr\.?$|credit amount|cr\.? amount|^deposit/],
  ['vchNo', /vch\.? no|voucher no|ref(erence)? no|bill no|invoice no|^ref\b/],
  ['vchType', /vch\.? type|voucher type/],
  ['narration', /narration|remark|description/],
  ['party', /particular|party|name of deductor|deductor|customer|^name\b|account name|ledger/],
  ['amount', /^amount$|amount paid|paid ?\/ ?credited|gross|bill amount|invoice (amount|value)|taxable|^value$|^amount\b/],
];

const norm = (c: Cell) => String(c ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function classifyHeader(row: Row): ColumnMap {
  const map: ColumnMap = {};
  const taken = new Set<number>();
  for (const [role, re] of PATTERNS) {
    if (map[role] !== undefined) continue;
    for (let i = 0; i < row.length; i++) {
      if (taken.has(i)) continue;
      const h = norm(row[i]);
      if (!h || h.length > 60) continue;
      if (re.test(h)) { map[role] = i; taken.add(i); break; }
    }
  }
  return map;
}

/**
 * Find the header row: the first row (of the first 40) that names a date
 * column, a party column and at least one amount column.
 */
export function findHeader(rows: Row[]): { index: number; map: ColumnMap } | null {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const map = classifyHeader(rows[i]);
    const hasAmount = map.debit !== undefined || map.credit !== undefined || map.tds !== undefined || map.amount !== undefined;
    if (map.date !== undefined && map.party !== undefined && hasAmount) return { index: i, map };
  }
  return null;
}

/** First rows as tab-separated text — what the AI column mapper is shown. */
export function rowsPreview(rows: Row[], n = 40): string {
  return rows.slice(0, n).map((r, i) => `${i}\t${r.map((c) => {
    if (c instanceof Date) return c.toISOString().slice(0, 10);
    return String(c ?? '').replace(/\s+/g, ' ').slice(0, 60);
  }).join('\t')}`).join('\n');
}
