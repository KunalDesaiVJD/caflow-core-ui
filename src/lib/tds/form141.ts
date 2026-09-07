/**
 * Form 141 — Challan-cum-statement of deduction of tax under section 393(1).
 * =========================================================================
 *
 * THE STATUTE LAYER for TDS on transfer of immovable property (Schedule B).
 * Every constant, code, citation and date rule the property module depends on
 * lives here and nowhere else, for the same reason src/lib/fsSignConvention.ts
 * and src/lib/tdsRateSeed.ts are each kept as ONE copy: two lists of "what the
 * minor head code is" that can disagree are worse than one that's wrong,
 * because nothing would ever compare them.
 *
 * ── Why this file exists at all (and why not form_type: "26QB") ────────────
 *
 * From 1 April 2026 (Tax Year 2026-27) the Income-tax Act, 2025 replaces the
 * four PAN-based challan-cum-statements — 26QB (property), 26QC (rent by
 * Ind/HUF), 26QD (contractor/professional by Ind/HUF) and 26QE (VDA) — with a
 * SINGLE consolidated Form 141 carrying four schedules. Property is
 * Schedule B. Form 26QB does not exist for a payment made on or after that
 * date, so this module never emits it.
 *
 * Form 141 also breaks every assumption the existing quarterly TDS spine
 * (tds_filings → tds_challans → tds_deductees) makes:
 *   • Filed under the deductor's PAN, not a TAN.
 *   • The period is a MONTH ("Month of Deduction: Sep-2026"), not a quarter.
 *   • One statement per buyer × per seller × per instalment, not one return.
 *   • The challan IS the statement — there is no separate OLTAS mapping step.
 * Hence a parallel spine rather than a fifth entry in TDS_FORMS. Adding "141"
 * to the quarterly auto-sync trigger (20260710180000_tds_filings_auto_sync.sql)
 * would manufacture four empty rows a year for a form that has no quarters.
 *
 * ── Provenance ────────────────────────────────────────────────────────────
 *
 * Two tiers of fact live here, deliberately kept apart — the same discipline
 * section393.ts already applies to its payment codes:
 *
 *   1. VERIFIED — read directly off a real filed Form 141 Schedule B
 *      acknowledgement and its paired challan receipt (Acknowledgement
 *      BTA0188370, CIN 26090200117177ICIC, Tax Year 2026-27, filed
 *      02-Sep-2026), cross-checked against the Income Tax Department's own
 *      Form 141 help page. Major/minor head codes, the table reference, the
 *      rule citation, the section 395(1) certificate column, the period
 *      granularity and the 13-column deductee row shape are all in this tier.
 *
 *   2. UNVERIFIED — carried forward in SUBSTANCE from the 1961 Act because
 *      the recodification did not change the arithmetic, but whose NEW
 *      section number this codebase has not independently corroborated.
 *      Marked `provenance: "unverified"` and surfaced through
 *      FORM_141_DISCLAIMER rather than printed as though settled. The
 *      computation is correct either way; only the citation alongside it is
 *      at stake. See UNVERIFIED_CITATIONS below for the live list.
 *
 * Everything is effective-dated so a CBDT notification is a data edit in this
 * file, never a refactor across the module.
 */

// ─── Regime boundary ────────────────────────────────────────────────────────

/** Income-tax Act, 2025 commencement. A payment or credit on/after this date
 *  is Form 141 territory; before it, the 1961 Act and Form 26QB apply. */
export const FORM_141_EFFECTIVE_FROM = "2026-04-01";

/** First Tax Year under Form 141, in this codebase's "YYYY-YY" convention. */
export const FORM_141_FIRST_TAX_YEAR = "2026-27";

/**
 * Whether a payment/credit date falls inside the Form 141 regime.
 *
 * Keyed off the DATE OF PAYMENT OR CREDIT, never the date of agreement — an
 * agreement to sell executed in March 2026 whose instalments run through
 * 2026-27 produces Form 141 filings, not Form 26QB ones. Getting this
 * backwards would reject an entirely ordinary transaction.
 */
