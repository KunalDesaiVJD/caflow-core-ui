// MSME 43B(h) — AI extraction path (any accounting-software PDF format).
//
// Uploads the PDF to the msme-extract-ledger edge function (which calls Claude
// server-side — the API key never reaches the browser), receives a canonical
// ledger JSON, then runs the SAME reconciliation oracle used for the
// deterministic parsers. A ledger that doesn't reconcile to its printed closing
// balance is returned flagged (balanceReconciled = false), not trusted.

import { supabase } from '@/integrations/supabase/client';
import type { VendorLedger, LedgerTxn } from './types';
import { reconcileLedger } from './reconcile';
import { fyFromStart, parseAmount, parseLedgerDate } from './parseUtils';
import { pdfPageTexts, pdfPageImages } from './pdfText';

async function bufferToBase64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};
const str = (v: unknown): string => (v == null ? '' : String(v));

// ─────────────────────────────────────────────────────────────────────────────
//  Deterministic corrections — DO NOT depend on the model following an
//  instruction. Verified against 41 real ledger exports across 6 clients
//  (Amadius Realty, Elenza Calista, Revti Infra, Skylark Corporation, Sweni
//  Corporation, Accurate PMS): the AI extraction was directly observed still
//  mislabeling a vendor with the reporting company's own letterhead AFTER an
//  explicit prompt instruction was added telling it not to — models do not
//  reliably follow layout-disambiguation instructions on every call. Both
//  patterns below are 100% mechanical (a fixed anchor word/phrase, not a
//  judgement call), so they are corrected here in code instead, using only
//  the model's read of the AMOUNTS (a reliable OCR-like task) — never its
//  read of which name or which sign those amounts belong to.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A real Tally "Ledger Account" export prints the reporting company's own
 * name (and often PAN/UDYAM/CIN/address) FIRST, then the true vendor name on
 * the line immediately before the literal heading "Ledger Account". Returns
 * every vendor name found, in order of appearance, for correlation against
 * however many ledger objects the model returned for this chunk.
 */
export function detectLedgerAccountVendorNames(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim());
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== 'Ledger Account') continue;
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j]) { names.push(lines[j]); break; }
    }
  }
  return names;
}

/**
 * The sign of a Tally opening/closing balance, from the "To"/"By" word
 * printed immediately before it.
 *
 * OPENING is read directly: "To Opening Balance" is a real debit/advance
 * balance carried in → negative. "By Opening Balance" → positive.
 *
 * CLOSING IS DIFFERENT: it is Tally's own balancing plug, printed on
 * whichever column needs a top-up to make the two column TOTALS print equal
 * — so its printed side is the OPPOSITE of what the ledger truly closes at.
 * "To Closing Balance" means the credit-column total exceeded the debit
 * total, so the ledger truly closes credit/payable → positive. "By Closing
 * Balance" → negative. Verified by hand against three real V.J. Desai & Co.
 * ledgers (Amadius Realty, Skylark Corporation, Sweni Corporation) and cross-
 * checked against the following year's own independently-printed opening
 * balance, which matched in every case.
 *
 * Returns undefined when the anchor text isn't present in this chunk (a
 * continuation chunk with no header, or a non-Tally export) — the model's own
 * figure is trusted as-is in that case.
 */
export function detectBalanceSign(text: string, which: 'Opening' | 'Closing'): 1 | -1 | undefined {
  const m = text.match(new RegExp(`\\b(To|By)\\s+${which}\\s+Balance\\b`, 'i'));
  if (!m) return undefined;
  const isTo = m[1].toLowerCase() === 'to';
  if (which === 'Opening') return isTo ? -1 : 1;
  return isTo ? 1 : -1; // Closing: inverted relative to Opening
}

/** Corrected voucher amounts, keyed by `${isoDate}|${vchNo}`. */
export interface GstSubtotalCorrection {
  /** the amount printed on the voucher's own Debit/Credit line — the true gross */
  grossAmount: number;
  /** the taxable value printed on the "Purchase @ N%" / "Inter State Purchase N%" sub-line */
  taxableValue: number;
  gstRate: number;
}

