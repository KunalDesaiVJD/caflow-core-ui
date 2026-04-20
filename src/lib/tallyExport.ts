// ──────────────────────────────────────────────────────────────────────────────
// Tally Sync — Export helpers (Excel + PDF), Big4-style formatting
//   - Excel: exceljs with merged title, bold navy header, borders, number format,
//            alternating row shading, bold group rows, bold grand-total, freeze panes
//   - PDF:   jspdf + jspdf-autotable with company title, navy header, borders,
//            right-aligned numeric cols, alternating rows, bold group/total rows
// ──────────────────────────────────────────────────────────────────────────────

import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface TBRow {
  ledger_name: string;
  opening_balance: number;
  opening_type: string;  // "Dr" | "Cr"
  debit: number;         // current-year turnover
  credit: number;
  closing_balance: number;
  balance_type: string;  // "Dr" | "Cr"
}

export interface TBGroupBlock {
  groupName: string;
  isRevenue: boolean;
  rows: TBRow[];
  openingTotal: number;  openingTotalType: string;
  debitTotal: number;    creditTotal: number;
  closingTotal: number;  closingTotalType: string;
}

export interface LedgerRow {
  ledger_name: string;
  parent_group: string;
  opening_balance: number;
  opening_type: string;
  closing_balance: number;
  closing_type: string;
}

export interface LedgerGroupBlock {
  groupName: string;
  isRevenue: boolean;
  depth: number;
  primaryName: string;   // resolved primary
  ledgers: LedgerRow[];
}

export interface GroupMasterRow {
  group_name: string;
  parent_group: string;
  primary_name: string;
  is_revenue: boolean;
  is_primary: boolean;
  depth: number;
}

export interface ExportMeta {
  clientName: string;
  financialYear: string;
  firmName?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const NUM_FMT = '#,##0.00;[Red]-#,##0.00;"-"';
const NAVY = "FF1F3864";
const NAVY_RGB: [number, number, number] = [31, 56, 100];
const LIGHT_NAVY = "FFE7EFFB";
const LIGHT_NAVY_RGB: [number, number, number] = [231, 239, 251];
const BAND = "FFF5F7FB";
const BAND_RGB: [number, number, number] = [245, 247, 251];
const TOTAL_FILL = "FFD9E1F2";
const TOTAL_RGB: [number, number, number] = [217, 225, 242];

function fmtAmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safeFileName(s: string): string {
  return (s || "export").replace(/[^\w\-]+/g, "_").slice(0, 60);
}

function signedAmt(amt: number, type: string): string {
  if (!amt || amt === 0) return "—";
  return `${fmtAmt(amt)} ${type}`;
}

function saveBlob(blob: Blob, filename: string) {
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 50);
}

function thinBorderAll() {
  return {
    top:    { style: "thin" as const, color: { argb: "FFB4B4B4" } },
    bottom: { style: "thin" as const, color: { argb: "FFB4B4B4" } },
    left:   { style: "thin" as const, color: { argb: "FFB4B4B4" } },
    right:  { style: "thin" as const, color: { argb: "FFB4B4B4" } },
  };
}

function writeTitleBlock(ws: ExcelJS.Worksheet, title: string, meta: ExportMeta, colSpan: number) {
  const lastCol = String.fromCharCode("A".charCodeAt(0) + colSpan - 1);

  ws.mergeCells(`A1:${lastCol}1`);
  const t1 = ws.getCell("A1");
  t1.value = meta.firmName || "Tally Sync Export";
  t1.font = { bold: true, size: 11, color: { argb: "FF555555" } };
  t1.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells(`A2:${lastCol}2`);
  const t2 = ws.getCell("A2");
  t2.value = `${title} — ${meta.clientName}`;
  t2.font = { bold: true, size: 15, color: { argb: NAVY } };
  t2.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 22;

  ws.mergeCells(`A3:${lastCol}3`);
  const t3 = ws.getCell("A3");
  t3.value = `Financial Year ${meta.financialYear}   |   Generated ${new Date().toLocaleString("en-IN")}`;
  t3.font  = { italic: true, size: 9, color: { argb: "FF777777" } };
  t3.alignment = { horizontal: "center" };

  ws.addRow([]);  // spacer
}

