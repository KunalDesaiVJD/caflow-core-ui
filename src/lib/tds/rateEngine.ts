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
  // Income Tax Act 2025 / Section 393 reorganisation (effective 1-Apr-2026).
  // Null on any row the reform doesn't (yet) have a verified mapping for —
  // callers must fall back to the plain section_code label in that case.
  payment_code?: string | null; new_section_code?: string | null;
  new_section_description?: string | null;
}

/**
 * Builds the "Payment Code : [Old Section] : New Section Code – Description"
 * dropdown label mandated for the Section 393 reform, falling back to the
 * plain "section_code — nature_of_payment" label when a row has no verified
 * new-code mapping yet (see migration 20260730130000's header comment for
 * why most sections are intentionally left unmapped).
 */
export function sectionDropdownLabel(r: RateEntry): string {
  if (!r.payment_code || !r.new_section_code) {
    return `${r.section_code} — ${r.nature_of_payment || ""}`;
  }
  const desc = r.new_section_description || r.nature_of_payment || "";
  return `${r.payment_code} : [${r.section_code}] : ${r.new_section_code} – ${desc}`;
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
  if (!candidates.length) return { rate: null as number | null, noPanRate: null as number | null, nature: null as string | null, threshold: null as number | null, rateFound: false, sectionRestrictedToIndividual: false };
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const eligible = candidates.filter(r =>
    (!r.effective_from || r.effective_from <= asOf) && (!r.effective_to || r.effective_to >= asOf));
  // Fall back to every candidate for this section if none is date-eligible
  // (e.g. effective_from left blank) rather than silently returning "no rate".
  const pool = eligible.length ? eligible : candidates;
  const match = pool.reduce((best, r) =>
    (!best || (r.effective_from || "") > (best.effective_from || "")) ? r : best, null as RateEntry | null)!;
  const useIndRate = isIndividualRateType(deducteeType || null);
  // Section 393 split some sections into an Individual/HUF-only variant and an
  // "Others" variant with a DIFFERENT rate (194C(a) 1% vs 194C(b) 2%, seeded by
  // the FY2026-27 rate master migration) — but the rate master row for the (a)
  // variant still carries a populated rate_company column for schema
  // completeness, not because a company under (a) is a valid combination. A
  // company can genuinely never fall under an "Individual/HUF" section; handing
  // it that row's rate_company anyway is how a real return got 194C(a) @ 1% on
  // a Ltd company instead of 194C(b) @ 2% — silently, with the rate field
  // locked as "auto" so there was no way to even notice or correct it inline.
  // Treated as "no rate for this deductee" so the caller can react (unlock the
  // field, or better, prompt the user toward the correct sibling section)
  // rather than confidently returning a number that was never meant for them.
  //
  // Deliberately checked against the literal "Company" value ONLY — not
  // "!useIndRate" (which is also true for "Non-Company", "Firm", "LLP",
  // "Trust", "AOP"). "Non-Company" is the government's own Form 26Q status
  // code (Genius import: "01" -> Company, "02" -> Non-Company — see
  // genius-import.ts) and is the long-standing, intentional value this app
  // already uses for the Individual/HUF-equivalent 1% bucket under 194C(a):
  // 344 live "Non-Company" + 80 "Individual" rows currently rely on exactly
  // that. Only 2 live rows were ever genuinely "Company" under 194C(a) — both
  // real, unambiguous instances of this bug. A blanket !useIndRate guard would
  // have newly misflagged all 344 correct ones instead of fixing 2 wrong ones.
  const individualOnlySection = /individual\s*\/\s*huf/i.test(match.nature_of_payment || "");
  if (individualOnlySection && deducteeType === "Company") {
    return {
      rate: null as number | null, noPanRate: match.rate_no_pan, nature: match.nature_of_payment,
      threshold: match.threshold_company, rateFound: false, sectionRestrictedToIndividual: true,
    };
  }
  return {
    rate: useIndRate ? match.rate_individual : match.rate_company,
    noPanRate: match.rate_no_pan,
    nature: match.nature_of_payment,
    threshold: useIndRate ? match.threshold_individual : match.threshold_company,
    rateFound: true,
    sectionRestrictedToIndividual: false,
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

/**
 * Kasar-Vatav (round-off/write-off): a small residual balance — ₹5, ₹10, a
 * stray ₹250 — that's left on a challan after every real deductee entry has
 * been made, with no deductee left to attach it to. Recording it lets a
 * challan close out as Fully Utilised without inventing a fake deductee row.
 *
 * It counts toward how much of the challan is "spoken for" for Fully
 * Utilised / Unconsumed / Over-applied / Carry-Forward-eligibility purposes,
 * so every caller that currently feeds computeApplied()'s `applied` into
 * isChallanFullyUtilised/isChallanOverApplied (or a hand-rolled unconsumed =
 * allocatable - applied) must add it in via this function first. It must
 * NEVER be folded into computeApplied's own tds/interest/surcharge — those
 * report what was actually deducted from deductees, and Kasar-Vatav
 * deliberately isn't that.
 */
export const withKasarVatav = (rowsApplied: number, kasarVatavAmount: number | null | undefined) =>
  (rowsApplied || 0) + (kasarVatavAmount || 0);

/** A deductee row shape wide enough for the live-interest recompute below —
 *  superset of ApplicableRow. */
export interface InterestApplicableRow extends ApplicableRow {
  date_of_payment?: string | null;
}

/**
 * Cross-utilization (firm instruction, 2026-08-06): TDS, Interest, and Late
 * Fee are ONE fungible pool measured against the challan's own undiminished
 * total_challan_amount — a component running under its own declared share is
 * free to be offset by another running over, as long as the GRAND TOTAL
 * never exceeds the challan. The only prior rule ("late_fees_234e is an
 * untouchable slice, carved out of allocatable before TDS/Interest are even
 * checked") is what produced false Over-Applied errors on challans that were
 * genuinely within their total.
 *
 * Deliberately a NEW function rather than changing computeAllocatable: that
 * one is still correct and still used as-is by the Unconsumed/Utilization
 * Reports (TdsReports.tsx), which track late fee's own separate
 * declared-vs-used balance (late_fees_234e / late_fees_used) as a genuinely
 * different, report-only concept — pooling it there would double-count that
 * column against this one. This function is the ONE definition of "is this
 * challan over-applied" for every gate that BLOCKS on it: TdsDataEntry.tsx's
 * Data Entry grid, the Corrections editor, TdsValidateFinalise.tsx's Stage-1
 * pre-flight gate, and the Genius Export guard.
 */
export function computeChallanPooled(
  challan: { total_challan_amount?: number | null; late_fees_234e?: number | null; kasar_vatav_amount?: number | null; deposit_date?: string | null },
  deductees: InterestApplicableRow[],
): {
  tds: number; interest: number; surcharge: number; lateFees: number; kasarVatav: number;
  effectiveApplied: number; allocatable: number; overApplied: boolean; unconsumed: number;
} {
  const liveInterestRows = deductees.map((d) => ({
    ...d,
    interest_amount: calcAutoInterest(d.total_tax_deducted || d.tds_amount || 0, d.date_of_payment ?? null, challan.deposit_date ?? null).interest,
  }));
  const { tds, interest, surcharge, applied } = computeApplied(liveInterestRows);
  const lateFees = challan.late_fees_234e || 0;
  const kasarVatav = challan.kasar_vatav_amount || 0;
  // Late fee now ADDS into the pooled applied figure, and allocatable is the
  // challan's raw total — not `allocatable = total - lateFees` — so all
  // three components draw from and are checked against the SAME undiminished
  // ceiling instead of late fee being reserved out of it first.
  const effectiveApplied = applied + kasarVatav + lateFees;
  const allocatable = challan.total_challan_amount || 0;
  return {
    tds, interest, surcharge, lateFees, kasarVatav, effectiveApplied, allocatable,
    overApplied: isChallanOverApplied(effectiveApplied, allocatable),
    unconsumed: Math.max(0, allocatable - effectiveApplied),
  };
}

/** The ONE definition of "is this challan over-applied", covering everything
 *  challanDeducteeTds/getChallanBreakdownAll's per-challan detail card already
 *  covers in TdsDataEntry.tsx — live interest recompute (a row's own stored
 *  interest_amount can be stale; see that component's own doc on why this
 *  must never be trusted directly), Kasar-Vatav, and late fees — so a SECOND
 *  caller (e.g. a Stage-1 pre-flight gate) reaches the identical verdict
 *  without re-deriving any of that logic itself. Takes plain data, no
 *  component state, so it's usable anywhere a challan + its deductees can be
 *  fetched. Thin wrapper over computeChallanPooled() — kept as its own named
 *  export since existing callers only need the three fields below. */
export function computeChallanOverApplied(
  challan: { total_challan_amount?: number | null; late_fees_234e?: number | null; kasar_vatav_amount?: number | null; deposit_date?: string | null },
  deductees: InterestApplicableRow[],
): { overApplied: boolean; effectiveApplied: number; allocatable: number } {
  const { overApplied, effectiveApplied, allocatable } = computeChallanPooled(challan, deductees);
  return { overApplied, effectiveApplied, allocatable };
}

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
