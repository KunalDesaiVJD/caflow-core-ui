/**
 * Form 141 Schedule B — validation engine.
 * ========================================
 *
 * The gate every figure passes before it reaches a draft form, whether it was
 * typed by hand, read out of a sale agreement by the extractor, or lifted
 * from an acknowledgement the user uploaded. One gate, not three: an
 * extracted value and a keyed value are indistinguishable here, which is the
 * whole point — the AI proposes, this engine disposes.
 *
 * ── Why this exists, concretely ────────────────────────────────────────────
 *
 * The real filed statement this module is pinned against (Acknowledgement
 * BTA0188370) contains an arithmetic contradiction the portal accepted:
 * seller 1's row shows an "Amount paid or credited in present instalment" of
 * ₹6,40,000 against an "Amount on which tax is liable to be deducted" of
 * ₹64,00,000, on a payment marked Lumpsum with no previous instalments. A
 * dropped zero. Seller 2's row, identical in every other respect, is correct.
 *
 * The tax paid was right, so no money was lost — but the STATEMENT is wrong,
 * and that statement is what the seller sees, what feeds their credit, and
 * what an officer reads back years later. Nothing in the filing chain caught
 * it. checkRowConsistency() below catches it with pure arithmetic, without
 * needing to know anything about the deal.
 *
 * ── Two independent checks, deliberately ──────────────────────────────────
 *
 *   1. checkRowConsistency  — INTRA-row arithmetic on stated figures alone.
 *      Needs no deal, no engine, no context. This is what lets the same code
 *      validate a third-party acknowledgement the user uploads, not just a
 *      draft this app produced.
 *
 *   2. compareWithComputed  — stated figures against what the engine derives
 *      from the deal. Catches a wrong figure that happens to be internally
 *      consistent (e.g. every column scaled by the same wrong share).
 *
 * A draft that passes only one of these is not validated.
 *
 * ── Severity ──────────────────────────────────────────────────────────────
 *
 *   blocking — the draft cannot be produced. Arithmetic that does not add up,
 *              a party who cannot legally be on this form, a period outside
 *              the module's regime.
 *   warning  — proceed, but a human should look. Almost always a figure that
 *              is legal but unusual, or a fact this codebase has not verified
 *              well enough to block on.
 *
 * Nothing here is advisory-only: a blocking finding blocks. If a rule cannot
 * justify stopping a filing, it is a warning, and if it cannot justify a
 * human's attention it is not a rule.
 */

import { isValidPan, PAN_4TH_CHAR_MAP } from "./rateEngine";
import {
  THRESHOLD_TOTAL_CONSIDERATION,
  THRESHOLD_PROXIMITY_WARN,
  RATE_STANDARD,
  RATE_NO_PAN,
  isForm141Regime,
  form141DueDate,
  todayInIndia,
  FORM_141_EFFECTIVE_FROM,
} from "./form141";
import {
  computeForm141ScheduleB,
  resolveRate,
  type Form141Deal,
  type Form141Computation,
  type Form141Statement,
} from "./form141ScheduleB";

// ─── Findings ───────────────────────────────────────────────────────────────

export type Severity = "blocking" | "warning";

export interface Form141Finding {
  code: string;
  severity: Severity;
  /** The form field or input this attaches to, for anchoring in the UI. */
  field: string;
  /** What is wrong AND what to do about it. Never just "invalid". */
  message: string;
  /** Seller PAN, instalment sequence, or party name the finding is about. */
  ref?: string;
}

export interface ValidationResult {
  findings: Form141Finding[];
  blocking: Form141Finding[];
  warnings: Form141Finding[];
  ok: boolean;
}

function collect(findings: Form141Finding[]): ValidationResult {
  const blocking = findings.filter((f) => f.severity === "blocking");
  const warnings = findings.filter((f) => f.severity === "warning");
  return { findings, blocking, warnings, ok: blocking.length === 0 };
}

// ─── Money comparison ───────────────────────────────────────────────────────

/**
 * Currency equality to the rupee. Direct === on floats reports 0.1 + 0.2 as
 * unequal to 0.3, which would raise a blocking finding on a correct filing —
 * the same paise-precision trap rateEngine.ts's toPaise() already guards.
 */
const RUPEE_TOLERANCE = 1;
const moneyEq = (a: number, b: number): boolean => Math.abs((a || 0) - (b || 0)) <= RUPEE_TOLERANCE;

const inr = (n: number): string => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

// ─── Stated figures ─────────────────────────────────────────────────────────
//
// What a row LOOKS like on a form — as keyed, as extracted, or as read off an
// uploaded acknowledgement. Every field optional: a partially-filled draft
// must be checkable, and an absent figure is not a wrong figure.