function writeExcelHeader(ws: ExcelJS.Worksheet, headers: string[]) {
  const row = ws.addRow(headers);
  row.height = 22;
  row.eachCell(c => {
    c.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border    = thinBorderAll();
  });
  return row.number;
}

// ──────────────────────────────────────────────────────────────────────────────
// TRIAL BALANCE
// ──────────────────────────────────────────────────────────────────────────────

export async function exportTrialBalanceExcel(
  blocks: TBGroupBlock[],
  meta: ExportMeta,
  grand: { drOpening: number; crOpening: number; debit: number; credit: number; drClosing: number; crClosing: number; }
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CAFlow";
  wb.created = new Date();

  const ws = wb.addWorksheet("Trial Balance", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  writeTitleBlock(ws, "Trial Balance", meta, 5);
  writeExcelHeader(ws, ["Particulars", "Opening Balance", "Debit", "Credit", "Closing Balance", ""].slice(0, 5));

  for (const g of blocks) {
    // Group row
    const gRow = ws.addRow([
      g.groupName,
      g.openingTotal ? `${fmtAmt(g.openingTotal)} ${g.openingTotalType}` : "—",
      g.debitTotal   || null,
      g.creditTotal  || null,
      g.closingTotal ? `${fmtAmt(g.closingTotal)} ${g.closingTotalType}` : "—",
    ]);
    gRow.font = { bold: true, color: { argb: g.isRevenue ? "FFA04A00" : "FF1F3864" }, size: 10 };
    gRow.eachCell(c => {
      c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_NAVY } };
      c.border = thinBorderAll();
    });
    gRow.getCell(1).alignment = { horizontal: "left" };
    [2, 3, 4, 5].forEach(i => gRow.getCell(i).alignment = { horizontal: "right" });
    [3, 4].forEach(i => { if (gRow.getCell(i).value) gRow.getCell(i).numFmt = NUM_FMT; });

    for (const r of g.rows) {
      const dRow = ws.addRow([
        "    " + r.ledger_name,
        r.opening_balance ? `${fmtAmt(r.opening_balance)} ${r.opening_type}` : "—",
        r.debit  || null,
        r.credit || null,
        r.closing_balance ? `${fmtAmt(r.closing_balance)} ${r.balance_type}` : "—",
      ]);
      dRow.eachCell(c => { c.border = thinBorderAll(); c.font = { size: 10 }; });
      dRow.getCell(1).alignment = { horizontal: "left" };
      [2, 3, 4, 5].forEach(i => dRow.getCell(i).alignment = { horizontal: "right" });
      [3, 4].forEach(i => { if (dRow.getCell(i).value) dRow.getCell(i).numFmt = NUM_FMT; });
      if (dRow.number % 2 === 0) {
        dRow.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }; });
      }
    }
  }

  const tRow = ws.addRow([
    "GRAND TOTAL",
    `${fmtAmt(grand.drOpening)} Dr  /  ${fmtAmt(grand.crOpening)} Cr`,
    grand.debit  || null,
    grand.credit || null,
    `${fmtAmt(grand.drClosing)} Dr  /  ${fmtAmt(grand.crClosing)} Cr`,
  ]);
  tRow.font = { bold: true, size: 10, color: { argb: NAVY } };
  tRow.eachCell(c => {
    c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    c.border = { ...thinBorderAll(), top: { style: "medium", color: { argb: NAVY } } };
  });
  tRow.getCell(1).alignment = { horizontal: "left" };
  [2, 3, 4, 5].forEach(i => tRow.getCell(i).alignment = { horizontal: "right" });
  [3, 4].forEach(i => { if (tRow.getCell(i).value) tRow.getCell(i).numFmt = NUM_FMT; });

  ws.columns = [
    { width: 48 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 22 },
  ];

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `TrialBalance_${safeFileName(meta.clientName)}_FY${safeFileName(meta.financialYear)}.xlsx`
  );
}

