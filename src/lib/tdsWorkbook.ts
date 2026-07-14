/**
 * Workbook/CSV → keyed-row parsing for TDS client-file imports.
 *
 * Shared by the off-main-thread parser (src/workers/tdsImportParser.worker.ts)
 * and its main-thread fallback in TdsValidateFinalise, so the two never drift.
 * All of the audit-driven robustness lives here:
 *   • range clamp (20000×63)  — real files declare a bloated !ref with MILLIONS
 *                               of phantom cells; without the clamp sheet_to_json
 *                               iterates them for tens of seconds.
 *   • merged-cell fill        — propagate a merge range's anchor value into its
 *                               covered cells so vertically-merged Name/PAN/
 *                               Section/header cells don't come back null.
 *   • hidden-sheet skip       — ignore hidden / very-hidden tabs (stale backup /
 *                               pivot sheets) unless they hold the only data.
 *   • memoized gridOf         — parse each sheet at most once.
 */
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { extractWorkbookRows, extractSheetRows } from "@/lib/tdsImportParsing";

const MAX_ROWS = 20000;
const MAX_COLS = 63;

/** A per-workbook sheet→grid reader: clamps the range, fills merged cells, and
 * caches so each sheet is converted at most once. */
function makeGridOf(wb: XLSX.WorkBook): (name: string) => unknown[][] {
  const cache = new Map<string, unknown[][]>();
  return (sn: string): unknown[][] => {
    const hit = cache.get(sn);
    if (hit) return hit;
    const ws = wb.Sheets[sn] as XLSX.WorkSheet | undefined;
    let grid: unknown[][] = [];
    if (ws && ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      range.e.r = Math.min(range.e.r, MAX_ROWS);
      range.e.c = Math.min(range.e.c, MAX_COLS);

      // Fill merged ranges (clamped, so no phantom-cell blow-up): copy each
      // merge's top-left value into its covered cells. Total/subtotal/month rows
      // are filtered downstream BEFORE the PAN test, so this can't resurrect them.
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

/** Parse an .xlsx/.xls ArrayBuffer into keyed deductee rows (all visible sheets). */
export function parseWorkbookRows(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const names = visibleSheetNames(wb);
  let rows = extractWorkbookRows(names, makeGridOf(wb));
  // If hidden-sheet filtering removed the only data, retry including hidden.
  if (!rows.length && names.length !== wb.SheetNames.length) {
    rows = extractWorkbookRows(wb.SheetNames, makeGridOf(wb));
  }
  return rows;
}

/** Parse CSV text into keyed deductee rows. */
export function parseCsvRows(text: string): Record<string, unknown>[] {
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
  return extractSheetRows((parsed.data as unknown[][]) || [], null);
}
