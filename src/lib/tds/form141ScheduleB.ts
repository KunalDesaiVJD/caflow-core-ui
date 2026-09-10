/**
 * Form 141 Schedule B — computation engine.
 * =========================================
 *
 * Pure functions. No database, no network, no React. Everything this module
 * needs to turn ONE property transaction into the set of challan-cum-statements
 * it produces, and every rupee on each of them.
 *
 * Kept pure on purpose: this is where the accuracy of the whole feature is
 * won or lost, and a pure engine can be pinned against a real filed
 * acknowledgement in a unit test (see form141ScheduleB.test.ts, which replays
 * BTA0188370 end to end) without a browser, a Supabase session or a fixture
 * database.
 *
 * ── One statement, many sellers ────────────────────────────────────────────
 *
 * A correction the real acknowledgement forced, and worth stating plainly
 * because the old regime worked the other way: under Form 26QB the rule of
 * thumb was one form per buyer-seller PAIR. Form 141 consolidates — the
 * sample statement (BTA0188370) covers TWO sellers under ONE acknowledgement,
 * ONE CIN and ONE challan of ₹1,28,000, with one ROW per seller in its
 * 13-column deductee table.
 *
 * So the fan-out is:
 *      one statement  per (filing buyer × instalment)
 *      one row        per seller, inside that statement
 *      interest & fee at the STATEMENT level, not the row level
 *
 * ── Apportionment ─────────────────────────────────────────────────────────
 *
 * With total consideration C, buyer i holding share bᵢ and seller j holding
 * share sⱼ, the amount buyer i owes seller j is C · bᵢ · sⱼ. Verified against
 * the sample: ₹2,56,00,000 × 0.5 × 0.5 = ₹64,00,000 per seller, ₹1,28,00,000
 * for the buyer, ₹1,28,000 of tax — matching the filed statement's own
 * "Total amount on which tax is required to be deducted" and Part C exactly.
 *
 * Shares are used EXACTLY as supplied and never re-normalised. If they sum to
 * 97% the engine computes on 97% and form141Validate.ts blocks the filing —
 * quietly scaling them to 100% would hide a data-entry error behind a
 * plausible-looking number, which is the one outcome this module exists to
 * prevent.
 */

import {
  RATE_STANDARD,
  RATE_NO_PAN,
  THRESHOLD_TOTAL_CONSIDERATION,
  INTEREST_RATE_LATE_DEDUCTION,
  INTEREST_RATE_LATE_DEPOSIT,
  LATE_FEE_PER_DAY,
  isForm141Regime,
  taxYearForDate,
  monthOfDeduction,
  form141DueDate,
  monthsOrPartLate,
  daysLate,
  FORM_141_EFFECTIVE_FROM,
} from "./form141";

// ─── Inputs ─────────────────────────────────────────────────────────────────

export type ResidentialStatus = "resident" | "non_resident";

export interface Form141Buyer {
  pan: string | null;
  name: string;
  /** Proportion of TOTAL sale consideration paid by this buyer, as a
   *  percentage (50 means 50%). */
  sharePct: number;
}

/**
 * Whether the deductee's PAN is live on the department's records.
 *
 * A PAN that EXISTS but is inoperative — not linked to Aadhaar — attracts the
 * same higher rate as no PAN at all. The seller will not volunteer this, and
 * nothing on the face of the deed reveals it, so it is carried as its own
 * field rather than inferred from the PAN string.
 *
 * "unknown" is the honest default and is deliberately not treated as
 * operative: it produces a warning telling the firm to check, rather than a
 * quiet 1% that becomes a demand two years later.
 */
export type PanStatus = "unknown" | "operative" | "inoperative" | "invalid";

/** PAN states that carry the no-PAN rate. */
export const PAN_STATUSES_AT_HIGHER_RATE: PanStatus[] = ["inoperative", "invalid"];