// A Tally "Tax Purchase" voucher prints its GROSS amount on the dated line
// itself, then breaks it down on the line(s) immediately below:
//   31-May-25 By (as per details) Tax Purchase 33     67,597.00
//   Purchase @ 5%                               64,378.24 Dr
//   SGST Input @ 2.5%                            1,609.46 Dr
//   CGST Input @ 2.5%                             1,609.46 Dr
// (or, for an interstate supply, "Inter State Purchase 18%" + a single "IGST
// Input" line instead of the SGST/CGST pair — the breakdown line's shape
// doesn't otherwise change).
const VOUCHER_TOTAL_RE = /^(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(?:To|By)\s+.*?\bTax Purchase\b\s+(\S+)\s+([\d,]+\.\d{1,2})\s*$/;
const TAXABLE_SUBLINE_RE = /^(?:Inter State |Local )?Purchase\s*@?\s*\d+(?:\.\d+)?\s*%\s+([\d,]+\.\d{1,2})\s*Dr\s*$/i;
const RATE_RE = /@?\s*(\d+(?:\.\d+)?)\s*%/;

/**
 * Detect the true gross and taxable value of every "Tax Purchase" voucher in
 * a chunk, straight from the ledger's own printed breakdown — never from a
 * declared/guessed GST rate.
 *
 * Verified against real Bindra Construction ledgers where the model had
 * extracted the SUB-LINE'S taxable amount ("Purchase @ 5% 64,378.24 Dr") as
 * if it were the voucher's gross, instead of the amount actually printed on
 * the dated voucher line ("...Tax Purchase 33 67,597.00"). Nothing downstream
 * catches this by itself: mapLedger's own GST split then applied a further
 * reduction to that already-net figure — a DOUBLE deduction — understating
 * the disallowance by the GST amount a second time over (confirmed against
 * the firm's own working paper: ₹1,37,394 shown vs. the correct ₹1,44,263).
 * The ledger's own printed closing balance still caught the resulting drift
 * and blocked sign-off, but the root misread is fixed here so the figure is
 * right the first time rather than merely flagged wrong.
 *
 * Keyed by date + voucher number so a correction only ever applies to the
 * one row it was read from. A date+vchNo pair seen more than once in the
 * chunk (an ambiguous split, or two vouchers sharing a number) is dropped
 * entirely rather than guessed at.
 */
export function detectGstSubtotalCorrections(text: string): Map<string, GstSubtotalCorrection> {
  const lines = text.split('\n');
  const out = new Map<string, GstSubtotalCorrection>();
  const seenAmbiguous = new Set<string>();

  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i].trim().match(VOUCHER_TOTAL_RE);
    if (!head) continue;
    const sub = lines[i + 1].trim().match(TAXABLE_SUBLINE_RE);
    if (!sub) continue;

    const iso = parseLedgerDate(head[1]);
    const vchNo = head[2].trim();
    if (!iso || !vchNo) continue;
    const key = `${iso}|${vchNo}`;

    const grossAmount = parseAmount(head[3]);
    const taxableValue = parseAmount(sub[1]);
    const rateMatch = lines[i + 1].match(RATE_RE);
    if (taxableValue <= 0 || taxableValue > grossAmount) continue;

    if (out.has(key) || seenAmbiguous.has(key)) {
      out.delete(key);
      seenAmbiguous.add(key);
      continue;
    }
    out.set(key, { grossAmount, taxableValue, gstRate: rateMatch ? parseAmount(rateMatch[1]) : 0 });
  }
  return out;
}

/** A voucher that prints BOTH a Debit- and a Credit-column amount on one line. */
export interface DualAmountVoucher {
  date: string;   // ISO
  vchNo: string;
  particulars: string;
  debitAmount: number;
  creditAmount: number;
}

