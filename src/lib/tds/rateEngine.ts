/**
 * TDS rate lookup + interest + challan-utilisation math — the ONE engine
 * shared by the live Data Entry screen (TdsDataEntry.tsx) and the Corrections
 * module (TdsCorrectionsModule.tsx). Extracted so the two screens can never
 * drift the way the Stage 1/2/3 matching engines did (see project memory) —
 * import these, never re-derive them locally.
 */

export interface RateEntry {
  section_code: string; nature_of_payment: string | null;
  rate_individual: number | null; rate_company: number | null;
  rate_no_pan: number | null; threshold_individual: number | null;
  threshold_company: number | null;
  effective_from: string | null; effective_to: string | null;
}

export const PAN_4TH_CHAR_MAP: Record<string, string> = {
  P: "Individual", H: "HUF", C: "Company", F: "Firm",
  L: "LLP", T: "Trust", A: "AOP",
};

export const isValidPan = (pan: string): boolean => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase());
export const isIndividualRateType = (type: string | null): boolean => type === "Individual" || type === "HUF";

/**
 * Resolves the rate/threshold for a section as of a given date — asOfDate
 * ("YYYY-MM-DD", usually the deductee's own date_of_payment) picks the right
 * row when a section has more than one date-ranged rate within the fetched
 * set (e.g. a rate cut effective partway through a financial year). Defaults
 * to today when no date is known yet (a brand-new row before Date of Payment
 * is set) so it still resolves a sane current rate rather than none at all.
 */
export function getRateForSection(
  rateMaster: RateEntry[], sectionCode: string,
  deducteeType?: string | null, asOfDate?: string | null,
) {
  const candidates = rateMaster.filter(r => r.section_code === sectionCode);
  if (!candidates.length) return { rate: null as number | null, noPanRate: null as number | null, nature: null as string | null, threshold: null as number | null, rateFound: false };
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const eligible = candidates.filter(r =>
    (!r.effective_from || r.effective_from <= asOf) && (!r.effective_to || r.effective_to >= asOf));
  // Fall back to every candidate for this section if none is date-eligible
  // (e.g. effective_from left blank) rather than silently returning "no rate".
  const pool = eligible.length ? eligible : candidates;
  const match = pool.reduce((best, r) =>
    (!best || (r.effective_from || "") > (best.effective_from || "")) ? r : best, null as RateEntry | null)!;
  const useIndRate = isIndividualRateType(deducteeType || null);
  return {
    rate: useIndRate ? match.rate_individual : match.rate_company,
    noPanRate: match.rate_no_pan,
    nature: match.nature_of_payment,
    threshold: useIndRate ? match.threshold_individual : match.threshold_company,
    rateFound: true,
  };
}

/** Local-midnight date parsing so day-of-month math never shifts under UTC. */
function parseLocalDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}

/**
 * Section 201(1A): due date is the 7th of the month following the deduction
 * (payment) month. Deposited on/before that date -> 0 interest; otherwise
 * 1.5% of TDS per month (or part month) late.
 */
export function calcAutoInterest(
  tdsAmount: number, paymentDate: string | null, depositDate: string | null,
): { interest: number; lateMonths: number } {
  if (!paymentDate || !depositDate || !tdsAmount) return { interest: 0, lateMonths: 0 };
  const entry = parseLocalDate(paymentDate);
  const challan = parseLocalDate(depositDate);
  const dueDate = new Date(entry.getFullYear(), entry.getMonth() + 1, 7);
  if (challan <= dueDate) return { interest: 0, lateMonths: 0 };
  const monthsDiff = (challan.getFullYear() - entry.getFullYear()) * 12 + (challan.getMonth() - entry.getMonth());
  const lateMonths = monthsDiff + 1;
  const interest = Math.round(tdsAmount * 0.015 * lateMonths);
  return { interest, lateMonths };
}

// Paise-precision comparison — avoids float-equality false negatives/positives
// on currency math (e.g. 0.1 + 0.2 !== 0.3 in JS floating point).
const toPaise = (n: number) => Math.round((n || 0) * 100);
export const isChallanOverApplied = (applied: number, allocatable: number): boolean =>
  toPaise(applied) > toPaise(allocatable);
export const isChallanFullyUtilised = (applied: number, allocatable: number): boolean =>
  toPaise(applied) === toPaise(allocatable);

/** A row shape both tds_deductees and tds_correction_deductees satisfy. */
export interface ApplicableRow {
  total_tax_deducted?: number | null; tds_amount?: number | null;
  interest_amount?: number | null; surcharge_amount?: number | null;
}

/**
 * Applied = TDS + Interest + Surcharge for a set of deductee-shaped rows —
 * the ONE definition (see project memory: the live app itself has three
 * subtly different reimplementations of this; this module intentionally
 * picks a single one rather than reproducing that drift).
 */
export function computeApplied(rows: ApplicableRow[]) {
  const tds = rows.reduce((s, d) => s + Math.round(d.total_tax_deducted || d.tds_amount || 0), 0);
  const interest = rows.reduce((s, d) => s + (d.interest_amount || 0), 0);
  const surcharge = rows.reduce((s, d) => s + (d.surcharge_amount || 0), 0);
  return { tds, interest, surcharge, applied: tds + interest + surcharge };
}

/** allocatable = total challan amount minus late fees (a separate govt levy, not part of what TDS entries can consume). */
export const computeAllocatable = (totalChallanAmount: number, lateFees234E: number) =>
  (totalChallanAmount || 0) - (lateFees234E || 0);

export function challanStatus(applied: number, allocatable: number): "Over-applied" | "Fully Utilised" | "Unconsumed" {
  if (isChallanOverApplied(applied, allocatable)) return "Over-applied";
  if (isChallanFullyUtilised(applied, allocatable)) return "Fully Utilised";
  return "Unconsumed";
}

export const balanceColorClass = (applied: number, allocatable: number): string => {
  if (isChallanOverApplied(applied, allocatable)) return "bg-destructive";
  if (isChallanFullyUtilised(applied, allocatable)) return "bg-emerald-500";
  return "bg-amber-500";
};

export const statusTextClass = (applied: number, allocatable: number): string => {
  if (isChallanOverApplied(applied, allocatable)) return "text-destructive";
  if (isChallanFullyUtilised(applied, allocatable)) return "text-emerald-600";
  return "text-amber-600";
};
