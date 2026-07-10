/**
 * Manual-upload reconciliation (Phase 5, Ticket 5.3 — behind VITE_SCRUTINY_V2).
 *
 * Canonical decision #9: GST-2B / 26AS / bank come in by manual file upload. The auditor uploads
 * an external file; we turn its rows and the book vouchers into normalised entries and reconcile:
 * matched, only-in-file (e.g. invoices/credits not booked), only-in-books.
 *
 * v1 matches by amount (a coarse but useful first pass — "does every amount in the statement
 * appear in the books, and vice versa?"); "amount_date" tightens it when dates are comparable.
 * Pure + dependency-free → unit-testable without a DB or a file.
 */

import type { VoucherRow } from "./detectionEngine";

export interface ReconEntry {
  key: string; // match key
  amount: number; // absolute value
  label: string; // display (date · ref)
}

export type ReconMode = "amount" | "amount_date";

export interface ReconResult {
  matched: { external: ReconEntry; book: ReconEntry }[];
  onlyExternal: ReconEntry[]; // in the uploaded file, not the books
  onlyBook: ReconEntry[]; // in the books, not the file
  externalTotal: number;
  bookTotal: number;
  matchedTotal: number;
}

const round2 = (n: number): string => String(Math.round(Math.abs(n) * 100));
export const keyFor = (amount: number, date: string, mode: ReconMode): string =>
  mode === "amount_date" ? `${round2(amount)}|${(date ?? "").trim()}` : round2(amount);

/** Greedy one-to-one reconciliation by key. */
export function reconcile(external: ReconEntry[], book: ReconEntry[]): ReconResult {
  const bookByKey = new Map<string, ReconEntry[]>();
  for (const b of book) {
    const arr = bookByKey.get(b.key);
    if (arr) arr.push(b);
    else bookByKey.set(b.key, [b]);
  }
  const matched: { external: ReconEntry; book: ReconEntry }[] = [];
  const onlyExternal: ReconEntry[] = [];
  for (const e of external) {
    const arr = bookByKey.get(e.key);
    if (arr && arr.length) matched.push({ external: e, book: arr.shift()! });
    else onlyExternal.push(e);
  }
  const onlyBook: ReconEntry[] = [];
  for (const arr of bookByKey.values()) onlyBook.push(...arr);

  const sum = (xs: ReconEntry[]) => xs.reduce((s, x) => s + x.amount, 0);
  return {
    matched,
    onlyExternal,
    onlyBook,
    externalTotal: sum(external),
    bookTotal: sum(book),
    matchedTotal: matched.reduce((s, m) => s + m.external.amount, 0),
  };
}

/** Book vouchers -> reconciliation entries. */
export function entriesFromVouchers(vouchers: VoucherRow[], mode: ReconMode = "amount"): ReconEntry[] {
  const out: ReconEntry[] = [];
  for (const v of vouchers) {
    const amount = Math.abs(v.amount ?? 0);
    if (amount === 0) continue;
    const date = (v.voucher_date ?? "").trim();
    out.push({
      key: keyFor(amount, date, mode),
      amount,
      label: [date, (v.party_ledger ?? v.ledger_name ?? "").trim(), v.voucher_number ?? ""].filter(Boolean).join(" · "),
    });
  }
  return out;
}

// Heuristic column matching for arbitrary uploaded rows (GST-2B / 26AS / bank exports vary).
const AMOUNT_HEADERS = ["taxable value", "invoice value", "amount paid", "amount credited", "amount", "value", "credit", "debit", "tds", "total"];
const DATE_HEADERS = ["invoice date", "value date", "txn date", "transaction date", "date"];
const REF_HEADERS = ["gstin", "invoice", "deductor", "particulars", "narration", "description", "name", "tan", "ref"];

function pickNumber(row: Record<string, unknown>, headers: string[]): number | null {
  for (const h of headers) {
    for (const k of Object.keys(row)) {
      if (k.toLowerCase().trim().includes(h)) {
        const n = Number(String(row[k] ?? "").replace(/[,₹\s]/g, ""));
        if (Number.isFinite(n) && n !== 0) return n;
      }
    }
  }
  return null;
}
function pickString(row: Record<string, unknown>, headers: string[]): string {
  for (const h of headers) {
    for (const k of Object.keys(row)) {
      if (k.toLowerCase().trim().includes(h)) {
        const s = String(row[k] ?? "").trim();
        if (s) return s;
      }
    }
  }
  return "";
}

/** Parsed file rows -> reconciliation entries (best-effort column detection). */
export function entriesFromRows(rows: Record<string, unknown>[], mode: ReconMode = "amount"): ReconEntry[] {
  const out: ReconEntry[] = [];
  for (const row of rows) {
    const amount = pickNumber(row, AMOUNT_HEADERS);
    if (amount == null) continue;
    const date = pickString(row, DATE_HEADERS);
    const ref = pickString(row, REF_HEADERS);
    out.push({
      key: keyFor(Math.abs(amount), date, mode),
      amount: Math.abs(amount),
      label: [date, ref].filter(Boolean).join(" · ") || "row",
    });
  }
  return out;
}