export interface Form141Seller {
  pan: string | null;
  name: string;
  contact?: string | null;
  email?: string | null;
  /** Proportion of TOTAL sale consideration received by this seller (%). */
  sharePct: number;
  residentialStatus: ResidentialStatus;
  /** Operative / inoperative, from the department's records. Absent is read
   *  as "unknown" — see PanStatus. */
  panStatus?: PanStatus | null;
  /** Lower/nil deduction certificate under s.395(1), when one is held. */
  section395CertificateNo?: string | null;
  /** Rate the certificate permits, as a percentage. Null with a certificate
   *  number present is itself a validation error, not a silent fall-back. */
  section395Rate?: number | null;
  /** The certificate's own validity window. A certificate is not a standing
   *  concession: it covers deductions made between these dates and nothing
   *  outside them. */
  section395ValidFrom?: string | null;
  section395ValidTo?: string | null;
  /** The ceiling the certificate carries — the total amount it covers. Tax on
   *  anything beyond it reverts to the standard rate. */
  section395CeilingAmount?: number | null;
}

export interface Form141Instalment {
  seq: number;
  /** Total this buyer paid or credited in THIS instalment, across all
   *  sellers. Apportioned by seller share below. */
  amountPaidByBuyer: number;
  datePaidOrCredited: string;
  /** When tax was actually deducted. Later than the payment date means late
   *  deduction, which carries its own 1%/month charge. */
  dateOfDeduction: string;
  /** When the challan was paid. Null while the filing is still a draft — the
   *  engine then reports interest/fee as of today's known facts only. */
  dateOfDeposit?: string | null;
  /** When the statement was actually filed, for the ₹200/day fee. Defaults to
   *  the deposit date, since Form 141 is a challan-cum-statement and the two
   *  normally coincide. */
  dateOfFiling?: string | null;
}

export interface Form141Deal {
  propertyType: string;
  propertyAddress: string;
  dateOfAgreement: string;
  /** When the deed was registered, where that differs from the agreement
   *  date. Optional because an unregistered draft agreement has none yet. */
  dateOfRegistration?: string | null;
  totalSaleConsideration: number;
  totalStampDutyValue: number;
  /** The date the stamp duty value was taken AS AT. Circle rates move, so a
   *  deal signed in one year and registered the next has two of them, and
   *  which one governs is a question of fact — see validateDeal. */
  stampDutyValueAsOn?: string | null;
  paymentMode: "lumpsum" | "instalments";
  /** Free text carried through only so the checks can read it — a deed
   *  described as GST-inclusive, for instance. */
  notes?: string | null;
  buyers: Form141Buyer[];
  sellers: Form141Seller[];
  instalments: Form141Instalment[];
}

// ─── Outputs ────────────────────────────────────────────────────────────────

export interface ThresholdResult {
  liable: boolean;
  /** The figure actually tested — the higher of consideration and stamp duty
   *  value, at PROPERTY level. */
  testedAmount: number;
  threshold: number;
  basis: "consideration" | "stamp_duty_value";
  explanation: string;
}

export interface Form141Row {
  sellerPan: string | null;
  sellerName: string;
  /** "Proportionate amount of Stamp Duty value" — the pair-level share of the
   *  property's stamp duty value. */
  proportionateSdv: number;
  /** Cumulative amount paid to this seller in earlier instalments. */
  previousInstalments: number;
  presentInstalment: number;
  /** Higher of the consideration and stamp-duty measures for this instalment. */
  amountLiable: number;
  datePaidOrCredited: string;
  dateOfDeduction: string;
  /** Whether the certificate ACTUALLY governed this row's rate. A held-but-
   *  expired or held-but-exhausted certificate reads false here while its
   *  number still prints below, which is the honest pairing: the form should
   *  not say a concessional rate was applied under a certificate that did not
   *  cover the deduction. `rateBasis` says which it was. */
  section395Applicable: boolean;
  section395CertificateNo: string | null;
  ratePct: number;
  /** WHY this rate, so a panel can explain a 20% row without re-deriving it. */
  rateBasis: RateBasis;
  tdsAmount: number;
}