export function isForm141Regime(paymentOrCreditDate: string | null | undefined): boolean {
  if (!paymentOrCreditDate) return false;
  return paymentOrCreditDate >= FORM_141_EFFECTIVE_FROM;
}

// ─── Form identity (VERIFIED against the filed statement) ───────────────────

export const FORM_141_NUMBER = "141";
export const FORM_141_TITLE =
  "Challan-cum-statement of deduction of tax under section 393(1)";
/** The four schedules Form 141 spans, as printed in its own header. */
export const FORM_141_TABLE_REFS = "[Table Sl. No. 2(i), 3(i), 6(ii) and 8(vi)]";
/** Rule citation printed under the form title. */
export const FORM_141_RULE_REF = "[See rules 218(3) and 219(5)]";

/** Schedule B — the only schedule this module implements. */
export const SCHEDULE_B = {
  key: "B",
  /** Exactly as the filed statement prints it. */
  title:
    "Schedule B - TDS on payment of Sale/Transfer of immovable Property under section 393(1) [Table Sl. No. 3(i)]",
  section: "393(1)",
  tableRef: "[Table Sl. No. 3(i)]",
  /** The 1961-Act provision this replaces. Reference only — never printed on
   *  the form, which cites no 1961-Act section anywhere. */
  legacySection: "194-IA",
  legacyForm: "26QB",
} as const;

// ─── Challan head codes (VERIFIED) ──────────────────────────────────────────

export const MAJOR_HEAD_CODE = "0021";
export const MAJOR_HEAD_LABEL = "Income Tax (Other than Companies) (0021)";
export const MINOR_HEAD_CODE = "800";
export const MINOR_HEAD_LABEL =
  "Schedule B :- TDS on payment of  Sale of immovable Property (800)";

// ─── Rates and threshold ────────────────────────────────────────────────────

/** Standard rate on the amount liable to deduction. */
export const RATE_STANDARD = 1;
/** Applied when the deductee has no PAN. */
export const RATE_NO_PAN = 20;

/**
 * The ₹50,00,000 threshold.
 *
 * Tested on the TOTAL consideration (or stamp duty value) for the PROPERTY —
 * NOT on each buyer's or seller's individual share. Two buyers at ₹30,00,000
 * each are both liable on a ₹60,00,000 property. This is the single most
 * commonly mis-implemented rule in the whole provision, and it is why
 * evaluateThreshold() in form141ScheduleB.ts takes the deal, not the row.
 */
export const THRESHOLD_TOTAL_CONSIDERATION = 5000000;

/** Deals within this fraction of the threshold get a review warning — a
 *  mis-keyed digit near the line flips liability entirely. */
export const THRESHOLD_PROXIMITY_WARN = 0.05;

// ─── Lower / nil deduction certificate ──────────────────────────────────────

/**
 * The filed statement's own column heading is "Whether section 395(1) is
 * applicable" with a companion "Certificate number under section 395(1) of
 * the Act" — so s.395(1) is the Income-tax Act, 2025 successor to the 1961
 * Act's s.197. VERIFIED: read directly off the acknowledgement.
 */
export const LOWER_DEDUCTION_SECTION = "395(1)";

// ─── Interest and fee (substance verified, citations NOT) ───────────────────

/** Monthly rate for tax deducted late — from the date it was deductible (the
 *  date of payment or credit) to the date it was actually deducted. */
export const INTEREST_RATE_LATE_DEDUCTION = 0.01;
/** Monthly rate for tax deducted on time but deposited late. */
export const INTEREST_RATE_LATE_DEPOSIT = 0.015;
/** Late-filing fee per day of delay. */
export const LATE_FEE_PER_DAY = 200;

/**
 * Citations this codebase has NOT independently corroborated. Each is carried
 * forward in substance from the 1961 Act — the arithmetic is unchanged and
 * the engine computes correctly regardless — but the NEW section number is
 * either unconfirmed or rests on a single secondary source. The UI prints
 * these through FORM_141_DISCLAIMER, never as settled law.
 *
 * Resolve one by replacing its entry here; nothing else in the module reads
 * a section number for interest or fee.
 */