export function exportTrialBalancePDF(
  blocks: TBGroupBlock[],
  meta: ExportMeta,
  grand: { drOpening: number; crOpening: number; debit: number; credit: number; drClosing: number; crClosing: number; }
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(85, 85, 85);
  doc.text(meta.firmName || "Tally Sync Export", pageWidth / 2, 12, { align: "center" });
  doc.setFontSize(14); doc.setTextColor(...NAVY_RGB);
  doc.text(`Trial Balance — ${meta.clientName}`, pageWidth / 2, 19, { align: "center" });
  doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`Financial Year ${meta.financialYear}   |   Generated ${new Date().toLocaleString("en-IN")}`,
    pageWidth / 2, 25, { align: "center" });

  const body: any[] = [];
  for (const g of blocks) {
    body.push([
      { content: g.groupName, styles: { fontStyle: "bold", fillColor: LIGHT_NAVY_RGB, textColor: g.isRevenue ? [160, 74, 0] : NAVY_RGB } },
      { content: g.openingTotal ? `${fmtAmt(g.openingTotal)} ${g.openingTotalType}` : "—", styles: { halign: "right", fontStyle: "bold", fillColor: LIGHT_NAVY_RGB } },
      { content: g.debitTotal  ? fmtAmt(g.debitTotal)  : "—", styles: { halign: "right", fontStyle: "bold", fillColor: LIGHT_NAVY_RGB } },
      { content: g.creditTotal ? fmtAmt(g.creditTotal) : "—", styles: { halign: "right", fontStyle: "bold", fillColor: LIGHT_NAVY_RGB } },
      { content: g.closingTotal ? `${fmtAmt(g.closingTotal)} ${g.closingTotalType}` : "—", styles: { halign: "right", fontStyle: "bold", fillColor: LIGHT_NAVY_RGB } },
    ]);
    for (const r of g.rows) {
      body.push([
        { content: "    " + r.ledger_name },
        { content: r.opening_balance ? `${fmtAmt(r.opening_balance)} ${r.opening_type}` : "—", styles: { halign: "right" } },
        { content: r.debit  ? fmtAmt(r.debit)  : "—", styles: { halign: "right" } },
        { content: r.credit ? fmtAmt(r.credit) : "—", styles: { halign: "right" } },
        { content: r.closing_balance ? `${fmtAmt(r.closing_balance)} ${r.balance_type}` : "—", styles: { halign: "right" } },
      ]);
    }
  }

  body.push([
    { content: "GRAND TOTAL", styles: { fontStyle: "bold", fillColor: TOTAL_RGB, textColor: NAVY_RGB } },
    { content: `${fmtAmt(grand.drOpening)} Dr  /  ${fmtAmt(grand.crOpening)} Cr`, styles: { halign: "right", fontStyle: "bold", fillColor: TOTAL_RGB } },
    { content: grand.debit  ? fmtAmt(grand.debit)  : "—", styles: { halign: "right", fontStyle: "bold", fillColor: TOTAL_RGB } },
    { content: grand.credit ? fmtAmt(grand.credit) : "—", styles: { halign: "right", fontStyle: "bold", fillColor: TOTAL_RGB } },
    { content: `${fmtAmt(grand.drClosing)} Dr  /  ${fmtAmt(grand.crClosing)} Cr`, styles: { halign: "right", fontStyle: "bold", fillColor: TOTAL_RGB } },
  ]);

  autoTable(doc, {
    startY: 30,
    head: [["Particulars", "Opening Balance", "Debit", "Credit", "Closing Balance"]],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: [180, 180, 180], lineWidth: 0.1, textColor: 30 },
    headStyles: { fillColor: NAVY_RGB, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: BAND_RGB },
    columnStyles: { 0: { cellWidth: 100 } },
    margin: { left: 10, right: 10 },
    didDrawPage: (data) => {
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth - 15, doc.internal.pageSize.getHeight() - 6, { align: "right" });
    },
  });

  doc.save(`TrialBalance_${safeFileName(meta.clientName)}_FY${safeFileName(meta.financialYear)}.pdf`);
}