export interface Form141Statement {
  instalmentSeq: number;
  taxYear: string;
  /** "Sep-2026", as Form 141 prints it. */
  month: string;
  dueDate: string;
  rows: Form141Row[];
  /** Sum of the rows' amountLiable — the form's "Total amount on which tax is
   *  required to be deducted". */
  totalAmountLiable: number;
  /** Part C (a) Amount deducted. */
  totalTds: number;
  /** Part C (b) Interest. */
  interest: number;
  interestBreakdown: {
    lateDeduction: number;
    lateDeductionMonths: number;
    lateDeposit: number;
    lateDepositMonths: number;
  };
  /** Part C (c) Fee. */
  fee: number;
  feeDays: number;
  /** Part C Total (a + b + c). */
  totalPayable: number;
}

export interface Form141Blocker {
  code:
    | "pre_regime"
    | "non_resident_seller"
    | "no_filing_buyer"
    | "no_sellers"
    | "no_instalments";
  message: string;
  /** Seller PAN or instalment seq the blocker attaches to, when applicable. */
  ref?: string;
}

export interface Form141Computation {
  threshold: ThresholdResult;
  statements: Form141Statement[];
  /** Conditions that make the computation meaningless rather than merely
   *  wrong. Callers must not render a draft form while any of these stand. */
  blockers: Form141Blocker[];
  /** Across every statement produced. */
  grandTotalTds: number;
  grandTotalPayable: number;
}

// ─── Money ──────────────────────────────────────────────────────────────────

/** Currency arithmetic settles to whole rupees, the unit the form prints and
 *  the portal accepts. Intermediate apportionment stays in floats; only the
 *  figures that reach a form field are rounded, and each is rounded once. */
const rupees = (n: number): number => Math.round(n);

const pct = (share: number): number => share / 100;

// ─── Threshold ──────────────────────────────────────────────────────────────

/**
 * The ₹50,00,000 test, run on the PROPERTY — never on a party's share.
 *
 * No deduction is required only when the consideration AND the stamp duty
 * value are BOTH under the threshold, so liability attaches when either
 * reaches it. Two buyers at ₹30,00,000 each on a ₹60,00,000 property are both
 * liable; testing each buyer's ₹30,00,000 share would wrongly exempt the whole
 * transaction, which is the classic implementation error in this provision.
 */
export function evaluateThreshold(deal: Form141Deal): ThresholdResult {
  const consideration = deal.totalSaleConsideration || 0;
  const sdv = deal.totalStampDutyValue || 0;
  const testedAmount = Math.max(consideration, sdv);
  const basis = sdv > consideration ? "stamp_duty_value" : "consideration";
  const liable = testedAmount >= THRESHOLD_TOTAL_CONSIDERATION;

  return {
    liable,
    testedAmount,
    threshold: THRESHOLD_TOTAL_CONSIDERATION,
    basis,
    explanation: liable
      ? `Liable: the property's ${basis === "stamp_duty_value" ? "stamp duty value" : "sale consideration"} of ₹${testedAmount.toLocaleString("en-IN")} reaches the ₹${THRESHOLD_TOTAL_CONSIDERATION.toLocaleString("en-IN")} threshold. The test is on the whole property, so every buyer is liable on their own share regardless of how small it is.`
      : `Not liable: both the sale consideration (₹${consideration.toLocaleString("en-IN")}) and the stamp duty value (₹${sdv.toLocaleString("en-IN")}) are below ₹${THRESHOLD_TOTAL_CONSIDERATION.toLocaleString("en-IN")}.`,
  };
}

// ─── Rate ───────────────────────────────────────────────────────────────────

/**
 * Why a row carries the rate it carries.
 *
 * The three `certificate_*` values all resolve to the STANDARD rate — they
 * record a certificate that was held but did not govern this deduction, which
 * is the difference the deductee will ask about and the difference the
 * validation layer turns into a finding. Collapsing them into "standard"
 * would lose exactly the fact worth reporting.
 */
