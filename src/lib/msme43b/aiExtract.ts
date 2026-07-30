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
import { fyFromStart } from './parseUtils';
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
 */
const LINES_PER_CHUNK = 80;

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
    for (const raw of await readPages(nums)) collected.push(mapLedger(raw, file.name, false));
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
    for (const raw of await readChunk(group)) collected.push(mapLedger(raw, file.name, false));
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
 * Rejoin the pieces of a ledger that spanned several page ranges.
 *
 * Opening comes from the FIRST range that stated one and closing from the LAST,
 * because those are the only ranges that can have seen them. Transactions are
 * concatenated in date order, with exact duplicates dropped — a row can appear
 * twice when a bill's detail lines straddle a page break and both ranges report it.
 */
function mergeLedgers(parts: VendorLedger[]): VendorLedger[] {
  const byVendor = new Map<string, VendorLedger[]>();
  for (const p of parts) {
    const k = nameKey(p.vendorName);
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

export function mapLedger(raw: unknown, sourceFile: string, reconcile = true): VendorLedger {
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
  const led: VendorLedger = {
    vendorName: str(r.vendorName) || sourceFile.replace(/\.[Pp][Dd][Ff]$/, ''),
    financialYear: str(r.financialYear) || (periodFrom ? fyFromStart(periodFrom) : undefined),
    periodFrom,
    periodTo: str(r.periodTo) || undefined,
    openingBalance: num(r.openingBalance),
    closingBalance: num(r.closingBalance),
    txns,
    format: 'ai',
    sourceFile,
    warnings: [],
  };
  return reconcile ? reconcileLedger(led) : led;
}
