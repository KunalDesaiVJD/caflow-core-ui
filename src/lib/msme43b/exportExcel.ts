// MSME 43B(h) — the working paper.
//
// Written with ExcelJS rather than SheetJS because this file is a DELIVERABLE,
// not a data dump: it carries the firm's presentation, and — more importantly —
// it carries LIVE FORMULAS. Every derived number in the bill-level schedule is
// an Excel formula referencing its own row, so a reviewer can click a cell and
// see the arithmetic, change a date and watch the answer move, and tie the
// schedule out without taking anything on trust:
//
//   Due date        = bill date + window            → =B7+I7
//   Days taken      = payment date − bill date      → =K7-B7
//   Within time?    = payment date ≤ due date       → =IF(K7<=J7,"Within time","Late")
//   Taxable value   = gross − GST                   → =D7-E7
//   Disallowed      = unpaid × taxable proportion   → =ROUND(N7*F7/D7,2)
//   Totals          = SUBTOTAL(109,…)               → respects filtering
//
// The Form 3CD figure on the summary is itself a formula pointing at the
// schedule, so the headline number cannot drift from the detail behind it.
//
// House style is defined once in the palette/helpers at the top and applied
// everywhere, so the whole pack reads as one document.

import ExcelJS from 'exceljs';
import type { Msme43bReport, VendorResult } from './types';
import type { CarryForward } from './carryForward';
import type { Msme43bConfig } from './config';
import { disclosedAssumptions, type RuleProfile } from './rules';

// ── House style ─────────────────────────────────────────────────────────────
const NAVY = 'FF1F3864';        // headers, rules
const NAVY_LIGHT = 'FF2E5496';  // section bands
const SLATE = 'FFF2F5F9';       // zebra / panel fill
const BORDER = 'FFD6DCE4';
const RED = 'FFC00000';
const GREEN = 'FF2E7D32';
const AMBER = 'FF8A6100';

const MONEY = '#,##0.00;[Red](#,##0.00);"–"';
const MONEY_BOLD = '#,##0.00;[Red](#,##0.00)';
const DATE_FMT = 'dd-mmm-yyyy';
const INT = '#,##0';

type Cell = ExcelJS.Cell;
type Row = ExcelJS.Row;

const thin = (color = BORDER): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb: color } });

function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, width: number): number {
  ws.mergeCells(1, 1, 1, width);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: NAVY } };
  t.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, width);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: 'Calibri', size: 10, color: { argb: 'FF5A6675' } };
  ws.getRow(2).height = 16;

  // Rule under the masthead.
  for (let c = 1; c <= width; c++) {
    ws.getCell(3, c).border = { bottom: { style: 'medium', color: { argb: NAVY } } };
  }
  ws.getRow(3).height = 6;
  return 4;
}

function headerRow(ws: ExcelJS.Worksheet, rowIdx: number, labels: string[]): Row {
  const row = ws.getRow(rowIdx);
  labels.forEach((label, i) => {
    const c = row.getCell(i + 1);
    c.value = label;
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { top: thin(NAVY), left: thin(NAVY), bottom: thin(NAVY), right: thin(NAVY) };
  });
  row.height = 30;
  return row;
}

function sectionBand(ws: ExcelJS.Worksheet, rowIdx: number, text: string, width: number): void {
  ws.mergeCells(rowIdx, 1, rowIdx, width);
  const c = ws.getCell(rowIdx, 1);
  c.value = text;
  c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_LIGHT } };
  c.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(rowIdx).height = 20;
}

function bodyCell(c: Cell, opts: { money?: boolean; date?: boolean; int?: boolean; bold?: boolean; color?: string; zebra?: boolean } = {}): void {
  c.font = { name: 'Calibri', size: 10, bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined };
  if (opts.money) c.numFmt = opts.bold ? MONEY_BOLD : MONEY;
  if (opts.date) c.numFmt = DATE_FMT;
  if (opts.int) c.numFmt = INT;
  c.border = { top: thin(), left: thin(), bottom: thin(), right: thin() };
  if (opts.zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE } };
  c.alignment = { vertical: 'middle', ...(opts.money || opts.int ? { horizontal: 'right' } : {}) };
}

/** A label/value pair on a summary sheet. */
function kv(ws: ExcelJS.Worksheet, rowIdx: number, label: string, value: ExcelJS.CellValue, opts: { money?: boolean; bold?: boolean; color?: string; formula?: boolean } = {}): void {
  const l = ws.getCell(rowIdx, 1);
  l.value = label;
  l.font = { name: 'Calibri', size: 10, bold: opts.bold, color: { argb: 'FF3B4654' } };
  l.alignment = { vertical: 'middle', indent: 1 };

  const v = ws.getCell(rowIdx, 2);
  v.value = value;
  v.font = { name: 'Calibri', size: 10, bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined };
  if (opts.money) v.numFmt = opts.bold ? MONEY_BOLD : MONEY;
  v.alignment = { vertical: 'middle', horizontal: opts.money ? 'right' : 'left' };
  ws.getRow(rowIdx).height = 17;
}