export interface StatedRow {
  sellerPan?: string | null;
  sellerName?: string;
  proportionateSdv?: number | null;
  previousInstalments?: number | null;
  presentInstalment?: number | null;
  amountLiable?: number | null;
  ratePct?: number | null;
  tdsAmount?: number | null;
  section395CertificateNo?: string | null;
}

export interface StatedStatement {
  instalmentSeq?: number;
  rows: StatedRow[];
  /** Part C (a). */
  totalTds?: number | null;
  /** The form's "Total amount on which tax is required to be deducted". */
  totalAmountLiable?: number | null;
}

// ─── 1. Intra-row arithmetic ────────────────────────────────────────────────

/**
 * Check one stated row against itself. No deal, no engine, no context.
 *
 * `sdvRatio` is the property's stamp-duty-value-to-consideration ratio,
 * floored at 1 — the factor by which the taxable base exceeds the amount
 * actually paid. Pass 1 (the default) when the stamp duty value does not
 * exceed consideration, which is the ordinary case and the one the sample
 * sits in.
 *
 * The rules:
 *   • amountLiable must equal presentInstalment × sdvRatio. This is the
 *     ₹6,40,000-against-₹64,00,000 catcher.
 *   • tdsAmount must equal amountLiable × rate.
 *   • rate must be 1%, 20% (no PAN), or backed by a s.395(1) certificate.
 *   • a stated PAN must be a well-formed PAN.
 */
export function checkRowConsistency(row: StatedRow, sdvRatio = 1): Form141Finding[] {
  const findings: Form141Finding[] = [];
  const ref = row.sellerPan || row.sellerName || undefined;

  const present = row.presentInstalment;
  const liable = row.amountLiable;

  if (present !== null && present !== undefined && liable !== null && liable !== undefined) {
    const expected = present * Math.max(1, sdvRatio);
    if (!moneyEq(liable, expected)) {
      findings.push({
        code: "row_liable_mismatch",
        severity: "blocking",
        field: "amountLiable",
        ref,
        message:
          sdvRatio > 1
            ? `Amount on which tax is liable (${inr(liable)}) does not match the present instalment of ${inr(present)} stepped up by the stamp duty value (expected ${inr(expected)}). Correct one of the two figures.`
            : `Amount on which tax is liable (${inr(liable)}) does not match the present instalment of ${inr(present)}. With the stamp duty value at or below the consideration these must be equal — check for a missing or extra digit in one of them.`,
      });
    }
  }

  if (
    liable !== null && liable !== undefined &&
    row.ratePct !== null && row.ratePct !== undefined &&
    row.tdsAmount !== null && row.tdsAmount !== undefined
  ) {
    const expected = Math.round(liable * (row.ratePct / 100));
    if (!moneyEq(row.tdsAmount, expected)) {
      findings.push({
        code: "row_tds_mismatch",
        severity: "blocking",
        field: "tdsAmount",
        ref,
        message: `Tax deducted of ${inr(row.tdsAmount)} is not ${row.ratePct}% of ${inr(liable)} — that would be ${inr(expected)}.`,
      });
    }
  }

  if (row.ratePct !== null && row.ratePct !== undefined) {
    const hasCert = Boolean(row.section395CertificateNo);
    const standard = row.ratePct === RATE_STANDARD || row.ratePct === RATE_NO_PAN;
    if (!standard && !hasCert) {
      findings.push({
        code: "row_rate_unsupported",
        severity: "blocking",
        field: "ratePct",
        ref,
        message: `A rate of ${row.ratePct}% needs either no PAN on record (${RATE_NO_PAN}%) or a section 395(1) certificate. Add the certificate number, or correct the rate to ${RATE_STANDARD}%.`,
      });
    }
    if (row.ratePct === RATE_NO_PAN && row.sellerPan) {
      findings.push({
        code: "row_no_pan_rate_with_pan",
        severity: "blocking",
        field: "ratePct",
        ref,
        message: `Tax is being deducted at ${RATE_NO_PAN}% although a PAN (${row.sellerPan}) is on record. Use ${RATE_STANDARD}%, or remove the PAN if it is genuinely unavailable.`,
      });
    }
  }

  if (row.sellerPan && !isValidPan(row.sellerPan)) {
    findings.push({
      code: "row_pan_invalid",
      severity: "blocking",
      field: "sellerPan",
      ref,
      message: `"${row.sellerPan}" is not a valid PAN. A PAN is five letters, four digits and a letter, e.g. ABCDE1234F.`,
    });
  } else if (row.sellerPan) {
    const fourth = row.sellerPan.toUpperCase()[3];
    if (!PAN_4TH_CHAR_MAP[fourth]) {
      findings.push({
        code: "row_pan_unknown_holder_type",
        severity: "warning",
        field: "sellerPan",
        ref,
        message: `PAN ${row.sellerPan} has an unrecognised holder-type character "${fourth}" in the fourth position. Confirm the PAN was read correctly.`,
      });
    }
  }

  if (present !== null && present !== undefined && present < 0) {
    findings.push({
      code: "row_negative_instalment",
      severity: "blocking",
      field: "presentInstalment",
      ref,
      message: "The present instalment cannot be negative.",
    });
  }

  return findings;
}

