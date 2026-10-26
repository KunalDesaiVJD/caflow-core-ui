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
import { extractWorkbookRows, extractSheetRows, gridToRows, isTwoSheetTemplate, joinChallanTemplate, isChallanBlockTemplate, explodeChallanBlockTemplate, quarterlyFormSheets, extractQuarterlyFormRows } from "@/lib/tdsImportParsing";

const MAX_ROWS = 50000;   // hard ceiling on rows processed per sheet
const MAX_COLS = 100;     // hard ceiling on columns processed per sheet

const perfNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export type ParseProgress = { stage: string; sheet?: number; totalSheets?: number; rows?: number; elapsedMs?: number };
/** The filing being imported into, so a workbook holding every form/quarter
 * can be narrowed to the one being validated. */
export type ImportScope = { form?: string | null; quarter?: string | null };

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
      // Fill VERTICAL merged ranges only (bounded to the real extent): copy a
      // merge's top-left value DOWN into the rows it covers. Total/subtotal/month
      // rows are filtered downstream BEFORE the PAN test, so this can't resurrect
      // them.
      //
      // Only a single-column, multi-row merge is propagated — that is a genuine
      // per-row datum (a Name/PAN/Section merged down its block, whose value
      // belongs to every covered data row). A merge that spans COLUMNS is always
      // a label/banner: a title across the sheet, a "DEDUCTEE DETAILS" /
      // "CHALLAN DETAILS" section header, or a month label. Filling those across
      // columns injects the label into every cell of the row, which turns
      // mid-sheet label rows into fake header rows and mis-aligns the real data
      // (SWASTIK "FORMETS" lost every party's amount / TDS / date this way — the
      // whole return came back with blank imported columns). Skip them.
      const merges = (ws["!merges"] || []) as XLSX.Range[];
      for (const m of merges) {
        if (m.s.c !== m.e.c || m.e.r <= m.s.r) continue; // vertical merges only
        if (m.s.r > range.e.r || m.s.c > range.e.c) continue;
        const er = Math.min(m.e.r, range.e.r), ec = Math.min(m.e.c, range.e.c);
        // Defensive: skip a merge covering a huge area. trueRange already bounds
        // er/ec to real data, but a stray whole-column merge over empty space
        // still carries no value worth propagating and would cost a lot of
        // writes — a genuine label/section merge is small.
        if ((er - m.s.r + 1) * (ec - m.s.c + 1) > 100_000) continue;
        const anchor = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })] as XLSX.CellObject | undefined;
        if (!anchor || anchor.v == null) continue;
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
export function parseWorkbookRows(buffer: ArrayBuffer, onProgress?: (p: ParseProgress) => void, scope?: ImportScope): Record<string, unknown>[] {
  const t0 = perfNow();
  onProgress?.({ stage: "reading", elapsedMs: 0 });
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const tRead = perfNow();
  const gridOf = makeGridOf(wb);

  // The official two-sheet TDS import template ("Challan Details" + "TDS
  // Entries") splits challan-level fields onto a sheet separate from the
  // deductee-transaction rows, joined by a shared "Challan ID" — a shape
  // extractWorkbookRows (one independent section per sheet) isn't built for.
  // Detect it FIRST, by exact tab name only, so an ordinary multi-sheet client
  // file (handled below) is never affected; anything that doesn't match this
  // exact template falls through to the existing behaviour unchanged.
  const twoSheet = isTwoSheetTemplate(wb.SheetNames);
  if (twoSheet) {
    onProgress?.({ stage: "sheets", totalSheets: 2, elapsedMs: Math.round(tRead - t0) });
    const challanRows = gridToRows(gridOf(twoSheet.challanSheet));
    const entryRows = gridToRows(gridOf(twoSheet.entriesSheet));
    const rows = joinChallanTemplate(challanRows, entryRows);
    const tEnd = perfNow();
    try { console.debug(`[tds-import] read ${Math.round(tRead - t0)}ms · extract ${Math.round(tEnd - tRead)}ms · ${rows.length} rows · 2 sheet(s) (two-sheet template)`); } catch { /* ignore */ }
    onProgress?.({ stage: "extracted", rows: rows.length, elapsedMs: Math.round(tEnd - t0) });
    return rows;
  }

  // The official single-sheet, challan-grouped template ("TDS Data"): every
  // row tagged Challan/Entry via a Row Type column, entries listed under
  // their challan. Detected FIRST, by exact tab name only, same as above.
  const challanBlockSheet = isChallanBlockTemplate(wb.SheetNames);
  if (challanBlockSheet) {
    onProgress?.({ stage: "sheets", totalSheets: 1, elapsedMs: Math.round(tRead - t0) });
    const rawRows = gridToRows(gridOf(challanBlockSheet));
    const rows = explodeChallanBlockTemplate(rawRows);
    const tEnd = perfNow();
    try { console.debug(`[tds-import] read ${Math.round(tRead - t0)}ms · extract ${Math.round(tEnd - tRead)}ms · ${rows.length} rows · 1 sheet(s) (challan-grouped template)`); } catch { /* ignore */ }
    onProgress?.({ stage: "extracted", rows: rows.length, elapsedMs: Math.round(tEnd - t0) });
    return rows;
  }

  // The firm's quarterly workbook (Challan Master + "24Q Q1" … "26Q Q4"):
  // read by exact column name from RAW cell values, narrowed to this filing.
  const formSheets = quarterlyFormSheets(wb.SheetNames);
  if (formSheets) {
    onProgress?.({ stage: "sheets", totalSheets: formSheets.length, elapsedMs: Math.round(tRead - t0) });
    const rawGridOf = (sn: string): unknown[][] => {
      const ws = wb.Sheets[sn];
      const range = ws ? trueRange(ws) : null;
      return ws && range ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, range }) as unknown[][] : [];
    };
    const rows = extractQuarterlyFormRows(formSheets, rawGridOf, scope);
    const tEnd = perfNow();
    try { console.debug(`[tds-import] read ${Math.round(tRead - t0)}ms · extract ${Math.round(tEnd - tRead)}ms · ${rows.length} rows (quarterly 24Q/26Q workbook${scope?.form ? `, ${scope.form} ${scope.quarter ?? ""}` : ""})`); } catch { /* ignore */ }
    onProgress?.({ stage: "extracted", rows: rows.length, elapsedMs: Math.round(tEnd - t0) });
    return rows;
  }

  const names = visibleSheetNames(wb);
  onProgress?.({ stage: "sheets", totalSheets: names.length, elapsedMs: Math.round(tRead - t0) });
  let rows = extractWorkbookRows(names, gridOf, (sheet) => onProgress?.({ stage: "extracting", sheet, totalSheets: names.length, elapsedMs: Math.round(perfNow() - t0) }));
  // If hidden-sheet filtering removed the only data, retry including hidden —
  // REUSE the same gridOf so already-parsed visible sheets come from the cache.
  if (!rows.length && names.length !== wb.SheetNames.length) {
    rows = extractWorkbookRows(wb.SheetNames, gridOf);
  }
  const tEnd = perfNow();
  // Per-stage timing to the console for diagnosing a slow file in the field.
  try { console.debug(`[tds-import] read ${Math.round(tRead - t0)}ms · extract ${Math.round(tEnd - tRead)}ms · ${rows.length} rows · ${names.length} sheet(s)`); } catch { /* ignore */ }
  onProgress?.({ stage: "extracted", rows: rows.length, elapsedMs: Math.round(tEnd - t0) });
  return rows;
}