export type RateBasis =
  | "no_pan"
  | "inoperative_pan"
  | "section_395"
  | "certificate_rate_missing"
  | "certificate_expired"
  | "certificate_exhausted"
  | "standard";

/** Everything about the moment of deduction that can change the rate. All
 *  optional: called with no context, resolveRate answers the timeless part of
 *  the question, which is what the deal-level checks want. */
export interface RateContext {
  /** Tested against the certificate's validity window. */
  dateOfDeduction?: string;
  /** Amount already covered by this certificate on earlier instalments. */
  alreadyCovered?: number;
  /** Amount this instalment would put through it. */
  amountLiable?: number;
}

export interface RateResolution {
  ratePct: number;
  basis: RateBasis;
  /** A certificate number was supplied with no rate. */
  certificateRateMissing: boolean;
  /** The deduction falls outside the certificate's validity window. */
  certificateExpired: boolean;
  /** This instalment would take the certificate past the amount it covers. */
  certificateCeilingExceeded: boolean;
}

/**
 * Rate for one seller, in priority order:
 *   1. No PAN, or a PAN that is inoperative → 20%
 *   2. Valid s.395(1) certificate            → the rate it permits
 *   3. Otherwise                             → 1%
 *
 * A certificate NUMBER without a rate does not silently fall through to 1% —
 * it returns 1% but flags `certificateRateMissing`, which form141Validate.ts
 * treats as blocking. Deducting at the standard rate when a certificate says
 * otherwise over-deducts the seller's money; deducting at a rate nobody
 * supplied under-deducts the government's. Neither is a default worth
 * guessing.
 *
 * A certificate is not a standing concession, and the two ways it stops
 * applying are the ones firms actually get caught by:
 *
 *   • it EXPIRES — it authorises deductions made inside its own window, so a
 *     later instalment on the same deal is back at the standard rate;
 *   • it is EXHAUSTED — it covers an amount, and tax on anything past that
 *     ceiling is due at the standard rate.
 *
 * In both cases the rate falls back to the standard one rather than the
 * concessional one, and the caller is told which happened so it can say so.
 * Falling back UP is the safe direction: over-deducting is the seller's
 * refund claim, under-deducting is the buyer's demand.
 *
 * The ceiling is applied per instalment rather than split mid-instalment: the
 * form carries one rate per deductee row, so an instalment that would breach
 * the ceiling goes through wholly at the standard rate. That over-deducts
 * slightly on the breaching instalment, in the safe direction, and the
 * finding tells the user exactly that.
 */
export function resolveRate(seller: Form141Seller, ctx: RateContext = {}): RateResolution {
  const clean: RateResolution = {
    ratePct: RATE_STANDARD,
    basis: "standard",
    certificateRateMissing: false,
    certificateExpired: false,
    certificateCeilingExceeded: false,
  };

  if (!seller.pan) return { ...clean, ratePct: RATE_NO_PAN, basis: "no_pan" };

  // An inoperative PAN is treated exactly as an absent one. "unknown" is NOT
  // — it means nobody has checked, which the validation layer reports rather
  // than silently pricing at either rate.
  if (seller.panStatus && PAN_STATUSES_AT_HIGHER_RATE.includes(seller.panStatus)) {
    return { ...clean, ratePct: RATE_NO_PAN, basis: "inoperative_pan" };
  }

  if (!seller.section395CertificateNo) return clean;

  if (seller.section395Rate === null || seller.section395Rate === undefined) {
    return { ...clean, basis: "certificate_rate_missing", certificateRateMissing: true };
  }

  const on = ctx.dateOfDeduction;
  const expired = Boolean(
    on &&
      ((seller.section395ValidFrom && on < seller.section395ValidFrom) ||
        (seller.section395ValidTo && on > seller.section395ValidTo)),
  );
  if (expired) return { ...clean, basis: "certificate_expired", certificateExpired: true };

  const ceiling = seller.section395CeilingAmount;
  if (ceiling !== null && ceiling !== undefined && ceiling > 0) {
    const wouldCover = (ctx.alreadyCovered || 0) + (ctx.amountLiable || 0);
    if (wouldCover > ceiling + 1) {
      return { ...clean, basis: "certificate_exhausted", certificateCeilingExceeded: true };
    }
  }

  return { ...clean, ratePct: seller.section395Rate, basis: "section_395" };
}

