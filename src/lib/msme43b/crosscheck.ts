// MSME 43B(h) — cross-check computation.
//
// WHAT THIS DOES AND DOES NOT COVER — read before trusting the "cross-checked"
// badge, which is easy to over-read:
//
//   CATCHES   arithmetic and control-flow errors: allocation order, day-count
//             off-by-one, phase gating, rounding, the identity
//             disallowed = allowedFY + stillOutstanding. Two programs written
//             differently rarely make the same slip.
//
//   DOES NOT  classification errors. This module calls the SAME classifyTxn and
//   CATCH     the SAME treatmentOf as engine.ts. A debit put in the wrong bucket
//             is put in the same wrong bucket here, and the two agree on a wrong
//             answer. Copying the keyword lists into this file would not change
//             that — it would only make the shared assumption look independent.
//             That gap is instead priced by sensitivity.ts, which re-runs the
//             figures with the assumption varied and reports the swing.
//
// This deliberately re-derives the same disallowance/allowance figures by a
// DIFFERENT route than engine.ts, so the two can be compared. engine.ts merges
// all settlements, allocates them to bills, then reads the outstanding. This
// module instead ages the payable in three explicit phases:
//
//   Phase 1  net out non-cash reductions (TDS / notes / kasar) — compliant, any date
//   Phase 2  apply CY cash settlements     → gives each bill its 31-March outstanding
//   Phase 3  age that outstanding against FY cash settlements, splitting each
//            settled chunk into within-due-date (compliant) vs late
//
// If the two engines disagree on a figure, verify.ts flags it rather than
// trusting either.

import type { VendorLedger } from './types';
import { classifyTxn } from './classify';
import { DEFAULT_CONFIG, Msme43bConfig, fyEndDate, addDays, dueDateFor, treatmentOf, splitGst } from './config';

export interface CrossResult {
  disallowedCY: number;
  allowedFY: number;
  stillOutstanding: number;
}

interface XBill {
  date: string;
  remaining: number; // running unpaid base
  isOpening: boolean;
  dueDate: string;
  yeOutstanding: number; // captured after Phase 2
  compliantAfterYE: number; // FY settlements within due date
  laidLateInFY: number; // FY settlements after due date
  /** taxable value ÷ gross — the disallowance is stated on the taxable value */
  taxableRatio: number;
}

