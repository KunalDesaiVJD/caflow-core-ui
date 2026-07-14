/**
 * Workbook/CSV → keyed-row parsing for TDS client-file imports.
 *
 * Shared by the off-main-thread parser (src/workers/tdsImportParser.worker.ts)
 * and its main-thread fallback in TdsValidateFinalise, so the two never drift.
 * All of the audit-driven robustness + performance lives here:
 *   • TRUE data extent      — the used range is computed from the sheet's ACTUAL
 *                             cells, NOT the declared !ref. Real client files
 *                             routinely declare a bloated !ref (a stray
 *                             value/format inflates it to Excel's 1,048,576-row
 *                             max) so the old "clamp !ref to 20000 rows" still
 *                             scanned up to 20000 EMPTY rows per sheet — across
 *                             many sheets that was minutes of dead work and the
 *                             "Reading file…" hang. Using the real extent means a
 *                             300-row sheet costs 300 rows, not 20000.
 *   • merged-cell fill      — propagate a merge range's anchor value into its
 *                             covered cells so vertically-merged Name/PAN/Section
 *                             cells don't come back null (bounded to real extent).
 *   • hidden-sheet skip     — ignore hidden / very-hidden tabs unless only data.
 *   • memoized gridOf       — parse each sheet at most once.
 *   • onProgress callback    — reports stage + per-sheet progress so the UI shows
 *                             a live status instead of a frozen "Reading file…".
 */
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { extractWorkbookRows, extractSheetRows } from "@/lib/tdsImportParsing";

const MAX_ROWS = 50000;   // hard ceiling on rows processed per sheet
const MAX_COLS = 100;     // hard ceiling on columns processed per sheet

export type ParseProgress = { stage: string; sheet?: number; totalSheets?: number; rows?: number };

/**
 * The sheet's TRUE used range, derived from its actual cell addresses rather
 * than the (frequently bloated) declared !ref. Returns null for an empty sheet.
 * This is O(real cells), never O(declared range), so a sheet that claims a
 * million rows but holds 300 costs 300.
 */
function trueRange(ws: XLSX.WorkSheet): XLSX.Range | null {
  let maxR = -1, maxC = -1;
  for (const key in ws) {
    if (key.charCodeAt(0) === 33) continue; // skip "!ref", "!merges", "!cols", …
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (maxR < 0) return null;
  return { s: { r: 0, c: 0 }, e: { r: Math.min(maxR, MAX_ROWS), c: Math.min(maxC, MAX_COLS) } };
}

/** A per-workbook sheet→grid reader: uses the TRUE extent, fills merged cells,
 * and caches so each sheet is converted at most once. */
function makeGridOf(wb: XLSX.WorkBook): (name: string) => unknown[][] {
  const cache = new Map<string, unknown[][]>();
  return (sn: string): unknown[][] => {
    const hit = cache.get(sn);
    if (hit) return hit;
    const ws = wb.Sheets[sn] as XLSX.WorkSheet | undefined;
    let grid: unknown[][] = [];
    const range = ws ? trueRange(ws) : null;
    if (ws && range) {
      // Fill merged ranges (bounded to the real extent): copy each merge's
      // top-left value into its covered cells. Total/subtotal/month rows are
      // filtered downstream BEFORE the PAN test, so this can't resurrect them.
      const merges = (ws["!merges"] || []) as XLSX.Range[];
      for (const m of merges) {
        if (m.s.r > range.e.r || m.s.c > range.e.c) continue;
        const anchor = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })] as XLSX.CellObject | undefined;
        if (!anchor || anchor.v == null) continue;
        const er = Math.min(m.e.r, range.e.r), ec = Math.min(m.e.c, range.e.c);
        for (let r = m.s.r; r <= er; r++) {
          for (let c = m.s.c; c <= ec; c++) {
            if (r === m.s.r && c === m.s.c) continue;
            ws[XLSX.utils.encode_cell({ r, c })] = { t: anchor.t, v: anchor.v, w: anchor.w } as XLSX.CellObject;
          }
        }
      }
      grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false, range }) as unknown[][];
    }
    cache.set(sn, grid);
    return grid;
  };
}

/** Sheet names that are NOT hidden / very-hidden (Workbook.Sheets[i].Hidden:
 * 0 visible, 1 hidden, 2 very hidden); falls back to all sheets if absent. */
function visibleSheetNames(wb: XLSX.WorkBook): string[] {
  const meta = wb.Workbook?.Sheets;
  if (!meta) return wb.SheetNames;
  const visible = wb.SheetNames.filter((_, i) => !meta[i] || !meta[i].Hidden);
  return visible.length ? visible : wb.SheetNames;
}

/** Parse an .xlsx/.xls ArrayBuffer into keyed deductee rows (all visible sheets),
 * reporting stage + per-sheet progress via onProgress. */
export function parseWorkbookRows(buffer: ArrayBuffer, onProgress?: (p: ParseProgress) => void): Record<string, unknown>[] {
  onProgress?.({ stage: "reading" });
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const names = visibleSheetNames(wb);
  onProgress?.({ stage: "sheets", totalSheets: names.length });
  const gridOf = makeGridOf(wb);
  let rows = extractWorkbookRows(names, gridOf, (sheet) => onProgress?.({ stage: "extracting", sheet, totalSheets: names.length }));
  // If hidden-sheet filtering removed the only data, retry including hidden.
  if (!rows.length && names.length !== wb.SheetNames.length) {
    rows = extractWorkbookRows(wb.SheetNames, makeGridOf(wb));
  }
  onProgress?.({ stage: "extracted", rows: rows.length });
  return rows;
}

/** Parse CSV text into keyed deductee rows. */
export function parseCsvRows(text: string, onProgress?: (p: ParseProgress) => void): Record<string, unknown>[] {
  onProgress?.({ stage: "reading" });
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
  const rows = extractSheetRows((parsed.data as unknown[][]) || [], null);
  onProgress?.({ stage: "extracted", rows: rows.length });
  return rows;
}