// A compound Tally journal that both raises a charge against the party AND
// nets something off in the same voucher (most commonly re-invoicing a fee
// while netting the TDS on it) prints BOTH its Debit- and Credit-column
// entries on the SAME line, in that column order:
//   31-Mar-26 To (as per details) Journal 285   23,300.00   2,33,000.00
// Verified by full-ledger reconciliation arithmetic (not a guess): summing
// every OTHER row's contribution to the printed Debit/Credit column TOTALS
// on three real V.J. Desai & Co. ledgers (Amadius Realty, Skylark
// Corporation, Sweni Corporation) and solving for what this one row must
// contribute — the totals only balance when the FIRST trailing amount is
// this row's Debit-column entry and the SECOND is its Credit-column entry.
const DUAL_AMOUNT_VOUCHER_RE =
  /^(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(?:To|By)\s+(.+?)\s+(\S+)\s+([\d,]+\.\d{1,2})\s+([\d,]+\.\d{1,2})\s*$/;

/**
 * Detect every dual-amount voucher in a chunk, keyed by date + voucher
 * number. A key seen more than once (an ambiguous split, or two vouchers
 * sharing a number) is dropped entirely rather than guessed at — same
 * discipline as detectGstSubtotalCorrections.
 *
 * The engine's own bill/settlement split (buildBillsAndSettlements in
 * engine.ts) reads credit-then-debit with an if/else — a single LedgerTxn
 * can only ever be read as ONE of a bill or a settlement, never both. So
 * this can't be fixed by setting both fields on one row; applyDeterministic
 * Corrections below turns each detected voucher into two rows instead —
 * exactly what the extraction prompt already asks the model to do, except
 * this no longer depends on the model complying.
 */
export function detectDualAmountVouchers(text: string): Map<string, DualAmountVoucher> {
  const out = new Map<string, DualAmountVoucher>();
  const seenAmbiguous = new Set<string>();

  for (const rawLine of text.split('\n')) {
    const m = rawLine.trim().match(DUAL_AMOUNT_VOUCHER_RE);
    if (!m) continue;
    const iso = parseLedgerDate(m[1]);
    const vchNo = m[3].trim();
    if (!iso || !vchNo) continue;
    const key = `${iso}|${vchNo}`;

    if (out.has(key) || seenAmbiguous.has(key)) {
      out.delete(key);
      seenAmbiguous.add(key);
      continue;
    }
    out.set(key, {
      date: iso,
      vchNo,
      particulars: m[2].trim(),
      debitAmount: parseAmount(m[4]),
      creditAmount: parseAmount(m[5]),
    });
  }
  return out;
}

/**
 * Apply both corrections to a chunk's raw model output IN PLACE, before
 * mapLedger ever sees it — so the existing UNRESOLVED-vendor / warning logic
 * downstream keeps working unchanged for whatever these detectors don't
 * cover (scanned PDFs, non-Tally exports, genuinely ambiguous multi-vendor
 * chunks).
 *
 * Vendor names are only overridden when the count of detected headers
 * EXACTLY matches the count of ledger objects the model returned for this
 * chunk — on a mismatch (a multi-vendor chunk this heuristic can't safely
 * correlate) nothing is touched, which is no worse than before. The balance
 * sign is only corrected when the chunk produced exactly one ledger, so
 * there is no ambiguity about which ledger a single detected "Opening/
 * Closing Balance" line belongs to.
 */
export function applyDeterministicCorrections(rawLedgers: unknown[], chunkText: string): void {
  const names = detectLedgerAccountVendorNames(chunkText);
  if (names.length && names.length === rawLedgers.length) {
    rawLedgers.forEach((raw, i) => {
      (raw as Record<string, unknown>).vendorName = names[i];
    });
  }

  if (rawLedgers.length === 1) {
    const raw = rawLedgers[0] as Record<string, unknown>;
    const openSign = detectBalanceSign(chunkText, 'Opening');
    if (openSign !== undefined && raw.openingBalance != null) {
      raw.openingBalance = Math.abs(num(raw.openingBalance)) * openSign;
    }
    const closeSign = detectBalanceSign(chunkText, 'Closing');
    if (closeSign !== undefined && raw.closingBalance != null) {
      raw.closingBalance = Math.abs(num(raw.closingBalance)) * closeSign;
    }
  }

  const gstCorrections = detectGstSubtotalCorrections(chunkText);
  if (gstCorrections.size) {
    for (const raw of rawLedgers) {
      const r = raw as Record<string, unknown>;
      const rows = Array.isArray(r.rows) ? r.rows : Array.isArray(r.txns) ? r.txns : [];
      for (const row of rows) {
        const f = rowFields(row);
        const iso = str(f.date);
        const vchNo = str(f.vchNo).trim();
        if (!iso || !vchNo) continue;
        const fix = gstCorrections.get(`${iso}|${vchNo}`);
        if (!fix) continue;

        // Overwrite whichever side the model already reported as this
        // voucher's amount (a "Tax Purchase" line is always the credit side
        // of a creditor ledger, but the correction only touches the side
        // actually in use, never invents an entry on the other side).
        if (num(f.credit) > 0) setRowField(row, 'credit', fix.grossAmount);
        else if (num(f.debit) > 0) setRowField(row, 'debit', fix.grossAmount);
        else continue;

        setRowField(row, 'taxableValue', fix.taxableValue);
        setRowField(row, 'gstRate', fix.gstRate);
        // Clear the model's own gstAmount: if it was computed against the
        // WRONG gross, it would fail mapLedger's own consistency check and
        // take taxableValue down with it. Leaving it unset lets splitGst
        // derive gstAmount = gross − taxableValue from the two corrected
        // figures instead.
        setRowField(row, 'gstAmount', undefined);
      }
    }
  }

  const dualVouchers = detectDualAmountVouchers(chunkText);
  if (dualVouchers.size) {
    const byVchNo = new Map<string, DualAmountVoucher>();
    const ambiguousVchNo = new Set<string>();
    for (const v of dualVouchers.values()) {
      if (byVchNo.has(v.vchNo) || ambiguousVchNo.has(v.vchNo)) {
        byVchNo.delete(v.vchNo);
        ambiguousVchNo.add(v.vchNo);
        continue;
      }
      byVchNo.set(v.vchNo, v);
    }

    for (const raw of rawLedgers) {
      const r = raw as Record<string, unknown>;
      const field = Array.isArray(r.rows) ? 'rows' : Array.isArray(r.txns) ? 'txns' : null;
      if (!field) continue;
      const rows = r[field] as unknown[];

      // Only correct a voucher this ledger's OWN rows already reference by
      // number — a chunk can hold more than one vendor, and a Tally journal
      // voucher number is not scoped to a single party, so matching on
      // vchNo alone across ALL ledgers in the chunk could apply one party's
      // amounts to a different party's ledger.
      const matchedVchNos = new Set<string>();
      for (const row of rows) {
        const vchNo = str(rowFields(row).vchNo).trim();
        if (vchNo && byVchNo.has(vchNo)) matchedVchNos.add(vchNo);
      }
      if (!matchedVchNos.size) continue;

      const kept = rows.filter((row) => {
        const vchNo = str(rowFields(row).vchNo).trim();
        return !matchedVchNos.has(vchNo);
      });
      for (const vchNo of matchedVchNos) {
        const v = byVchNo.get(vchNo)!;
        kept.push([v.date, v.particulars, '', v.vchNo, v.debitAmount, 0, undefined, undefined, undefined]);
        kept.push([v.date, v.particulars, '', v.vchNo, 0, v.creditAmount, undefined, undefined, undefined]);
      }
      r[field] = kept;
    }
  }
}

/**
 * An OPTIONAL number: null/undefined/"" stay undefined rather than collapsing to
 * 0. That distinction carries the whole GST safety story — "the document did not
 * show the tax" (undefined) must never be confused with "the tax was nil" (0),
 * because the first is flagged for a declaration and the second is taken as fact.
 */
const optNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

interface AiExtractResult {
  ledgers: VendorLedger[];
  truncated: boolean;
}

/**
 * Turn supabase-js's opaque transport errors into something a CA firm can act
 * on. Two of its messages say nothing on their own:
 *
 *   "Failed to send a request to the Edge Function"  → not deployed at all
 *   "Edge Function returned a non-2xx status code"   → deployed, but it failed,
 *                                                      and the REASON is in the
 *                                                      response body, which
 *                                                      supabase-js hides in
 *                                                      error.context
 *
 * So the body is read out and shown. Without this the user sees the same nine
 * words whether the API key is missing, the PDF was rejected, or the model
 * errored — which is how eight sessions went by without knowing which it was.
 *
 * The error also carries the one distinction the caller ACTS on: whether the
 * page range was too much for a single call (retrying it smaller will work) or
 * whether something is wrong regardless of size (retrying is pointless and the
 * error belongs on screen).
 */
class LedgerReadError extends Error {
  constructor(message: string, readonly rangeTooDense: boolean) {
    super(message);
    this.name = 'LedgerReadError';
  }
}

async function describeInvokeError(
  error: { name?: string; message?: string; context?: unknown },
  fileName: string,
): Promise<LedgerReadError> {
  const msg = error.message || '';

  if (/Failed to send a request|Failed to fetch|NetworkError|FunctionsFetchError/i.test(msg) || error.name === 'FunctionsFetchError') {
    return new LedgerReadError(
      'Could not reach the ledger-reading service (msme-extract-ledger). It is most likely not deployed yet — ' +
      'run "npx supabase functions deploy msme-extract-ledger". ' +
      'If it is deployed, check your network connection and try again.',
      false,
    );
  }
  if (/timeout|timed out/i.test(msg)) {
    // The platform's idle timeout. Fewer pages per call is the remedy.
    return new LedgerReadError(`Reading "${fileName}" timed out — the page range was too dense for one call.`, true);
  }

  // A non-2xx: the function ran and reported something. Get it out of the body.
  const body = await readErrorBody(error.context);
  const status = (error.context as Response | undefined)?.status;

  // An explicit signal from the function wins. With NO signal at all — the body
  // was unreadable, already consumed, or empty — a 502/504 still means the reply
  // did not come back whole, so the safe default is "try a smaller chunk", not
  // "lose the file". Guessing wrong here costs a few extra requests; guessing
  // the other way costs the whole ledger.
  const rangeTooDense = body ? body.rangeTooDense : status === 502 || status === 504;

  if (body?.detail) {
    return new LedgerReadError(
      `The ledger-reading service failed${status ? ` (HTTP ${status})` : ''}: ${body.detail}`,
      rangeTooDense,
    );
  }
  return new LedgerReadError(
    msg || `The ledger-reading service failed${status ? ` (HTTP ${status})` : ''}.`,
    rangeTooDense,
  );
}

/**
 * supabase-js puts the raw Response on error.context for an HTTP error. Reading
 * it is best-effort: the body may already be consumed, may not be JSON, or may
 * be empty, and none of those should replace the original error with a new one.
 *
 * `code` is read rather than pattern-matching the prose, so the retry decision
 * does not silently stop working when a message is reworded.
 */
async function readErrorBody(
  context: unknown,
): Promise<{ detail: string | null; rangeTooDense: boolean } | null> {
  const res = context as Response | undefined;
  if (!res || typeof res.text !== 'function') return null;
  try {
    const text = (await res.text()).trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as {
        error?: string; message?: string; code?: string; truncated?: boolean;
      };
      const picked = parsed.error || parsed.message;
      return {
        detail: picked ? String(picked).slice(0, 500) : text.slice(0, 500),
        rangeTooDense: parsed.code === 'truncated' || parsed.truncated === true,
      };
    } catch {
      // Not JSON — the raw text is still the most useful thing available.
      return { detail: text.slice(0, 500), rangeTooDense: false };
    }
  } catch {
    return null;
  }
}

