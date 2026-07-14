/// <reference lib="webworker" />
/**
 * Off-main-thread parser for TDS client-file imports (Excel / CSV).
 *
 * WHY A WORKER: XLSX.read() is a single, indivisible SYNCHRONOUS call (ZIP
 * inflate + cell parse) and sheet_to_json walks every cell — for a large or
 * many-sheet workbook this blocks the UI thread for seconds and triggers
 * Chrome's "Page Unresponsive" dialog. Chunking/yielding cannot split
 * XLSX.read, so the only correct fix is to run the whole parse off the main
 * thread. The main thread stays responsive and just awaits the posted-back rows.
 *
 * The actual parse (range clamp, merged-cell fill, hidden-sheet skip) lives in
 * src/lib/tdsWorkbook.ts so the worker and its main-thread fallback share it.
 */
import { parseWorkbookRows, parseCsvRows } from "@/lib/tdsWorkbook";

type ParseRequest =
  | { id: number; fileType: "xlsx"; buffer: ArrayBuffer }
  | { id: number; fileType: "csv"; text: string };

type ParseResponse =
  | { id: number; ok: true; rows: Record<string, unknown>[] }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const req = e.data;
  const post = (r: ParseResponse) => (self as unknown as Worker).postMessage(r);
  try {
    const rows = req.fileType === "xlsx" ? parseWorkbookRows(req.buffer) : parseCsvRows(req.text);
    post({ id: req.id, ok: true, rows });
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
