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

export interface Form141Seller {
  pan: string | null;
  name: string;
  contact?: string | null;
  email?: string | null;
  /** Proportion of TOTAL sale consideration received by this seller (%). */
  sharePct: number;
  residentialStatus: ResidentialStatus;
  /** Lower/nil deduction certificate under s.395(1), when one is held. */
  section395CertificateNo?: string | null;
  /** Rate the certificate permits, as a percentage. Null with a certificate
   *  number present is itself a validation error, not a silent fall-back. */
  section395Rate?: number | null;
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
  totalSaleConsideration: number;
  totalStampDutyValue: number;
  paymentMode: "lumpsum" | "instalments";
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
  section395Applicable: boolean;
  section395CertificateNo: string | null;
  ratePct: number;
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
 * Rate for one seller, in priority order:
 *   1. No PAN                    → 20%
 *   2. Valid s.395(1) certificate → the rate it permits
 *   3. Otherwise                  → 1%
 *
 * A certificate NUMBER without a rate does not silently fall through to 1% —
 * it returns 1% but flags `certificateRateMissing`, which form141Validate.ts
 * treats as blocking. Deducting at the standard rate when a certificate says
 * otherwise over-deducts the seller's money; deducting at a rate nobody
 * supplied under-deducts the government's. Neither is a default worth
 * guessing.
 */
export function resolveRate(seller: Form141Seller): {
  ratePct: number;
  basis: "no_pan" | "section_395" | "standard";
  certificateRateMissing: boolean;
} {
  if (!seller.pan) {
    return { ratePct: RATE_NO_PAN, basis: "no_pan", certificateRateMissing: false };
  }
  if (seller.section395CertificateNo) {
    if (seller.section395Rate === null || seller.section395Rate === undefined) {
      return { ratePct: RATE_STANDARD, basis: "standard", certificateRateMissing: true };
    }
    return { ratePct: seller.section395Rate, basis: "section_395", certificateRateMissing: false };
  }
  return { ratePct: RATE_STANDARD, basis: "standard", certificateRateMissing: false };
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
  const ordered = [...deal.instalments].sort((a, b) => a.seq - b.seq);

  // Cumulative amount already paid to each seller, carried across instalments
  // — and across tax years, since a schedule straddling 31 March is ordinary
  // and each instalment is simply its own statement under its own month.
  const paidSoFar = new Map<string, number>();
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

      const { ratePct } = resolveRate(seller);
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
        section395Applicable: Boolean(seller.section395CertificateNo),
        section395CertificateNo: seller.section395CertificateNo || null,
        ratePct,
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
