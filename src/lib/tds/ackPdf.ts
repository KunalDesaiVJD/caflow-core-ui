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

// ─── Cross-check fields (Name / Financial Year / Quarter / Form No. / TAN) ──
//
// Unlike the Ack No./RRR pair above, every one of these prints as a single
// "Label : Value" row on the real receipt (confirmed against a genuine Form
// 24Q acknowledgement's actual extracted text runs, top to bottom):
//
//   Name        : KWIKTEAM SUPPORT SERVICES PRIVATE LIMITED
//   PAN/TAN     : AHMK08204A
//   Form No.    : Form 24Q
//   Financial Year : 2025-26
//   Quarter     : Q4
//
// So no RRR-style lookahead/bail-out is needed here: find the band whose text
// starts with the label, then take whatever remains of THAT SAME band's text
// after the label and its ":" separator.
//
// IMPORTANT — a label word starting a line is NOT enough by itself. The
// "Form Description" field on the real receipt wraps across three lines, and
// its boilerplate third line reads (verbatim, lowercase, no colon anywhere
// near it):
//
//   quarter ended June/September/December/March (Financial year)
//
// A bare `/^Quarter\b/i` (or `/^Name\b/i`, `/^Financial\s+Year\b/i`, etc.)
// matches that prose line just as happily as the genuine "Quarter : Q4" row,
// and — because it's earlier on the page — wins first, handing back
// "ended June/September/December/March (Financial year)" as the "quarter".
// So every label pattern below requires the colon to appear immediately
// after the label (only whitespace in between): that's what actually makes a
// band a "label: value" row rather than a sentence that merely starts with
// the same word. Quarter additionally gets a value-shape check
// (`/^Q[1-4]$/i`) as a second, independent safety net — even if some future
// receipt template put a colon somewhere inside boilerplate prose, a
// resulting value that doesn't look like a real quarter code is rejected
// rather than accepted.

export interface AckFields {
  ackNumber: string | null;
  name: string | null;
  financialYear: string | null;
  quarter: string | null;
  /** Bare form code, e.g. "24Q" — the receipt's own "Form " prefix is stripped
   *  so this compares directly against tds_filings.tds_forms[0]. */
  formNo: string | null;
  tan: string | null;
}

// Each pattern requires the label to be followed (after only whitespace) by
// the ":" separator itself — NOT just `\b` — so a prose line that happens to
// start with the same word (e.g. the Form Description boilerplate's
// "quarter ended ...") can never qualify as a "label: value" row.
const NAME_LABEL_RE = /^Name\s*:\s*/i;
const FY_LABEL_RE = /^Financial\s+Year\s*:\s*/i;
const QUARTER_LABEL_RE = /^Quarter\s*:\s*/i;
const FORM_NO_LABEL_RE = /^Form\s+No\.?\s*:\s*/i;
const PAN_TAN_LABEL_RE = /^PAN\s*\/\s*TAN\s*:\s*/i;
// Safety net beyond the regex tightening above: a genuine Quarter value is
// always exactly Q1–Q4. If a matched band still produces anything else,
// something is wrong (e.g. an unforeseen boilerplate collision) and the
// value should be discarded rather than trusted.
const QUARTER_VALUE_RE = /^Q[1-4]$/i;

function bandText(band: PdfTextItem[]): string {
  return band.map((i) => i.str.trim()).filter(Boolean).join(" ");
}

/** Pull the value out of a "Label : Value" row. Returns null if the label
 * isn't found on this page, OR if it is but the printed value is blank/"-"
 * (several fields — Assessment Year, Month — are legitimately "-" on a
 * regular quarterly TDS receipt; nothing to report there), OR if a
 * `valuePattern` is given and the extracted value doesn't match it (an
 * additional shape check so a stray match never hands back garbage). */
function extractLabelledValue(bands: PdfTextItem[][], labelRe: RegExp, valuePattern?: RegExp): string | null {
  for (const band of bands) {
    const text = bandText(band);
    const m = labelRe.exec(text);
    if (!m) continue;
    const rest = text.slice(m.index + m[0].length).replace(/^\s*:\s*/, "").trim();
    if (!rest || rest === "-") return null;
    if (valuePattern && !valuePattern.test(rest)) return null;
    return rest;
  }
  return null;
}

/** Pure parse: extract every field this codebase cross-checks an attached ACK
 * PDF against, from already-extracted text runs. Accumulates across pages
 * (first hit per field wins) so a multi-page PDF with a cover page still
 * resolves correctly. Returns all-null fields (never throws) when the PDF has
 * no matching text layer at all — e.g. a scanned/image-only PDF — so callers
 * can treat "nothing extracted" as "nothing to cross-check" rather than an
 * error. */
export function extractAckFields(pages: PdfTextItem[][]): AckFields {
  let name: string | null = null;
  let financialYear: string | null = null;
  let quarter: string | null = null;
  let formNo: string | null = null;
  let tan: string | null = null;
  for (const items of pages) {
    const bands = toBands(items);
    name ??= extractLabelledValue(bands, NAME_LABEL_RE);
    financialYear ??= extractLabelledValue(bands, FY_LABEL_RE);
    quarter ??= extractLabelledValue(bands, QUARTER_LABEL_RE, QUARTER_VALUE_RE);
    formNo ??= extractLabelledValue(bands, FORM_NO_LABEL_RE);
    tan ??= extractLabelledValue(bands, PAN_TAN_LABEL_RE);
  }
  return {
    ackNumber: extractAckNumber(pages),
    name,
    financialYear,
    quarter,
    formNo: formNo ? formNo.replace(/^Form\s+/i, "").trim() : null,
    tan,
  };
}

/** Convenience wrapper: read a PDF File and return every cross-check field. */
export async function extractAckFieldsFromFile(file: File): Promise<AckFields> {
  const pages = await pdfToTextPages(file);
  return extractAckFields(pages);
}
