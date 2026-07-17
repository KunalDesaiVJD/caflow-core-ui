/**
 * PDF → positioned text runs, for the Tally ledger parser.
 *
 * This is the ONLY I/O half of Stage-3's PDF import: it turns a File into the
 * {x, y, w, str} items that tallyPdf.ts reasons about. Keeping the two apart is
 * what lets the parser be unit-tested offline against real client PDFs without a
 * browser (see scratchpad/pdftest2.mjs — the parsed credits are checked against
 * each ledger's own printed total).
 *
 * pdfjs is imported DYNAMICALLY and its worker wired the same way
 * ScrutinyConnectorsPanel.tsx already does it, so the ~1MB engine stays out of the
 * main bundle and only loads when someone actually imports a ledger.
 */

import type { PdfTextItem } from "./tallyPdf";

let workerReady = false;

/** Extract every page's positioned text runs from a PDF file. */
export async function pdfToTextPages(file: File | ArrayBuffer): Promise<PdfTextItem[][]> {
  const pdfjs = await import("pdfjs-dist") as unknown as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (opts: unknown) => { promise: Promise<any> };
  };
  if (!workerReady) {
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    workerReady = true;
  }

  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const pages: PdfTextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(
      (tc.items as any[])
        .filter((i) => i?.str && String(i.str).trim())
        // transform[4]/[5] are the run's x/y on the page; width is its rendered
        // width — the parser needs the RIGHT edge (x + w) because Tally
        // right-aligns its figures.
        .map((i) => ({ x: i.transform[4] as number, y: i.transform[5] as number, w: (i.width as number) ?? 0, str: String(i.str) })),
    );
  }
  return pages;
}