// ──────────────────────────────────────────────────────────────────────────────
// LEDGER MASTERS
// ──────────────────────────────────────────────────────────────────────────────

export async function exportLedgersExcel(blocks: LedgerGroupBlock[], meta: ExportMeta) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ledgers", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  writeTitleBlock(ws, "Ledger Masters", meta, 4);
  writeExcelHeader(ws, ["Particulars", "Primary Group", "Opening Balance", "Closing Balance"]);

  for (const g of blocks) {
    const indent = "    ".repeat(g.depth);
    const gRow = ws.addRow([`${indent}${g.groupName}`, g.primaryName || "", "", ""]);
    gRow.font = { bold: true, color: { argb: g.isRevenue ? "FFA04A00" : "FF1F3864" }, size: 10 };
    gRow.eachCell(c => {
      c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_NAVY } };
      c.border = thinBorderAll();
    });

    for (const l of g.ledgers) {
      const dRow = ws.addRow([
        `${indent}    ${l.ledger_name}`,
        "",
        l.opening_balance ? `${fmtAmt(l.opening_balance)} ${l.opening_type}` : "—",
        l.closing_balance ? `${fmtAmt(l.closing_balance)} ${l.closing_type}` : "—",
      ]);
      dRow.eachCell(c => { c.border = thinBorderAll(); c.font = { size: 10 }; });
      dRow.getCell(3).alignment = { horizontal: "right" };
      dRow.getCell(4).alignment = { horizontal: "right" };
      if (dRow.number % 2 === 0) {
        dRow.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }; });
      }
    }
  }

  ws.columns = [{ width: 48 }, { width: 24 }, { width: 24 }, { width: 24 }];

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Ledgers_${safeFileName(meta.clientName)}_FY${safeFileName(meta.financialYear)}.xlsx`
  );
}

export function exportLedgersPDF(blocks: LedgerGroupBlock[], meta: ExportMeta) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(85);
  doc.text(meta.firmName || "Tally Sync Export", pageWidth / 2, 12, { align: "center" });
  doc.setFontSize(14); doc.setTextColor(...NAVY_RGB);
  doc.text(`Ledger Masters — ${meta.clientName}`, pageWidth / 2, 19, { align: "center" });
  doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`Financial Year ${meta.financialYear}   |   Generated ${new Date().toLocaleString("en-IN")}`,
    pageWidth / 2, 25, { align: "center" });

  const body: any[] = [];
  for (const g of blocks) {
    const indent = "    ".repeat(g.depth);
    body.push([
      { content: `${indent}${g.groupName}`, styles: { fontStyle: "bold", fillColor: LIGHT_NAVY_RGB, textColor: g.isRevenue ? [160,74,0] : NAVY_RGB } },
      { content: g.primaryName || "—",       styles: { fillColor: LIGHT_NAVY_RGB, fontStyle: "bold" } },
      { content: "", styles: { fillColor: LIGHT_NAVY_RGB } },
      { content: "", styles: { fillColor: LIGHT_NAVY_RGB } },
    ]);
    for (const l of g.ledgers) {
      body.push([
        `${indent}    ${l.ledger_name}`,
        "",
        { content: l.opening_balance ? `${fmtAmt(l.opening_balance)} ${l.opening_type}` : "—", styles: { halign: "right" } },
        { content: l.closing_balance ? `${fmtAmt(l.closing_balance)} ${l.closing_type}` : "—", styles: { halign: "right" } },
      ]);
    }
  }

  autoTable(doc, {
    startY: 30,
    head: [["Particulars", "Primary Group", "Opening Balance", "Closing Balance"]],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: [180,180,180], lineWidth: 0.1 },
    headStyles: { fillColor: NAVY_RGB, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: BAND_RGB },
    columnStyles: { 0: { cellWidth: 110 } },
    margin: { left: 10, right: 10 },
    didDrawPage: (data) => {
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth - 15, doc.internal.pageSize.getHeight() - 6, { align: "right" });
    },
  });

  doc.save(`Ledgers_${safeFileName(meta.clientName)}_FY${safeFileName(meta.financialYear)}.pdf`);
}

// ──────────────────────────────────────────────────────────────────────────────
// GROUP MASTERS
// ──────────────────────────────────────────────────────────────────────────────

export async function exportGroupsExcel(rows: GroupMasterRow[], meta: ExportMeta) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Groups", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  writeTitleBlock(ws, "Group Masters", meta, 5);
  writeExcelHeader(ws, ["Group Name", "Parent Group", "Primary Group", "Revenue", "Primary"]);

  for (const r of rows) {
    const indent = "    ".repeat(r.depth);
    const row = ws.addRow([
      `${indent}${r.group_name}`,
      r.parent_group || "—",
      r.primary_name || "—",
      r.is_revenue ? "Yes" : "No",
      r.is_primary ? "Yes" : "No",
    ]);
    row.eachCell(c => { c.border = thinBorderAll(); c.font = { size: 10 }; });
    if (r.is_primary) {
      row.font = { bold: true, color: { argb: r.is_revenue ? "FFA04A00" : "FF1F3864" }, size: 10 };
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_NAVY } }; });
    } else if (row.number % 2 === 0) {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }; });
    }
    row.getCell(4).alignment = { horizontal: "center" };
    row.getCell(5).alignment = { horizontal: "center" };
  }

  ws.columns = [{ width: 42 }, { width: 28 }, { width: 28 }, { width: 12 }, { width: 12 }];

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Groups_${safeFileName(meta.clientName)}_FY${safeFileName(meta.financialYear)}.xlsx`
  );
}

