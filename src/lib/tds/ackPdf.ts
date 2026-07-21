/**
 * Extract the e-Filing Acknowledgement Number from a TRACES/income-tax
 * e-filing "Acknowledgement Receipt" PDF (the receipt generated for every
 * TDS quarterly return upload). Same I/O split as pdfText.ts/tallyPdf.ts:
 * the pure parse below is unit-tested against real receipts' text runs
 * without needing pdf.js or a browser.
 *
 * The receipt's fixed government template prints two distinct 15-digit
 * numbers — "e-Filing Acknowledgement Number" and "RRR Number" — so the
 * match must anchor on the "Acknowledgement Number" label specifically,
 * not just grab the first long digit run on the page.
 */

import { pdfToTextPages } from "./pdfText";
import type { PdfTextItem } from "./tallyPdf";

const ACK_NUMBER_RE = /Acknowledg(?:e)?ments?\s+Number[^\d]{0,80}(\d{9,20})\b/i;

/** Pure parse: find the acknowledgement number in already-extracted text runs. */
export function extractAckNumber(pages: PdfTextItem[][]): string | null {
  const text = pages.flat().map((i) => i.str).join(" ");
  return text.match(ACK_NUMBER_RE)?.[1] ?? null;
}

/** Convenience wrapper: read a PDF File and return its acknowledgement number. */
export async function extractAckNumberFromFile(file: File): Promise<string | null> {
  const pages = await pdfToTextPages(file);
  return extractAckNumber(pages);
}