/**
 * Read every VISIBLE sheet of an .xlsx/.xls ArrayBuffer to a raw grid (array of
 * rows), using the SAME anti-freeze machinery as the deductee importer: the TRUE
 * used range (never the bloated !ref), merged-cell fill, hidden-sheet handling and
 * per-sheet memoisation. Callers that do their own header/column detection on the
 * grid (e.g. Stage-2 TRACES PAN parsing) reuse this so they can NEVER freeze the
 * tab on a bloated-!ref file — the exact hang Stage 1 fixed.
 */
export function readSheetGrids(buffer: ArrayBuffer): { name: string; grid: unknown[][] }[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const gridOf = makeGridOf(wb);
  let names = visibleSheetNames(wb);
  let out = names.map((name) => ({ name, grid: gridOf(name) }));
  // If hidden-sheet filtering left nothing with data, retry including hidden.
  if (!out.some((s) => s.grid.length) && names.length !== wb.SheetNames.length) {
    out = wb.SheetNames.map((name) => ({ name, grid: gridOf(name) }));
  }
  return out;
}

/** Read delimited text (CSV / tab / TRACES .txt) into a single raw grid, shaped
 * like readSheetGrids so the SAME grid-based extractors work on it. Auto-detects
 * the delimiter (comma / tab / pipe). */
export function readDelimitedGrid(text: string): { name: string; grid: unknown[][] }[] {
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  return [{ name: "text", grid: (parsed.data as unknown[][]) || [] }];
}

/** Parse CSV text into keyed deductee rows. */
export function parseCsvRows(text: string, onProgress?: (p: ParseProgress) => void): Record<string, unknown>[] {
  onProgress?.({ stage: "reading" });
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
  const rows = extractSheetRows((parsed.data as unknown[][]) || [], null);
  onProgress?.({ stage: "extracted", rows: rows.length });
  return rows;
}
