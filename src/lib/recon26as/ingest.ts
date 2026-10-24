// File → entries, for both sides. Deterministic readers first; the AI reader
// (tds-26as-recon-ai) only for what they do not recognise, and every AI read
// is labelled so the reviewer knows which figures came from it.

import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { describeFunctionError } from '@/lib/msme43b/invokeError';
import { pdfPageTexts } from '@/lib/msme43b/pdfText';
import type { ParseResult, PartyLink, TdsEntry } from './types';
import { parse26asFlat, parse26asPdfLines, parse26asTraces, textToRows } from './parse26as';
import { parseLedgerRows, cleanParticulars, type LedgerNature } from './parseLedger';
import { rowsPreview, type ColumnMap, type Row } from './tabular';
import { parseAmount, parseDate, round2, TAN_RE } from './parseUtils';
import type { PartySummary } from './engine';

export const AI_FN = 'tds-26as-recon-ai';
const PAGES_PER_CALL = 5;

async function callAi<T>(body: Record<string, unknown>, whatFor: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(AI_FN, { body });
  if (error) throw new Error((await describeFunctionError(error, AI_FN, whatFor)).message);
  if (data?.error) throw new Error(`${whatFor} failed: ${data.error}`);
  return data as T;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const ext = (f: File) => (f.name.split('.').pop() || '').toLowerCase();

function sheetRows(buf: ArrayBuffer): Row[][] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json<Row>(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
}

type AiRow = {
  party?: string; tan?: string | null; section?: string | null; date?: string | null;
  amount_paid?: number | string | null; tds?: number | string | null; tds_deposited?: number | string | null;
  status?: string | null; part?: string | null; ref?: string | null;
};

function aiRowsToEntries(rows: AiRow[], side: 'books' | '26as', file: string): TdsEntry[] {
  const out: TdsEntry[] = [];
  for (const r of rows || []) {
    const tds = parseAmount(r.tds);
    const party = side === 'books' ? cleanParticulars(String(r.party ?? '')) : String(r.party ?? '').trim();
    if (!party || tds === null || tds === 0) continue;
    const tan = String(r.tan ?? '').toUpperCase().trim();
    out.push({
      id: '',
      side,
      party,
      tan: TAN_RE.test(tan) ? tan : undefined,
      section: r.section || undefined,
      date: parseDate(r.date),
      amountPaid: parseAmount(r.amount_paid) ?? undefined,
      tds: round2(tds),
      tdsDeposited: parseAmount(r.tds_deposited) ?? undefined,
      bookingStatus: r.status || undefined,
      ref: [r.part && r.part !== 'I' ? `Part ${r.part}` : '', r.ref || ''].filter(Boolean).join(' · ') || undefined,
      file,
    });
  }
  return out;
}

/** AI read of a PDF / text, page-chunked so a long file never overflows one reply. */
async function aiExtract(file: File, kind: '26as' | 'ledger', onNote?: (s: string) => void, textPages?: string[]): Promise<ParseResult> {
  const side = kind === '26as' ? '26as' : 'books';
  const entries: TdsEntry[] = [];
  const warnings: string[] = [`${file.name}: read by AI — check the figures against the document.`];
  const excluded: ParseResult['excluded'] = [];
  let assessee: ParseResult['assessee'];
  const printed: Record<string, number> = {};

  const hasText = textPages && textPages.join('').trim().length > 50;
  if (!hasText) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} has no text layer and is too large to send to the AI reader. Upload the TRACES text / Excel export instead.`);
    onNote?.(`AI reading ${file.name}…`);
    type R = { rows: AiRow[]; assessee?: ParseResult['assessee']; truncated?: boolean };
    const res = await callAi<R>({ action: 'extract', kind, pdf_base64: await fileToBase64(file), file_name: file.name }, `Reading ${file.name}`);
    entries.push(...aiRowsToEntries(res.rows, side, file.name));
    if (res.truncated) warnings.push(`${file.name}: the AI reply was cut off — some lines may be missing.`);
    assessee = res.assessee;
  } else {
    for (let i = 0; i < textPages!.length; i += PAGES_PER_CALL) {
      const chunk = textPages!.slice(i, i + PAGES_PER_CALL);
      onNote?.(`AI reading ${file.name}, pages ${i + 1}–${i + chunk.length} of ${textPages!.length}…`);
      type R = {
        rows: AiRow[]; assessee?: ParseResult['assessee']; truncated?: boolean;
        deductor_totals?: Array<{ tan: string; tds: number }>; skipped?: Array<{ text: string; reason: string }>;
      };
      const res = await callAi<R>({ action: 'extract', kind, text: chunk.join('\n\n--- page break ---\n\n'), file_name: file.name }, `Reading ${file.name}`);
      entries.push(...aiRowsToEntries(res.rows, side, file.name));
      if (res.truncated) warnings.push(`${file.name} pages ${i + 1}–${i + chunk.length}: the AI reply was cut off — some lines may be missing.`);
      assessee = assessee ?? res.assessee;
      for (const t of res.deductor_totals || []) if (t?.tan) printed[t.tan] = round2(Number(t.tds) || 0);
      for (const s of res.skipped || []) excluded.push({ file: file.name, text: s.text, reason: s.reason });
    }
  }
  // the same oracle the deterministic reader uses
  if (kind === '26as') {
    for (const [tan, total] of Object.entries(printed)) {
      const got = round2(entries.filter((e) => e.tan === tan).reduce((s, e) => s + e.tds, 0));
      if (Math.abs(got - total) > 1) warnings.push(`${tan}: lines read add to ₹${got.toLocaleString('en-IN')} but the printed total is ₹${total.toLocaleString('en-IN')}.`);
    }
  }
  if (!entries.length) throw new Error(`No TDS lines could be read from ${file.name}.`);
  return { entries, excluded, warnings, method: 'ai', assessee, printedTotals: printed };
}

export async function read26as(file: File, onNote?: (s: string) => void): Promise<ParseResult> {
  const e = ext(file);
  if (e === 'pdf') {
    const pages = await pdfPageTexts(await file.arrayBuffer()).catch(() => [] as string[]);
    const det = parse26asPdfLines(pages.flatMap((p) => p.split('\n')), file.name);
    if (det && !det.warnings.some((w) => /line items add/.test(w))) return det;
    return aiExtract(file, '26as', onNote, pages);
  }
  if (e === 'txt' || e === 'tsv') {
    const text = await file.text();
    const rows = textToRows(text);
    const det = parse26asTraces(rows, file.name) ?? parse26asFlat(rows, file.name);
    if (det) return det;
    return aiExtract(file, '26as', onNote, [text]);
  }
  for (const rows of sheetRows(await file.arrayBuffer())) {
    const det = parse26asTraces(rows, file.name) ?? parse26asFlat(rows, file.name);
    if (det) return det;
  }
  const text = sheetRows(await file.arrayBuffer()).map((r) => rowsPreview(r, 2000)).join('\n\n');
  return aiExtract(file, '26as', onNote, [text]);
}

export async function readLedger(file: File, nature: LedgerNature, onNote?: (s: string) => void): Promise<ParseResult> {
  const e = ext(file);
  if (e === 'pdf') {
    const pages = await pdfPageTexts(await file.arrayBuffer()).catch(() => [] as string[]);
    return aiExtract(file, 'ledger', onNote, pages);
  }
  const sheets = e === 'txt' || e === 'tsv' ? [textToRows(await file.text())] : sheetRows(await file.arrayBuffer());
  for (const rows of sheets) {
    const det = parseLedgerRows(rows, file.name, { nature });
    if (det) return det;
  }
  // header not recognised: ask the AI which column is which, then read deterministically
  for (const rows of sheets) {
    if (rows.length < 2) continue;
    onNote?.(`AI identifying the columns of ${file.name}…`);
    type R = { header_row: number; columns: ColumnMap; nature?: string; note?: string };
    const res = await callAi<R>({ action: 'map_columns', preview: rowsPreview(rows), file_name: file.name }, `Reading the columns of ${file.name}`);
    if (typeof res?.header_row !== 'number' || !res.columns) continue;
    const det = parseLedgerRows(rows, file.name, {
      mapping: { headerRow: res.header_row, map: res.columns },
      nature: nature !== 'auto' ? nature : res.nature === 'credit' ? 'credit' : res.nature === 'debit' ? 'debit' : 'auto',
    });
    if (det) {
      det.warnings.unshift(`${file.name}: columns identified by AI${res.note ? ` — ${res.note}` : ''}.`);
      return det;
    }
  }
  return aiExtract(file, 'ledger', onNote, sheets.map((r) => rowsPreview(r, 3000)));
}

/** AI links for parties the deterministic pass left open. */
export async function aiMatchParties(books: PartySummary[], deductors: PartySummary[]): Promise<PartyLink[]> {
  type R = { links: Array<{ book_key: string; deductor_key: string; confidence: number; reason: string }> };
  const res = await callAi<R>({
    action: 'match_parties',
    books: books.map((b) => ({ key: b.key, name: b.name, total: b.total, count: b.count })),
    deductors: deductors.map((d) => ({ key: d.key, name: d.name, tan: d.tan, total: d.total, count: d.count })),
  }, 'AI party matching');
  const bk = new Set(books.map((b) => b.key)), dk = new Set(deductors.map((d) => d.key));
  return (res.links || [])
    .filter((l) => bk.has(l.book_key) && dk.has(l.deductor_key))
    .map((l) => ({
      bookKey: l.book_key,
      deductorKey: l.deductor_key,
      method: 'ai' as const,
      confidence: Math.max(0, Math.min(100, Math.round(Number(l.confidence) || 0))),
      reason: `AI: ${l.reason || 'judged the same payer'}`,
    }));
}

export interface AiReview {
  summary: string;
  findings: Array<{ severity: 'high' | 'medium' | 'low'; title: string; detail: string; action: string }>;
  next_steps: string[];
}

/** A senior reviewer's 360° read of the finished reconciliation. */
export async function aiReview(facts: unknown): Promise<AiReview> {
  const res = await callAi<Partial<AiReview>>({ action: 'review', facts }, 'AI 360° review');
  return {
    summary: String(res.summary || ''),
    findings: Array.isArray(res.findings) ? res.findings : [],
    next_steps: Array.isArray(res.next_steps) ? res.next_steps.map(String) : [],
  };
}
