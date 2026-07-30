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
import { pdfPageCount, pdfPageTexts } from './pdfText';

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
 */
async function describeInvokeError(
  error: { name?: string; message?: string; context?: unknown },
  fileName: string,
): Promise<Error> {
  const msg = error.message || '';

  if (/Failed to send a request|Failed to fetch|NetworkError|FunctionsFetchError/i.test(msg) || error.name === 'FunctionsFetchError') {
    return new Error(
      'Could not reach the ledger-reading service (msme-extract-ledger). It is most likely not deployed yet — ' +
      'run "npx supabase functions deploy msme-extract-ledger". ' +
      'If it is deployed, check your network connection and try again.',
    );
  }
  if (/timeout|timed out/i.test(msg)) {
    return new Error(`Reading "${fileName}" timed out. Very large ledgers can exceed the limit — try splitting the PDF.`);
  }

  // A non-2xx: the function ran and reported something. Get it out of the body.
  const detail = await readErrorBody(error.context);
  if (detail) {
    const status = (error.context as Response | undefined)?.status;
    return new Error(`The ledger-reading service failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
  }
  return new Error(msg || 'The ledger-reading service failed.');
}

/**
 * supabase-js puts the raw Response on error.context for an HTTP error. Reading
 * it is best-effort: the body may already be consumed, may not be JSON, or may
 * be empty, and none of those should replace the original error with a new one.
 */
async function readErrorBody(context: unknown): Promise<string | null> {
  const res = context as Response | undefined;
  if (!res || typeof res.text !== 'function') return null;
  try {
    const text = (await res.text()).trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      const picked = parsed.error || parsed.message;
      if (picked) return String(picked).slice(0, 500);
    } catch {
      // Not JSON — the raw text is still the most useful thing available.
    }
    return text.slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Pages per request when a merged export has to be split.
 *
 * THE BINDING CONSTRAINT IS TIME, NOT SIZE. A Supabase edge function is killed
 * after 150 seconds with no bytes written to the response, and the function does
 * not write anything until the model has finished, so the whole model call has
 * to fit inside 150 seconds. This was 8 pages against a 32,000-token output cap
 * — a reply that long takes several minutes to generate and could never have
 * arrived in time, which is exactly the 504 the firm hit.
 *
 * 3 pages against an 8,000-token cap (see msme-extract-ledger) is a call that
 * completes in tens of seconds. It means more requests per file, and the page
 * range of each is shown as it runs, so a long file visibly progresses instead
 * of appearing to hang.
 */
const PAGES_PER_CHUNK = 3;

/**
 * Above this, the file is treated as a merged export and split. Below it, the
 * PDF is sent whole as a document, which reads better and is the only way a
 * SCANNED ledger can be read at all.
 */
const CHUNK_THRESHOLD_PAGES = 4;

/** A 504/timeout from the platform rather than a refusal by the model. */
function isTimeout(message: string): boolean {
  return /idle timeout|504|timed out|timeout/i.test(message);
}

/** Extract vendor ledgers from a PDF of any format via Claude. */
export async function extractLedgersViaAI(
  file: File,
  onProgress?: (note: string) => void,
): Promise<AiExtractResult> {
  const buf = await file.arrayBuffer();

  let pages = 0;
  try {
    pages = await pdfPageCount(buf);
  } catch {
    // Not readable as a PDF here — let the model try the whole file.
  }

  if (pages > CHUNK_THRESHOLD_PAGES) {
    return extractByChunks(file, buf, pages, onProgress);
  }

  const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
    body: { pdf_base64: await bufferToBase64(buf), filename: file.name },
  });
  if (error) throw await describeInvokeError(error, file.name);
  if (data?.error) throw new Error(data.error);

  const rawLedgers: unknown[] = Array.isArray(data?.ledgers) ? data.ledgers : [];
  const ledgers = rawLedgers.map((raw) => mapLedger(raw, file.name));
  return { ledgers, truncated: !!data?.truncated };
}

/**
 * A MERGED export — every vendor's ledger in one PDF — read in page ranges.
 *
 * Sent whole, such a file blows past a single reply and comes back truncated
 * mid-JSON, which is discarded: the entire upload fails for want of headroom.
 * So the text is split by page range, each range read separately, and the
 * vendors stitched back together afterwards. A ledger that straddles a boundary
 * is rejoined by name in mergeLedgers().
 */
async function extractByChunks(
  file: File,
  buf: ArrayBuffer,
  pages: number,
  onProgress?: (note: string) => void,
): Promise<AiExtractResult> {
  const texts = await pdfPageTexts(buf);
  const chunks: Array<{ from: number; to: number; text: string }> = [];
  for (let i = 0; i < texts.length; i += PAGES_PER_CHUNK) {
    const slice = texts.slice(i, i + PAGES_PER_CHUNK);
    const text = slice.map((t, j) => `--- page ${i + j + 1} ---\n${t}`).join('\n\n');
    if (text.trim()) chunks.push({ from: i + 1, to: Math.min(i + PAGES_PER_CHUNK, texts.length), text });
  }

  if (!chunks.length) {
    throw new Error(
      `"${file.name}" has ${pages} pages but no readable text — it is probably a scan. ` +
      `Split it into files of ${CHUNK_THRESHOLD_PAGES} pages or fewer so each can be read as an image.`,
    );
  }

  const collected: VendorLedger[] = [];
  let truncated = false;
  const failures: string[] = [];

  /** Read one page range. Returns null and records the reason on failure. */
  const readRange = async (c: { from: number; to: number; text: string }): Promise<unknown[] | null> => {
    onProgress?.(`${file.name}: pages ${c.from}–${c.to} of ${pages}`);
    const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
      body: { text_content: c.text, filename: file.name, page_range: `${c.from}-${c.to}` },
    });
    if (error) {
      const described = await describeInvokeError(error, file.name);
      // A timeout is about THIS range being too dense, not about the file, so it
      // is retried smaller below rather than abandoning the other ranges.
      if (isTimeout(described.message)) return null;
      throw described;
    }
    if (data?.error) {
      failures.push(`pages ${c.from}–${c.to}: ${data.error}`);
      return [];
    }
    truncated = truncated || !!data?.truncated;
    return Array.isArray(data?.ledgers) ? data.ledgers : [];
  };

  for (const c of chunks) {
    let got = await readRange(c);

    // Timed out: a dense range can hold more rows than one call can emit inside
    // the platform's 150-second window. Retry it a page at a time — one page of
    // a ledger is always small enough — instead of losing the range entirely.
    if (got === null) {
      onProgress?.(`${file.name}: pages ${c.from}–${c.to} were too dense, retrying page by page`);
      got = [];
      for (let p = c.from; p <= c.to; p++) {
        const single = {
          from: p,
          to: p,
          text: `--- page ${p} ---\n${texts[p - 1] ?? ''}`,
        };
        if (!single.text.trim()) continue;
        const one = await readRange(single);
        if (one === null) {
          failures.push(`page ${p}: timed out even on its own — the page is unusually dense`);
          continue;
        }
        got.push(...one);
      }
    }

    for (const raw of got) collected.push(mapLedger(raw, file.name, false));
  }

  if (!collected.length) {
    throw new Error(`Could not read any ledger from "${file.name}". ${failures.join('; ')}`);
  }

  const merged = mergeLedgers(collected);
  // Reconcile only once the pieces are whole — a half-ledger never balances.
  const reconciled = merged.map((l) => reconcileLedger(l));
  for (const l of reconciled) {
    if (failures.length) l.warnings = [...(l.warnings || []), `Some page ranges of ${file.name} could not be read: ${failures.join('; ')}`];
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

function mapLedger(raw: unknown, sourceFile: string, reconcile = true): VendorLedger {
  const r = (raw ?? {}) as Record<string, unknown>;
  const txns: LedgerTxn[] = (Array.isArray(r.txns) ? r.txns : []).map((t) => {
    const tt = (t ?? {}) as Record<string, unknown>;
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