// ─── Taxable base ───────────────────────────────────────────────────────────

/**
 * The amount an instalment bears tax on.
 *
 * Tax is charged on the higher of consideration and stamp duty value. Spread
 * across instalments, that means scaling each instalment by the ratio the
 * property's stamp duty value bears to its consideration — so an instalment of
 * ₹10,00,000 on a deal whose SDV is 10% above consideration bears tax on
 * ₹11,00,000. Equivalent to apportioning the full proportionate SDV across
 * instalments, and easier to check by eye.
 *
 * The ratio floors at 1: a stamp duty value BELOW consideration never reduces
 * the base.
 */
export function amountLiableForInstalment(
  considerationPart: number,
  totalSaleConsideration: number,
  totalStampDutyValue: number,
): number {
  if (!considerationPart) return 0;
  if (!totalSaleConsideration || totalSaleConsideration <= 0) return considerationPart;
  const ratio = Math.max(1, (totalStampDutyValue || 0) / totalSaleConsideration);
  return considerationPart * ratio;
}

// ─── Interest and fee ───────────────────────────────────────────────────────

/**
 * Interest on a statement, in its two independent limbs:
 *
 *   • late DEDUCTION — 1% per month or part, from the date the tax was
 *     deductible (the date of payment or credit) to the date it was actually
 *     deducted. Form 141 carries both dates as separate columns, so this is
 *     directly computable rather than inferred.
 *   • late DEPOSIT   — 1.5% per month or part, from the date of deduction to
 *     the date of deposit, and only once the due date has passed.
 *
 * Both limbs can apply to the same statement, and they are additive.
 *
 * Note the due date here is 30 days from the END of the deduction month — NOT
 * the 7th-of-following-month rule the quarterly forms use. Reusing
 * rateEngine.ts's calcAutoInterest would charge interest weeks early.
 */
export function computeInterest(
  tdsAmount: number,
  datePaidOrCredited: string,
  dateOfDeduction: string,
  dateOfDeposit: string | null | undefined,
): Form141Statement["interestBreakdown"] & { total: number } {
  const lateDeductionMonths = monthsOrPartLate(datePaidOrCredited, dateOfDeduction);
  const lateDeduction = rupees(tdsAmount * INTEREST_RATE_LATE_DEDUCTION * lateDeductionMonths);

  let lateDepositMonths = 0;
  let lateDeposit = 0;
  if (dateOfDeposit) {
    const dueDate = form141DueDate(dateOfDeduction);
    if (dateOfDeposit > dueDate) {
      lateDepositMonths = monthsOrPartLate(dateOfDeduction, dateOfDeposit);
      lateDeposit = rupees(tdsAmount * INTEREST_RATE_LATE_DEPOSIT * lateDepositMonths);
    }
  }

  return {
    lateDeduction,
    lateDeductionMonths,
    lateDeposit,
    lateDepositMonths,
    total: lateDeduction + lateDeposit,
  };
}

/**
 * Late-filing fee: ₹200 for every day from the due date to the date of
 * filing, capped at the tax deducted on that statement. The cap is the whole
 * point of the provision — the fee can equal the tax but never exceed it.
 */