/**
 * How much of a ledger goes in one call — measured in LINES, not pages.
 *
 * THIS IS THE ROOT-CAUSE FIX, and the reason three previous attempts failed.
 * What overflows a reply is the number of ROWS. Pages were being used as a proxy
 * for rows, and they are not one: a merged export can pack a hundred rows onto
 * one page. So a dense 3-page file was never split at all (it was under the
 * page threshold and went whole in a single call), and even when splitting did
 * happen, splitting a single overflowing page by page could not make it smaller.
 * Tuning pages-per-call was tuning the wrong dimension.
 *
 * Chunking by lines makes the unit of work proportional to the actual output,
 * independent of how the pages happen to be laid out, and it lets a chunk be
 * halved again and again until it fits (see readChunk) — which terminates,
 * because a chunk of one line always fits.
 *
 * THE SIZE IS MEASURED, NOT GUESSED. On the firm's own merged exports:
 *
 *   98 pages → 4,464 lines of text →   729 dated transaction rows  (16%)
 *   46 pages → 1,854 lines of text →   280 dated transaction rows  (15%)
 *
 * Only about one line in six becomes a row, because a Tally ledger carries page
 * headers, column headers, GST detail lines and carried-forward lines. So 500
 * lines is roughly 80 rows, which as compact arrays is about 2,000 output tokens
 * against the 8,000-token cap — comfortable, with the halving retry as the
 * backstop for an unusually dense stretch.
 *
 * The first version of this used 80 lines, sized by guesswork. That was ~13 rows
 * per call and would have made 80 sequential requests of those two files, each
 * using a quarter of the budget it was given.
 */
