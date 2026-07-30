// MSME 43B(h) — Phase 3+4: FIFO settlement matcher and the two-year
// disallowance computation engine.
//
// Model (creditor ledger, credit-positive = payable):
//   • Bills        = credit entries (purchases) + the CY opening payable.
//   • Settlements  = debit entries (payments, TDS, kasar/vatav, notes, contra…).
//   • FIFO         = each settlement clears the OLDEST open bill first (no bill
//                    references exist in the source, so FIFO is the defensible
//                    default and is disclosed on the workpaper).
//
// Disallowance (view B — actual-payment-date test, which is why two years are
// required): for each CY-accrued bill, the portion of its base still outstanding
// at 31-March that is NOT cleared within its s.15 due date is disallowed in CY,
// and re-allowed in the FY in which it is actually paid.

import type {
  VendorLedger, LedgerTxn, SettlementType, MatchedBill, Settlement,
  Bill43bResult, VendorResult, Msme43bReport,
} from './types';
import { classifyTxn } from './classify';
import { DEFAULT_CONFIG, Msme43bConfig, fyEndDate, addDays, dueDateFor, treatmentOf, splitGst } from './config';
import { verifyVendor } from './verify';
import { classificationSensitivity, sensitivityWarnings } from './sensitivity';

interface Alloc { date: string; amount: number; type: SettlementType; }
interface WorkBill extends MatchedBill { allocs: Alloc[]; remaining: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

let seq = 0;

function buildBillsAndSettlements(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig,
  declaredGstRate?: number,
): { bills: WorkBill[]; settlements: Settlement[] } {
  const bills: WorkBill[] = [];
  const settlements: Settlement[] = [];

  const openingDate = cy.periodFrom || `${cy.financialYear?.slice(0, 4)}-04-01`;
  if (cfg.includeOpeningBalance && cy.openingBalance > cfg.toleranceRupees) {
    bills.push(mkBill(cy.vendorName, openingDate, cy.openingBalance, 'OPENING', true));
  } else if (cy.openingBalance < -cfg.toleranceRupees) {
    // Opening advance (debit balance) → an early settlement available to FIFO.
    settlements.push({ date: openingDate, amount: -cy.openingBalance, type: 'ADVANCE_ADJ', particulars: 'Opening advance' });
  }

  const ingest = (led: VendorLedger, isCY: boolean) => {
    for (const t of led.txns) {
      const c = classifyTxn(t);
      t.type = c.type;
      t.needsReview = c.needsReview;
      if (t.credit > cfg.toleranceRupees) {
        bills.push(mkBill(led.vendorName, t.date, t.credit, c.type === 'PURCHASE' ? 'PURCHASE' : c.type, false, t, declaredGstRate));
      } else if (t.debit > cfg.toleranceRupees) {
        // 'ignore' settlements are not discharges under the current rule profile
        // and take no part in the matching.
        if (treatmentOf(c.type, cfg) === 'ignore') continue;
        settlements.push({
          date: t.date, amount: t.debit, type: c.type,
          particulars: t.particulars, vchNo: t.vchNo, yearBucket: isCY ? 'CY' : 'FY',
        });
      }
    }
  };

  ingest(cy, true);
  if (fy) ingest(fy, false); // FY opening is skipped — it equals CY closing (same money).

  bills.sort((a, b) => a.billDate.localeCompare(b.billDate));
  settlements.sort((a, b) => a.date.localeCompare(b.date));
  return { bills, settlements };
}

function mkBill(
  vendor: string, date: string, amount: number,
  type: SettlementType, isOpening: boolean, src?: LedgerTxn,
  declaredGstRate?: number,
): WorkBill {
  // The GST split is established here, once, from the document or a declaration
  // — never inferred. An opening balance is a carried-forward net figure with no
  // invoice behind it, so no rate is applied to it.
  const gst = isOpening
    ? { gstAmount: 0, taxableValue: r2(amount), taxableRatio: 1, source: 'unavailable' as const }
    : splitGst(amount, src, declaredGstRate);

  return {
    id: `B${++seq}`,
    vendorName: vendor,
    billDate: date,
    grossAmount: r2(amount),
    tdsAmount: 0, noteReductions: 0, kasarAmount: 0,
    base: r2(amount),
    isOpening,
    settlements: [],
    vchNo: src?.vchNo,
    vchType: src?.vchType || (isOpening ? 'Opening' : undefined),
    gstAmount: gst.gstAmount,
    taxableValue: gst.taxableValue,
    taxableRatio: gst.taxableRatio,
    gstSource: gst.source,
    gstRate: gst.rate,
    allocs: [],
    remaining: r2(amount),
  };
}

/** Apply a settlement to a bill, recording the allocation on the audit trail. */
function take(b: WorkBill, s: Settlement, amount: number): number {
  const amt = Math.min(amount, b.remaining);
  if (amt <= 0.005) return 0;
  b.remaining = r2(b.remaining - amt);
  b.allocs.push({ date: s.date, amount: amt, type: s.type });
  b.settlements.push({ date: s.date, amount: amt, type: s.type, particulars: s.particulars, vchNo: s.vchNo, yearBucket: s.yearBucket });
  return amt;
}

/**
 * Match settlements to bills. The source exports carry no bill-wise references,
 * so WHICH bill a payment clears is an interpretation — exposed as a rule.
 *   FIFO     — oldest open bill first (the defensible default, and what most
 *              Indian books do in practice).
 *   LIFO     — newest already-raised bill first.
 *   PRO_RATA — spread across every bill open on the settlement date, in
 *              proportion to the amount still outstanding on each.
 * Excess settlement (an over-payment or advance) is ignored, as before.
 */
function allocate(bills: WorkBill[], settlements: Settlement[], cfg: Msme43bConfig): void {
  if (cfg.allocation === 'FIFO') {
    let bi = 0;
    for (const s of settlements) {
      let amt = s.amount;
      while (amt > 0.005 && bi < bills.length) {
        const b = bills[bi];
        if (b.remaining <= 0.005) { bi++; continue; }
        amt = r2(amt - take(b, s, amt));
        if (b.remaining <= 0.005) bi++;
      }
    }
    return;
  }

  for (const s of settlements) {
    // Only bills already raised on the settlement date can be cleared by it.
    const open = bills.filter((b) => b.remaining > 0.005 && b.billDate <= s.date);
    // Nothing raised yet → fall back to the oldest open bill (an advance).
    const pool = open.length ? open : bills.filter((b) => b.remaining > 0.005);
    if (!pool.length) continue;

    if (cfg.allocation === 'LIFO') {
      let amt = s.amount;
      for (let i = pool.length - 1; i >= 0 && amt > 0.005; i--) amt = r2(amt - take(pool[i], s, amt));
      continue;
    }

    // PRO_RATA
    const total = pool.reduce((a, b) => a + b.remaining, 0);
    if (total <= 0.005) continue;
    const spend = Math.min(s.amount, total);
    let placed = 0;
    for (let i = 0; i < pool.length; i++) {
      const share = i === pool.length - 1 ? r2(spend - placed) : r2((spend * pool[i].remaining) / total);
      placed = r2(placed + take(pool[i], s, share));
    }
  }
}

function computeBill(b: WorkBill, cfg: Msme43bConfig, cyEnd: string, fyEnd: string): Bill43bResult {
  const dueDate = dueDateFor(b.billDate, cfg);
  const isNonCash = (a: Alloc) => treatmentOf(a.type, cfg) === 'nonCash';
  const isCash = (a: Alloc) => treatmentOf(a.type, cfg) === 'cashTiming';

  // Split allocations for reporting. Only reductions treated as non-cash under
  // the current rule profile come out of the 43B(h) base.
  let tds = 0, notes = 0, kasar = 0;
  for (const a of b.allocs) {
    if (!isNonCash(a)) continue;
    if (a.type === 'TDS') tds += a.amount;
    else if (a.type === 'DEBIT_NOTE' || a.type === 'CREDIT_NOTE') notes += a.amount;
    else if (a.type === 'KASAR_VATAV' || a.type === 'ROUND_OFF') kasar += a.amount;
  }
  b.tdsAmount = r2(tds); b.noteReductions = r2(notes); b.kasarAmount = r2(kasar);
  b.base = r2(b.grossAmount - tds - notes - kasar);

  const sum = (pred: (a: Alloc) => boolean) => r2(b.allocs.filter(pred).reduce((x, a) => x + a.amount, 0));

  const allocByYE = sum((a) => a.date <= cyEnd);
  const outstandingAtYE = r2(Math.max(0, b.grossAmount - allocByYE));

  // Non-cash reductions are always compliant; cash within due date is compliant.
  const compliantAfterYE = r2(
    sum((a) => a.date > cyEnd && isNonCash(a)) +
    sum((a) => a.date > cyEnd && a.date <= dueDate && isCash(a)),
  );
  const settledWithinWindowAfterYE = Math.min(outstandingAtYE, compliantAfterYE);
  const grossDisallowedCY = r2(Math.max(0, outstandingAtYE - compliantAfterYE));

  // Of the disallowed amount, the part actually paid (cash) during the FY, after
  // the due date, is allowed as a deduction in the FY.
  const paidLateInFY = sum((a) => a.date > dueDate && a.date > cyEnd && a.date <= fyEnd && isCash(a));
  const grossAllowedInFY = Math.min(grossDisallowedCY, r2(paidLateInFY));

  // ── GST ──
  // Settlements are made in GROSS rupees, so everything above runs on gross.
  // The disallowance is then stated on the taxable value, because that is what
  // was claimed as a deduction (see Msme43bConfig.disallowanceBase). Applying a
  // single ratio to all three figures keeps
  //   disallowed = allowedFY + stillOutstanding
  // exact, which the invariant checker enforces.
  const ratio = cfg.disallowanceBase === 'taxableValue' ? b.taxableRatio : 1;
  const disallowedCY = r2(grossDisallowedCY * ratio);
  const allowedInFY = r2(grossAllowedInFY * ratio);
  const stillOutstanding = r2(disallowedCY - allowedInFY);

  // Day count for the workpaper: when this bill was actually cleared, and how
  // long it took. Uses the last cash allocation, which is the one that settles it.
  const cashAllocs = b.allocs.filter(isCash);
  const clearedOn = cashAllocs.length && b.remaining <= cfg.toleranceRupees
    ? cashAllocs[cashAllocs.length - 1].date
    : undefined;
  const daysTaken = clearedOn ? daysBetween(b.billDate, clearedOn) : undefined;

  let reason: string;
  if (b.isOpening && cfg.openingDisallowance === 'exclude') reason = 'Opening balance — pre-CY accrual, excluded from CY disallowance';
  else if (b.isOpening && disallowedCY > cfg.toleranceRupees) reason = `Opening balance unpaid beyond due date (${dueDate}) — disallowed (opening included by rule)`;
  else if (outstandingAtYE <= cfg.toleranceRupees) reason = `Settled within CY (by ${cyEnd})`;
  else if (disallowedCY <= cfg.toleranceRupees) reason = `Outstanding at year-end cleared within s.15 due date (${dueDate})`;
  else if (allowedInFY > 0 && stillOutstanding <= cfg.toleranceRupees) reason = `Paid in FY beyond due date (${dueDate}) — disallowed CY, allowed FY`;
  else if (allowedInFY > 0) reason = `Part paid late in FY, balance unpaid beyond due date (${dueDate})`;
  else reason = `Unpaid beyond s.15 due date (${dueDate}) — disallowed`;

  return {
    bill: b, dueDate, windowDays: cfg.windowDays,
    outstandingAtYearEnd: outstandingAtYE,
    settledWithinWindowAfterYE, disallowedCY, allowedInFY, stillOutstanding,
    grossDisallowedCY, clearedOn, daysTaken, reason,
  };
}

/** Calendar days between two ISO dates (exclusive of the start date). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z');
  const b = Date.parse(toIso + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function analyzeVendor(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig = DEFAULT_CONFIG,
  /**
   * Run the independent cross-check. Only turned off by the rule calibrator,
   * which re-runs the engine hundreds of times to search interpretations — it
   * verifies the winning configuration once at the end instead.
   */
  verify = true,
  /** the GST rate the firm has declared for this vendor's supplies, if any */
  declaredGstRate?: number,
): VendorResult {
  const { bills, settlements } = buildBillsAndSettlements(cy, fy, cfg, declaredGstRate);
  allocate(bills, settlements, cfg);

  const cyEnd = cy.periodTo || fyEndDate(cy.financialYear || '2025-26');
  const fyEnd = fy ? (fy.periodTo || fyEndDate(fy.financialYear || '2026-27')) : addDays(cyEnd, 365);

  const cyBills = bills.filter((b) => !b.isOpening && b.billDate >= (cy.periodFrom || '0000-00-00') && b.billDate <= cyEnd);
  const results = cyBills.map((b) => computeBill(b, cfg, cyEnd, fyEnd));
  // Opening bill result kept for transparency (0 disallowance).
  const openingBill = bills.find((b) => b.isOpening);
  if (openingBill) results.unshift(computeBill(openingBill, cfg, cyEnd, fyEnd));

  // Whether a prior-year opening payable can be disallowed in CY is a rule.
  const skip = (x: Bill43bResult) => x.bill.isOpening && cfg.openingDisallowance === 'exclude';
  const totalDisallowedCY = r2(results.reduce((a, x) => a + (skip(x) ? 0 : x.disallowedCY), 0));
  const totalAllowedFY = r2(results.reduce((a, x) => a + (skip(x) ? 0 : x.allowedInFY), 0));
  const totalStillOutstanding = r2(results.reduce((a, x) => a + (skip(x) ? 0 : x.stillOutstanding), 0));

  const reviewCount = cy.txns.filter((t) => t.needsReview).length + (fy ? fy.txns.filter((t) => t.needsReview).length : 0);
  const continuityOk = !fy || Math.abs(cy.closingBalance - fy.openingBalance) <= cfg.toleranceRupees;

  // ── GST coverage ──
  const scored = results.filter((x) => !skip(x));
  const gstExcluded = r2(scored.reduce((a, x) => a + (x.grossDisallowedCY - x.disallowedCY), 0));
  const gstUnidentifiedValue = r2(
    scored
      .filter((x) => x.bill.gstSource === 'unavailable' && x.grossDisallowedCY > cfg.toleranceRupees)
      .reduce((a, x) => a + x.grossDisallowedCY, 0),
  );

  const warnings = [...(cy.warnings || [])];
  if (!cy.balanceReconciled) warnings.push(`CY ledger did not reconcile (drift ₹${cy.reconDrift}).`);
  if (fy && !fy.balanceReconciled) warnings.push(`FY ledger did not reconcile (drift ₹${fy.reconDrift}).`);
  if (!continuityOk) warnings.push(`FY opening (₹${fy?.openingBalance}) ≠ CY closing (₹${cy.closingBalance}).`);
  if (!fy) warnings.push('Following-year ledger not provided — FY payment dates unknown; year-end outstanding shown as fully disallowed pending FY data.');
  if (cfg.disallowanceBase === 'taxableValue' && gstUnidentifiedValue > cfg.toleranceRupees) {
    warnings.push(
      `GST could not be identified on ₹${gstUnidentifiedValue} of disallowed value — the ledger does not show the tax split. ` +
      'That amount is stated on GROSS and is therefore OVERSTATED by the tax. Declare this vendor\'s GST rate to correct it.',
    );
  }

  const result: VendorResult = {
    vendorName: cy.vendorName,
    format: cy.format,
    cyReconciled: !!cy.balanceReconciled,
    fyReconciled: fy ? !!fy.balanceReconciled : false,
    cyClosing: r2(cy.closingBalance),
    fyOpening: fy ? r2(fy.openingBalance) : 0,
    continuityOk,
    bills: results,
    totalDisallowedCY, totalAllowedFY, totalStillOutstanding,
    gstExcluded, gstUnidentifiedValue, declaredGstRate,
    warnings, reviewCount,
  };

  // Cross-check + invariants (see verify.ts). The cross-check re-derives the
  // arithmetic by a different route; it shares the classifier, so it cannot
  // detect a misread narration. That gap is priced separately, below.
  if (verify) {
    const v = verifyVendor(result, cy, fy, cfg);
    result.verified = v.verified;
    result.verifyNotes = v.notes;
    if (!v.verified) warnings.push(...v.notes.map((n) => `Cross-check: ${n}`));

    // What the figure would be if the narration-driven non-cash reductions were
    // date-tested like any other payment — the exposure the cross-check is blind
    // to, stated as a number rather than assumed away.
    const sens = classificationSensitivity(cy, fy, cfg, declaredGstRate);
    result.narrationSwing = sens.maxSwing;
    const sw = sensitivityWarnings(sens, cfg);
    result.sensitivityNotes = sw;
    warnings.push(...sw);
  }

  return result;
}