/** Every row in a stated statement, plus its Part C totals. */
export function checkStatementConsistency(stmt: StatedStatement, sdvRatio = 1): Form141Finding[] {
  const findings = stmt.rows.flatMap((r) => checkRowConsistency(r, sdvRatio));

  const rowsWithTds = stmt.rows.filter((r) => r.tdsAmount !== null && r.tdsAmount !== undefined);
  if (rowsWithTds.length && stmt.totalTds !== null && stmt.totalTds !== undefined) {
    const sum = rowsWithTds.reduce((t, r) => t + (r.tdsAmount || 0), 0);
    if (!moneyEq(sum, stmt.totalTds)) {
      findings.push({
        code: "statement_tds_total_mismatch",
        severity: "blocking",
        field: "totalTds",
        message: `Part C shows tax deducted of ${inr(stmt.totalTds)}, but the deductee rows add up to ${inr(sum)}.`,
      });
    }
  }

  const rowsWithLiable = stmt.rows.filter((r) => r.amountLiable !== null && r.amountLiable !== undefined);
  if (rowsWithLiable.length && stmt.totalAmountLiable !== null && stmt.totalAmountLiable !== undefined) {
    const sum = rowsWithLiable.reduce((t, r) => t + (r.amountLiable || 0), 0);
    if (!moneyEq(sum, stmt.totalAmountLiable)) {
      findings.push({
        code: "statement_liable_total_mismatch",
        severity: "blocking",
        field: "totalAmountLiable",
        message: `The total amount on which tax is required to be deducted (${inr(stmt.totalAmountLiable)}) does not match the sum of the deductee rows (${inr(sum)}).`,
      });
    }
  }

  return findings;
}

// ─── 2. Deal-level integrity ────────────────────────────────────────────────

/**
 * Validate the transaction itself, before any statement is produced.
 *
 * `selectedClientPan` is the PAN of the client whose file this is being
 * entered under. When supplied and it does not appear among the buyers, that
 * blocks — filing one client's deduction under another client's record is
 * both a compliance error and very hard to unpick afterwards.
 */