const asDate = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The 43B(h) PRINCIPAL disallowance is reported under Form 3CD **Clause 26**
 * (sums covered by section 43B). Clause 22 captures only the MSMED-Act s.23
 * INTEREST, which this tool does not compute. This hook feeds the audit engine.
 */
export function msme43bToForm3cd(report: Msme43bReport) {
  return {
    clause26: {
      section: '43B(h)',
      description: 'Sums payable to micro & small enterprises beyond the s.15 MSMED Act time limit',
      amountDisallowedCY: report.totalDisallowedCY,
      amountAllowedOnPaymentFY: report.totalAllowedFY,
      amountUnpaid: report.totalStillOutstanding,
      windowDays: report.windowDays,
    },
  };
}

export interface WorkpaperOptions {
  /** the rule profile in force, disclosed on the Basis of preparation sheet */
  config?: Msme43bConfig;
  profile?: RuleProfile | null;
  /** name shown on the cover */
  firmName?: string;
  preparedBy?: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Workbook
// ────────────────────────────────────────────────────────────────────────────

export async function buildWorkpaperWorkbook(
  report: Msme43bReport,
  carry?: CarryForward | null,
  opts: WorkpaperOptions = {},
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.firmName || 'CAFlow';
  wb.company = opts.firmName || undefined;
  wb.created = new Date();

  buildCover(wb, report, opts);
  const scheduleRanges = buildSchedule(wb, report);
  buildVendorSummary(wb, report, scheduleRanges);
  buildSummary(wb, report, carry, opts);
  if (carry) buildCarryForward(wb, carry);
  if (opts.config) buildBasis(wb, report, opts);
  buildExceptions(wb, report);

  // Turn gridlines off everywhere for the printed look — MERGING into whatever
  // view each sheet already set, so the frozen header panes survive.
  for (const ws of wb.worksheets) {
    const existing = ws.views?.[0];
    ws.views = [{ ...(existing ?? {}), showGridLines: false } as ExcelJS.WorksheetView];
  }
  return wb;
}

function buildCover(wb: ExcelJS.Workbook, report: Msme43bReport, opts: WorkpaperOptions): void {
  const ws = wb.addWorksheet('Cover', { properties: { tabColor: { argb: NAVY } } });
  ws.columns = [{ width: 4 }, { width: 34 }, { width: 58 }, { width: 4 }];

  ws.mergeCells('B3:C3');
  const brand = ws.getCell('B3');
  brand.value = opts.firmName || 'CAFlow';
  brand.font = { name: 'Calibri', size: 11, bold: true, color: { argb: NAVY_LIGHT } };

  ws.mergeCells('B5:C6');
  const title = ws.getCell('B5');
  title.value = 'MSME disallowance under section 43B(h)';
  title.font = { name: 'Calibri', size: 24, bold: true, color: { argb: NAVY } };
  title.alignment = { vertical: 'middle', wrapText: true };

  ws.mergeCells('B7:C7');
  const sub = ws.getCell('B7');
  sub.value = 'Income Tax Act 1961 · read with section 15, MSMED Act 2006';
  sub.font = { name: 'Calibri', size: 11, color: { argb: 'FF5A6675' } };

  for (const col of ['B', 'C']) ws.getCell(`${col}8`).border = { bottom: { style: 'medium', color: { argb: NAVY } } };

  let r = 10;
  const line = (label: string, value: string) => {
    ws.getCell(r, 2).value = label;
    ws.getCell(r, 2).font = { name: 'Calibri', size: 10, color: { argb: 'FF5A6675' } };
    ws.getCell(r, 3).value = value;
    ws.getCell(r, 3).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1B1F24' } };
    ws.getRow(r).height = 20;
    r++;
  };
  line('Client', report.clientName || '—');
  line('Year under audit', report.cyLabel);
  line('Following year examined', report.fyLabel);
  line('Payment window applied', `${report.windowDays} days`);
  line('Vendors analysed', String(report.vendors.length));
  line('Prepared', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
  if (opts.preparedBy) line('Prepared by', opts.preparedBy);
  line(
    'Status',
    report.blocksSignOff
      ? `NOT READY FOR SIGN-OFF — ${report.blockingReasons.length} exception(s) below`
      : 'All ledgers reconciled and cross-checked',
  );
  ws.getCell(r - 1, 3).font = {
    name: 'Calibri', size: 11, bold: true,
    color: { argb: report.blocksSignOff ? RED : GREEN },
  };

  // The blockers are stated on the cover, not buried on the Exceptions tab: this
  // is the page a reviewer and a partner actually read before signing.
  if (report.blocksSignOff) {
    r++;
    ws.mergeCells(r, 2, r, 3);
    const head = ws.getCell(r, 2);
    head.value = 'Exceptions to be cleared before this working paper is issued';
    head.font = { name: 'Calibri', size: 11, bold: true, color: { argb: RED } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEC' } };
    head.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 20;
    r++;
    for (const reason of report.blockingReasons) {
      ws.mergeCells(r, 2, r, 3);
      const c = ws.getCell(r, 2);
      c.value = `•  ${reason}`;
      c.font = { name: 'Calibri', size: 9.5, color: { argb: RED } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEC' } };
      c.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = 32;
      r++;
    }
    if (report.unreconciledDisallowed > 0) {
      ws.mergeCells(r, 2, r, 3);
      const c = ws.getCell(r, 2);
      c.value =
        `•  Amount at risk: ₹${report.unreconciledDisallowed.toLocaleString('en-IN')} of the ` +
        `₹${report.totalDisallowedCY.toLocaleString('en-IN')} disallowance is contributed by ledgers ` +
        'that did not agree to their printed closing balance.';
      c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: RED } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEC' } };
      c.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = 32;
      r++;
    }
  }

  r++;
  ws.mergeCells(r, 2, r, 3);
  const noteHead = ws.getCell(r, 2);
  noteHead.value = 'Basis and limitations';
  noteHead.font = { name: 'Calibri', size: 11, bold: true, color: { argb: NAVY } };
  r++;

  const notes = [
    'Each ledger is reconstructed from its transactions and agreed to the printed closing balance. A ledger that does not agree is NOT excluded — omitting it would understate the disallowance — so its figures remain in the totals, but it is named under Exceptions, the disallowance it contributes is quantified separately, and sign-off is blocked until it is resolved.',
    'The disallowance is stated on the TAXABLE VALUE of each invoice. GST is not claimed as a deduction where input credit is available, so there is nothing in the tax component for section 43B(h) to disallow.',
    'The source ledgers carry no bill-wise references, so settlements are matched to bills on the basis set out in "Basis of preparation". That is an interpretation, and it is disclosed rather than assumed.',
    'Only vendors identified by the firm as registered micro or small enterprises are included. This working paper does not determine MSME status.',
    'Interest under section 16 of the MSMED Act (Form 3CD clause 22) is outside the scope of this working paper.',
  ];
  for (const n of notes) {
    ws.mergeCells(r, 2, r, 3);
    const c = ws.getCell(r, 2);
    c.value = `•  ${n}`;
    c.font = { name: 'Calibri', size: 9.5, color: { argb: 'FF3B4654' } };
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 30;
    r++;
  }

  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
}

interface ScheduleRange { vendor: string; first: number; last: number }

/**
 * The bill-level schedule — the heart of the pack, and the sheet that carries
 * the live formulas. Every derived column is computed by Excel from the raw
 * inputs on its own row.
 */
function buildSchedule(wb: ExcelJS.Workbook, report: Msme43bReport): ScheduleRange[] {
  const ws = wb.addWorksheet('Bill-wise working', { properties: { tabColor: { argb: NAVY_LIGHT } } });

  const COLS = [
    { header: 'Vendor', width: 30 },                    // A
    { header: 'Bill date', width: 12 },                 // B
    { header: 'Voucher no.', width: 14 },               // C
    { header: 'Gross invoice', width: 14 },             // D
    { header: 'GST', width: 12 },                       // E
    { header: 'Taxable value', width: 14 },             // F  = D-E
    { header: 'GST source', width: 13 },                // G
    { header: 'TDS / notes / kasar', width: 15 },       // H
    { header: 'Window (days)', width: 11 },             // I
    { header: 'Due date', width: 12 },                  // J  = B+I
    { header: 'Cleared on', width: 12 },                // K
    { header: 'Days taken', width: 11 },                // L  = K-B
    { header: 'Within time?', width: 13 },              // M  = IF(K<=J,…)
    { header: 'Unpaid at 31-Mar (gross)', width: 16 },  // N
    { header: 'Cleared within due date', width: 16 },   // O
    { header: 'Disallowed — gross', width: 15 },        // P  = MAX(0,N-O)
    { header: 'Disallowed — taxable', width: 16 },      // Q  = ROUND(P*F/D,2)
    { header: 'Allowed on payment (FY)', width: 16 },   // R
    { header: 'Still unpaid', width: 14 },              // S  = Q-R
    { header: 'Basis', width: 52 },                     // T
  ];
  ws.columns = COLS.map((c) => ({ width: c.width }));
  const W = COLS.length;

  let r = titleBlock(
    ws,
    'Bill-wise working — section 43B(h)',
    `${report.clientName || 'Client'} · ${report.cyLabel} (following year ${report.fyLabel}) · every derived column below is a live Excel formula`,
    W,
  );

  const headRow = r;
  headerRow(ws, r, COLS.map((c) => c.header));
  r++;
  const firstDataRow = r;

  const ranges: ScheduleRange[] = [];

  for (const v of report.vendors) {
    const bills = v.bills.filter((b) => !b.bill.isOpening);
    if (!bills.length) continue;

    sectionBand(ws, r, `${v.vendorName}${v.declaredGstRate !== undefined ? `  ·  GST declared at ${v.declaredGstRate}%` : ''}`, W);
    r++;
    const vFirst = r;

    bills.forEach((b, i) => {
      const zebra = i % 2 === 1;
      const row = ws.getRow(r);
      const bill = b.bill;

      row.getCell(1).value = v.vendorName;
      row.getCell(2).value = asDate(bill.billDate);
      row.getCell(3).value = bill.vchNo || '';
      row.getCell(4).value = bill.grossAmount;
      row.getCell(5).value = bill.gstAmount;
      // Taxable value is DERIVED in the sheet, not pasted.
      row.getCell(6).value = { formula: `D${r}-E${r}` };
      row.getCell(7).value = gstSourceLabel(bill.gstSource, bill.gstRate);
      row.getCell(8).value = bill.tdsAmount + bill.noteReductions + bill.kasarAmount;
      row.getCell(9).value = b.windowDays;
      // Due date = bill date + window. Change either and the sheet re-answers.
      row.getCell(10).value = { formula: `B${r}+I${r}` };
      row.getCell(11).value = asDate(b.clearedOn);
      row.getCell(12).value = { formula: `IF(K${r}="","",K${r}-B${r})` };
      row.getCell(13).value = { formula: `IF(K${r}="","Unpaid",IF(K${r}<=J${r},"Within time","Late"))` };
      row.getCell(14).value = b.outstandingAtYearEnd;
      row.getCell(15).value = b.settledWithinWindowAfterYE;
      row.getCell(16).value = { formula: `MAX(0,N${r}-O${r})` };
      // Disallowance restricted to the taxable proportion of the unpaid amount.
      row.getCell(17).value = { formula: `IF(D${r}=0,0,ROUND(P${r}*F${r}/D${r},2))` };
      row.getCell(18).value = b.allowedInFY;
      row.getCell(19).value = { formula: `ROUND(Q${r}-R${r},2)` };
      row.getCell(20).value = b.reason;

      for (let c = 1; c <= W; c++) {
        const cell = row.getCell(c);
        const money = [4, 5, 6, 8, 14, 15, 16, 17, 18, 19].includes(c);
        const date = [2, 10, 11].includes(c);
        const int = [9, 12].includes(c);
        bodyCell(cell, {
          money, date, int, zebra,
          bold: c === 17,
          color: c === 17 ? RED : c === 18 ? GREEN : c === 19 ? AMBER : undefined,
        });
        if (c === 20 || c === 7 || c === 13) cell.alignment = { vertical: 'middle', horizontal: c === 20 ? 'left' : 'center', wrapText: c === 20 };
      }
      // Highlight a bill whose GST could not be established — its disallowance
      // is on gross and therefore overstated.
      if (bill.gstSource === 'unavailable' && b.disallowedCY > 0) {
        row.getCell(7).font = { name: 'Calibri', size: 10, bold: true, color: { argb: AMBER } };
      }
      row.height = 16;
      r++;
    });

    // Vendor subtotal.
    const vLast = r - 1;
    const sub = ws.getRow(r);
    sub.getCell(1).value = `Total — ${v.vendorName}`;
    for (const c of [4, 5, 6, 14, 16, 17, 18, 19]) {
      sub.getCell(c).value = { formula: `SUBTOTAL(109,${colLetter(c)}${vFirst}:${colLetter(c)}${vLast})` };
    }
    for (let c = 1; c <= W; c++) {
      const cell = sub.getCell(c);
      bodyCell(cell, { money: [4, 5, 6, 14, 16, 17, 18, 19].includes(c), bold: true });
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF5' } };
      cell.border = { top: { style: 'thin', color: { argb: NAVY } }, bottom: { style: 'thin', color: { argb: NAVY } }, left: thin(), right: thin() };
    }
    ranges.push({ vendor: v.vendorName, first: vFirst, last: vLast });
    r += 2;
  }

  // Grand total across every vendor subtotal — SUBTOTAL ignores nested
  // SUBTOTALs, so summing the whole data range does not double-count.
  const lastRow = r - 1;
  const gt = ws.getRow(r);
  gt.getCell(1).value = 'TOTAL — all vendors';
  for (const c of [4, 5, 6, 14, 16, 17, 18, 19]) {
    gt.getCell(c).value = { formula: `SUBTOTAL(109,${colLetter(c)}${firstDataRow}:${colLetter(c)}${lastRow})` };
  }
  for (let cc = 1; cc <= W; cc++) {
    const cell = gt.getCell(cc);
    bodyCell(cell, { money: [4, 5, 6, 14, 16, 17, 18, 19].includes(cc), bold: true });
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  }
  gt.height = 20;
  (ws as ExcelJS.Worksheet & { _grandTotalRow?: number })._grandTotalRow = r;

  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: W } };
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headRow, showGridLines: false }];
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: `${headRow}:${headRow}`,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter = { oddFooter: '&L&"Calibri,Italic"&8Generated by CAFlow · figures re-derived from the source ledgers&R&"Calibri,Italic"&8Page &P of &N' };

  return ranges;
}