export interface BuildReportOptions {
  /** run the independent cross-check per vendor (default true) */
  verify?: boolean;
  /**
   * Per-vendor s.15 window, keyed by normalised vendor name. This is a DECLARED
   * fact about the vendor (a written agreement exists → 45 days, otherwise 15),
   * not a tuning knob: only 15 or 45 are accepted (enforced in rules.ts) and the
   * declaration is disclosed on the workpaper.
   */
  vendorWindowDays?: Record<string, number>;
  /**
   * Per-vendor GST rate %, keyed by normalised vendor name. Like the window,
   * this is a DECLARED fact (what rate this vendor charges), used only where
   * the ledger itself does not show the tax split. Only the statutory rates are
   * accepted — enforced in rules.ts.
   */
  vendorGstRate?: Record<string, number>;
}

/** Normalise a vendor name for matching across years / working papers. */
export const normVendor = norm;

/** Pair CY and FY ledgers by normalised vendor name and build the full report. */
export function buildReport(
  cyLedgers: VendorLedger[],
  fyLedgers: VendorLedger[],
  cfg: Msme43bConfig = DEFAULT_CONFIG,
  clientName?: string,
  opts: BuildReportOptions = {},
): Msme43bReport {
  const fyByName = new Map(fyLedgers.map((l) => [norm(l.vendorName), l]));
  const vendors = cyLedgers.map((cy) => {
    const key = norm(cy.vendorName);
    const declared = opts.vendorWindowDays?.[key];
    const vcfg = declared && declared !== cfg.windowDays ? { ...cfg, windowDays: declared } : cfg;
    return analyzeVendor(cy, fyByName.get(key) || null, vcfg, opts.verify !== false, opts.vendorGstRate?.[key]);
  });

  const cyLabel = cyLedgers[0]?.financialYear || 'CY';
  const fyLabel = fyLedgers[0]?.financialYear || 'FY';
  const totalDisallowedCY = r2(vendors.reduce((a, v) => a + v.totalDisallowedCY, 0));
  const totalAllowedFY = r2(vendors.reduce((a, v) => a + v.totalAllowedFY, 0));
  const totalStillOutstanding = r2(vendors.reduce((a, v) => a + v.totalStillOutstanding, 0));
  const totalGstExcluded = r2(vendors.reduce((a, v) => a + v.gstExcluded, 0));
  const totalGstUnidentified = r2(vendors.reduce((a, v) => a + v.gstUnidentifiedValue, 0));

  const blockers = deriveBlockers(vendors);

  return {
    clientName, cyLabel, fyLabel, windowDays: cfg.windowDays,
    vendors, totalDisallowedCY, totalAllowedFY, totalStillOutstanding,
    totalGstExcluded, totalGstUnidentified,
    ...blockers,
    clean: blockers.blockingReasons.length === 0 && vendors.every((v) => v.reviewCount === 0),
  };
}

