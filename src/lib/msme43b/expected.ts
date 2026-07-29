// MSME 43B(h) — read the REVIEWER'S OWN working paper.
//
// When the preparer disagrees with the tool, they upload the working they
// believe is right. This module turns that file — an Excel/CSV working in
// whatever layout the firm uses, or a PDF — into a canonical set of per-vendor
// figures the calibrator can compare against.
//
// Excel/CSV is parsed deterministically here (column headers are found by
// synonym, the way the ledger parsers find columns by position). A PDF, or a
// spreadsheet whose headers we cannot identify, goes to Claude via the
// msme-calibrate edge function — the same any-format escape hatch the ledger
// reader uses, and subject to the same rule: nothing extracted is trusted
// silently, every row is echoed back in the diff for the preparer to eyeball.
//
// IMPORTANT: what comes out of here is compared with the engine's output. It is
// NEVER fed into the engine. See rules.ts, fence #4.

import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

export interface ExpectedVendorRow {
  vendorName: string;
  disallowedCY: number;
  allowedFY?: number;
  stillOutstanding?: number;
  /** anything the reviewer wrote against the line (their reason) */
  note?: string;
}

export interface ExpectedWorking {
  source: 'xlsx' | 'csv' | 'ai';
  fileName: string;
  rows: ExpectedVendorRow[];
  /** grand total as stated by the reviewer, when the sheet carries one */
  statedTotal?: number;
  /** columns we mapped, for display ("Party Name → vendor") */
  columnMap?: Record<string, string>;
  warnings: string[];
}

// Header synonyms. Deliberately generous — firms name these columns freely.
const COL_SYNONYMS: Array<{ field: keyof ExpectedVendorRow; keys: string[] }> = [
  { field: 'vendorName', keys: ['vendor', 'party', 'supplier', 'creditor', 'name of', 'particulars', 'account', 'ledger'] },
  { field: 'disallowedCY', keys: ['disallow', 'add back', 'addback', 'add-back', '43b', 'inadmissible', 'not allowed', 'dis allowed'] },
  { field: 'allowedFY', keys: ['allowed', 'allowable', 'paid in fy', 'paid next', 'deduction next', 'released'] },
  { field: 'stillOutstanding', keys: ['outstanding', 'unpaid', 'still due', 'balance', 'pending'] },
];

const TOTAL_WORDS = ['total', 'grand total', 'sum', 'net total'];

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Parse an Indian-format number cell: "1,23,456.78", "(1,234)" = negative, "₹ 500". */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /(^|\s)(cr|dr-)\s*$/i.test(s);
  s = s.replace(/[()₹rs.\s]/gi, (m) => (m === '.' ? '.' : '')).replace(/,/g, '');
  s = s.replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/**
 * Find the header row and map each canonical field to a column index.
 * A header row is one where a vendor-ish column AND a disallowance-ish column
 * are both present — the two figures the comparison actually needs.
 */
function findHeader(grid: unknown[][]): { rowIdx: number; map: Partial<Record<keyof ExpectedVendorRow, number>>; labels: Record<string, string> } | null {
  const limit = Math.min(grid.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = grid[r] || [];
    const map: Partial<Record<keyof ExpectedVendorRow, number>> = {};
    const labels: Record<string, string> = {};
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]);
      if (!cell) continue;
      for (const { field, keys } of COL_SYNONYMS) {
        if (map[field] !== undefined) continue;
        if (keys.some((k) => cell.includes(k))) {
          map[field] = c;
          labels[field] = String(row[c]);
          break;
        }
      }
    }
    if (map.vendorName !== undefined && map.disallowedCY !== undefined) return { rowIdx: r, map, labels };
  }
  return null;
}

