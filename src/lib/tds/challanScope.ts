import { withChallanInterest } from "./rateEngine";

/**
 * Which deductee rows count against a challan, and how a separate
 * interest-only challan offsets the interest on the others. Shared by
 * TdsDataEntry.tsx (challan cards, detail bar, edit guard) and
 * TdsValidateFinalise.tsx (Stage-1 over-applied gate) so both screens reach
 * the same "Over-applied" verdict.
 */

/** Sortable period number: FY 2026-27 Q2 → 20262. NaN when either part is missing. */
export const periodNum = (fy: string | null | undefined, quarter: string | null | undefined): number => {
  if (!fy || !quarter) return NaN;
  return parseInt(fy.split("-")[0], 10) * 10 + parseInt(quarter.replace(/^Q/i, ""), 10);
};

type Period = { quarter?: string | null; financial_year?: string | null };

/**
 * A challan's balance is drawn on by entries of its OWN quarter and of later
 * quarters (carry-forward). An entry from a quarter BEFORE the challan's own
 * one cannot have been paid from it — that return was already filed with
 * its own challans. Such rows end up attached when an import matched a
 * different challan that happened to share the same Bank Challan Number
 * (e.g. a 24Q Q1 return's 99 salary entries, ₹8,45,043, sitting on a Q2
 * challan of ₹26,464). They stay visible as read-only history but are not
 * counted toward this challan's Applied. With either period unknown the row
 * counts, as before.
 */
export const countsAgainstChallan = (challan: Period | null | undefined, row: Period): boolean => {
  const c = periodNum(challan?.financial_year, challan?.quarter);
  const r = periodNum(row.financial_year, row.quarter);
  if (Number.isNaN(c) || Number.isNaN(r)) return true;
  return r >= c;
};

export const rowsCountedAgainst = <T extends Period>(challan: Period | null | undefined, rows: T[]): T[] =>
  rows.filter((r) => countsAgainstChallan(challan, r));

type ChallanLike = {
  id: string; deposit_date?: string | null;
  total_tax_deposited?: number | null; surcharge_deposited?: number | null; interest_deposited?: number | null;
};
type RowLike = { tds_amount?: number | null; total_tax_deducted?: number | null; date_of_payment?: string | null };

/** A challan that carries only interest (no TDS / surcharge) — Genius records
 *  late-deposit interest as its own challan. */
export const isInterestOnlyChallan = (c: Pick<ChallanLike, "total_tax_deposited" | "surcharge_deposited" | "interest_deposited">) =>
  (c.total_tax_deposited || 0) === 0 && (c.surcharge_deposited || 0) === 0 && (c.interest_deposited || 0) > 0;

/** The TDS figure Data Entry works interest out on. */
export const tdsOfEntry = (d: { tds_amount?: number | null; total_tax_deducted?: number | null }) =>
  d.tds_amount || d.total_tax_deducted || 0;

/**
 * When the filing has a separate interest-only challan, interest is paid on
 * THAT challan, so the late-deposit interest the other challans' entries owe
 * (beyond what each declares itself) is never counted against those TDS
 * challans — otherwise they read "Over-applied" purely because the interest
 * was shown separately. The interest challan's deposit is matched against
 * that interest, oldest TDS challan first:
 *   via      TDS challan id  -> interest left out of its Applied (all of it)
 *   avail    TDS challan id  -> same allowance, for the edit guard
 *   consumed interest challan id -> part of its deposit that was matched
 *   shortfall interest owed beyond every interest challan's deposit — shown
 *            as an interest short-payment, not as an over-applied TDS challan
 * With no interest-only challan in the list the plan is empty.
 */
export function planInterestChallans<C extends ChallanLike>(
  challans: C[], rowsOf: (c: C) => RowLike[],
): { avail: Map<string, number>; via: Map<string, number>; consumed: Map<string, number>; shortfall: number } {
  const avail = new Map<string, number>();
  const via = new Map<string, number>();
  const consumed = new Map<string, number>();
  const interestOnly = challans.filter(isInterestOnlyChallan);
  if (interestOnly.length === 0) return { avail, via, consumed, shortfall: 0 };
  const byDate = (x: C, y: C) => (x.deposit_date || "").localeCompare(y.deposit_date || "");
  const pool = interestOnly.reduce((sum, c) => sum + (c.interest_deposited || 0), 0);
  let owed = 0;
  for (const c of challans.filter((x) => !isInterestOnlyChallan(x)).sort(byDate)) {
    const live = withChallanInterest(rowsOf(c) as any[], c.deposit_date || null, tdsOfEntry).reduce((sum, r) => sum + r.interest_amount, 0);
    const excess = Math.max(0, live - (c.interest_deposited || 0));
    owed += excess;
    via.set(c.id, excess);
    // Any interest an edit adds is likewise owed to the interest challan.
    avail.set(c.id, Number.POSITIVE_INFINITY);
  }
  let used = Math.min(owed, pool);
  for (const c of [...interestOnly].sort(byDate)) {
    const part = Math.min(c.interest_deposited || 0, used);
    consumed.set(c.id, part);
    used -= part;
  }
  return { avail, via, consumed, shortfall: Math.max(0, owed - pool) };
}