export const UNVERIFIED_CITATIONS = {
  interest: {
    legacySection: "201(1A)",
    newSection: null as string | null,
    provenance: "unverified" as const,
    note:
      "The 1% (late deduction) and 1.5% (late deposit) monthly charges are unchanged in substance. The Income-tax Act, 2025 section number replacing s.201(1A) could not be corroborated and is deliberately left null rather than guessed.",
  },
  lateFee: {
    legacySection: "234E",
    newSection: "427" as string | null,
    provenance: "single-source" as const,
    note:
      "₹200/day capped at the tax amount appears unchanged. The renumbering to s.427 rests on ONE secondary source and wants a second before it is printed as settled.",
  },
  certificateForm: {
    legacyForm: "16B",
    newForm: "132" as string | null,
    provenance: "single-source" as const,
    note:
      "The certificate issued to the seller is reported as Form 132, from a single secondary source; the Department's own Form 141 help page does not mention a certificate at all. Confirm before tracking issue deadlines against it.",
  },
} as const;

export const FORM_141_DISCLAIMER =
  "From 1 Apr 2026 TDS on transfer of immovable property is reported in Form 141 Schedule B (challan-cum-statement under section 393(1), Table Sl. No. 3(i)), filed under the buyer's PAN — Form 26QB does not apply. Head codes, the table reference and the section 395(1) certificate fields shown here are read from a filed acknowledgement. Interest and late-fee amounts are computed on rates carried forward unchanged from the 1961 Act, but the new Act's section numbers for them are NOT independently confirmed — verify any citation before relying on it in correspondence.";

// ─── Property type ──────────────────────────────────────────────────────────

/**
 * "LAND" is the only value observed on a real acknowledgement. The portal's
 * full dropdown has not been enumerated, so the rest are candidates the UI
 * offers with a free-text fallback rather than a closed list that could
 * silently block a legitimate filing.
 */
export const PROPERTY_TYPES_OBSERVED = ["LAND"] as const;
export const PROPERTY_TYPES_CANDIDATE = [
  "LAND",
  "BUILDING",
  "LAND & BUILDING",
  "FLAT / APARTMENT",
  "OTHER",
] as const;

/** Rural agricultural land is outside the charge. The Income-tax Act, 2025
 *  definition has not been read against the 1961 Act's, so the module warns
 *  rather than blocks — see form141Validate.ts. */
export const AGRICULTURAL_LAND_EXCLUDED = true;

// ─── Period resolution ──────────────────────────────────────────────────────
//
// The DOCUMENT determines the period, not whatever Tax Year the user happens
// to have selected in the UI. A deed uploaded while viewing 2026-27 whose
// instalments fall in 2027-28 must resolve to 2027-28 and say so, never write
// silently into the year on screen.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse "YYYY-MM-DD" as a LOCAL date. `new Date(str)` would read it as UTC
 *  and shift the day backwards west of Greenwich — the same trap
 *  rateEngine.ts's parseLocalDate() already avoids. */
function parseLocalDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * Tax Year containing a date, in "YYYY-YY" form ("2026-27").
 *
 * The Indian tax year runs 1 April → 31 March, so January–March belong to the
 * year that STARTED the previous April.
 */
