import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { extractAckFields, extractAckNumber } from "./ackPdf";

// jsdom (vitest's test environment for this repo) doesn't implement
// DOMMatrix, which pdfjs-dist's canvas module references at import time.
// Minimal stub, sufficient for text-only extraction (no rendering).
(globalThis as any).DOMMatrix ??= class {
  constructor(_init?: unknown) {}
};

// pdfText.ts is written for Vite's browser bundling (`?url` worker import),
// which vitest's transform can't resolve for a plain node-invoked script the
// same way. Import pdfjs-dist directly here instead — same library, same
// getTextContent() API pdfText.ts calls — to build the identical
// {x,y,w,str}[] shape, then hand it to the REAL parsing logic under test
// (extractAckFields / extractAckNumber) unmodified.
import * as pdfjsLib from "pdfjs-dist";
import type { PdfTextItem } from "./tallyPdf";

async function pdfToTextPagesForTest(arrayBuffer: ArrayBuffer): Promise<PdfTextItem[][]> {
  const doc = await (pdfjsLib as any).getDocument({ data: new Uint8Array(arrayBuffer), useSystemFonts: true }).promise;
  const pages: PdfTextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(
      (tc.items as any[])
        .filter((i) => i?.str && String(i.str).trim())
        .map((i) => ({ x: i.transform[4] as number, y: i.transform[5] as number, w: (i.width as number) ?? 0, str: String(i.str) })),
    );
  }
  return pages;
}

describe("REAL PDF manual verification (temporary, not part of suite)", () => {
  it("extracts fields from the real Form 24Q ack PDF on Desktop", async () => {
    const buf = readFileSync("C:/Users/Admin/OneDrive/Desktop/Form 24Q_ARN_770000388680821.pdf");
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const pages = await pdfToTextPages(arrayBuffer);
    console.log("PAGE COUNT:", pages.length);
    pages.forEach((items, idx) => {
      console.log(`--- PAGE ${idx} raw items (${items.length}) ---`);
      items.forEach((it) => console.log(`  x=${it.x.toFixed(1)} y=${it.y.toFixed(1)} str=${JSON.stringify(it.str)}`));
    });
    const fields = extractAckFields(pages);
    console.log("EXTRACTED FIELDS:", JSON.stringify(fields, null, 2));
    console.log("ACK NUMBER (direct fn):", extractAckNumber(pages));
  });
});