export const LINES_PER_CHUNK = 500;

/**
 * A chunk this small that STILL overflows is not a size problem — something is
 * wrong with the page (unreadable text, a pathological row) and halving further
 * would just multiply requests. It is reported instead.
 */
const MIN_LINES_PER_CHUNK = 8;

/**
 * Pages of a SCANNED ledger per call. Lower than the text budget because a page
 * image costs far more input than the same page as text, and because 2 pages of
 * a ledger already carry plenty of rows. A chunk that overflows is halved down to
 * a single page (see extractByPageImages).
 */
const PAGES_PER_IMAGE_CHUNK = 2;

/** One physical line of the PDF, tagged with the page it came from. */
interface SourceLine { page: number; text: string }

/** Extract vendor ledgers from a PDF of any format via Claude. */
export async function extractLedgersViaAI(
  file: File,
  onProgress?: (note: string) => void,
): Promise<AiExtractResult> {
  const buf = await file.arrayBuffer();

  // Text first, and always. Previously the page COUNT decided the route, and a
  // failure to read it fell through to `pages = 0` — routing the file to the one
  // path with no splitting and no retry, which is the opposite of what an
  // unknown-size file needs.
  //
  // The two ways of having no text are kept APART. Conflating them produced a
  // message that said "this is a scan" when pdfjs had simply failed, which sent
  // the reader looking for the wrong problem.
  let pageTexts: string[] = [];
  let pdfjsError: string | null = null;
  try {
    pageTexts = await pdfPageTexts(buf);
  } catch (e) {
    pdfjsError = (e as Error)?.message || String(e);
  }

  const lines: SourceLine[] = [];
  pageTexts.forEach((pageText, i) => {
    for (const raw of pageText.split('\n')) {
      const text = raw.trim();
      if (text) lines.push({ page: i + 1, text });
    }
  });

  if (lines.length) return extractByLineChunks(file, lines, pageTexts.length, onProgress);

  // pdfjs could not open the file at all — it cannot render pages either, so the
  // document itself is the only thing left to send.
  if (pdfjsError !== null) return extractWholeFile(file, buf, pdfjsError, onProgress);

  // pdfjs opened it and found no text: a genuine scan. Rendering its pages makes
  // it splittable on the same terms as a text PDF, instead of all-or-nothing.
  return extractByPageImages(file, buf, pageTexts.length, onProgress);
}

/**
 * Last resort: send the document whole, when pdfjs could not read it well enough
 * even to render its pages. Nothing here can split it, so if it overflows the
 * message says what will actually help.
 */
async function extractWholeFile(
  file: File,
  buf: ArrayBuffer,
  pdfjsError: string,
  onProgress?: (note: string) => void,
): Promise<AiExtractResult> {
  onProgress?.(`${file.name}: could not be opened locally — sending the whole document`);
  const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
    body: { pdf_base64: await bufferToBase64(buf), filename: file.name },
  });
  if (error) {
    const described = await describeInvokeError(error, file.name);
    if (described.rangeTooDense) {
      throw new Error(
        `"${file.name}" could not be opened here (${pdfjsError}), so it had to be sent whole and cannot be ` +
        'split automatically — and it holds more rows than one read can return. Split the PDF into smaller ' +
        'files (one vendor each is safest) and upload those.',
      );
    }
    throw described;
  }
  if (data?.error) throw new Error(data.error);

  const rawLedgers: unknown[] = Array.isArray(data?.ledgers) ? data.ledgers : [];
  return { ledgers: rawLedgers.map((raw) => mapLedger(raw, file.name)), truncated: !!data?.truncated };
}