function gridToWorking(grid: unknown[][], fileName: string, source: 'xlsx' | 'csv'): ExpectedWorking | null {
  const header = findHeader(grid);
  if (!header) return null;

  const { rowIdx, map, labels } = header;
  const rows: ExpectedVendorRow[] = [];
  const warnings: string[] = [];
  let statedTotal: number | undefined;

  for (let r = rowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = String(row[map.vendorName!] ?? '').trim();
    if (!name) continue;

    const disallowed = parseAmount(row[map.disallowedCY!]);

    // A "Total" line is the reviewer's own grand total, not a vendor.
    if (TOTAL_WORDS.includes(norm(name)) || norm(name).startsWith('total ')) {
      if (disallowed !== null) statedTotal = disallowed;
      continue;
    }
    if (disallowed === null) continue; // a blank/section row

    rows.push({
      vendorName: name,
      disallowedCY: disallowed,
      allowedFY: map.allowedFY !== undefined ? (parseAmount(row[map.allowedFY]) ?? undefined) : undefined,
      stillOutstanding: map.stillOutstanding !== undefined ? (parseAmount(row[map.stillOutstanding]) ?? undefined) : undefined,
    });
  }

  if (!rows.length) return null;

  if (statedTotal !== undefined) {
    const summed = rows.reduce((a, x) => a + x.disallowedCY, 0);
    if (Math.abs(summed - statedTotal) > 1) {
      warnings.push(
        `The sheet's stated total (₹${Math.round(statedTotal).toLocaleString('en-IN')}) does not equal the sum of its ` +
        `vendor rows (₹${Math.round(summed).toLocaleString('en-IN')}). Some rows may not have been read — check the mapping below.`,
      );
    }
  }

  return { source, fileName, rows, statedTotal, columnMap: labels, warnings };
}

/**
 * Ask Claude to read a working paper we could not map deterministically.
 * A PDF goes over as a document; a spreadsheet whose headers we could not
 * identify goes over as the text of its cells (Claude cannot open .xlsx).
 */
async function extractViaAI(file: File, payload: { base64?: string; text?: string }): Promise<ExpectedWorking> {
  const { data, error } = await supabase.functions.invoke('msme-calibrate', {
    body: {
      mode: 'extract-working',
      pdf_base64: payload.base64,
      text_content: payload.text,
      filename: file.name,
    },
  });
  if (error) throw new Error(error.message || 'Could not read the working paper.');
  if (data?.error) throw new Error(data.error);

  const raw = Array.isArray(data?.rows) ? data.rows : [];
  const rows: ExpectedVendorRow[] = raw
    .map((r: Record<string, unknown>) => ({
      vendorName: String(r.vendorName ?? '').trim(),
      disallowedCY: Number(r.disallowedCY) || 0,
      allowedFY: r.allowedFY === undefined || r.allowedFY === null || r.allowedFY === '' ? undefined : Number(r.allowedFY),
      stillOutstanding: r.stillOutstanding === undefined || r.stillOutstanding === null || r.stillOutstanding === '' ? undefined : Number(r.stillOutstanding),
      note: r.note ? String(r.note) : undefined,
    }))
    .filter((r: ExpectedVendorRow) => r.vendorName);

  const warnings: string[] = ['Read by Claude — check each row against your sheet before accepting any rule change.'];
  if (data?.truncated) warnings.push('The file was too large to read in one pass; some rows may be missing.');

  return {
    source: 'ai', fileName: file.name, rows,
    statedTotal: typeof data?.statedTotal === 'number' ? data.statedTotal : undefined,
    warnings,
  };
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Read the reviewer's working paper. Excel/CSV is mapped deterministically;
 * PDFs and unmappable sheets fall back to Claude.
 */
export async function parseExpectedWorking(file: File): Promise<ExpectedWorking> {
  const lower = file.name.toLowerCase();
  const isSheet = /\.(xlsx|xlsm|xls|csv|tsv)$/.test(lower);

  if (isSheet) {
    let csvFallback = '';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true });
        const parsed = gridToWorking(grid as unknown[][], file.name, lower.endsWith('.csv') || lower.endsWith('.tsv') ? 'csv' : 'xlsx');
        if (parsed) {
          if (wb.SheetNames.length > 1) parsed.warnings.push(`Read sheet "${sheetName}" of ${wb.SheetNames.length}.`);
          return parsed;
        }
        if (!csvFallback) csvFallback = XLSX.utils.sheet_to_csv(sheet).slice(0, 200_000);
      }
    } catch (e) {
      console.warn('Deterministic working-paper parse failed:', e);
    }
    // Headers we could not identify — hand the cells to Claude instead.
    if (csvFallback) return extractViaAI(file, { text: csvFallback });
  }

  return extractViaAI(file, { base64: await toBase64(file) });
}