/** The blocking fields of a report, derived purely from its vendor results. */
export interface ReportBlockers {
  unreconciledVendors: string[];
  unreconciledDisallowed: number;
  blocksSignOff: boolean;
  blockingReasons: string[];
}

/**
 * Reconciliation exposure and the other sign-off blockers.
 *
 * A ledger that does not agree to its printed closing balance is NOT dropped:
 * silently omitting a vendor would understate the disallowance, which is the
 * worse error. Instead its contribution is quantified and sign-off is blocked,
 * so the figure cannot be issued without a human deciding what to do about it.
 * Before this, the code claimed "flagged, not used" while doing neither.
 *
 * Kept as a pure function of `vendors` so a run saved before these fields
 * existed can be rehydrated with the same logic instead of defaulting to
 * "nothing wrong" (see hydrateReport in persistence.ts).
 */
export function deriveBlockers(vendors: VendorResult[]): ReportBlockers {
  const unreconciled = vendors.filter((v) => !v.cyReconciled);
  const unreconciledVendors = unreconciled.map((v) => v.vendorName);
  const unreconciledDisallowed = r2(unreconciled.reduce((a, v) => a + v.totalDisallowedCY, 0));

  const blockingReasons: string[] = [];
  if (unreconciled.length) {
    blockingReasons.push(
      `${unreconciled.length} ledger(s) did not agree to their printed closing balance, contributing ` +
      `₹${unreconciledDisallowed.toLocaleString('en-IN')} of the disallowance: ${unreconciledVendors.join(', ')}. ` +
      'Their figures are included in the totals but cannot be relied on until the extraction is corrected.',
    );
  }
  const crossCheckFlagged = vendors.filter((v) => v.verified === false);
  if (crossCheckFlagged.length) {
    blockingReasons.push(
      `${crossCheckFlagged.length} vendor(s) failed the cross-check or an internal invariant: ` +
      crossCheckFlagged.map((v) => v.vendorName).join(', ') + '.',
    );
  }
  const continuityBroken = vendors.filter((v) => !v.continuityOk);
  if (continuityBroken.length) {
    blockingReasons.push(
      `${continuityBroken.length} vendor(s) have a following-year opening balance that does not equal the ` +
      'current-year closing balance, so the two ledgers are not the same account: ' +
      continuityBroken.map((v) => v.vendorName).join(', ') + '.',
    );
  }

  return {
    unreconciledVendors,
    unreconciledDisallowed,
    blocksSignOff: blockingReasons.length > 0,
    blockingReasons,
  };
}