function gstSourceLabel(source: string, rate?: number): string {
  switch (source) {
    case 'ledger': return rate !== undefined ? `Per ledger (${rate}%)` : 'Per ledger';
    case 'declared-rate': return `Declared ${rate}%`;
    case 'no-gst': return 'No GST';
    default: return 'Not identified';
  }
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m - 1) / 26); }
  return s;
}

function buildVendorSummary(wb: ExcelJS.Workbook, report: Msme43bReport, ranges: ScheduleRange[]): void {
  const ws = wb.addWorksheet('Vendor summary');
  const COLS = [
    { header: 'Vendor', width: 34 },
    { header: 'Source', width: 10 },
    { header: 'Closing payable (CY)', width: 16 },
    { header: 'Disallowed — taxable', width: 16 },
    { header: 'Allowed on payment (FY)', width: 17 },
    { header: 'Still unpaid', width: 14 },
    { header: 'GST excluded', width: 14 },
    { header: 'GST not identified', width: 15 },
    { header: 'Ledger agreed', width: 13 },
    { header: 'Cross-checked', width: 13 },
    { header: 'Items for review', width: 13 },
  ];
  ws.columns = COLS.map((c) => ({ width: c.width }));
  const W = COLS.length;

  let r = titleBlock(ws, 'Vendor summary', `${report.clientName || 'Client'} · ${report.cyLabel} · disallowance columns link to the bill-wise working`, W);
  const headRow = r;
  headerRow(ws, r, COLS.map((c) => c.header));
  r++;
  const first = r;

  report.vendors.forEach((v, i) => {
    const row = ws.getRow(r);
    const range = ranges.find((x) => x.vendor === v.vendorName);
    row.getCell(1).value = v.vendorName;
    row.getCell(2).value = v.format;
    row.getCell(3).value = v.cyClosing;
    // Link to the schedule so the summary can never disagree with the detail.
    row.getCell(4).value = range
      ? { formula: `SUM('Bill-wise working'!Q${range.first}:Q${range.last})` }
      : v.totalDisallowedCY;
    row.getCell(5).value = range
      ? { formula: `SUM('Bill-wise working'!R${range.first}:R${range.last})` }
      : v.totalAllowedFY;
    row.getCell(6).value = { formula: `ROUND(D${r}-E${r},2)` };
    row.getCell(7).value = v.gstExcluded;
    row.getCell(8).value = v.gstUnidentifiedValue;
    row.getCell(9).value = v.cyReconciled ? 'Yes' : 'NO';
    row.getCell(10).value = v.verified === false ? 'Review' : v.verified ? 'Yes' : '—';
    row.getCell(11).value = v.reviewCount;

    const zebra = i % 2 === 1;
    for (let c = 1; c <= W; c++) {
      bodyCell(row.getCell(c), {
        money: [3, 4, 5, 6, 7, 8].includes(c),
        int: c === 11,
        zebra,
        bold: c === 4,
        color: c === 4 ? RED : c === 5 ? GREEN : c === 6 ? AMBER : undefined,
      });
      if ([9, 10].includes(c)) row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    if (!v.cyReconciled) row.getCell(9).font = { name: 'Calibri', size: 10, bold: true, color: { argb: RED } };
    if (v.verified === false) row.getCell(10).font = { name: 'Calibri', size: 10, bold: true, color: { argb: AMBER } };
    if (v.gstUnidentifiedValue > 0) row.getCell(8).font = { name: 'Calibri', size: 10, bold: true, color: { argb: AMBER } };
    r++;
  });

  const last = r - 1;
  const tot = ws.getRow(r);
  tot.getCell(1).value = 'TOTAL';
  for (const c of [3, 4, 5, 6, 7, 8]) tot.getCell(c).value = { formula: `SUM(${colLetter(c)}${first}:${colLetter(c)}${last})` };
  for (let c = 1; c <= W; c++) {
    const cell = tot.getCell(c);
    bodyCell(cell, { money: [3, 4, 5, 6, 7, 8].includes(c), bold: true });
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  }
  tot.height = 20;
  (ws as ExcelJS.Worksheet & { _totalRow?: number })._totalRow = r;

  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: W } };
  ws.views = [{ state: 'frozen', ySplit: headRow, showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headRow}:${headRow}` };
}

function buildSummary(wb: ExcelJS.Workbook, report: Msme43bReport, carry: CarryForward | null | undefined, opts: WorkpaperOptions): void {
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: NAVY } } });
  ws.columns = [{ width: 52 }, { width: 20 }, { width: 60 }];

  let r = titleBlock(ws, 'Summary and Form 3CD', `${report.clientName || 'Client'} · assessment year following ${report.cyLabel}`, 3);

  const vs = wb.getWorksheet('Vendor summary') as (ExcelJS.Worksheet & { _totalRow?: number }) | undefined;
  const tr = vs?._totalRow;

  sectionBand(ws, r, `Section 43B(h) — ${report.cyLabel}`, 3); r++;
  // These reference the vendor summary, which references the bill-wise working.
  // The headline cannot drift from the detail.
  kv(ws, r++, 'Disallowed (added back) — on taxable value', tr ? { formula: `'Vendor summary'!D${tr}` } : report.totalDisallowedCY, { money: true, bold: true, color: RED });
  kv(ws, r++, `Of which paid in ${report.fyLabel} — allowable then`, tr ? { formula: `'Vendor summary'!E${tr}` } : report.totalAllowedFY, { money: true, color: GREEN });
  kv(ws, r++, 'Still unpaid at the end of the following year', tr ? { formula: `'Vendor summary'!F${tr}` } : report.totalStillOutstanding, { money: true, color: AMBER });
  r++;

  sectionBand(ws, r, 'GST', 3); r++;
  kv(ws, r++, 'GST excluded from the disallowance', tr ? { formula: `'Vendor summary'!G${tr}` } : report.totalGstExcluded, { money: true });
  kv(ws, r++, 'Disallowed value where GST could not be identified', tr ? { formula: `'Vendor summary'!H${tr}` } : report.totalGstUnidentified, { money: true, color: report.totalGstUnidentified > 0 ? AMBER : undefined });
  if (report.totalGstUnidentified > 0) {
    ws.mergeCells(r, 1, r, 3);
    const c = ws.getCell(r, 1);
    c.value = 'These ledgers do not print a tax split, so the amounts above are stated on GROSS and are overstated by the tax. Declaring the vendor\'s GST rate in the tool corrects them.';
    c.font = { name: 'Calibri', size: 9, italic: true, color: { argb: AMBER } };
    c.alignment = { wrapText: true, vertical: 'top', indent: 1 };
    ws.getRow(r).height = 26;
    r++;
  }
  r++;

  sectionBand(ws, r, 'Form 3CD', 3); r++;
  kv(ws, r++, 'Reported under', 'Clause 26 — sums covered by section 43B');
  kv(ws, r++, 'Amount to be reported', tr ? { formula: `'Vendor summary'!D${tr}` } : report.totalDisallowedCY, { money: true, bold: true });
  kv(ws, r++, 'Note', 'Clause 22 captures MSMED-Act s.16 interest only, which is outside this working paper.');
  r++;

  sectionBand(ws, r, 'Assurance performed', 3); r++;
  const unrec = report.vendors.filter((v) => !v.cyReconciled).length;
  const flagged = report.vendors.filter((v) => v.verified === false).length;
  kv(ws, r++, 'Vendors analysed', report.vendors.length);
  kv(ws, r++, 'Ledgers agreed to printed closing balance', `${report.vendors.length - unrec} of ${report.vendors.length}`, { color: unrec ? RED : GREEN });
  kv(ws, r++, 'Arithmetic re-derived by a second computation', `${report.vendors.length - flagged} of ${report.vendors.length}`, { color: flagged ? AMBER : GREEN });
  const swing = report.vendors.reduce((a, v) => a + (v.narrationSwing ?? 0), 0);
  kv(ws, r++, 'Disallowance dependent on narration-based classification', Math.round(swing * 100) / 100, { money: true, color: swing > 0 ? AMBER : GREEN });
  ws.mergeCells(r, 1, r, 3);
  const scope = ws.getCell(r, 1);
  scope.value =
    'The second computation is written independently of the first, so it tests the arithmetic — allocation order, '
    + 'day counts, rounding, and the identity disallowed = paid later + still unpaid. It shares the narration '
    + 'classifier with the first, so it cannot detect an entry that was typed wrongly. The line above states what '
    + 'that is worth: the disallowance that would change if write-offs, discounts, notes and TDS debits were '
    + 'date-tested as ordinary payments instead. Vendor-level detail is on the Exceptions sheet.';
  scope.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF5A6675' } };
  scope.alignment = { wrapText: true, vertical: 'top', indent: 1 };
  ws.getRow(r).height = 46;
  r++;
  kv(ws, r++, 'Window applied', `${report.windowDays} days`);
  if (opts.preparedBy) kv(ws, r++, 'Prepared by', opts.preparedBy);
  kv(
    ws, r++, 'Ready for sign-off',
    report.blocksSignOff ? 'NO — see the exceptions below' : 'Yes',
    { bold: true, color: report.blocksSignOff ? RED : GREEN },
  );

  if (report.blocksSignOff) {
    r++;
    sectionBand(ws, r, 'Exceptions to be cleared before issue', 3); r++;
    if (report.unreconciledDisallowed > 0) {
      kv(ws, r++, 'Disallowance contributed by unreconciled ledgers', report.unreconciledDisallowed, { money: true, bold: true, color: RED });
    }
    for (const reason of report.blockingReasons) {
      ws.mergeCells(r, 1, r, 3);
      const c = ws.getCell(r, 1);
      c.value = `•  ${reason}`;
      c.font = { name: 'Calibri', size: 9.5, color: { argb: RED } };
      c.alignment = { wrapText: true, vertical: 'top', indent: 1 };
      ws.getRow(r).height = 30;
      r++;
    }
  }

  if (carry) {
    r++;
    sectionBand(ws, r, 'Year-on-year', 3); r++;
    kv(ws, r++, `Net section 43B(h) impact for ${carry.currentCyLabel}`, carry.netDisallowanceThisYear, { money: true, bold: true });
  }

  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function buildCarryForward(wb: ExcelJS.Workbook, carry: CarryForward): void {
  const ws = wb.addWorksheet('Carry-forward');
  ws.columns = [{ width: 62 }, { width: 20 }];
  let r = titleBlock(ws, 'Year-on-year carry-forward', 'Amounts added back last year and paid this year become deductible now', 2);

  const first = r;
  kv(ws, r++, `Disallowance brought forward (added back in ${carry.priorCyLabel})`, carry.broughtForwardDisallowed, { money: true });
  kv(ws, r++, `Less: paid in ${carry.currentCyLabel} — allowable now`, -carry.allowedThisYearOnPayment, { money: true, color: GREEN });
  kv(ws, r++, 'Still carried forward (unpaid at prior year-end)', carry.stillCarriedForward, { money: true, color: AMBER });
  kv(ws, r++, `Add: fresh disallowance for ${carry.currentCyLabel}`, carry.currentYearDisallowance, { money: true, color: RED });
  // The net figure is a formula over the lines above it.
  kv(ws, r, `Net section 43B(h) impact for ${carry.currentCyLabel}`, { formula: `SUM(B${first}:B${r - 1})` }, { money: true, bold: true });
  ws.getCell(r, 1).border = { top: { style: 'double', color: { argb: NAVY } } };
  ws.getCell(r, 2).border = { top: { style: 'double', color: { argb: NAVY } } };
  r += 2;

  if (!carry.yearsAligned) {
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 1);
    c.value = `Years do not chain: the prior year's following year (${carry.priorFyLabel}) is not ${carry.currentCyLabel}. Check the run selected.`;
    c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: RED } };
    c.alignment = { wrapText: true };
  }

  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function buildBasis(wb: ExcelJS.Workbook, report: Msme43bReport, opts: WorkpaperOptions): void {
  const ws = wb.addWorksheet('Basis of preparation');
  const COLS = [{ header: 'Question', width: 46 }, { header: 'Position taken', width: 30 }, { header: 'Basis', width: 72 }, { header: 'Source', width: 22 }];
  ws.columns = COLS.map((c) => ({ width: c.width }));

  let r = titleBlock(ws, 'Basis of preparation', 'Every judgement the figures depend on. Positions marked "learned" were adopted from a working paper this firm confirmed as correct, and apply to every vendor.', 4);
  const headRow = r;
  headerRow(ws, r, COLS.map((c) => c.header));
  r++;

  disclosedAssumptions(opts.config!).forEach((a, i) => {
    const row = ws.getRow(r);
    row.getCell(1).value = a.question;
    row.getCell(2).value = a.position;
    row.getCell(3).value = a.basis;
    row.getCell(4).value = a.isDefault ? 'Standard position' : 'Learned from reviewed working';
    for (let c = 1; c <= 4; c++) {
      bodyCell(row.getCell(c), { zebra: i % 2 === 1, bold: c === 2 });
      row.getCell(c).alignment = { wrapText: true, vertical: 'top' };
    }
    row.height = 32;
    r++;
  });

  const windows = opts.profile?.vendorWindows ?? [];
  const gsts = opts.profile?.vendorGstRates ?? [];
  if (windows.length || gsts.length) {
    r++;
    sectionBand(ws, r, 'Declarations about individual vendors', 4); r++;
    headerRow(ws, r, ['Vendor', 'Declared', 'Basis', 'Declared by']); r++;
    for (const d of windows) {
      const row = ws.getRow(r);
      row.getCell(1).value = d.vendorName;
      row.getCell(2).value = `${d.windowDays}-day window`;
      row.getCell(3).value = d.basis === 'agreement' ? 'Written agreement with the supplier is on file (s.15 MSMED Act permits up to 45 days).' : 'No written agreement, so the 15-day limit u/s 15 applies.';
      row.getCell(4).value = d.declaredBy || '—';
      for (let c = 1; c <= 4; c++) { bodyCell(row.getCell(c)); row.getCell(c).alignment = { wrapText: true, vertical: 'top' }; }
      row.height = 28; r++;
    }
    for (const d of gsts) {
      const row = ws.getRow(r);
      row.getCell(1).value = d.vendorName;
      row.getCell(2).value = `GST at ${d.gstRate}%`;
      row.getCell(3).value = 'The ledger does not print a tax split; the firm has declared the rate this vendor charges, and the taxable value is derived from it.';
      row.getCell(4).value = d.declaredBy || '—';
      for (let c = 1; c <= 4; c++) { bodyCell(row.getCell(c)); row.getCell(c).alignment = { wrapText: true, vertical: 'top' }; }
      row.height = 28; r++;
    }
  }

  r++;
  ws.mergeCells(r, 1, r, 4);
  const foot = ws.getCell(r, 1);
  foot.value =
    'The source exports carry no bill-wise references, so the allocation of settlements to bills stated above is an interpretation, not data. ' +
    `Window applied: ${report.windowDays} days unless declared otherwise for a vendor above.`;
  foot.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF5A6675' } };
  foot.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(r).height = 28;

  ws.views = [{ state: 'frozen', ySplit: headRow, showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function buildExceptions(wb: ExcelJS.Workbook, report: Msme43bReport): void {
  const ws = wb.addWorksheet('Exceptions');
  const COLS = [{ header: 'Vendor', width: 32 }, { header: 'Matter', width: 108 }];
  ws.columns = COLS.map((c) => ({ width: c.width }));

  let r = titleBlock(ws, 'Exceptions', 'Matters requiring attention before this working paper is signed', 2);
  const headRow = r;
  headerRow(ws, r, COLS.map((c) => c.header));
  r++;

  let n = 0;
  // Report-level blockers first — a matter can block sign-off (e.g. broken
  // year-on-year continuity) without producing a per-vendor warning line, so
  // they are listed in their own right rather than left to be inferred.
  for (const reason of report.blockingReasons) {
    const row = ws.getRow(r);
    row.getCell(1).value = 'BLOCKS SIGN-OFF';
    row.getCell(2).value = reason;
    for (let c = 1; c <= 2; c++) {
      bodyCell(row.getCell(c), { bold: c === 1, color: RED, zebra: n % 2 === 1 });
      row.getCell(c).alignment = { wrapText: true, vertical: 'top' };
    }
    row.height = 30;
    r++; n++;
  }
  for (const v of report.vendors) {
    const items = [...v.warnings, ...(v.verifyNotes ?? []).map((x) => `Cross-check: ${x}`)];
    for (const w of items) {
      const row = ws.getRow(r);
      row.getCell(1).value = v.vendorName;
      row.getCell(2).value = w;
      for (let c = 1; c <= 2; c++) { bodyCell(row.getCell(c), { zebra: n % 2 === 1 }); row.getCell(c).alignment = { wrapText: true, vertical: 'top' }; }
      row.height = 28;
      r++; n++;
    }
  }
  if (!n) {
    const row = ws.getRow(r);
    row.getCell(1).value = '—';
    row.getCell(2).value = 'No exceptions. Every ledger agreed to its printed closing balance, and a second, independently written computation reproduced every figure.';
    for (let c = 1; c <= 2; c++) bodyCell(row.getCell(c), { color: GREEN });
  }

  ws.views = [{ state: 'frozen', ySplit: headRow, showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

// ────────────────────────────────────────────────────────────────────────────
//  Download
// ────────────────────────────────────────────────────────────────────────────

export function workpaperFileName(report: Msme43bReport): string {
  const client = (report.clientName || 'Client').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `MSME_43Bh_${client}_${report.cyLabel.replace('-', '_')}.xlsx`;
}

/** Build the workbook and hand it back as a Blob (also used for retention). */
export async function workpaperBlob(
  report: Msme43bReport,
  carry?: CarryForward | null,
  opts: WorkpaperOptions = {},
): Promise<Blob> {
  const wb = await buildWorkpaperWorkbook(report, carry, opts);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function downloadWorkpaper(
  report: Msme43bReport,
  carry?: CarryForward | null,
  opts: WorkpaperOptions = {},
): Promise<void> {
  const blob = await workpaperBlob(report, carry, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = workpaperFileName(report);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
