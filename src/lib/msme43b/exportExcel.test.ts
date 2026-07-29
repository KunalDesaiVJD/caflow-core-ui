import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkpaperWorkbook } from './exportExcel';
import { buildReport } from './engine';
import { DEFAULT_CONFIG } from './config';
import { emptyProfile } from './rules';
import type { VendorLedger, LedgerTxn } from './types';

function txn(date: string, particulars: string, credit: number, debit: number, extra?: Partial<LedgerTxn>): LedgerTxn {
  return { date, particulars, credit, debit, ...extra };
}
function ledger(name: string, fy: string, opening: number, txns: LedgerTxn[]): VendorLedger {
  const start = fy.slice(0, 4);
  const end = parseInt(start, 10) + 1;
  const closing = txns.reduce((a, t) => a + t.credit - t.debit, opening);
  return {
    vendorName: name, financialYear: fy,
    periodFrom: `${start}-04-01`, periodTo: `${end}-03-31`,
    openingBalance: opening, closingBalance: closing, txns,
    format: 'ai', reconstructedClosing: closing, balanceReconciled: true, reconDrift: 0,
  };
}

const CY = [
  ledger('Alpha Steels', '2025-26', 0, [
    txn('2026-03-01', 'Purchase A/c', 118000, 0, { taxableValue: 100000, gstAmount: 18000, gstRate: 18 }),
  ]),
  ledger('Beta Alloys', '2025-26', 0, [txn('2026-02-01', 'Purchase A/c', 59000, 0, { gstRate: 18 })]),
];
const FY = [
  ledger('Alpha Steels', '2026-27', 118000, [txn('2026-08-01', 'HDFC Bank', 0, 118000)]),
  ledger('Beta Alloys', '2026-27', 59000, [txn('2026-04-02', 'HDFC Bank', 0, 59000)]),
];

async function build() {
  const report = buildReport(CY, FY, DEFAULT_CONFIG, 'Test Client Pvt Ltd');
  const profile = emptyProfile();
  profile.vendorGstRates = [{ key: 'betaalloys', vendorName: 'Beta Alloys', gstRate: 18, at: 'now', declaredBy: 'CA' }];
  const wb = await buildWorkpaperWorkbook(report, null, {
    config: DEFAULT_CONFIG, profile, firmName: 'Test & Co', preparedBy: 'CA Reviewer',
  });
  return { wb, report };
}

describe('working paper structure', () => {
  it('has the sheets a reviewer expects, in reading order', async () => {
    const { wb } = await build();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Cover', 'Bill-wise working', 'Vendor summary', 'Summary', 'Basis of preparation', 'Exceptions',
    ]);
  });

  it('is a real xlsx that round-trips through ExcelJS', async () => {
    const { wb } = await build();
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(5000);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buf as ArrayBuffer);
    expect(reopened.getWorksheet('Bill-wise working')).toBeTruthy();
  });
});

