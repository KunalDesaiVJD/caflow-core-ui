// Dates and amounts as Indian accounting exports print them.

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse a date cell. Day-first, as every Indian export is: 01/04/2025 is
 * 1 April. Accepts Date objects, Excel serials, ISO, d-Mon-yy(yy), d/m/y,
 * d-m-y and d.m.y.
 */
export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // xlsx cellDates gives local-midnight dates; read the local parts
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial (1900 system)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim().toUpperCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\s\-/.]+([A-Z]{3,4})[A-Z]*[\s\-/.,]+(\d{2,4})\b/);
  if (m && MONTHS[m[2]]) return iso(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/^([A-Z]{3,4})[A-Z]*[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})\b/);
  if (m && MONTHS[m[1]]) return iso(+m[3], MONTHS[m[1]], +m[2]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

/**
 * Parse an amount. Handles Indian grouping (1,23,456.00), brackets for
 * negatives, a trailing Dr / Cr, and a leading ₹ / Rs.
 */
export function parseAmount(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bCr\.?$/i.test(s)) { s = s.replace(/\bCr\.?$/i, ''); }
  s = s.replace(/\bDr\.?$/i, '').replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/,/g, '').trim();
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86400000);
}

/** "2025-26" for a date in that Indian financial year. */
export function fyOf(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const y = +isoDate.slice(0, 4), m = +isoDate.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** Calendar month key, "2025-04". */
export const monthOf = (isoDate: string | null) => (isoDate ? isoDate.slice(0, 7) : 'nodate');

/** TDS quarter key within the FY, "2025-26 Q1". */
export function quarterOf(isoDate: string | null): string {
  if (!isoDate) return 'nodate';
  const m = +isoDate.slice(5, 7);
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  return `${fyOf(isoDate)} Q${q}`;
}

export const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
