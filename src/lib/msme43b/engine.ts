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
import { classifyTxn, isCashTiming, isNonCashReduction } from './classify';
import { DEFAULT_CONFIG, Msme43bConfig, fyEndDate, addDays } from './config';

interface Alloc { date: string; amount: number; type: SettlementType; }
interface WorkBill extends MatchedBill { allocs: Alloc[]; remaining: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

let seq = 0;

function buildBillsAndSettlements(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig,
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
        bills.push(mkBill(led.vendorName, t.date, t.credit, c.type === 'PURCHASE' ? 'PURCHASE' : c.type, false, t));
      } else if (t.debit > cfg.toleranceRupees) {
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
): WorkBill {
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
    allocs: [],
    remaining: r2(amount),
  };
}

/** FIFO: allocate each settlement to the oldest open bill(s). */
function fifoAllocate(bills: WorkBill[], settlements: Settlement[]): void {
  let bi = 0;
  for (const s of settlements) {
    let amt = s.amount;
    while (amt > 0.005 && bi < bills.length) {
      const b = bills[bi];
      if (b.remaining <= 0.005) { bi++; continue; }
      const take = Math.min(amt, b.remaining);
      b.remaining = r2(b.remaining - take);
      amt = r2(amt - take);
      b.allocs.push({ date: s.date, amount: take, type: s.type });
      b.settlements.push({ date: s.date, amount: take, type: s.type, particulars: s.particulars, vchNo: s.vchNo, yearBucket: s.yearBucket });
      if (b.remaining <= 0.005) bi++;
    }
    // excess settlement (over-allocation / advance) is ignored
  }
}

function computeBill(b: WorkBill, cfg: Msme43bConfig, cyEnd: string, fyEnd: string): Bill43bResult {
  const dueDate = addDays(b.billDate, cfg.windowDays);

  // Split allocations for reporting.
  let tds = 0, notes = 0, kasar = 0;
  for (const a of b.allocs) {
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
    sum((a) => a.date > cyEnd && isNonCashReduction(a.type)) +
    sum((a) => a.date > cyEnd && a.date <= dueDate && isCashTiming(a.type)),
  );
  const settledWithinWindowAfterYE = Math.min(outstandingAtYE, compliantAfterYE);
  const disallowedCY = r2(Math.max(0, outstandingAtYE - compliantAfterYE));

  // Of the disallowed amount, the part actually paid (cash) during the FY, after
  // the due date, is allowed as a deduction in the FY.
  const paidLateInFY = sum((a) => a.date > dueDate && a.date > cyEnd && a.date <= fyEnd && isCashTiming(a.type));
  const allowedInFY = Math.min(disallowedCY, r2(paidLateInFY));
  const stillOutstanding = r2(disallowedCY - allowedInFY);

  let reason: string;
  if (b.isOpening) reason = 'Opening balance — pre-CY accrual, excluded from CY disallowance';
  else if (outstandingAtYE <= cfg.toleranceRupees) reason = `Settled within CY (by ${cyEnd})`;
  else if (disallowedCY <= cfg.toleranceRupees) reason = `Outstanding at year-end cleared within s.15 due date (${dueDate})`;
  else if (allowedInFY > 0 && stillOutstanding <= cfg.toleranceRupees) reason = `Paid in FY beyond due date (${dueDate}) — disallowed CY, allowed FY`;
  else if (allowedInFY > 0) reason = `Part paid late in FY, balance unpaid beyond due date (${dueDate})`;
  else reason = `Unpaid beyond s.15 due date (${dueDate}) — disallowed`;

  return {
    bill: b, dueDate, outstandingAtYearEnd: outstandingAtYE,
    settledWithinWindowAfterYE, disallowedCY, allowedInFY, stillOutstanding, reason,
  };
}

