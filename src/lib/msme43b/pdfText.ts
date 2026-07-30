// MSME 43B(h) Analyser — PDF text extraction (browser side).
//
// Isolates the pdfjs-dist dependency. The pure parsers operate on the
// TextLine[][] structure produced here, so they can be unit-tested and run in a
// Node validation harness without pdfjs in the loop.

import type { TextToken, TextLine } from './types';

/**
 * WHY THE LEGACY BUILD, NOT THE DEFAULT ONE.
 *
 * pdfjs v6's default worker calls `Uint8Array.prototype.toHex()` while OPENING a
 * document (pdf.worker.mjs: `[hashOriginal.toHex(), hashModified?.toHex()]` in the
 * `fingerprints` getter). That method is a 2025 addition to JavaScript — Chrome
 * 140+, Firefox 133+, Safari 18.4+. On anything older, getDocument() dies with
 * "a.toHex is not a function" before a single page is read, and every PDF feature
 * in this app fails with it.
 *
 * The default build carries no fallback. The LEGACY build ships a guarded
 * polyfill for exactly this, so it works on both old and new browsers. The API is
 * identical; the only cost is a slightly larger bundle.
 *
 * This cost a firm most of a working day: the failure surfaced as "the PDF has no
 * text layer", so it looked like a scanned-document problem and was chased as one
 * through four rounds of fixes. Do not "modernise" these two specifiers without a
 * deliberate decision about the oldest browser the firm actually uses.
 */

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
 * A PRIVATE COPY of the caller's bytes.
 *
 * pdfjs TRANSFERS the buffer it is given to its worker thread, which DETACHES it
 * on this side: every later read of the caller's buffer then throws "Cannot
 * perform Construct on a detached ArrayBuffer". That bit a real upload — the
 * page count was taken first and the upload of the same buffer died immediately
 * after. Handing pdfjs a copy keeps the caller's buffer usable, and callers can
 * pass the same data to several functions here without thinking about it.
 */
export function ownedBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  return src.slice(); // slice() allocates a fresh buffer, unlike subarray()
}

/**
 * Convert a PDF (ArrayBuffer / Uint8Array) to pages of TextLines, in the browser.
 * The pdfjs worker must be configured once at app start (see setupPdfWorker).
 */
export async function pdfToLines(data: ArrayBuffer | Uint8Array): Promise<TextLine[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as typeof import('pdfjs-dist');
  await setupPdfWorker(pdfjs);
  const bytes = ownedBytes(data);
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

/**
 * Page count plus the plain text of every page, in reading order.
 *
 * Used to handle a MERGED export — one PDF holding every vendor's ledger. Such a
 * file is far too large for one model call: the reply would be truncated
 * mid-JSON and thrown away. Splitting it into page ranges needs the text, and
 * pdfjs can read a PDF even though it cannot write one.
 */
export async function pdfPageTexts(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  const pages = await pdfToLines(data);
  return pages.map((lines) => lines.map((l) => l.text).join('\n'));
}

/**
 * Render the given 1-based page numbers to base64 JPEGs.
 *
 * A SCANNED ledger has no text layer, so it can only be read as an image. Before
 * this, such a file had to go to the model whole — one call for the entire
 * document — which overflows on anything sizeable and cannot be split, so the
 * only advice was "go and split the PDF yourself". Rendering page by page makes a
 * scan chunkable on exactly the same terms as a text PDF.
 *
 * JPEG, not PNG: a scanned page as PNG is several times larger, base64 adds
 * another third on top, and the tax figures stay perfectly legible at q=0.85.
 * TARGET_WIDTH is what decides whether small print survives — 1600px is about
 * 200 DPI for A4, which reads a Tally ledger reliably.
 */
const TARGET_WIDTH = 1600;

export async function pdfPageImages(
  data: ArrayBuffer | Uint8Array,
  pageNumbers: number[],
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as typeof import('pdfjs-dist');
  await setupPdfWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({ data: ownedBytes(data) });
  const out: string[] = [];
  try {
    const doc = await loadingTask.promise;
    for (const n of pageNumbers) {
      if (n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, TARGET_WIDTH / unit.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2D canvas context to render the PDF page.');
      // A scan is opaque, but a PDF page can be transparent, and transparent
      // pixels flatten to BLACK in a JPEG — which would hide the whole ledger.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      out.push(canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, ''));
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await loadingTask.destroy();
  }
  return out;
}

/** Cheap page count without pulling the text of every page. */
export async function pdfPageCount(data: ArrayBuffer | Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as typeof import('pdfjs-dist');
  await setupPdfWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({ data: ownedBytes(data) });
  try {
    const doc = await loadingTask.promise;
    return doc.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

let workerReady = false;
async function setupPdfWorker(pdfjs: typeof import('pdfjs-dist')): Promise<void> {
  if (workerReady) return;
  // Vite resolves the worker asset URL at build time.
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  workerReady = true;
}
