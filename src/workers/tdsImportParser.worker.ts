/// <reference lib="webworker" />
/**
 * Off-main-thread parser for TDS client-file imports (Excel / CSV).
 *
 * WHY A WORKER: XLSX.read() is a single, indivisible SYNCHRONOUS call (ZIP
 * inflate + cell parse) and sheet_to_json walks every cell — for a large or
 * many-sheet workbook this blocks the UI thread for seconds and triggers
 * Chrome's "Page Unresponsive" dialog. Running it in a worker keeps the main
 * thread responsive; it just awaits the posted-back rows and forwards progress.
 *
 * The actual parse (true-extent range, merged-cell fill, hidden-sheet skip)
 * lives in src/lib/tdsWorkbook.ts so the worker and its main-thread fallback
 * share it. The worker posts {type:'progress'} messages so the UI shows a live
 * stage instead of a frozen "Reading file…", and the main thread runs a
 * stall-watchdog that terminates the worker if progress stops.
 */
import { parseWorkbookRows, parseCsvRows, type ParseProgress } from "@/lib/tdsWorkbook";

type ParseRequest =
  | { id: number; fileType: "xlsx"; buffer: ArrayBuffer }
  | { id: number; fileType: "csv"; text: string };

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const req = e.data;
  const w = self as unknown as Worker;
  const onProgress = (p: ParseProgress) => w.postMessage({ id: req.id, type: "progress", ...p });
  try {
    const rows = req.fileType === "xlsx"
      ? parseWorkbookRows(req.buffer, onProgress)
      : parseCsvRows(req.text, onProgress);
    w.postMessage({ id: req.id, ok: true, rows });
  } catch (err) {
    w.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
