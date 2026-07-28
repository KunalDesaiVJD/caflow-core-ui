// MSME 43B(h) — INDEPENDENT cross-check computation.
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
// trusting either. Two independent programs agreeing catches implementation bugs
// (off-by-one, allocation order, gating) that a single code path can hide.

import type { VendorLedger } from './types';
import { classifyTxn, isCashTiming } from './classify';
import { DEFAULT_CONFIG, Msme43bConfig, fyEndDate, addDays } from './config';

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
}

interface XSettle { date: string; amount: number; cash: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function crossCheckVendor(
  cy: VendorLedger,
  fy: VendorLedger | null,
  cfg: Msme43bConfig = DEFAULT_CONFIG,
): CrossResult {
  const cyEnd = cy.periodTo || fyEndDate(cy.financialYear || '2025-26');
  const fyEnd = fy ? (fy.periodTo || fyEndDate(fy.financialYear || '2026-27')) : addDays(cyEnd, 365);
  const openDate = cy.periodFrom || `${(cy.financialYear || '2025').slice(0, 4)}-04-01`;

  // ── bills (opening + CY purchases) ──
  const bills: XBill[] = [];
  if (cfg.includeOpeningBalance && cy.openingBalance > cfg.toleranceRupees) {
    bills.push(mkBill(openDate, cy.openingBalance, true, cfg));
  }
  const settlements: XSettle[] = [];
  if (cy.openingBalance < -cfg.toleranceRupees) {
    settlements.push({ date: openDate, amount: -cy.openingBalance, cash: true });
  }
  const ingest = (led: VendorLedger) => {
    for (const t of led.txns) {
      const c = classifyTxn(t);
      if (t.credit > cfg.toleranceRupees) {
        bills.push(mkBill(t.date, t.credit, false, cfg));
      } else if (t.debit > cfg.toleranceRupees) {
        // cash = timing-sensitive (payment/advance/contra); non-cash reductions
        // (TDS/notes/kasar/round-off) are compliant regardless of date → Phase 1.
        settlements.push({ date: t.date, amount: t.debit, cash: isCashTiming(c.type) });
      }
    }
  };
  ingest(cy);
  if (fy) ingest(fy);

  bills.sort((a, b) => a.date.localeCompare(b.date));

  // ── Phase 1: net non-cash reductions (any date), FIFO oldest bill first ──
  const nonCash = settlements.filter((s) => !s.cash).sort((a, b) => a.date.localeCompare(b.date));
  applyFifo(bills, nonCash, () => {});

  // ── Phase 2: CY cash settlements → 31-March outstanding ──
  const cyCash = settlements.filter((s) => s.cash && s.date <= cyEnd).sort((a, b) => a.date.localeCompare(b.date));
  applyFifo(bills, cyCash, () => {});
  for (const b of bills) b.yeOutstanding = b.remaining;

  // ── Phase 3: age the year-end outstanding against FY cash settlements ──
  const fyCash = settlements.filter((s) => s.cash && s.date > cyEnd && s.date <= fyEnd).sort((a, b) => a.date.localeCompare(b.date));
  applyFifo(bills, fyCash, (bill, chunk, date) => {
    if (date <= bill.dueDate) bill.compliantAfterYE += chunk;
    else bill.laidLateInFY += chunk;
  });

  let disallowedCY = 0, allowedFY = 0, stillOutstanding = 0;
  for (const b of bills) {
    // Only CY-accrued bills get a CY disallowance. FY purchases stay in the FIFO
    // (they absorb leftover FY payments after CY bills clear) but are next year's.
    if (b.isOpening || b.date > cyEnd) continue;
    const dis = Math.max(0, r2(b.yeOutstanding - b.compliantAfterYE));
    if (dis <= cfg.toleranceRupees) continue;
    const allow = Math.min(dis, r2(b.laidLateInFY));
    disallowedCY += dis;
    allowedFY += allow;
    stillOutstanding += r2(dis - allow);
  }
  return { disallowedCY: r2(disallowedCY), allowedFY: r2(allowedFY), stillOutstanding: r2(stillOutstanding) };
}

function mkBill(date: string, amount: number, isOpening: boolean, cfg: Msme43bConfig): XBill {
  return {
    date, remaining: r2(amount), isOpening,
    dueDate: addDays(date, cfg.windowDays),
    yeOutstanding: 0, compliantAfterYE: 0, laidLateInFY: 0,
  };
}

/** FIFO-apply settlements to bills (oldest bill first), invoking onChunk per allocation. */
function applyFifo(bills: XBill[], settles: XSettle[], onChunk: (b: XBill, chunk: number, date: string) => void): void {
  let bi = 0;
  for (const s of settles) {
    let amt = s.amount;
    while (amt > 0.005 && bi < bills.length) {
      const b = bills[bi];
      if (b.remaining <= 0.005) { bi++; continue; }
      const take = Math.min(amt, b.remaining);
      b.remaining = r2(b.remaining - take);
      amt = r2(amt - take);
      onChunk(b, take, s.date);
      if (b.remaining <= 0.005) bi++;
    }
  }
}