export function computeLateFee(
  tdsAmount: number,
  dateOfDeduction: string,
  dateOfFiling: string | null | undefined,
): { fee: number; days: number } {
  if (!dateOfFiling) return { fee: 0, days: 0 };
  const dueDate = form141DueDate(dateOfDeduction);
  const days = daysLate(dueDate, dateOfFiling);
  if (days <= 0) return { fee: 0, days: 0 };
  return { fee: Math.min(days * LATE_FEE_PER_DAY, rupees(tdsAmount)), days };
}

// ─── The engine ─────────────────────────────────────────────────────────────

/**
 * Compute every Form 141 Schedule B statement one buyer must file for one
 * property transaction.
 *
 * `filingBuyerPan` names which buyer is filing — the module is buyer-side, and
 * a co-buyer files their own statements under their own PAN. A transaction is
 * recorded once at property level and produces a different set of statements
 * for each buyer who reads it.
 */
export function computeForm141ScheduleB(
  deal: Form141Deal,
  filingBuyerPan: string,
): Form141Computation {
  const blockers: Form141Blocker[] = [];
  const threshold = evaluateThreshold(deal);

  const buyer = deal.buyers.find((b) => b.pan === filingBuyerPan);
  if (!buyer) {
    blockers.push({
      code: "no_filing_buyer",
      message: `No buyer with PAN ${filingBuyerPan} is listed on this transaction. The statement is filed under the buyer's own PAN, so it cannot be produced for a party who is not a buyer.`,
      ref: filingBuyerPan,
    });
  }
  if (!deal.sellers.length) {
    blockers.push({ code: "no_sellers", message: "The transaction lists no sellers, so no deductee rows can be produced." });
  }
  if (!deal.instalments.length) {
    blockers.push({ code: "no_instalments", message: "The transaction records no payment, so there is nothing to deduct tax on." });
  }

  // A non-resident seller takes the transaction out of s.393(1) Table Sl. No.
  // 3(i) entirely and into s.195 — a different section, a different form, and
  // a TAN the buyer may not even hold. Producing a Schedule B draft anyway
  // would be worse than producing nothing.
  for (const s of deal.sellers) {
    if (s.residentialStatus === "non_resident") {
      blockers.push({
        code: "non_resident_seller",
        message: `${s.name} is a non-resident. Tax on a payment to a non-resident seller is deducted under section 195 and reported in Form 27Q under the deductor's TAN — not in Form 141 Schedule B. This transaction cannot be filed here.`,
        ref: s.pan || s.name,
      });
    }
  }

  for (const inst of deal.instalments) {
    if (!isForm141Regime(inst.datePaidOrCredited)) {
      blockers.push({
        code: "pre_regime",
        message: `Instalment ${inst.seq} was paid on ${inst.datePaidOrCredited}, before the Income-tax Act, 2025 commenced on ${FORM_141_EFFECTIVE_FROM}. That deduction belongs in Form 26QB under the 1961 Act.`,
        ref: String(inst.seq),
      });
    }
  }

  if (blockers.length || !buyer || !threshold.liable) {
    return { threshold, statements: [], blockers, grandTotalTds: 0, grandTotalPayable: 0 };
  }

  const buyerShare = pct(buyer.sharePct);

  // Ordered by WHEN THE MONEY MOVED, not by the sequence number the user
  // happened to type. "Previous instalments" is a statement of historical
  // fact — what had already been paid to this seller when this payment was
  // made — and a payment remembered late and entered as instalment 4 was
  // still, in fact, the first one. Ordering by seq would report it as the
  // last, overstating the earlier statements' carry-forward and understating
  // its own. The seq is the tie-breaker, so same-day payments keep the order
  // the user gave them.
  const ordered = [...deal.instalments].sort(
    (a, b) => a.datePaidOrCredited.localeCompare(b.datePaidOrCredited) || a.seq - b.seq,
  );

  // Cumulative amount already paid to each seller, carried across instalments
  // — and across tax years, since a schedule straddling 31 March is ordinary
  // and each instalment is simply its own statement under its own month.
  const paidSoFar = new Map<string, number>();
  // Cumulative amount already put through each seller's s.395(1) certificate,
  // for the ceiling test. Tracked separately from paidSoFar because only the
  // instalments the certificate ACTUALLY covered count against it.
  const coveredByCertificate = new Map<string, number>();
  const sellerKey = (s: Form141Seller) => s.pan || s.name;

  const statements: Form141Statement[] = ordered.map((inst) => {
    const rows: Form141Row[] = deal.sellers.map((seller) => {
      const key = sellerKey(seller);
      const sellerShare = pct(seller.sharePct);

      const presentInstalment = inst.amountPaidByBuyer * sellerShare;
      const previousInstalments = paidSoFar.get(key) || 0;
      paidSoFar.set(key, previousInstalments + presentInstalment);

      // Pair-level share of the property's stamp duty value. The form's own
      // column is "Proportionate amount of Stamp Duty value", which reads as
      // the pair's share of the whole property rather than an instalment
      // slice — matching the sample, where a lumpsum payment made the two
      // coincide. Flagged in the roadmap as worth confirming against a real
      // multi-instalment filing.
      const proportionateSdv = (deal.totalStampDutyValue || 0) * buyerShare * sellerShare;

      const amountLiable = amountLiableForInstalment(
        presentInstalment,
        deal.totalSaleConsideration,
        deal.totalStampDutyValue,
      );

      const covered = coveredByCertificate.get(key) || 0;
      const { ratePct, basis } = resolveRate(seller, {
        dateOfDeduction: inst.dateOfDeduction,
        alreadyCovered: covered,
        amountLiable,
      });
      if (basis === "section_395") coveredByCertificate.set(key, covered + amountLiable);
      const tdsAmount = rupees(amountLiable * (ratePct / 100));

      return {
        sellerPan: seller.pan,
        sellerName: seller.name,
        proportionateSdv: rupees(proportionateSdv),
        previousInstalments: rupees(previousInstalments),
        presentInstalment: rupees(presentInstalment),
        amountLiable: rupees(amountLiable),
        datePaidOrCredited: inst.datePaidOrCredited,
        dateOfDeduction: inst.dateOfDeduction,
        section395Applicable: basis === "section_395",
        section395CertificateNo: seller.section395CertificateNo || null,
        ratePct,
        rateBasis: basis,
        tdsAmount,
      };
    });

    const totalAmountLiable = rows.reduce((sum, r) => sum + r.amountLiable, 0);
    const totalTds = rows.reduce((sum, r) => sum + r.tdsAmount, 0);

    // Interest and fee attach to the STATEMENT, computed on its total tax —
    // one acknowledgement, one CIN, one Part C, however many seller rows.
    const interest = computeInterest(
      totalTds,
      inst.datePaidOrCredited,
      inst.dateOfDeduction,
      inst.dateOfDeposit,
    );
    const { fee, days } = computeLateFee(
      totalTds,
      inst.dateOfDeduction,
      inst.dateOfFiling ?? inst.dateOfDeposit,
    );

    return {
      instalmentSeq: inst.seq,
      taxYear: taxYearForDate(inst.datePaidOrCredited),
      month: monthOfDeduction(inst.dateOfDeduction),
      dueDate: form141DueDate(inst.dateOfDeduction),
      rows,
      totalAmountLiable,
      totalTds,
      interest: interest.total,
      interestBreakdown: {
        lateDeduction: interest.lateDeduction,
        lateDeductionMonths: interest.lateDeductionMonths,
        lateDeposit: interest.lateDeposit,
        lateDepositMonths: interest.lateDepositMonths,
      },
      fee,
      feeDays: days,
      totalPayable: totalTds + interest.total + fee,
    };
  });

  return {
    threshold,
    statements,
    blockers,
    grandTotalTds: statements.reduce((sum, s) => sum + s.totalTds, 0),
    grandTotalPayable: statements.reduce((sum, s) => sum + s.totalPayable, 0),
  };
}