interface XSettle { date: string; amount: number; cash: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function crossCheckVendor(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig = DEFAULT_CONFIG,
  declaredGstRate?: number,
): CrossResult {
  const cyEnd = cy.periodTo || fyEndDate(cy.financialYear || '2025-26');
  const fyEnd = fy ? (fy.periodTo || fyEndDate(fy.financialYear || '2026-27')) : addDays(cyEnd, 365);
  const openDate = cy.periodFrom || `${(cy.financialYear || '2025').slice(0, 4)}-04-01`;

  // ── bills (opening + CY purchases) ──
  const bills: XBill[] = [];
  if (cfg.includeOpeningBalance && cy.openingBalance > cfg.toleranceRupees) {
    // An opening balance is a carried-forward net figure with no invoice behind
    // it, so no GST split is applied to it (matching the primary engine).
    bills.push(mkBill(openDate, cy.openingBalance, true, cfg, 1));
  }
  const settlements: XSettle[] = [];
  if (cy.openingBalance < -cfg.toleranceRupees) {
    settlements.push({ date: openDate, amount: -cy.openingBalance, cash: true });
  }
  const ingest = (led: VendorLedger) => {
    for (const t of led.txns) {
      const c = classifyTxn(t);
      if (t.credit > cfg.toleranceRupees) {
        // Mirrors engine.ts: a provision is not an invoice from the supplier,
        // so it never originates a bill under the default 'ignore' profile.
        if (c.type === 'PROVISION' && treatmentOf(c.type, cfg) === 'ignore') continue;
        const ratio = cfg.disallowanceBase === 'taxableValue'
          ? splitGst(t.credit, t, declaredGstRate).taxableRatio
          : 1;
        bills.push(mkBill(t.date, t.credit, false, cfg, ratio));
      } else if (t.debit > cfg.toleranceRupees) {
        // cash = timing-sensitive (payment/advance/contra); non-cash reductions
        // (TDS/notes/kasar/round-off) are compliant regardless of date → Phase 1.
        // Both classifications come from the rule profile, so a rule change moves
        // this engine and the primary engine together.
        const tr = treatmentOf(c.type, cfg);
        if (tr === 'ignore') continue;
        settlements.push({ date: t.date, amount: t.debit, cash: tr === 'cashTiming' });
      }
    }
  };
  ingest(cy);
  if (fy) ingest(fy);

  bills.sort((a, b) => a.date.localeCompare(b.date));

  // ── Phase 1: net non-cash reductions (any date), FIFO oldest bill first ──
  const nonCash = settlements.filter((s) => !s.cash).sort((a, b) => a.date.localeCompare(b.date));
  applyMatch(bills, nonCash, cfg, () => {});

  // ── Phase 2: CY cash settlements → 31-March outstanding ──
  const cyCash = settlements.filter((s) => s.cash && s.date <= cyEnd).sort((a, b) => a.date.localeCompare(b.date));
  applyMatch(bills, cyCash, cfg, () => {});
  for (const b of bills) b.yeOutstanding = b.remaining;

  // ── Phase 3: age the year-end outstanding against FY cash settlements ──
  const fyCash = settlements.filter((s) => s.cash && s.date > cyEnd && s.date <= fyEnd).sort((a, b) => a.date.localeCompare(b.date));
  applyMatch(bills, fyCash, cfg, (bill, chunk, date) => {
    if (date <= bill.dueDate) bill.compliantAfterYE += chunk;
    else bill.laidLateInFY += chunk;
  });

  const skipOpening = cfg.openingDisallowance === 'exclude';
  let disallowedCY = 0, allowedFY = 0, stillOutstanding = 0;
  for (const b of bills) {
    // Only CY-accrued bills get a CY disallowance. FY purchases stay in the
    // matching (they absorb leftover FY payments after CY bills clear) but are
    // next year's item.
    if ((b.isOpening && skipOpening) || b.date > cyEnd) continue;
    const dis = Math.max(0, r2(b.yeOutstanding - b.compliantAfterYE));
    if (dis <= cfg.toleranceRupees) continue;
    const allow = Math.min(dis, r2(b.laidLateInFY));
    // Matching runs on gross (payments are gross); the disallowance is stated
    // on the taxable value. Same treatment as the primary engine.
    disallowedCY += r2(dis * b.taxableRatio);
    allowedFY += r2(allow * b.taxableRatio);
    stillOutstanding += r2((dis - allow) * b.taxableRatio);
  }
  return { disallowedCY: r2(disallowedCY), allowedFY: r2(allowedFY), stillOutstanding: r2(stillOutstanding) };
}

function mkBill(date: string, amount: number, isOpening: boolean, cfg: Msme43bConfig, taxableRatio: number): XBill {
  return {
    date, remaining: r2(amount), isOpening,
    dueDate: dueDateFor(date, cfg),
    yeOutstanding: 0, compliantAfterYE: 0, laidLateInFY: 0,
    taxableRatio,
  };
}

/**
 * Apply settlements to bills under the configured allocation rule, invoking
 * onChunk per allocation. Written independently of engine.ts's matcher — same
 * interpretation, different code. That is the scope of the cross-check: it tests
 * the code, not the interpretation.
 */
function applyMatch(
  bills: XBill[],
  settles: XSettle[],
  cfg: Msme43bConfig,
  onChunk: (b: XBill, chunk: number, date: string) => void,
): void {
  const hit = (b: XBill, amt: number, date: string): number => {
    const chunk = Math.min(amt, b.remaining);
    if (chunk <= 0.005) return 0;
    b.remaining = r2(b.remaining - chunk);
    onChunk(b, chunk, date);
    return chunk;
  };

  for (const s of settles) {
    const raised = bills.filter((b) => b.remaining > 0.005 && b.date <= s.date);
    const open = raised.length ? raised : bills.filter((b) => b.remaining > 0.005);
    if (!open.length) continue;

    if (cfg.allocation === 'LIFO') {
      let amt = s.amount;
      for (let i = open.length - 1; i >= 0 && amt > 0.005; i--) amt = r2(amt - hit(open[i], amt, s.date));
    } else if (cfg.allocation === 'PRO_RATA') {
      const total = open.reduce((a, b) => a + b.remaining, 0);
      if (total <= 0.005) continue;
      const spend = Math.min(s.amount, total);
      let placed = 0;
      for (let i = 0; i < open.length; i++) {
        const share = i === open.length - 1 ? r2(spend - placed) : r2((spend * open[i].remaining) / total);
        placed = r2(placed + hit(open[i], share, s.date));
      }
    } else {
      // FIFO — oldest open bill first, regardless of whether it was raised
      // before the settlement (matches the primary engine's advance handling).
      let amt = s.amount;
      const all = bills.filter((b) => b.remaining > 0.005);
      for (let i = 0; i < all.length && amt > 0.005; i++) amt = r2(amt - hit(all[i], amt, s.date));
    }
  }
}
