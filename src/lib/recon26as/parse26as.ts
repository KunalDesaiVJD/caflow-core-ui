// Form 26AS readers.
//
// Three routes, tried in this order by the page:
//   1. the TRACES "Text" download (caret-separated) — exact, preferred;
//      the same structure also arrives when that file is opened in Excel;
//   2. the TRACES PDF, read line by line from its text layer;
//   3. a flat table (one row per entry, deductor on every row).
// Anything none of these can read goes to the AI reader.
//
// TRACES prints each deductor's totals above its line items. That printed
// total is used as an oracle: a deductor whose lines do not add up to it is
// reported, so a misread never passes quietly.

import type { ExcludedRow, ParseResult, TdsEntry } from './types';
import { parseAmount, parseDate, round2, TAN_RE, PAN_RE } from './parseUtils';
import { findHeader, type Row } from './tabular';

/** Parts of 26AS that carry TDS on the assessee's receipts. */
const TDS_PARTS = new Set(['I', 'II', 'III']);

const str = (c: unknown) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').trim());
const isSection = (s: string) => /^(19\d|206)[0-9A-Z()\-/]*$/i.test(s.replace(/\s+/g, ''));
const isDateLike = (s: string) => /^\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}$/.test(s) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s);

function partOf(cells: string[]): string | null {
  const first = cells.find((c) => c);
  if (!first) return null;
  const m = first.match(/^PART[\s\-–]*([IVX]+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function checkTotals(entries: TdsEntry[], printed: Record<string, number>, warnings: string[]) {
  const sums: Record<string, number> = {};
  for (const e of entries) {
    const k = e.tan || e.party;
    sums[k] = (sums[k] || 0) + e.tds;
  }
  for (const [k, total] of Object.entries(printed)) {
    const got = round2(sums[k] || 0);
    if (Math.abs(got - total) > 1) {
      warnings.push(`${k}: line items add to ₹${got.toLocaleString('en-IN')} but 26AS prints a total of ₹${total.toLocaleString('en-IN')} — some lines may not have been read.`);
    }
  }
}

/**
 * TRACES structure: deductor header rows (Sr, Name, TAN, …totals) each
 * followed by line rows (blank, Sr, Section, Txn date, Status, Booking date,
 * Remarks, Amount paid, Tax deducted, TDS deposited).
 */
export function parse26asTraces(rows: Row[], file: string): ParseResult | null {
  const entries: TdsEntry[] = [];
  const excluded: ExcludedRow[] = [];
  const warnings: string[] = [];
  const printed: Record<string, number> = {};
  const assessee: ParseResult['assessee'] = {};
  let part: string | null = null;
  let deductor: { name: string; tan: string } | null = null;
  let headerLabels: string[] | null = null;
  let seenDeductor = false;
  const skippedParts = new Set<string>();

  for (const raw of rows) {
    const cells = raw.map(str);
    if (!cells.some(Boolean)) continue;

    // assessee header: a label row, then its values
    if (cells.some((c) => /name of assessee/i.test(c))) { headerLabels = cells; continue; }
    if (headerLabels) {
      headerLabels.forEach((label, i) => {
        if (/name of assessee/i.test(label)) assessee.name = cells[i] || assessee.name;
        if (/permanent account number|^pan$/i.test(label) && PAN_RE.test(cells[i] || '')) assessee.pan = cells[i];
        if (/financial year/i.test(label)) assessee.fy = cells[i] || assessee.fy;
      });
      headerLabels = null;
      continue;
    }

    const p = partOf(cells);
    if (p) { part = p; deductor = null; continue; }
    if (part && !TDS_PARTS.has(part)) { skippedParts.add(part); continue; }

    const tanIdx = cells.findIndex((c) => TAN_RE.test(c));
    const firstIdx = cells.findIndex(Boolean);
    const firstIsSr = /^\d+$/.test(cells[firstIdx] || '');

    // deductor header row
    if (tanIdx > 0 && firstIsSr) {
      let nameIdx = tanIdx - 1;
      while (nameIdx > firstIdx && !cells[nameIdx]) nameIdx--;
      const name = nameIdx > firstIdx ? cells[nameIdx] : '';
      deductor = { name, tan: cells[tanIdx] };
      seenDeductor = true;
      const nums = cells.slice(tanIdx + 1).map(parseAmount).filter((n): n is number => n !== null);
      if (nums.length >= 2) printed[deductor.tan] = round2(nums.length >= 3 ? nums[nums.length - 2] : nums[nums.length - 1]);
      continue;
    }

    // line row
    const dateIdx = cells.findIndex((c) => isDateLike(c));
    const secIdx = cells.findIndex((c, i) => i < (dateIdx < 0 ? cells.length : dateIdx) && isSection(c));
    if (deductor && dateIdx > 0 && secIdx >= 0) {
      let lastDate = dateIdx;
      cells.forEach((c, i) => { if (i > dateIdx && isDateLike(c)) lastDate = i; });
      const nums = cells.slice(lastDate + 1).map(parseAmount).filter((n): n is number => n !== null);
      if (nums.length < 2) {
        excluded.push({ file, text: cells.filter(Boolean).join(' | '), reason: 'line without amounts' });
        continue;
      }
      const [paid, deducted, deposited] = nums.length >= 3 ? nums.slice(-3) : [undefined, nums[nums.length - 2], nums[nums.length - 1]];
      const status = cells.slice(dateIdx + 1, lastDate + 1).find((c) => /^[FUPOM]$/.test(c));
      const remarks = cells.slice(dateIdx + 1, lastDate + 1).find((c) => c && !/^[FUPOM]$/.test(c) && !isDateLike(c) && c !== '-');
      entries.push({
        id: '',
        side: '26as',
        party: deductor.name,
        tan: deductor.tan,
        section: cells[secIdx],
        date: parseDate(cells[dateIdx]),
        amountPaid: paid,
        tds: round2(deducted ?? 0),
        tdsDeposited: deposited,
        bookingStatus: status,
        ref: [part && part !== 'I' ? `Part ${part}` : '', remarks || ''].filter(Boolean).join(' · ') || undefined,
        file,
      });
    }
  }

  if (!seenDeductor) return null;
  if (skippedParts.size) {
    warnings.push(`Parts ${[...skippedParts].sort().join(', ')} of 26AS (TCS, tax paid, refunds, property/SFT details) are not TDS on receipts and were not reconciled.`);
  }
  checkTotals(entries, printed, warnings);
  return { entries, excluded, warnings, method: 'traces-text', assessee, printedTotals: printed };
}

const AMT = String.raw`(-?[\d,]+\.\d{2})`;
const DEDUCTOR_LINE = new RegExp(String.raw`^(\d+)\s+(.+?)\s+([A-Z]{4}\d{5}[A-Z])\s+${AMT}\s+${AMT}\s+${AMT}\s*$`);
const ENTRY_LINE = new RegExp(
  String.raw`^(\d+)\s+(\S+)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+([FUPOM])\s+(\d{1,2}-[A-Za-z]{3}-\d{4})?\s*(.*?)\s*${AMT}\s+${AMT}\s+${AMT}\s*$`,
);

/** The TRACES PDF, from its text layer — one string per printed line. */
export function parse26asPdfLines(lines: string[], file: string): ParseResult | null {
  const entries: TdsEntry[] = [];
  const warnings: string[] = [];
  const printed: Record<string, number> = {};
  let part: string | null = null;
  let deductor: { name: string; tan: string } | null = null;
  const assessee: ParseResult['assessee'] = {};

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const pm = line.match(/^PART[\s\-–]*([IVX]+)\b/i);
    if (pm) { part = pm[1].toUpperCase(); deductor = null; continue; }
    if (!assessee.pan) {
      const pan = line.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
      if (pan && /permanent account number|pan/i.test(line)) assessee.pan = pan[1];
    }
    if (part && !TDS_PARTS.has(part)) continue;
    const d = line.match(DEDUCTOR_LINE);
    if (d) {
      deductor = { name: d[2].trim(), tan: d[3] };
      printed[d[3]] = round2(parseAmount(d[5]) ?? 0);
      continue;
    }
    const e = line.match(ENTRY_LINE);
    if (e && deductor && isSection(e[2])) {
      entries.push({
        id: '',
        side: '26as',
        party: deductor.name,
        tan: deductor.tan,
        section: e[2],
        date: parseDate(e[3]),
        amountPaid: parseAmount(e[7]) ?? undefined,
        tds: round2(parseAmount(e[8]) ?? 0),
        tdsDeposited: parseAmount(e[9]) ?? undefined,
        bookingStatus: e[4],
        ref: [part && part !== 'I' ? `Part ${part}` : '', e[6] && e[6] !== '-' ? e[6] : ''].filter(Boolean).join(' · ') || undefined,
        file,
      });
    }
  }
  if (!entries.length) return null;
  checkTotals(entries, printed, warnings);
  return { entries, excluded: [], warnings, method: 'traces-pdf', assessee, printedTotals: printed };
}

/** One row per entry, deductor repeated on each row. */
export function parse26asFlat(rows: Row[], file: string): ParseResult | null {
  const h = findHeader(rows);
  if (!h || h.map.tds === undefined) return null;
  const { map } = h;
  const entries: TdsEntry[] = [];
  const excluded: ExcludedRow[] = [];
  for (const r of rows.slice(h.index + 1)) {
    const party = str(r[map.party!]);
    const tds = parseAmount(r[map.tds!]);
    if (!party || tds === null) {
      if (r.some((c) => str(c))) excluded.push({ file, text: r.map(str).filter(Boolean).join(' | '), reason: 'no deductor or TDS amount' });
      continue;
    }
    if (/^(sub ?)?total|grand total/i.test(party)) { excluded.push({ file, text: party, reason: 'total row' }); continue; }
    const tan = map.tan !== undefined ? str(r[map.tan]).toUpperCase() : '';
    entries.push({
      id: '',
      side: '26as',
      party,
      tan: TAN_RE.test(tan) ? tan : undefined,
      section: map.section !== undefined ? str(r[map.section]) || undefined : undefined,
      date: parseDate(r[map.date!]),
      amountPaid: map.amount !== undefined ? parseAmount(r[map.amount]) ?? undefined : undefined,
      tds: round2(tds),
      tdsDeposited: map.deposited !== undefined ? parseAmount(r[map.deposited]) ?? undefined : undefined,
      bookingStatus: map.status !== undefined ? str(r[map.status]) || undefined : undefined,
      file,
    });
  }
  if (!entries.length) return null;
  return { entries, excluded, warnings: [], method: 'tabular' };
}

/** Text file: caret-separated TRACES download, or tab/comma separated. */
export function textToRows(text: string): Row[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const sep = text.includes('^') ? '^' : text.includes('\t') ? '\t' : null;
  if (sep) return lines.map((l) => l.split(sep));
  return lines.map((l) => [l]);
}
