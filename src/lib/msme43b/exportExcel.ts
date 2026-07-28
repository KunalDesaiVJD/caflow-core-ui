// MSME 43B(h) — Phase 6: Excel working-paper export + Form 3CD hook.

import * as XLSX from 'xlsx';
import type { Msme43bReport } from './types';
import type { CarryForward } from './carryForward';

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * The 43B(h) PRINCIPAL disallowance is reported under Form 3CD **Clause 26**
 * (sums covered by section 43B). Clause 22 captures only the MSMED-Act s.23
 * INTEREST, which this tool does not compute. This hook feeds the audit engine.
 */
export function msme43bToForm3cd(report: Msme43bReport) {
  return {
    clause26: {
      section: '43B(h)',
      description: 'Sum payable to micro/small enterprises not paid within the time limit u/s 15 of the MSMED Act, 2006',
      amountDisallowedCY: money(report.totalDisallowedCY),
      amountAllowedOnPaymentFY: money(report.totalAllowedFY),
      stillOutstanding: money(report.totalStillOutstanding),
    },
    note: 'Clause 22 (MSMED interest u/s 23) is out of scope of this computation.',
  };
}

export function buildWorkpaperWorkbook(report: Msme43bReport, carry?: CarryForward | null): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ── Summary ──
  const summary: (string | number)[][] = [
    ['MSME 43B(h) Disallowance Working Paper'],
    [],
    ['Client', report.clientName || '—'],
    ['Current Year (audited)', report.cyLabel],
    ['Following Year', report.fyLabel],
    ['Section 15 window (days)', report.windowDays],
    [],
    ['Total disallowance (CY, added back)', money(report.totalDisallowedCY)],
    ['Allowed on payment (FY)', money(report.totalAllowedFY)],
    ['Still outstanding beyond due date (FY end)', money(report.totalStillOutstanding)],
    [],
    ['Reported in Form 3CD', 'Clause 26 — sums covered u/s 43B(h)'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  // ── Year-over-year carry-forward ──
  if (carry) {
    const cf: (string | number)[][] = [
      ['Year-over-year carry-forward'],
      [],
      [`Disallowance brought forward (added back in ${carry.priorCyLabel})`, money(carry.broughtForwardDisallowed)],
      [`Less: paid in ${carry.currentCyLabel} — allowed now (deduction)`, -money(carry.allowedThisYearOnPayment)],
      ['Still carried forward (unpaid at prior year-end)', money(carry.stillCarriedForward)],
      [`Add: fresh disallowance for ${carry.currentCyLabel}`, money(carry.currentYearDisallowance)],
      [`Net s.43B(h) impact for ${carry.currentCyLabel}`, money(carry.netDisallowanceThisYear)],
      [],
      ['Years chained correctly (prior FY = current CY)', carry.yearsAligned ? 'Yes' : 'NO — check selection'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cf), 'Carry-forward');
  }

  // ── Vendor summary ──
  const vHead = ['Vendor', 'Format', 'CY Closing', 'FY Opening', 'Continuity OK',
    'Disallowed CY', 'Allowed FY', 'Still Outstanding', 'Review Items', 'Reconciled'];
  const vRows = report.vendors.map((v) => [
    v.vendorName, v.format, money(v.cyClosing), money(v.fyOpening), v.continuityOk ? 'Yes' : 'NO',
    money(v.totalDisallowedCY), money(v.totalAllowedFY), money(v.totalStillOutstanding),
    v.reviewCount, v.cyReconciled ? 'Yes' : 'NO',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([vHead, ...vRows]), 'Vendors');

  // ── Bill-level detail (disallowed / outstanding only) ──
  const bHead = ['Vendor', 'Bill Date', 'Vch No', 'Gross', 'TDS', 'Notes', 'Kasar/Vatav',
    'Base', 'Due Date', 'Outstanding @ 31-Mar', 'Disallowed CY', 'Allowed FY', 'Still Outstanding', 'Reason'];
  const bRows: (string | number)[][] = [];
  for (const v of report.vendors) {
    for (const b of v.bills) {
      if (b.bill.isOpening) continue;
      if (b.disallowedCY <= 0 && b.outstandingAtYearEnd <= 0) continue;
      bRows.push([
        v.vendorName, b.bill.billDate, b.bill.vchNo || '', money(b.bill.grossAmount),
        money(b.bill.tdsAmount), money(b.bill.noteReductions), money(b.bill.kasarAmount),
        money(b.bill.base), b.dueDate, money(b.outstandingAtYearEnd),
        money(b.disallowedCY), money(b.allowedInFY), money(b.stillOutstanding), b.reason,
      ]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([bHead, ...bRows]), 'Bill Detail');

  // ── Exceptions ──
  const exHead = ['Vendor', 'Warning'];
  const exRows: string[][] = [];
  for (const v of report.vendors) for (const w of v.warnings) exRows.push([v.vendorName, w]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([exHead, ...(exRows.length ? exRows : [['—', 'No exceptions']])]), 'Exceptions');

  return wb;
}

export function downloadWorkpaper(report: Msme43bReport, carry?: CarryForward | null): void {
  const wb = buildWorkpaperWorkbook(report, carry);
  const name = `MSME_43B(h)_${(report.clientName || 'client').replace(/\s+/g, '_')}_${report.cyLabel}.xlsx`;
  XLSX.writeFile(wb, name);
}
