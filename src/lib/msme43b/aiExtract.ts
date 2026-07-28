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

interface AiExtractResult {
  ledgers: VendorLedger[];
  truncated: boolean;
}

/** Extract vendor ledgers from a PDF of any format via Claude. */
export async function extractLedgersViaAI(file: File): Promise<AiExtractResult> {
  const pdf_base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('msme-extract-ledger', {
    body: { pdf_base64, filename: file.name },
  });
  if (error) throw new Error(error.message || 'AI extraction request failed');
  if (data?.error) throw new Error(data.error);

  const rawLedgers: unknown[] = Array.isArray(data?.ledgers) ? data.ledgers : [];
  const ledgers = rawLedgers.map((raw) => mapLedger(raw, file.name));
  return { ledgers, truncated: !!data?.truncated };
}

function mapLedger(raw: unknown, sourceFile: string): VendorLedger {
  const r = (raw ?? {}) as Record<string, unknown>;
  const txns: LedgerTxn[] = (Array.isArray(r.txns) ? r.txns : []).map((t) => {
    const tt = (t ?? {}) as Record<string, unknown>;
    return {
      date: str(tt.date),
      particulars: str(tt.particulars),
      vchType: str(tt.vchType) || undefined,
      vchNo: str(tt.vchNo) || undefined,
      debit: num(tt.debit),
      credit: num(tt.credit),
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