export function validateDeal(
  deal: Form141Deal,
  filingBuyerPan: string,
  selectedClientPan?: string | null,
): Form141Finding[] {
  const findings: Form141Finding[] = [];

  // ── Shares ───────────────────────────────────────────────────────────────
  const buyerSum = deal.buyers.reduce((t, b) => t + (b.sharePct || 0), 0);
  if (deal.buyers.length && Math.abs(buyerSum - 100) > 0.01) {
    findings.push({
      code: "buyer_shares_not_100",
      severity: "blocking",
      field: "buyers",
      message: `The buyers' shares add up to ${buyerSum}%, not 100%. Every buyer's proportion of the total sale consideration must be listed, and they must total 100%.`,
    });
  }
  const sellerSum = deal.sellers.reduce((t, s) => t + (s.sharePct || 0), 0);
  if (deal.sellers.length && Math.abs(sellerSum - 100) > 0.01) {
    findings.push({
      code: "seller_shares_not_100",
      severity: "blocking",
      field: "sellers",
      message: `The sellers' shares add up to ${sellerSum}%, not 100%. Every seller's proportion must be listed, and they must total 100%.`,
    });
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  for (const b of deal.buyers) {
    if (b.pan && !isValidPan(b.pan)) {
      findings.push({
        code: "buyer_pan_invalid",
        severity: "blocking",
        field: "buyers",
        ref: b.name,
        message: `Buyer ${b.name} has an invalid PAN "${b.pan}". A PAN is five letters, four digits and a letter.`,
      });
    }
  }
  if (!deal.buyers.some((b) => b.pan === filingBuyerPan)) {
    findings.push({
      code: "filing_buyer_not_listed",
      severity: "blocking",
      field: "buyers",
      ref: filingBuyerPan,
      message: `The statement is being filed under PAN ${filingBuyerPan}, which is not one of the buyers listed on this transaction.`,
    });
  }
  if (selectedClientPan && !deal.buyers.some((b) => b.pan === selectedClientPan)) {
    findings.push({
      code: "client_pan_not_a_buyer",
      severity: "blocking",
      field: "client",
      ref: selectedClientPan,
      message: `This transaction is being recorded under a client whose PAN (${selectedClientPan}) is not among the buyers on the agreement. Check that the correct client is selected and that the agreement belongs to them.`,
    });
  }

  // ── Sellers ──────────────────────────────────────────────────────────────
  for (const s of deal.sellers) {
    const ref = s.pan || s.name;
    if (s.residentialStatus === "non_resident") {
      findings.push({
        code: "non_resident_seller",
        severity: "blocking",
        field: "sellers",
        ref,
        message: `${s.name} is a non-resident. Tax on a payment to a non-resident seller is deducted under section 195 and reported in Form 27Q under a TAN — not in Form 141 Schedule B.`,
      });
    }
    if (s.pan && !isValidPan(s.pan)) {
      findings.push({
        code: "seller_pan_invalid",
        severity: "blocking",
        field: "sellers",
        ref,
        message: `Seller ${s.name} has an invalid PAN "${s.pan}".`,
      });
    }
    if (s.section395CertificateNo && (s.section395Rate === null || s.section395Rate === undefined)) {
      findings.push({
        code: "certificate_rate_missing",
        severity: "blocking",
        field: "sellers",
        ref,
        message: `${s.name} holds a section 395(1) certificate (${s.section395CertificateNo}) but no rate has been recorded for it. Enter the rate the certificate permits — deducting at the standard ${RATE_STANDARD}% instead would over-deduct.`,
      });
    }
    // ── PAN operativeness ──────────────────────────────────────────────
    // The gap this closes is the expensive one. A PAN that exists but is not
    // linked to Aadhaar is INOPERATIVE, and a deduction against it is due at
    // 20%, not 1%. Nothing on the deed reveals it and the seller will not
    // raise it, so an unchecked PAN is reported as unchecked rather than
    // quietly priced at the lower rate. On a ₹1 crore flat the difference is
    // ₹19 lakh, recovered from the buyer.
    if (s.pan && isValidPan(s.pan)) {
      if (s.panStatus === "inoperative" || s.panStatus === "invalid") {
        findings.push({
          code: "seller_pan_inoperative",
          severity: "warning",
          field: "sellers",
          ref,
          message: `${s.name}'s PAN is recorded as ${s.panStatus}, so tax on this seller is being deducted at ${RATE_NO_PAN}% rather than ${RATE_STANDARD}%. If the seller has since linked their PAN to Aadhaar, update the status before filing — and tell them, because they cannot claim credit for a deduction against an inoperative PAN.`,
        });
      } else if (!s.panStatus || s.panStatus === "unknown") {
        findings.push({
          code: "seller_pan_status_unchecked",
          severity: "warning",
          field: "sellers",
          ref,
          message: `${s.name}'s PAN has not been checked for operativeness. An inoperative (Aadhaar-unlinked) PAN attracts ${RATE_NO_PAN}% instead of ${RATE_STANDARD}%, and the shortfall is recovered from the buyer with interest. Verify it before filing.`,
        });
      }
    }

    // ── Certificate coherence ──────────────────────────────────────────
    if (s.section395CertificateNo) {
      if (s.section395ValidFrom && s.section395ValidTo && s.section395ValidFrom > s.section395ValidTo) {
        findings.push({
          code: "certificate_window_inverted",
          severity: "blocking",
          field: "sellers",
          ref,
          message: `${s.name}'s section 395(1) certificate is recorded as valid from ${s.section395ValidFrom} to ${s.section395ValidTo}, which ends before it starts.`,
        });
      }
      if (!s.section395ValidFrom && !s.section395ValidTo) {
        findings.push({
          code: "certificate_window_missing",
          severity: "warning",
          field: "sellers",
          ref,
          message: `No validity period recorded for ${s.name}'s section 395(1) certificate. A certificate authorises deductions made within its own window only — without the dates, a later instalment will keep taking the concessional rate after the certificate has expired.`,
        });
      }
      if (
        s.section395CeilingAmount === null ||
        s.section395CeilingAmount === undefined ||
        s.section395CeilingAmount <= 0
      ) {
        findings.push({
          code: "certificate_ceiling_missing",
          severity: "warning",
          field: "sellers",
          ref,
          message: `No amount ceiling recorded for ${s.name}'s section 395(1) certificate. A certificate covers a stated amount; tax on anything beyond it is due at the standard ${RATE_STANDARD}%. Without the ceiling the concessional rate is applied to the whole consideration.`,
        });
      }
    }

    if (!s.email && !s.contact) {
      findings.push({
        code: "seller_contact_missing",
        severity: "warning",
        field: "sellers",
        ref,
        message: `No email or contact number recorded for ${s.name}. Form 141 asks for both, and the TDS certificate has to reach the seller.`,
      });
    }
  }

  // ── Amounts ──────────────────────────────────────────────────────────────
  if (!deal.totalSaleConsideration || deal.totalSaleConsideration <= 0) {
    findings.push({
      code: "consideration_missing",
      severity: "blocking",
      field: "totalSaleConsideration",
      message: "The total sale consideration is missing or zero. It is the basis of the whole computation.",
    });
  }
  if (!deal.totalStampDutyValue) {
    // A WARNING, not a blocker, and never a question.
    //
    // The figure is the government's own jantri/circle rate, revised on the
    // government's schedule and printed on the Index-II page. Asking a
    // preparer for it can only produce a look-up or a guess, so the module
    // reads it off the document and otherwise leaves it empty.
    //
    // Blocking on it would have locked a user out of their own filing over a
    // number nobody in the room is allowed to decide. The consequence is real
    // and is stated instead of hidden: with no stamp duty value the engine
    // charges tax on the consideration alone, which under-deducts wherever the
    // circle rate is higher. That is a judgement for the preparer to make on
    // the facts, with this said plainly on the transaction.
    findings.push({
      code: "stamp_duty_value_missing",
      severity: "warning",
      field: "totalStampDutyValue",
      message:
        "No stamp duty value was found on the uploaded document, so tax is computed on the sale consideration alone. Tax is charged on the HIGHER of consideration and stamp duty value, so where the circle rate exceeds the price this under-deducts. Upload the Index-II page if it was not included.",
    });
  }
  if (deal.totalStampDutyValue > deal.totalSaleConsideration && deal.totalSaleConsideration > 0) {
    findings.push({
      code: "sdv_above_consideration",
      severity: "warning",
      field: "totalStampDutyValue",
      message: `The stamp duty value (${inr(deal.totalStampDutyValue)}) exceeds the sale consideration (${inr(deal.totalSaleConsideration)}), so tax is charged on the higher figure. Confirm both before filing.`,
    });
  }

  const tested = Math.max(deal.totalSaleConsideration || 0, deal.totalStampDutyValue || 0);
  const nearBand = THRESHOLD_TOTAL_CONSIDERATION * THRESHOLD_PROXIMITY_WARN;
  if (Math.abs(tested - THRESHOLD_TOTAL_CONSIDERATION) <= nearBand) {
    findings.push({
      code: "near_threshold",
      severity: "warning",
      field: "totalSaleConsideration",
      message: `At ${inr(tested)} this transaction sits within 5% of the ${inr(THRESHOLD_TOTAL_CONSIDERATION)} threshold. A single mis-keyed digit flips liability entirely — verify the figure against the agreement.`,
    });
  }
  if (
    (deal.totalSaleConsideration || 0) < THRESHOLD_TOTAL_CONSIDERATION &&
    (deal.totalStampDutyValue || 0) >= THRESHOLD_TOTAL_CONSIDERATION
  ) {
    findings.push({
      code: "sub_threshold_sdv_liable",
      severity: "warning",
      field: "totalStampDutyValue",
      message: `The consideration is below ${inr(THRESHOLD_TOTAL_CONSIDERATION)} but the stamp duty value is not, so tax IS deductible. This is easy to miss when working from the sale price alone.`,
    });
  }

  // ── Which stamp duty value governs ───────────────────────────────────────
  //
  // Where a deed is registered later than it is agreed there are two circle
  // rates in play, and where part-consideration moved by banking channel on or
  // before the agreement date it is the AGREEMENT-date value that governs,
  // while Index-II carries the registration-date one.
  //
  // This module used to raise that as two questions to the user. It no longer
  // asks anything about the stamp duty value — see stamp_duty_value_missing
  // above — so the point is made once, as a note on the facts already present,
  // and only where the two dates actually differ and money actually moved by
  // the agreement date. Nothing here asks for a figure.
  if (
    deal.dateOfRegistration &&
    deal.dateOfAgreement &&
    deal.dateOfRegistration !== deal.dateOfAgreement &&
    deal.instalments.some((i) => i.datePaidOrCredited <= deal.dateOfAgreement)
  ) {
    findings.push({
      code: "sdv_agreement_date_governs",
      severity: "warning",
      field: "totalStampDutyValue",
      message: `Consideration moved on or before the agreement date (${deal.dateOfAgreement}) and the deed was registered later, on ${deal.dateOfRegistration}. Where part-consideration is paid by banking channel on or before the agreement date, the AGREEMENT-date stamp duty value governs — and the Index-II page carries the registration-date one. Check which figure applies before filing.`,
    });
  }
  if (deal.dateOfRegistration && deal.dateOfAgreement && deal.dateOfRegistration < deal.dateOfAgreement) {
    findings.push({
      code: "registration_before_agreement",
      severity: "blocking",
      field: "dateOfRegistration",
      message: `The deed is shown as registered on ${deal.dateOfRegistration}, before it was agreed on ${deal.dateOfAgreement}. Check both dates.`,
    });
  }

  // ── GST ──────────────────────────────────────────────────────────────────
  // Tax is deducted on the consideration, not on GST charged over it. A deed
  // quoting a tax-inclusive figure is the common way the gross amount ends up
  // in the consideration field — particularly on an under-construction flat.
  const gstText = `${deal.notes || ""} ${deal.propertyType || ""} ${deal.propertyAddress || ""}`;
  if (/\bGST\b|inclusive of (all )?tax|tax[- ]inclusive/i.test(gstText)) {
    findings.push({
      code: "gst_in_consideration",
      severity: "warning",
      field: "totalSaleConsideration",
      message:
        "This transaction mentions GST or a tax-inclusive price. Tax is deducted on the consideration for the property, not on GST charged over it — confirm the figure entered excludes GST.",
    });
  }

  // Matched across the type AND the address: a deed reading "Survey No. 142,
  // Village Karjat" is agricultural land that names itself nowhere in the
  // property-type field.
  if (/agricultur|farm|krishi|kheti|survey no|gut no|khasra/i.test(
    `${deal.propertyType || ""} ${deal.propertyAddress || ""}`,
  )) {
    findings.push({
      code: "agricultural_land",
      severity: "warning",
      field: "propertyType",
      message:
        "This looks like agricultural land. Rural agricultural land is outside the charge — confirm whether the land is rural or urban before filing. This is flagged rather than blocked because the Income-tax Act, 2025 definition has not been verified against the 1961 Act's.",
    });
  }

  // ── Instalments ──────────────────────────────────────────────────────────
  if (deal.paymentMode === "lumpsum" && deal.instalments.length > 1) {
    findings.push({
      code: "lumpsum_multiple_instalments",
      severity: "blocking",
      field: "paymentMode",
      message: `The payment is marked Lumpsum but ${deal.instalments.length} instalments are recorded. Change the mode to Instalments, or merge the payments.`,
    });
  }

  // The engine carries "previous instalments" forward in DATE order, because
  // that is what the column means. Where the sequence numbers disagree with
  // the chronology — a forgotten earlier payment entered last, which is how
  // it usually happens — the statements will not print in the order the user
  // typed them, and that is worth saying out loud rather than letting them
  // wonder.
  const bySeq = [...deal.instalments].sort((a, b) => a.seq - b.seq);
  const outOfOrder = bySeq.some(
    (inst, idx) => idx > 0 && inst.datePaidOrCredited < bySeq[idx - 1].datePaidOrCredited,
  );
  if (outOfOrder) {
    findings.push({
      code: "instalments_out_of_date_order",
      severity: "warning",
      field: "instalments",
      message:
        "The instalments are not numbered in the order they were paid. Tax is computed in date order — which is what the form's \u201cprevious instalments\u201d column means — so the statements will follow the payment dates, not the sequence numbers. Renumber them if the order shown is not what you expect.",
    });
  }

  const buyer = deal.buyers.find((b) => b.pan === filingBuyerPan);
  if (buyer) {
    const obligation = (deal.totalSaleConsideration || 0) * (buyer.sharePct / 100);
    const paid = deal.instalments.reduce((t, i) => t + (i.amountPaidByBuyer || 0), 0);
    if (paid - obligation > RUPEE_TOLERANCE) {
      findings.push({
        code: "instalments_exceed_obligation",
        severity: "blocking",
        field: "instalments",
        message: `The instalments total ${inr(paid)}, more than this buyer's ${buyer.sharePct}% share of the consideration (${inr(obligation)}). Check the amounts and the share.`,
      });
    }
  }

  const seen = new Set<number>();
  for (const inst of deal.instalments) {
    const ref = String(inst.seq);
    if (seen.has(inst.seq)) {
      findings.push({
        code: "duplicate_instalment_seq",
        severity: "blocking",
        field: "instalments",
        ref,
        message: `Two instalments share the sequence number ${inst.seq}.`,
      });
    }
    seen.add(inst.seq);

    if (!isForm141Regime(inst.datePaidOrCredited)) {
      findings.push({
        code: "pre_regime_payment",
        severity: "blocking",
        field: "instalments",
        ref,
        message: `Instalment ${inst.seq} was paid on ${inst.datePaidOrCredited}, before the Income-tax Act, 2025 commenced on ${FORM_141_EFFECTIVE_FROM}. That deduction belongs in Form 26QB under the 1961 Act, which this module does not produce.`,
      });
    }
    if (inst.dateOfDeduction < inst.datePaidOrCredited) {
      findings.push({
        code: "deduction_before_payment",
        severity: "blocking",
        field: "instalments",
        ref,
        message: `Instalment ${inst.seq} shows tax deducted on ${inst.dateOfDeduction}, before the payment on ${inst.datePaidOrCredited}. Tax cannot be deducted from a payment that has not been made.`,
      });
    }
    if (inst.dateOfDeposit && inst.dateOfDeposit < inst.dateOfDeduction) {
      findings.push({
        code: "deposit_before_deduction",
        severity: "warning",
        field: "instalments",
        ref,
        message: `Instalment ${inst.seq} shows the challan deposited on ${inst.dateOfDeposit}, before the deduction date of ${inst.dateOfDeduction}. Check both dates.`,
      });
    }
    if (deal.dateOfAgreement && deal.dateOfAgreement > inst.datePaidOrCredited) {
      findings.push({
        code: "agreement_after_payment",
        severity: "warning",
        field: "dateOfAgreement",
        ref,
        message: `The agreement is dated ${deal.dateOfAgreement}, after instalment ${inst.seq} was paid on ${inst.datePaidOrCredited}. An advance before the agreement is possible, but confirm both dates.`,
      });
    }
    if (!inst.dateOfDeposit) {
      const due = form141DueDate(inst.dateOfDeduction);
      const today = todayInIndia();
      if (today > due) {
        findings.push({
          code: "past_due_unpaid",
          severity: "warning",
          field: "instalments",
          ref,
          message: `Instalment ${inst.seq} was due on ${due} and has no deposit recorded. Interest and a ₹200-a-day fee are accruing.`,
        });
      }
    }
  }

  return findings;
}

// ─── 3. Stated against computed ─────────────────────────────────────────────

/**
 * Compare what a form SAYS against what the engine derives from the deal.
 *
 * Catches the class checkRowConsistency() cannot: figures that are internally
 * consistent but wrong — every column of a row scaled by a mistaken share, a
 * seller's proportion transposed, an instalment attributed to the wrong
 * payment. Rows are matched on seller PAN; a stated row naming a seller who
 * is not on the deal is itself a finding.
 */
export function compareWithComputed(
  stated: StatedStatement,
  computed: Form141Statement,
): Form141Finding[] {
  const findings: Form141Finding[] = [];

  for (const row of stated.rows) {
    const match = computed.rows.find((c) => c.sellerPan && c.sellerPan === row.sellerPan);
    if (!match) {
      findings.push({
        code: "stated_seller_not_on_deal",
        severity: "blocking",
        field: "sellerPan",
        ref: row.sellerPan || row.sellerName,
        message: `The statement names a deductee (${row.sellerPan || row.sellerName}) who is not among the sellers recorded on this transaction.`,
      });
      continue;
    }
    const ref = match.sellerPan || match.sellerName;
    const cmp: Array<[keyof StatedRow, number, string]> = [
      ["presentInstalment", match.presentInstalment, "Amount paid or credited in present instalment"],
      ["previousInstalments", match.previousInstalments, "Amount paid or credited in previous instalments"],
      ["amountLiable", match.amountLiable, "Amount on which tax is liable to be deducted"],
      ["proportionateSdv", match.proportionateSdv, "Proportionate amount of Stamp Duty value"],
      ["tdsAmount", match.tdsAmount, "Amount of tax deducted at source"],
    ];
    for (const [key, expected, label] of cmp) {
      const v = row[key] as number | null | undefined;
      if (v === null || v === undefined) continue;
      if (!moneyEq(v, expected)) {
        findings.push({
          code: `stated_${key}_mismatch`,
          severity: "blocking",
          field: String(key),
          ref,
          message: `${label} is stated as ${inr(v)} but computes to ${inr(expected)} from the transaction as recorded.`,
        });
      }
    }
    if (row.ratePct !== null && row.ratePct !== undefined && row.ratePct !== match.ratePct) {
      findings.push({
        code: "stated_rate_mismatch",
        severity: "blocking",
        field: "ratePct",
        ref,
        message: `The rate is stated as ${row.ratePct}% but resolves to ${match.ratePct}% for this seller.`,
      });
    }
  }

  if (stated.totalTds !== null && stated.totalTds !== undefined && !moneyEq(stated.totalTds, computed.totalTds)) {
    findings.push({
      code: "stated_total_tds_mismatch",
      severity: "blocking",
      field: "totalTds",
      message: `Part C states tax deducted of ${inr(stated.totalTds)}; the transaction computes to ${inr(computed.totalTds)}.`,
    });
  }

  return findings;
}

// ─── 4. Why each row carries the rate it does ───────────────────────────────

/**
 * Turn the engine's rate fallbacks into findings.
 *
 * A section 395(1) certificate that was held but did not govern a deduction —
 * because it had expired, or because the deal had already used up the amount
 * it covers — is invisible on the face of the form: the row simply shows the
 * standard rate. It is also exactly the thing the seller telephones about.
 * Reading it off `rateBasis` keeps the reasoning in the engine and the
 * reporting here, rather than re-deriving the cumulative amounts twice.
 *
 * Both are warnings, not blockers. The rate the engine fell back to is the
 * correct one; the finding exists so nobody is surprised by it.
 */
export function checkRateBases(computation: Form141Computation): Form141Finding[] {
  const findings: Form141Finding[] = [];
  const reported = new Set<string>();

  for (const stmt of computation.statements) {
    for (const row of stmt.rows) {
      const ref = row.sellerPan || row.sellerName;
      const key = `${row.rateBasis}:${ref}`;

      if (row.rateBasis === "certificate_expired" && !reported.has(key)) {
        reported.add(key);
        findings.push({
          code: "certificate_expired",
          severity: "warning",
          field: "sellers",
          ref,
          message: `${row.sellerName}'s section 395(1) certificate (${row.section395CertificateNo}) does not cover the deduction made on ${row.dateOfDeduction}, so that instalment is deducted at the standard ${RATE_STANDARD}%. A certificate authorises deductions inside its own validity period only.`,
        });
      }

      if (row.rateBasis === "certificate_exhausted" && !reported.has(key)) {
        reported.add(key);
        findings.push({
          code: "certificate_ceiling_exceeded",
          severity: "warning",
          field: "sellers",
          ref,
          message: `${row.sellerName}'s section 395(1) certificate has been used up by earlier instalments on this deal, so instalment ${stmt.instalmentSeq} is deducted at the standard ${RATE_STANDARD}% rather than the certificate rate. The certificate covers an amount, not the whole transaction.`,
        });
      }

      if (row.rateBasis === "inoperative_pan" && !reported.has(key)) {
        reported.add(key);
        findings.push({
          code: "rate_from_inoperative_pan",
          severity: "warning",
          field: "sellers",
          ref,
          message: `Tax on ${row.sellerName} is computed at ${row.ratePct}% because their PAN is recorded as inoperative. Confirm the status before filing — this trebles the deduction and the seller cannot claim credit for it.`,
        });
      }
    }
  }

  return findings;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ValidateOptions {
  selectedClientPan?: string | null;
  /** Stated statements to cross-check, keyed by instalment sequence. Omit for
   *  a pure deal validation before any figures have been keyed. */
  stated?: StatedStatement[];
}

/**
 * The one call the UI makes. Runs deal integrity, engine blockers, intra-row
 * arithmetic and the stated-versus-computed comparison, and returns a single
 * ordered finding list — blocking first.
 */
export function validateForm141(
  deal: Form141Deal,
  filingBuyerPan: string,
  options: ValidateOptions = {},
): ValidationResult & { computation: Form141Computation } {
  const computation = computeForm141ScheduleB(deal, filingBuyerPan);
  const findings: Form141Finding[] = [
    ...validateDeal(deal, filingBuyerPan, options.selectedClientPan),
  ];

  // Engine blockers that the deal checks do not already cover, so a caller
  // holding only a ValidationResult still sees everything that stops a draft.
  findings.push(...checkRateBases(computation));

  const covered = new Set(findings.map((f) => f.code));
  for (const b of computation.blockers) {
    if (b.code === "non_resident_seller" && covered.has("non_resident_seller")) continue;
    if (b.code === "pre_regime" && covered.has("pre_regime_payment")) continue;
    if (b.code === "no_filing_buyer" && covered.has("filing_buyer_not_listed")) continue;
    findings.push({ code: b.code, severity: "blocking", field: "transaction", message: b.message, ref: b.ref });
  }

  if (options.stated?.length) {
    const ratio =
      deal.totalSaleConsideration > 0
        ? Math.max(1, (deal.totalStampDutyValue || 0) / deal.totalSaleConsideration)
        : 1;
    for (const stmt of options.stated) {
      findings.push(...checkStatementConsistency(stmt, ratio));
      const computed = computation.statements.find((s) => s.instalmentSeq === stmt.instalmentSeq);
      if (computed) findings.push(...compareWithComputed(stmt, computed));
    }
  }

  const ordered = [
    ...findings.filter((f) => f.severity === "blocking"),
    ...findings.filter((f) => f.severity === "warning"),
  ];
  return { ...collect(ordered), computation };
}

/** Rate resolution re-exported so a UI can explain WHY a rate was chosen
 *  without importing the engine separately. */
export { resolveRate };