describe('the day-count arithmetic is preserved as live formulas', () => {
  it('due date, days taken and the within-time test are formulas, not pasted values', async () => {
    const { wb } = await build();
    const ws = wb.getWorksheet('Bill-wise working')!;

    // Find the first row carrying a bill (column D = gross invoice).
    let row = 0;
    ws.eachRow((r, i) => { if (!row && typeof r.getCell(4).value === 'number') row = i; });
    expect(row).toBeGreaterThan(0);

    const f = (c: number) => (ws.getCell(row, c).value as { formula?: string })?.formula;
    expect(f(6)).toBe(`D${row}-E${row}`);                                        // taxable = gross − GST
    expect(f(10)).toBe(`B${row}+I${row}`);                                       // due date = bill + window
    expect(f(12)).toBe(`IF(K${row}="","",K${row}-B${row})`);                     // days taken
    expect(f(13)).toBe(`IF(K${row}="","Unpaid",IF(K${row}<=J${row},"Within time","Late"))`);
    expect(f(16)).toBe(`MAX(0,N${row}-O${row})`);                                // disallowed, gross
    expect(f(17)).toBe(`IF(D${row}=0,0,ROUND(P${row}*F${row}/D${row},2))`);      // restricted to taxable
    expect(f(19)).toBe(`ROUND(Q${row}-R${row},2)`);                              // still unpaid
  });

  it('the raw inputs those formulas depend on are real values, not text', async () => {
    const { wb } = await build();
    const ws = wb.getWorksheet('Bill-wise working')!;
    let row = 0;
    ws.eachRow((r, i) => { if (!row && typeof r.getCell(4).value === 'number') row = i; });

    expect(ws.getCell(row, 2).value).toBeInstanceOf(Date);   // bill date
    expect(typeof ws.getCell(row, 4).value).toBe('number');  // gross
    expect(typeof ws.getCell(row, 5).value).toBe('number');  // GST
    expect(typeof ws.getCell(row, 9).value).toBe('number');  // window days
    expect(ws.getCell(row, 2).numFmt).toBe('dd-mmm-yyyy');
  });

  it('totals use SUBTOTAL so they follow the autofilter', async () => {
    const { wb } = await build();
    const ws = wb.getWorksheet('Bill-wise working')!;
    const formulas: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => {
      const fm = (c.value as { formula?: string })?.formula;
      if (fm) formulas.push(fm);
    }));
    expect(formulas.some((x) => x.startsWith('SUBTOTAL(109,Q'))).toBe(true);
    expect(ws.autoFilter).toBeTruthy();
  });
});

describe('the headline figure cannot drift from the detail', () => {
  it('the summary references the vendor summary, which references the schedule', async () => {
    const { wb } = await build();
    const summary = wb.getWorksheet('Summary')!;
    const vendor = wb.getWorksheet('Vendor summary')!;

    const summaryFormulas: string[] = [];
    summary.eachRow((r) => r.eachCell((c) => {
      const fm = (c.value as { formula?: string })?.formula;
      if (fm) summaryFormulas.push(fm);
    }));
    expect(summaryFormulas.some((f) => f.includes("'Vendor summary'!D"))).toBe(true);

    const vendorFormulas: string[] = [];
    vendor.eachRow((r) => r.eachCell((c) => {
      const fm = (c.value as { formula?: string })?.formula;
      if (fm) vendorFormulas.push(fm);
    }));
    expect(vendorFormulas.some((f) => f.includes("SUM('Bill-wise working'!Q"))).toBe(true);
  });
});

describe('presentation', () => {
  it('applies the house style to headers and freezes them', async () => {
    const { wb } = await build();
    const ws = wb.getWorksheet('Bill-wise working')!;
    let headerCell: ExcelJS.Cell | undefined;
    ws.eachRow((r) => { if (!headerCell && r.getCell(1).value === 'Vendor') headerCell = r.getCell(1); });
    expect(headerCell).toBeTruthy();
    expect((headerCell!.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F3864');
    expect(headerCell!.font?.bold).toBe(true);
    expect(ws.views?.[0]).toMatchObject({ state: 'frozen' });
    expect(ws.pageSetup?.orientation).toBe('landscape');
  });

  it('discloses the interpretation and the vendor declarations', async () => {
    const { wb } = await build();
    const ws = wb.getWorksheet('Basis of preparation')!;
    const text: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); }));
    const all = text.join(' | ');
    expect(all).toMatch(/taxable value/i);
    expect(all).toMatch(/Beta Alloys/);
    expect(all).toMatch(/GST at 18%/);
  });

  it('shows GST provenance per bill', async () => {
    const { wb } = await build();
    const ws = wb.getWorksheet('Bill-wise working')!;
    const labels: string[] = [];
    ws.eachRow((r) => { const v = r.getCell(7).value; if (typeof v === 'string') labels.push(v); });
    expect(labels.some((l) => /Per ledger/.test(l))).toBe(true);
  });
});