export function exportGroupsPDF(rows: GroupMasterRow[], meta: ExportMeta) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(85);
  doc.text(meta.firmName || "Tally Sync Export", pageWidth / 2, 12, { align: "center" });
  doc.setFontSize(14); doc.setTextColor(...NAVY_RGB);
  doc.text(`Group Masters — ${meta.clientName}`, pageWidth / 2, 19, { align: "center" });
  doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`Financial Year ${meta.financialYear}   |   Generated ${new Date().toLocaleString("en-IN")}`,
    pageWidth / 2, 25, { align: "center" });

  const body = rows.map(r => {
    const indent = "    ".repeat(r.depth);
    const base = r.is_primary ? LIGHT_NAVY_RGB : undefined;
    const textCol = r.is_primary ? (r.is_revenue ? [160,74,0] : NAVY_RGB) : [30,30,30];
    return [
      { content: `${indent}${r.group_name}`, styles: { fontStyle: r.is_primary ? "bold" : "normal", fillColor: base, textColor: textCol } },
      { content: r.parent_group || "—",      styles: { fillColor: base } },
      { content: r.primary_name || "—",      styles: { fillColor: base } },
      { content: r.is_revenue ? "Yes" : "No", styles: { halign: "center", fillColor: base } },
      { content: r.is_primary ? "Yes" : "No", styles: { halign: "center", fillColor: base } },
    ];
  });

  autoTable(doc, {
    startY: 30,
    head: [["Group Name", "Parent Group", "Primary Group", "Revenue", "Primary"]],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: [180,180,180], lineWidth: 0.1 },
    headStyles: { fillColor: NAVY_RGB, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: BAND_RGB },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 70 }, 2: { cellWidth: 70 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 } },
    margin: { left: 10, right: 10 },
    didDrawPage: (data) => {
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${data.pageNumber} of ${pageCount}`, pageWidth - 15, doc.internal.pageSize.getHeight() - 6, { align: "right" });
    },
  });

  doc.save(`Groups_${safeFileName(meta.clientName)}_FY${safeFileName(meta.financialYear)}.pdf`);
}
