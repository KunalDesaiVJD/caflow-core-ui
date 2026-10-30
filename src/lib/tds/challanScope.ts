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

/** A leftover this small after the interest has been matched is day-count /
 *  rounding noise between CAFlow's figure and Genius's (Shivon Infra: ₹215
 *  paid vs ₹212 calculated), not a real overpayment worth showing as
 *  Unconsumed. Anything above it is shown as it is. */
export const INTEREST_SURPLUS_TOLERANCE = 10;

/**
 * Interest u/s 201(1A) in a Genius return is ONE pool across the filing, not a
 * figure each challan settles for its own entries. Two real shapes:
 *   - a separate interest-only challan (TDS 0, only Interest — Shivon Infra,
 *     BSR 0510002, ₹215) that pays the interest of the other challans;
 *   - an ordinary TDS challan that declares more interest than ITS OWN entries
 *     owe, the extra paying the others' (ACCU-Panels Energy Q2: the 21/10
 *     challan declares ₹800 against about ₹120 of its own, while three earlier
 *     challans declare ₹321 / ₹3 / ₹290 less than their entries calculate to).
 * Counting each challan's calculated interest against ITS OWN total made the
 * under-declaring ones read "Over-applied" and the over-declaring one
 * "Unconsumed", though across the filing the interest paid matched the
 * interest owed.
 *
 * So every challan's surplus (an interest-only challan's whole deposit, or a
 * TDS challan's declared interest beyond what its entries owe) forms a pool,
 * and the interest the other challans' entries owe beyond what they declare
 * themselves is matched against it, oldest challan first. That interest is
 * never counted against those TDS challans' Applied:
 *   via      TDS challan id  -> interest left out of its Applied (all of it)
 *   avail    TDS challan id  -> same allowance, for the edit guard
 *   consumed surplus challan id -> part of its deposit that was matched, and
 *            counts as applied there
 *   shortfall interest owed beyond everything the pool holds — shown as an
 *            interest short-payment, not as an over-applied TDS challan
 * With no surplus anywhere in the list the plan is empty and nothing changes.
 */
export function planInterestChallans<C extends ChallanLike>(
  challans: C[], rowsOf: (c: C) => RowLike[],
): { avail: Map<string, number>; via: Map<string, number>; consumed: Map<string, number>; shortfall: number } {
  const avail = new Map<string, number>();
  const via = new Map<string, number>();
  const consumed = new Map<string, number>();
  const byDate = (x: C, y: C) => (x.deposit_date || "").localeCompare(y.deposit_date || "");
  const calc = challans.map((c) => {
    const interestOnly = isInterestOnlyChallan(c);
    const declared = c.interest_deposited || 0;
    const live = interestOnly ? 0
      : withChallanInterest(rowsOf(c) as any[], c.deposit_date || null, tdsOfEntry).reduce((sum, r) => sum + r.interest_amount, 0);
    return { c, interestOnly, declared, excess: Math.max(0, live - declared), surplus: interestOnly ? declared : Math.max(0, declared - live) };
  });
  const providers = calc.filter((x) => x.surplus > 0).sort((x, y) => byDate(x.c, y.c));
  if (providers.length === 0) return { avail, via, consumed, shortfall: 0 };
  const pool = providers.reduce((sum, x) => sum + x.surplus, 0);
  let owed = 0;
  for (const x of calc.filter((y) => !y.interestOnly)) {
    owed += x.excess;
    via.set(x.c.id, x.excess);
    // Any interest an edit adds is likewise owed to the pool.
    avail.set(x.c.id, Number.POSITIVE_INFINITY);
  }
  let used = Math.min(owed, pool);
  for (const x of providers) {
    let part = Math.min(x.surplus, used);
    used -= part;
    if (part > 0 && x.surplus - part <= INTEREST_SURPLUS_TOLERANCE) part = x.surplus;
    consumed.set(x.c.id, part);
  }
  return { avail, via, consumed, shortfall: Math.max(0, owed - pool) };
}
