// MSME 43B(h) — Phase 6: Excel working-paper export + Form 3CD hook.

import * as XLSX from 'xlsx';
import type { Msme43bReport } from './types';
import type { CarryForward } from './carryForward';
import type { Msme43bConfig } from './config';
import { disclosedAssumptions, type RuleProfile } from './rules';

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

export interface WorkpaperOptions {
  /** the rule profile in force, disclosed on an "Interpretation" sheet */
  config?: Msme43bConfig;
  profile?: RuleProfile | null;
}

export function buildWorkpaperWorkbook(
  report: Msme43bReport,
  carry?: CarryForward | null,
  opts?: WorkpaperOptions,
): XLSX.WorkBook {
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

  // ── Interpretation applied ──
  // Every judgement the figures depend on, stated on the deliverable itself, so
  // a reviewer can see WHY a number is what it is — including any position the
  // tool has learned from this client's own working papers.
  if (opts?.config) {
    const rows: (string | number)[][] = [
      ['Interpretation applied to this computation'],
      ['Each line is a judgement the figures depend on. Positions marked "learned" were'],
      ['adopted from a working paper this firm confirmed as correct, and are applied to every vendor.'],
      [],
      ['Question', 'Position taken', 'Basis', 'Source'],
    ];
    for (const a of disclosedAssumptions(opts.config)) {
      rows.push([a.question, a.position, a.basis, a.isDefault ? 'Standard position' : 'Learned from reviewed working']);
    }
    if (opts.profile?.vendorWindows.length) {
      rows.push([], ['Per-vendor declarations (s.15 MSMED Act)'], ['Vendor', 'Window', 'Basis', 'Declared by']);
      for (const d of opts.profile.vendorWindows) {
        rows.push([
          d.vendorName, `${d.windowDays} days`,
          d.basis === 'agreement' ? 'Written agreement on file' : 'No written agreement',
          d.declaredBy || '—',
        ]);
      }
    }
    rows.push(
      [],
      ['Matching note', 'The source ledgers carry no bill-wise references, so settlements are matched to bills'],
      ['', `on the "${opts.config.allocation}" basis stated above. This is an interpretation, not data.`],
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Interpretation');
  }

  // ── Exceptions ──
  const exHead = ['Vendor', 'Warning'];
  const exRows: string[][] = [];
  for (const v of report.vendors) for (const w of v.warnings) exRows.push([v.vendorName, w]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([exHead, ...(exRows.length ? exRows : [['—', 'No exceptions']])]), 'Exceptions');

  return wb;
}

export function downloadWorkpaper(report: Msme43bReport, carry?: CarryForward | null, opts?: WorkpaperOptions): void {
  const wb = buildWorkpaperWorkbook(report, carry, opts);
  const name = `MSME_43B(h)_${(report.clientName || 'client').replace(/\s+/g, '_')}_${report.cyLabel}.xlsx`;
  XLSX.writeFile(wb, name);
}