/**
 * A SCANNED ledger: no text layer, so each page is rendered to an image and read
 * as one. Same halving logic as the text route — the unit is pages here because
 * a page image is the smallest thing that can be rendered, and an image chunk
 * that overflows is split until a single page is left.
 */
async function extractByPageImages(
  file: File,
  buf: ArrayBuffer,
  pages: number,
  onProgress?: (note: string) => void,
): Promise<AiExtractResult> {
  const collected: VendorLedger[] = [];
  const failures: string[] = [];
  let truncated = false;

  const readPages = async (nums: number[]): Promise<unknown[]> => {
    const label = nums.length === 1 ? `page ${nums[0]}` : `pages ${nums[0]}–${nums[nums.length - 1]}`;
    onProgress?.(`${file.name}: ${label} of ${pages} (scan — rendering to image)`);
    const images = await pdfPageImages(buf, nums);
    if (!images.length) {
      failures.push(`${label}: could not be rendered`);
      return [];
    }

    const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
      body: { page_images: images, filename: file.name, page_range: label },
    });

    if (error) {
      const described = await describeInvokeError(error, file.name);
      if (!described.rangeTooDense) throw described;
      if (nums.length === 1) {
        failures.push(
          `${label}: one page still would not fit in a single read. It holds too many rows — ` +
          `split this page's vendor out into its own file. (${described.message})`,
        );
        return [];
      }
      const mid = Math.ceil(nums.length / 2);
      onProgress?.(`${file.name}: ${label} too dense, splitting`);
      return [...await readPages(nums.slice(0, mid)), ...await readPages(nums.slice(mid))];
    }

    if (data?.error) {
      failures.push(`${label}: ${data.error}`);
      return [];
    }
    truncated = truncated || !!data?.truncated;
    return Array.isArray(data?.ledgers) ? data.ledgers : [];
  };

  for (let p = 1; p <= pages; p += PAGES_PER_IMAGE_CHUNK) {
    const nums: number[] = [];
    for (let k = p; k < p + PAGES_PER_IMAGE_CHUNK && k <= pages; k++) nums.push(k);
    const label = nums.length === 1 ? `page ${nums[0]}` : `pages ${nums[0]}–${nums[nums.length - 1]}`;
    for (const raw of await readPages(nums)) collected.push(mapLedger(raw, file.name, false, label));
  }

  if (!collected.length) {
    throw new Error(
      `"${file.name}" is a scan (${pages} pages, no text layer) and no ledger could be read from it. ` +
      (failures.length ? failures.join('; ') : 'The service returned no ledgers.'),
    );
  }

  const merged = mergeLedgers(collected);
  const reconciled = merged.map((l) => reconcileLedger(l));
  for (const l of reconciled) {
    l.warnings = [
      ...(l.warnings || []),
      `Read from a SCANNED PDF (no text layer) — figures were transcribed from page images, so check them against the printed ledger.`,
      ...(failures.length ? [`Parts of ${file.name} could not be read: ${failures.join('; ')}`] : []),
    ];
  }
  return { ledgers: reconciled, truncated };
}

/**
 * The normal route: read the ledger in line-bounded chunks and stitch the
 * vendors back together. A ledger that straddles a boundary is rejoined by name
 * in mergeLedgers(), so the boundaries need not fall between vendors.
 */
