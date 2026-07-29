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

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
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
 * on. "Failed to send a request to the Edge Function" is what you get when the
 * function is not deployed at all, and on its own it tells the user nothing.
 */
function describeInvokeError(error: { name?: string; message?: string }, fileName: string): Error {
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
  return new Error(msg || 'The ledger-reading service failed.');
}

/** Extract vendor ledgers from a PDF of any format via Claude. */
export async function extractLedgersViaAI(file: File): Promise<AiExtractResult> {
  const pdf_base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
    body: { pdf_base64, filename: file.name },
  });
  if (error) throw describeInvokeError(error, file.name);
  if (data?.error) throw new Error(data.error);

  const rawLedgers: unknown[] = Array.isArray(data?.ledgers) ? data.ledgers : [];
  const ledgers = rawLedgers.map((raw) => mapLedger(raw, file.name));
  return { ledgers, truncated: !!data?.truncated };
}

function mapLedger(raw: unknown, sourceFile: string): VendorLedger {
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
  return reconcileLedger(led);
}
