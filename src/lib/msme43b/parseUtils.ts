// Shared parsing helpers for the MSME 43B(h) ledger parsers.

/** Parse an Indian-grouped number like "18,76,200.00" or "82600.00C". */
export function parseAmount(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** True if the token looks like a monetary amount. */
export function isAmountToken(s: string): boolean {
  return /^-?[\d,]+\.\d{2}[A-Za-z.]*$/.test(s.trim()) || /^-?[\d,]{1,}\.\d{2}$/.test(s.trim());
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date in the two formats seen in the samples:
 *   Tally  : "1-Apr-25", "31-Mar-26"
 *   Expert : "01/04/2025"
 * Returns ISO yyyy-mm-dd or null.
 */
export function parseLedgerDate(s: string): string | null {
  const str = s.trim();
  let m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase()];
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (!mon) return null;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (mon < 1 || mon > 12) return null;
    return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/** Leading date of a line, if any. */
export function leadingDate(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/);
  return m ? parseLedgerDate(m[1]) : null;
}

/** Financial-year label from an ISO period-start date, e.g. 2025-04-01 → "2025-26". */
export function fyFromStart(iso: string): string {
  const y = parseInt(iso.slice(0, 4), 10);
  const end = (y + 1) % 100;
  return `${y}-${String(end).padStart(2, '0')}`;
}
