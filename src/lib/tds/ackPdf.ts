/**
 * Extract the e-Filing Acknowledgement Number from a TRACES/income-tax
 * e-filing "Acknowledgement Receipt" PDF (the receipt generated for every
 * TDS quarterly return upload). Same I/O split as pdfText.ts/tallyPdf.ts:
 * the pure parse below is unit-tested against real receipts' text runs
 * without needing pdf.js or a browser.
 *
 * The receipt's fixed government template prints two distinct 15-digit
 * numbers on the same page — "e-Filing Acknowledgement Number" and "RRR
 * Number" — so this CANNOT be a blind "find the first long digit run in the
 * page's text" scan: that silently returns the wrong number half the time.
 * pdf.js's getTextContent() also does not guarantee that its item order
 * matches visual reading order for a multi-column layout like this one (see
 * tallyPdf.ts's header comment for the same lesson learned the hard way on
 * Tally ledger PDFs). So this parses by POSITION, the same way tallyPdf.ts
 * does: group text runs into y-bands (visual rows), then walk bands
 * strictly downward from the Acknowledgement label's own row, bailing out
 * if the RRR Number label is reached before a qualifying value is found.
 */

import { pdfToTextPages } from "./pdfText";
import type { PdfTextItem } from "./tallyPdf";

const Y_TOL = 4; // px: lines this close vertically are one visual row
// Accept the spelled-out "Number"/"Numbers" AND the abbreviated "No"/"No."
// used on older TIN-NSDL/Protean e-TDS receipt templates for correction/
// revised returns of older quarters.
const ACK_LABEL_RE = /Acknowledg(?:e)?ments?\s+(?:Number|No\.?)/i;
const RRR_LABEL_RE = /\bRRR\b/i;
const DIGIT_RE = /^\d+$/;
const MAX_BAND_LOOKAHEAD = 3; // don't wander arbitrarily far from the label

function toBands(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y); // top of page first
  const bands: PdfTextItem[][] = [];
  for (const it of sorted) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= Y_TOL) last.push(it);
    else bands.push([it]);
  }
  for (const b of bands) b.sort((a, c) => a.x - c.x); // left to right
  return bands;
}

/** Merge adjacent all-digit items within a band into one token. pdf.js
 * sometimes emits one printed number as two or more separate text runs
 * (kerning/table-alignment artifacts) — two genuinely distinct numbers
 * never sit directly next to each other with no separating label or
 * punctuation on this receipt, so merging is safe. */
function mergeDigitRuns(band: PdfTextItem[]): string[] {
  const tokens: string[] = [];
  for (const it of band) {
    const s = it.str.trim();
    if (!s) continue;
    const prev = tokens[tokens.length - 1];
    if (prev !== undefined && DIGIT_RE.test(prev) && DIGIT_RE.test(s)) tokens[tokens.length - 1] = prev + s;
    else tokens.push(s);
  }
  return tokens;
}

/** Pure parse: find the acknowledgement number in already-extracted text runs. */
export function extractAckNumber(pages: PdfTextItem[][]): string | null {
  for (const items of pages) {
    const bands = toBands(items);
    const labelBandIdx = bands.findIndex((b) => ACK_LABEL_RE.test(b.map((i) => i.str).join(" ")));
    if (labelBandIdx === -1) continue;

    for (let i = labelBandIdx; i < bands.length && i <= labelBandIdx + MAX_BAND_LOOKAHEAD; i++) {
      if (i > labelBandIdx && RRR_LABEL_RE.test(bands[i].map((it) => it.str).join(" "))) return null; // hit RRR's row first
      const hit = mergeDigitRuns(bands[i]).find((t) => DIGIT_RE.test(t) && t.length >= 9 && t.length <= 20);
      if (hit) return hit;
    }
  }
  return null;
}

/** Convenience wrapper: read a PDF File and return its acknowledgement number. */
export async function extractAckNumberFromFile(file: File): Promise<string | null> {
  const pages = await pdfToTextPages(file);
  return extractAckNumber(pages);
}