export function analyzeVendor(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig = DEFAULT_CONFIG,
): VendorResult {
  const { bills, settlements } = buildBillsAndSettlements(cy, fy, cfg);
  fifoAllocate(bills, settlements);

  const cyEnd = cy.periodTo || fyEndDate(cy.financialYear || '2025-26');
  const fyEnd = fy ? (fy.periodTo || fyEndDate(fy.financialYear || '2026-27')) : addDays(cyEnd, 365);

  const cyBills = bills.filter((b) => !b.isOpening && b.billDate >= (cy.periodFrom || '0000-00-00') && b.billDate <= cyEnd);
  const results = cyBills.map((b) => computeBill(b, cfg, cyEnd, fyEnd));
  // Opening bill result kept for transparency (0 disallowance).
  const openingBill = bills.find((b) => b.isOpening);
  if (openingBill) results.unshift(computeBill(openingBill, cfg, cyEnd, fyEnd));

  const totalDisallowedCY = r2(results.reduce((a, x) => a + (x.bill.isOpening ? 0 : x.disallowedCY), 0));
  const totalAllowedFY = r2(results.reduce((a, x) => a + (x.bill.isOpening ? 0 : x.allowedInFY), 0));
  const totalStillOutstanding = r2(results.reduce((a, x) => a + (x.bill.isOpening ? 0 : x.stillOutstanding), 0));

  const reviewCount = cy.txns.filter((t) => t.needsReview).length + (fy ? fy.txns.filter((t) => t.needsReview).length : 0);
  const continuityOk = !fy || Math.abs(cy.closingBalance - fy.openingBalance) <= cfg.toleranceRupees;

  const warnings = [...(cy.warnings || [])];
  if (!cy.balanceReconciled) warnings.push(`CY ledger did not reconcile (drift ₹${cy.reconDrift}).`);
  if (fy && !fy.balanceReconciled) warnings.push(`FY ledger did not reconcile (drift ₹${fy.reconDrift}).`);
  if (!continuityOk) warnings.push(`FY opening (₹${fy?.openingBalance}) ≠ CY closing (₹${cy.closingBalance}).`);
  if (!fy) warnings.push('Following-year ledger not provided — FY payment dates unknown; year-end outstanding shown as fully disallowed pending FY data.');

  return {
    vendorName: cy.vendorName,
    format: cy.format,
    cyReconciled: !!cy.balanceReconciled,
    fyReconciled: fy ? !!fy.balanceReconciled : false,
    cyClosing: r2(cy.closingBalance),
    fyOpening: fy ? r2(fy.openingBalance) : 0,
    continuityOk,
    bills: results,
    totalDisallowedCY, totalAllowedFY, totalStillOutstanding,
    warnings, reviewCount,
  };
}

/** Pair CY and FY ledgers by normalised vendor name and build the full report. */
export function buildReport(
  cyLedgers: VendorLedger[],
  fyLedgers: VendorLedger[],
  cfg: Msme43bConfig = DEFAULT_CONFIG,
  clientName?: string,
): Msme43bReport {
  const fyByName = new Map(fyLedgers.map((l) => [norm(l.vendorName), l]));
  const vendors = cyLedgers.map((cy) => analyzeVendor(cy, fyByName.get(norm(cy.vendorName)) || null, cfg));

  const cyLabel = cyLedgers[0]?.financialYear || 'CY';
  const fyLabel = fyLedgers[0]?.financialYear || 'FY';
  const totalDisallowedCY = r2(vendors.reduce((a, v) => a + v.totalDisallowedCY, 0));
  const totalAllowedFY = r2(vendors.reduce((a, v) => a + v.totalAllowedFY, 0));
  const totalStillOutstanding = r2(vendors.reduce((a, v) => a + v.totalStillOutstanding, 0));
  const clean = vendors.every((v) => v.cyReconciled && (v.fyReconciled || true) && v.reviewCount === 0);

  return {
    clientName, cyLabel, fyLabel, windowDays: cfg.windowDays,
    vendors, totalDisallowedCY, totalAllowedFY, totalStillOutstanding, clean,
  };
}