async function extractByLineChunks(
  file: File,
  lines: SourceLine[],
  pages: number,
  onProgress?: (note: string) => void,
): Promise<AiExtractResult> {
  const collected: VendorLedger[] = [];
  const failures: string[] = [];
  let truncated = false;

  /** "pages 3–4" / "page 3", for progress and for error messages. */
  const span = (group: SourceLine[]): string => {
    const from = group[0].page;
    const to = group[group.length - 1].page;
    return from === to ? `page ${from}` : `pages ${from}–${to}`;
  };

  /** Re-emit a chunk as text, keeping the page markers the model benefits from. */
  const render = (group: SourceLine[]): string => {
    const out: string[] = [];
    let current = -1;
    for (const l of group) {
      if (l.page !== current) { out.push(`--- page ${l.page} ---`); current = l.page; }
      out.push(l.text);
    }
    return out.join('\n');
  };

  /**
   * Read one chunk, halving it on overflow until it fits. Recursion terminates:
   * each step halves, and the floor is MIN_LINES_PER_CHUNK.
   */
  const readChunk = async (group: SourceLine[]): Promise<unknown[]> => {
    const label = span(group);
    onProgress?.(`${file.name}: ${label} of ${pages} (${group.length} lines)`);

    const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
      body: { text_content: render(group), filename: file.name, page_range: label },
    });

    if (error) {
      const described = await describeInvokeError(error, file.name);
      if (!described.rangeTooDense) throw described;

      if (group.length <= MIN_LINES_PER_CHUNK) {
        failures.push(`${label}: ${group.length} lines still would not fit in one read — ${described.message}`);
        return [];
      }
      const mid = Math.ceil(group.length / 2);
      onProgress?.(`${file.name}: ${label} too dense, splitting ${group.length} lines in half`);
      return [...await readChunk(group.slice(0, mid)), ...await readChunk(group.slice(mid))];
    }

    if (data?.error) {
      failures.push(`${label}: ${data.error}`);
      return [];
    }
    truncated = truncated || !!data?.truncated;
    return Array.isArray(data?.ledgers) ? data.ledgers : [];
  };

  for (let i = 0; i < lines.length; i += LINES_PER_CHUNK) {
    const group = lines.slice(i, i + LINES_PER_CHUNK);
    const chunkText = render(group);
    const rawLedgers = await readChunk(group);
    applyDeterministicCorrections(rawLedgers, chunkText);
    for (const raw of rawLedgers) collected.push(mapLedger(raw, file.name, false, span(group)));
  }

  if (!collected.length) {
    throw new Error(
      `Could not read any ledger from "${file.name}" (${pages} pages, ${lines.length} lines of text). ` +
      (failures.length ? failures.join('; ') : 'The service returned no ledgers.'),
    );
  }

  const merged = mergeLedgers(collected);
  // Reconcile only once the pieces are whole — a half-ledger never balances.
  const reconciled = merged.map((l) => reconcileLedger(l));
  for (const l of reconciled) {
    if (failures.length) l.warnings = [...(l.warnings || []), `Parts of ${file.name} could not be read: ${failures.join('; ')}`];
  }
  return { ledgers: reconciled, truncated };
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Marker for a ledger fragment whose vendor name could not be read from its
 * chunk. Each chunk call has NO memory of the vendor identified in a previous
 * call (see readChunk/readPages — only that chunk's text is sent), so when a
 * chunk boundary lands before the vendor header ever appears, the model
 * genuinely cannot know the name.
 *
 * Previously this fell back to the UPLOADED FILE'S NAME, which looks like a
 * confident, correct vendor name and is not one — on a merged multi-vendor
 * export it silently mislabels the fragment as whatever the file happened to
 * be called, and mergeLedgers() below then merges EVERY such fragment from the
 * same file into one corrupted ledger (wrong party, missing transactions,
 * unreliable disallowance) because they all share that same fallback name.
 *
 * An unresolved fragment must instead be visibly flagged and never silently
 * merged with another unresolved fragment that likely belongs to a different
 * real vendor.
 */
export const UNRESOLVED_VENDOR_PREFIX = 'UNRESOLVED VENDOR';

/** True for a ledger whose vendor name is a placeholder, not a read name. */
export const isUnresolvedVendor = (name: string): boolean => name.startsWith(UNRESOLVED_VENDOR_PREFIX);

/**
 * Rejoin the pieces of a ledger that spanned several page ranges.
 *
 * Opening comes from the FIRST range that stated one and closing from the LAST,
 * because those are the only ranges that can have seen them. Transactions are
 * concatenated in date order, with exact duplicates dropped — a row can appear
 * twice when a bill's detail lines straddle a page break and both ranges report it.
 *
 * Unresolved fragments (see UNRESOLVED_VENDOR_PREFIX) are never grouped by name
 * with one another — two fragments that both failed to read a vendor name are
 * not evidence they are the SAME vendor, so each is kept separate and left for
 * a human to identify and reassign.
 */
function mergeLedgers(parts: VendorLedger[]): VendorLedger[] {
  const byVendor = new Map<string, VendorLedger[]>();
  let unresolvedSeq = 0;
  for (const p of parts) {
    const k = isUnresolvedVendor(p.vendorName) ? `__unresolved_${unresolvedSeq++}` : nameKey(p.vendorName);
    byVendor.set(k, [...(byVendor.get(k) ?? []), p]);
  }

  const out: VendorLedger[] = [];
  for (const group of byVendor.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }

    const base = group[0];
    const seen = new Set<string>();
    const txns: LedgerTxn[] = [];
    for (const g of group) {
      for (const t of g.txns) {
        const sig = `${t.date}|${t.particulars}|${t.debit}|${t.credit}|${t.vchNo ?? ''}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        txns.push(t);
      }
    }
    txns.sort((a, b) => a.date.localeCompare(b.date));

    const withOpening = group.find((g) => g.openingBalance !== 0);
    const withClosing = [...group].reverse().find((g) => g.closingBalance !== 0);

    out.push({
      ...base,
      openingBalance: withOpening?.openingBalance ?? 0,
      closingBalance: withClosing?.closingBalance ?? 0,
      periodFrom: group.find((g) => g.periodFrom)?.periodFrom,
      periodTo: [...group].reverse().find((g) => g.periodTo)?.periodTo,
      financialYear: group.find((g) => g.financialYear)?.financialYear,
      txns,
      warnings: [...(base.warnings ?? []), `Read from ${group.length} page ranges of a merged export.`],
    });
  }
  return out;
}

/** The fixed element order of a compact row. Must match the prompt exactly. */
const ROW = {
  date: 0, particulars: 1, vchType: 2, vchNo: 3,
  debit: 4, credit: 5, taxableValue: 6, gstAmount: 7, gstRate: 8,
} as const;

/**
 * Write one field back into a raw row IN PLACE, whichever of the two accepted
 * shapes (positional array or named object — see rowFields) it happens to be
 * in. Used by applyDeterministicCorrections, which must overwrite a field the
 * model already returned rather than just read it.
 */
function setRowField(row: unknown, field: keyof typeof ROW, value: number | undefined): void {
  if (Array.isArray(row)) row[ROW[field]] = value;
  else if (row && typeof row === 'object') (row as Record<string, unknown>)[field] = value;
}

/**
 * Accept a transaction as either a positional array (the compact form the prompt
 * asks for, which fits ~2.5x more rows in one reply) or an object with named
 * fields.
 *
 * Both are accepted on purpose. The named form is what the model produced before
 * the prompt changed, and a model occasionally ignores a format instruction — a
 * silently dropped ledger would be far worse than a slightly larger reply, and
 * the reconciliation oracle catches nothing here because a ledger read as ZERO
 * rows with a zero balance can look internally consistent.
 */
export function rowFields(t: unknown): Record<string, unknown> {
  if (!Array.isArray(t)) return (t ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, idx] of Object.entries(ROW)) out[name] = t[idx];
  return out;
}

/**
 * @param contextLabel the page range / chunk this fragment was read from (e.g.
 *   "page 3" or "pages 3–4"), included in the unresolved placeholder so two
 *   different unresolved fragments never collide on the same name and so the
 *   reviewer knows exactly where in the source PDF to look. Omitted for a
 *   whole-document read, where there is only one fragment to begin with.
 */
export function mapLedger(raw: unknown, sourceFile: string, reconcile = true, contextLabel?: string): VendorLedger {
  const r = (raw ?? {}) as Record<string, unknown>;
  // "rows" is the compact form; "txns" is the older named form.
  const rawRows = Array.isArray(r.rows) ? r.rows : Array.isArray(r.txns) ? r.txns : [];
  const txns: LedgerTxn[] = rawRows.map((t) => {
    const tt = rowFields(t);
    const credit = num(tt.credit);
    let taxableValue = optNum(tt.taxableValue);
    let gstAmount = optNum(tt.gstAmount);
    const gstRate = optNum(tt.gstRate);

    // Sanity-check the model's tax split against the amount it sits on. A split
    // that does not add up is DISCARDED rather than used — falling back to "tax
    // not identified", which the engine flags for a human declaration. Trusting
    // an inconsistent split would silently understate the disallowance.
    if (taxableValue !== undefined && gstAmount !== undefined && credit > 0) {
      if (Math.abs(taxableValue + gstAmount - credit) > 1) {
        taxableValue = undefined;
        gstAmount = undefined;
      }
    }
    if (taxableValue !== undefined && (taxableValue < 0 || taxableValue > credit + 1)) taxableValue = undefined;
    if (gstAmount !== undefined && (gstAmount < 0 || gstAmount > credit)) gstAmount = undefined;

    return {
      date: str(tt.date),
      particulars: str(tt.particulars),
      vchType: str(tt.vchType) || undefined,
      vchNo: str(tt.vchNo) || undefined,
      debit: num(tt.debit),
      credit,
      taxableValue,
      gstAmount,
      // Only keep a rate that is actually a GST rate.
      gstRate: gstRate !== undefined && gstRate >= 0 && gstRate <= 28 ? gstRate : undefined,
    };
  }).filter((t) => t.date && (t.debit > 0 || t.credit > 0));

  const periodFrom = str(r.periodFrom) || undefined;
  const rawVendorName = str(r.vendorName).trim();
  const where = contextLabel ? ` (${contextLabel} of "${sourceFile}")` : ` (in "${sourceFile}")`;
  const vendorName = rawVendorName || `${UNRESOLVED_VENDOR_PREFIX}${where}`;
  const warnings: string[] = [];
  if (!rawVendorName) {
    warnings.push(
      `The vendor name could not be read from${where} — the header may sit outside the chunk that was read. ` +
      'These transactions have NOT been assumed to belong to any other vendor in this upload; identify the ' +
      'correct party and re-run, or manually reassign this ledger before relying on its figures.',
    );
  }
  const led: VendorLedger = {
    vendorName,
    financialYear: str(r.financialYear) || (periodFrom ? fyFromStart(periodFrom) : undefined),
    periodFrom,
    periodTo: str(r.periodTo) || undefined,
    openingBalance: num(r.openingBalance),
    closingBalance: num(r.closingBalance),
    txns,
    format: 'ai',
    sourceFile,
    warnings,
  };
  return reconcile ? reconcileLedger(led) : led;
}
