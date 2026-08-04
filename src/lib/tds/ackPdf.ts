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

// ─── The Protean "Tax Invoice cum Token Number" template ────────────────────
//
// A THIRD real receipt shape, distinct from both the e-filing-portal
// templates above: the TDS return-FILING utility's own upload receipt
// (Protean eGov Technologies, formerly NSDL — "Statement of TDS under
// section 397(3) of the Income-tax Act, 2025", seen from FY2026-27 Q1), not
// the income-tax e-filing PORTAL's own acknowledgement. It never prints the
// words "Acknowledgement Number" (or any "Label : Value" row at all) — every
// field this module cross-checks is a plain COLUMN VALUE, left-aligned under
// its own column header on the row(s) directly below, the same shape
// tallyPdf.ts already reads a Tally ledger's Debit/Credit columns by.
// Confirmed against a real receipt (334899600554750, PRINCIPAL COMMISSIONER
// OF INCOME TAX (REAC) AHMEDABAD, 24Q Q1 FY2026-27 — "Form No" prints the
// bare portal code "138", already mapped to 24Q in ackMismatch.ts's
// FORM_NO_PORTAL_ALIASES).
const COLUMN_X_TOL = 15; // px: how close a value's own left edge must sit to its header's

/** The item in `band` whose left edge sits closest to `headerX`, within
 *  COLUMN_X_TOL — or null if nothing in the row qualifies as that column's
 *  value. */
function valueUnderColumn(band: PdfTextItem[], headerX: number): string | null {
  let best: PdfTextItem | null = null, bestDist = Infinity;
  for (const it of band) {
    const d = Math.abs(it.x - headerX);
    if (d <= COLUMN_X_TOL && d < bestDist) { best = it; bestDist = d; }
  }
  const s = best?.str.trim();
  return s || null;
}

// "Tax Invoice cum Token" prints on its own line, with "Number" wrapping to a
// SECOND line that (by y-proximity) merges into the NEXT row's own band —
// so, unlike every label above, the value sits several bands below the line
// this regex matches, not one. Anchored on "Tax Invoice cum Token" alone: it
// is distinctive enough on the page that the wrapped "Number" fragment adds
// nothing worth also matching for.
const TOKEN_NUMBER_LABEL_RE = /Tax\s+Invoice\s+cum\s+Token/i;
const TOKEN_NUMBER_LOOKAHEAD = 5; // bands: label row → header-wrap rows → the value row

function findAckNumberByColumn(bands: PdfTextItem[][]): string | null {
  const labelBandIdx = bands.findIndex((b) => TOKEN_NUMBER_LABEL_RE.test(b.map((i) => i.str).join(" ")));
  if (labelBandIdx === -1) return null;
  const headerX = Math.min(...bands[labelBandIdx].map((i) => i.x));
  for (let i = labelBandIdx + 1; i <= labelBandIdx + TOKEN_NUMBER_LOOKAHEAD && i < bands.length; i++) {
    const val = valueUnderColumn(bands[i], headerX);
    if (val && DIGIT_RE.test(val) && val.length >= 9 && val.length <= 20) return val;
  }
  return null;
}

