// MSME 43B(h) Analyser — PDF text extraction (browser side).
//
// Isolates the pdfjs-dist dependency. The pure parsers operate on the
// TextLine[][] structure produced here, so they can be unit-tested and run in a
// Node validation harness without pdfjs in the loop.

import type { TextToken, TextLine } from './types';

export interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Group raw positioned text items into physical lines (top-to-bottom), with
 * tokens ordered left-to-right. Pure — shared by browser and the Node harness.
 */
export function linesFromItems(items: RawItem[], yTolerance = 3): TextLine[] {
  const toks: TextToken[] = items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => ({ x: it.x, x1: it.x + it.width, y: it.y, text: it.str.trim() }));

  // Cluster by y (PDF y grows upward). Larger y = higher on the page.
  toks.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextLine[] = [];
  for (const t of toks) {
    let line = lines.find((l) => Math.abs(l.y - t.y) <= yTolerance);
    if (!line) {
      line = { y: t.y, tokens: [], text: '' };
      lines.push(line);
    }
    line.tokens.push(t);
  }
  for (const l of lines) {
    l.tokens.sort((a, b) => a.x - b.x);
    l.text = l.tokens.map((t) => t.text).join(' ');
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/**
 * Convert a PDF (ArrayBuffer / Uint8Array) to pages of TextLines, in the browser.
 * The pdfjs worker must be configured once at app start (see setupPdfWorker).
 */
export async function pdfToLines(data: ArrayBuffer | Uint8Array): Promise<TextLine[][]> {
  const pdfjs = await import('pdfjs-dist');
  await setupPdfWorker(pdfjs);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Keep the loading task: pdfjs v6's PDFDocumentProxy has no destroy(); cleanup
  // (worker teardown) lives on the loading task.
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  const pages: TextLine[][] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: RawItem[] = content.items
        .filter((it: unknown): it is { str: string; transform: number[]; width: number } =>
          typeof (it as { str?: unknown }).str === 'string')
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }));
      pages.push(linesFromItems(items));
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

let workerReady = false;
async function setupPdfWorker(pdfjs: typeof import('pdfjs-dist')): Promise<void> {
  if (workerReady) return;
  // Vite resolves the worker asset URL at build time.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  workerReady = true;
}
