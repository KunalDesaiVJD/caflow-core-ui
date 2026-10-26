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
import { parseWorkbookRows, parseCsvRows, type ParseProgress, type ImportScope } from "@/lib/tdsWorkbook";
import { decryptOfficeFile, WrongPasswordError } from "@/lib/officeDecrypt";

type ParseRequest =
  | { id: number; fileType: "xlsx"; buffer: ArrayBuffer; password?: string; scope?: ImportScope }
  | { id: number; fileType: "csv"; text: string };

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const req = e.data;
  const w = self as unknown as Worker;
  const onProgress = (p: ParseProgress) => w.postMessage({ id: req.id, type: "progress", ...p });
  try {
    // A password-protected workbook is decrypted here, off the main thread
    // (the key derivation is ~1 s of hashing).
    let buffer = req.fileType === "xlsx" ? req.buffer : null;
    if (req.fileType === "xlsx" && req.password != null) {
      onProgress({ stage: "decrypting" });
      buffer = await decryptOfficeFile(req.buffer, req.password);
    }
    const rows = req.fileType === "xlsx"
      ? parseWorkbookRows(buffer!, onProgress, req.scope)
      : parseCsvRows(req.text, onProgress);
    w.postMessage({ id: req.id, ok: true, rows });
  } catch (err) {
    w.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), wrongPassword: err instanceof WrongPasswordError });
  }
};