/** Pure parse: find the acknowledgement number in already-extracted text runs. */
export function extractAckNumber(pages: PdfTextItem[][]): string | null {
  for (const items of pages) {
    const bands = toBands(items);
    const labelBandIdx = bands.findIndex((b) => ACK_LABEL_RE.test(b.map((i) => i.str).join(" ")));
    if (labelBandIdx !== -1) {
      for (let i = labelBandIdx; i < bands.length && i <= labelBandIdx + MAX_BAND_LOOKAHEAD; i++) {
        if (i > labelBandIdx && RRR_LABEL_RE.test(bands[i].map((it) => it.str).join(" "))) return null; // hit RRR's row first
        const hit = mergeDigitRuns(bands[i]).find((t) => DIGIT_RE.test(t) && t.length >= 9 && t.length <= 20);
        if (hit) return hit;
      }
      continue; // label found but nothing qualified within lookahead — try the next page
    }
    const byColumn = findAckNumberByColumn(bands);
    if (byColumn) return byColumn;
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
// The newer "Acknowledgement Receipt of Income Tax Forms (Other Than Income
// Tax Return)" template (seen from Tax Year 2026-27 on) prints "Financial
// Year : -" (genuinely blank) and puts the real year under "Tax Year"
// instead — confirmed against a real receipt. Tried only as a fallback, after
// FY_LABEL_RE, so the older/normal template's own "Financial Year" row is
// still preferred whenever it's actually populated.
const TAX_YEAR_LABEL_RE = /^Tax\s+Year\s*:\s*/i;
const QUARTER_LABEL_RE = /^Quarter\s*:\s*/i;
const FORM_NO_LABEL_RE = /^Form\s+No\.?\s*:\s*/i;
// The newer template (see TAX_YEAR_LABEL_RE above) labels this row
// "PAN/TAN/Other ID :" rather than the older template's plain "PAN/TAN :" —
// confirmed against a real receipt. The optional "/Other ID" suffix keeps
// both templates working under one pattern.
const PAN_TAN_LABEL_RE = /^PAN\s*\/\s*TAN(?:\s*\/\s*Other\s+ID)?\s*:\s*/i;
// Safety net beyond the regex tightening above: a genuine Quarter value is
// always exactly Q1–Q4. If a matched band still produces anything else,
// something is wrong (e.g. an unforeseen boilerplate collision) and the
// value should be discarded rather than trusted.
const QUARTER_VALUE_RE = /^Q[1-4]$/i;

function bandText(band: PdfTextItem[]): string {
  return band.map((i) => i.str.trim()).filter(Boolean).join(" ");
}

// ─── The Protean template's column tables (fallback for extractLabelledValue) ─
//
// Two separate tables on the same receipt, both read the same way as
// findAckNumberByColumn above:
//
//   Table 1 (Name):  "Name of Deductor" header, wrapped like "Tax Invoice cum
//                     Token / Number" is — the value sits several bands below.
//   Table 2 (TAN/Form No/Periodicity/Tax Year): "Date | TAN | AO Code | Form
//                     No | Periodicity | Type of Statement | Tax Year" prints
//                     as ONE clean header band, immediately followed by ONE
//                     clean value band — no wrapping, so no lookahead needed.
//
// "TAN" anchors Table 2: a bare, exact "TAN" text run only ever appears in
// this table (the older templates' PAN/TAN row is always ONE combined string
// like "PAN/TAN" or "PAN/TAN/Other ID", never a standalone "TAN" run), so it
// can't collide with the label-based extraction above even though both are
// tried on every page.
const NAME_OF_DEDUCTOR_RE = /Name\s+of\s+Deductor/i;
const NAME_COLUMN_LOOKAHEAD = 5;

function extractNameOfDeductorColumn(bands: PdfTextItem[][]): string | null {
  const labelBandIdx = bands.findIndex((b) => NAME_OF_DEDUCTOR_RE.test(b.map((i) => i.str).join(" ")));
  if (labelBandIdx === -1) return null;
  const headerItem = bands[labelBandIdx].find((it) => NAME_OF_DEDUCTOR_RE.test(it.str));
  if (!headerItem) return null;
  for (let i = labelBandIdx + 1; i <= labelBandIdx + NAME_COLUMN_LOOKAHEAD && i < bands.length; i++) {
    const val = valueUnderColumn(bands[i], headerItem.x);
    if (val && val.length >= 2) return val;
  }
  return null;
}

const IDENTITY_ROW_TAN_RE = /^TAN$/i;
const IDENTITY_COLUMN_HEADERS = {
  tan: /^TAN$/i,
  formNo: /^Form\s*No\.?$/i,
  quarter: /^Periodicity$/i,
  taxYear: /^Tax\s+Year$/i,
} as const;

function extractIdentityColumnTable(bands: PdfTextItem[][]): Record<keyof typeof IDENTITY_COLUMN_HEADERS, string | null> | null {
  for (let i = 0; i < bands.length - 1; i++) {
    const header = bands[i];
    if (!header.some((it) => IDENTITY_ROW_TAN_RE.test(it.str.trim()))) continue;
    const values = bands[i + 1];
    const out = { tan: null, formNo: null, quarter: null, taxYear: null } as Record<keyof typeof IDENTITY_COLUMN_HEADERS, string | null>;
    for (const key of Object.keys(IDENTITY_COLUMN_HEADERS) as (keyof typeof IDENTITY_COLUMN_HEADERS)[]) {
      const headerItem = header.find((it) => IDENTITY_COLUMN_HEADERS[key].test(it.str.trim()));
      if (headerItem) out[key] = valueUnderColumn(values, headerItem.x);
    }
    return out;
  }
  return null;
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
    financialYear ??= extractLabelledValue(bands, FY_LABEL_RE) ?? extractLabelledValue(bands, TAX_YEAR_LABEL_RE);
    quarter ??= extractLabelledValue(bands, QUARTER_LABEL_RE, QUARTER_VALUE_RE);
    formNo ??= extractLabelledValue(bands, FORM_NO_LABEL_RE);
    tan ??= extractLabelledValue(bands, PAN_TAN_LABEL_RE);

    // Fallback: the Protean "Tax Invoice cum Token Number" template has no
    // "Label : Value" row for any of these — see extractIdentityColumnTable's
    // own doc. Only tried once something above is still unresolved, so it
    // costs nothing on the templates the label-based reader already handles.
    if (name == null || financialYear == null || quarter == null || formNo == null || tan == null) {
      name ??= extractNameOfDeductorColumn(bands);
      const cols = extractIdentityColumnTable(bands);
      if (cols) {
        tan ??= cols.tan;
        formNo ??= cols.formNo;
        if (cols.quarter && QUARTER_VALUE_RE.test(cols.quarter)) quarter ??= cols.quarter;
        financialYear ??= cols.taxYear;
      }
    }
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