export function taxYearForDate(date: string): string {
  const d = parseLocalDate(date);
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/** "Month of Deduction" exactly as Form 141 prints it: "Sep-2026". */
export function monthOfDeduction(deductionDate: string): string {
  const d = parseLocalDate(deductionDate);
  return `${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Filing/payment due date: 30 days from the END of the month in which tax was
 * deducted. Deduction on 02-Sep-2026 → month ends 30-Sep-2026 → due
 * 30-Oct-2026. Note this is 30 days from month-end, NOT "the 30th of the
 * following month" and NOT the 7th-of-next-month rule the quarterly forms use
 * (rateEngine.ts's calcAutoInterest) — reusing that helper here would produce
 * a due date weeks early and manufacture interest that isn't owed.
 */
export function form141DueDate(deductionDate: string): string {
  const d = parseLocalDate(deductionDate);
  const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const due = new Date(endOfMonth.getFullYear(), endOfMonth.getMonth(), endOfMonth.getDate() + 30);
  return toIso(due);
}

/**
 * Whole calendar months, or part thereof, spanned by [from, to] — the
 * convention Indian tax interest is computed on. 02-Sep → 05-Nov counts THREE
 * (Sep, Oct, Nov), not two, and not 64/30. Same convention as the quarterly
 * engine's calcAutoInterest, deliberately, so two parts of this app never
 * disagree about what "a month late" means.
 *
 * Returns 0 when `to` is on or before `from`.
 */
export function monthsOrPartLate(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (b <= a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

/** Whole days between two dates, floor 0. Used for the ₹200/day fee. */
export function daysLate(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  const ms = b.getTime() - a.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86400000);
}

// ─── Regime / period reconciliation ─────────────────────────────────────────

export type PeriodVerdict =
  /** Payment on/after 1-Apr-2026 and inside the Tax Year on screen. */
  | "in_context"
  /** Valid Form 141 filing, but for a DIFFERENT Tax Year than the one selected. */
  | "other_tax_year"
  /** Payment predates the Act — Form 26QB under the 1961 Act, not this module. */
  | "pre_regime";

export interface PeriodResolution {
  verdict: PeriodVerdict;
  /** Tax Year the payment actually belongs to, e.g. "2026-27". */
  taxYear: string;
  /** "Sep-2026" — the form's own Month of Deduction, from the deduction date. */
  month: string;
  dueDate: string;
  message: string;
}

/**
 * Reconcile a transaction's own dates against the Tax Year the user is
 * viewing.
 *
 * Deliberately NOT a boolean gate. There are three distinct outcomes and only
 * one of them is an error:
 *
 *   • pre_regime    — hard stop. The module covers Form 141 from 1-Apr-2026;
 *                     an earlier payment is Form 26QB under the 1961 Act and
 *                     is not half-supported here.
 *   • other_tax_year— NOT an error. Offer to switch context or file under the
 *                     resolved year. Instalments straddling a year-end are
 *                     ordinary, and each one is its own filing under its own
 *                     Tax Year and Month of Deduction.
 *   • in_context    — proceed.
 *
 * The date of AGREEMENT is intentionally not consulted. An agreement executed
 * before 1-Apr-2026 with payments after it produces Form 141 filings; testing
 * the agreement date would reject a routine transaction.
 */
export function resolveForm141Period(
  paymentOrCreditDate: string,
  deductionDate: string | null,
  selectedTaxYear: string | null,
): PeriodResolution {
  const deducted = deductionDate || paymentOrCreditDate;
  const taxYear = taxYearForDate(paymentOrCreditDate);
  const month = monthOfDeduction(deducted);
  const dueDate = form141DueDate(deducted);

  if (!isForm141Regime(paymentOrCreditDate)) {
    return {
      verdict: "pre_regime",
      taxYear,
      month,
      dueDate,
      message: `Payment or credit dated ${paymentOrCreditDate} falls before the Income-tax Act, 2025 commenced on ${FORM_141_EFFECTIVE_FROM}. That deduction is reported in Form 26QB under the 1961 Act — this module covers Form 141 Schedule B only.`,
    };
  }

  if (selectedTaxYear && selectedTaxYear !== taxYear) {
    return {
      verdict: "other_tax_year",
      taxYear,
      month,
      dueDate,
      message: `This payment falls in Tax Year ${taxYear} (${month}), not the ${selectedTaxYear} you are viewing. Switch context, or file it under ${taxYear}.`,
    };
  }

  return {
    verdict: "in_context",
    taxYear,
    month,
    dueDate,
    message: `Tax Year ${taxYear}, Month of Deduction ${month}. Due ${dueDate}.`,
  };
}
