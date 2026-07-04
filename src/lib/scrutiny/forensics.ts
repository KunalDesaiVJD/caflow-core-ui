/**
 * Forensic analytics (Phase 5, Ticket 5.1 — behind VITE_SCRUTINY_V2).
 *
 * Two classic forensic tests over voucher-level data:
 *  - Benford's Law: the leading-digit distribution of genuine accounting amounts follows a known
 *    curve; large deviations can indicate fabricated or manipulated figures.
 *  - Duplicate detection: same amount + date + party repeated = a possible double payment.
 *
 * Pure + dependency-free → unit-testable without a DB. Operates on the engine's VoucherRow shape.
 */

import type { VoucherRow } from "./detectionEngine";

// ── Benford's Law ──────────────────────────────────────────────────────────

export interface BenfordDigit {
  digit: number; // 1..9
  observed: number; // count
  observedPct: number; // %
  expectedPct: number; // Benford %
  deviation: number; // observedPct - expectedPct (percentage points)
}

export type BenfordVerdict = "insufficient" | "close" | "acceptable" | "marginal" | "nonconforming";

export interface BenfordResult {
  total: number; // amounts with a valid leading digit
  digits: BenfordDigit[]; // 9 entries (digit 1..9)
  mad: number; // mean absolute deviation (Nigrini units, fraction)
  verdict: BenfordVerdict;
}

/** First significant digit (1..9) of |n|, or null for 0 / sub-1 / non-finite. */
export function leadingDigit(n: number): number | null {
  let x = Math.abs(n);
  if (!Number.isFinite(x) || x < 1) return null;
  while (x >= 10) x /= 10;
  const d = Math.floor(x);
  return d >= 1 && d <= 9 ? d : null;
}

const benfordExpectedFraction = (d: number): number => Math.log10(1 + 1 / d);

export function benfordAnalysis(amounts: number[]): BenfordResult {
  const counts = new Array(10).fill(0); // use indices 1..9
  let total = 0;
  for (const n of amounts) {
    const d = leadingDigit(n);
    if (d) { counts[d]++; total++; }
  }
  const digits: BenfordDigit[] = [];
  let madSum = 0;
  for (let d = 1; d <= 9; d++) {
    const obsFrac = total ? counts[d] / total : 0;
    const expFrac = benfordExpectedFraction(d);
    digits.push({
      digit: d,
      observed: counts[d],
      observedPct: obsFrac * 100,
      expectedPct: expFrac * 100,
      deviation: (obsFrac - expFrac) * 100,
    });
    madSum += Math.abs(obsFrac - expFrac);
  }
  const mad = total ? madSum / 9 : 0;
  // Nigrini MAD bands (first-digit test); "insufficient" when the sample is too small to trust.
  let verdict: BenfordVerdict;
  if (total < 50) verdict = "insufficient";
  else if (mad < 0.006) verdict = "close";
  else if (mad < 0.012) verdict = "acceptable";
  else if (mad < 0.015) verdict = "marginal";
  else verdict = "nonconforming";
  return { total, digits, mad, verdict };
}

// ── Duplicate detection ────────────────────────────────────────────────────

export interface DuplicateGroup {
  key: string;
  amount: number;
  date: string;
  party: string;
  vouchers: VoucherRow[];
  count: number;
}

const partyOf = (v: VoucherRow): string => (v.party_ledger ?? v.ledger_name ?? "").trim();
const dupKey = (v: VoucherRow): string =>
  `${Math.round(Math.abs(v.amount ?? 0) * 100)}|${(v.voucher_date ?? "").trim()}|${partyOf(v).toLowerCase()}`;

/**
 * Group vouchers that share amount + date + party (a possible double payment).
 * `minAmount` skips small/noise amounts; vouchers without a date are ignored.
 * Returned groups have count >= 2, most-repeated (then largest) first.
 */
export function findDuplicates(vouchers: VoucherRow[], minAmount = 0): DuplicateGroup[] {
  const byKey = new Map<string, VoucherRow[]>();
  for (const v of vouchers) {
    if (Math.abs(v.amount ?? 0) < minAmount) continue;
    if (!v.voucher_date) continue;
    const k = dupKey(v);
    const arr = byKey.get(k);
    if (arr) arr.push(v);
    else byKey.set(k, [v]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, vs] of byKey) {
    if (vs.length > 1) {
      groups.push({
        key,
        amount: Math.abs(vs[0].amount ?? 0),
        date: vs[0].voucher_date ?? "",
        party: partyOf(vs[0]),
        vouchers: vs,
        count: vs.length,
      });
    }
  }
  return groups.sort((a, b) => b.count - a.count || b.amount - a.amount);
}
