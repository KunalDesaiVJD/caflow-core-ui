/**
 * Group statement of account PDF: a summary by client (receipts, TDS / GST TDS,
 * kasar and credit notes in their own columns) followed by each client's ledger
 * with every receipt, TDS and kasar on its own line.
 */
import { format, parseISO } from "date-fns";
import { ensurePdfUnicodeFont, formatPdfCurrency, setPdfUnicodeFont } from "@/lib/jspdfUnicodeFont";
import type { LedgerEntryKind } from "@/lib/ledgerEntryKinds";
import type { LedgerEntry } from "@/lib/statementOfAccount";

export interface GroupStatementClient { clientId: string; name: string; entries: LedgerEntry[] }

const drCr = (net: number) => (net >= 0 ? { abs: net, label: "Dr" as const } : { abs: -net, label: "Cr" as const });

/** Period figures for one client's statement, with credits split by kind. */
export function summariseEntries(entries: LedgerEntry[]) {
  const opening = entries.filter(e => !e.kind).reduce((sum, e) => sum + e.debit - e.credit, 0);
  const credit = (...kinds: LedgerEntryKind[]) =>
    entries.filter(e => e.kind && kinds.includes(e.kind)).reduce((sum, e) => sum + e.credit, 0);
  const debit = entries.filter(e => e.kind).reduce((sum, e) => sum + e.debit, 0);
  const receipts = credit("receipt"), tds = credit("tds", "gst_tds"), kasar = credit("kasar"), creditNotes = credit("credit_note");
  return { opening, debit, receipts, tds, kasar, creditNotes, closing: opening + debit - receipts - tds - kasar - creditNotes };
}

export async function buildGroupStatementPdf(o: {
  groupName: string; firmLabel: string; logoDataUrl: string | null;
  fromDate: string; toDate: string; perClient: GroupStatementClient[];
}): Promise<{ base64: string; blob: Blob }> {
  const jsPDF = (await import("jspdf")).default;
  const autoTable = (await import("jspdf-autotable")).default;
  const DARK_BLUE: [number, number, number] = [26, 58, 92];
  const WHITE: [number, number, number] = [255, 255, 255];
  const { groupName, firmLabel, logoDataUrl: logo, fromDate, toDate, perClient } = o;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await ensurePdfUnicodeFont(doc);

  doc.setFillColor(...DARK_BLUE); doc.rect(0, 0, 297, 24, "F");
  let textX = 14;
  if (logo) { try { doc.addImage(logo, logo.includes("image/png") ? "PNG" : "JPEG", 12, 2, 32, 20); textX = 50; } catch { /* ignore */ } }
  doc.setTextColor(...WHITE);
  setPdfUnicodeFont(doc, "bold"); doc.setFontSize(14);
  doc.text("GROUP STATEMENT OF ACCOUNT", textX, 10);
  setPdfUnicodeFont(doc, "normal"); doc.setFontSize(8);
  doc.text(`${groupName}   |   ${firmLabel}`, textX, 16);
  doc.text(`Period: ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}   |   Generated: ${format(new Date(), "d MMM yyyy, HH:mm")}`, textX, 21);

  const sums = perClient.map(c => ({ ...c, s: summariseEntries(c.entries) }));
  const total = sums.reduce((t, c) => ({
    opening: t.opening + c.s.opening, debit: t.debit + c.s.debit, receipts: t.receipts + c.s.receipts,
    tds: t.tds + c.s.tds, kasar: t.kasar + c.s.kasar, creditNotes: t.creditNotes + c.s.creditNotes, closing: t.closing + c.s.closing,
  }), { opening: 0, debit: 0, receipts: 0, tds: 0, kasar: 0, creditNotes: 0, closing: 0 });
  const bal = (n: number) => { if (Math.abs(n) < 0.005) return "—"; const { abs, label } = drCr(n); return `${formatPdfCurrency(abs)} ${label}`; };
  const amt = (n: number) => (n > 0.005 ? formatPdfCurrency(n) : "—");
  const hdr = { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: WHITE };
  const right = { ...hdr, halign: "right" as const };

  // 1) Summary by client
  const summaryRows: any[][] = sums.map(c => [c.name, bal(c.s.opening), amt(c.s.debit), amt(c.s.receipts), amt(c.s.tds), amt(c.s.kasar), amt(c.s.creditNotes), bal(c.s.closing)]);
  summaryRows.push([
    { content: `GROUP TOTAL (${sums.length} client${sums.length !== 1 ? "s" : ""})`, styles: hdr },
    { content: bal(total.opening), styles: right }, { content: amt(total.debit), styles: right },
    { content: amt(total.receipts), styles: right }, { content: amt(total.tds), styles: right },
    { content: amt(total.kasar), styles: right }, { content: amt(total.creditNotes), styles: right },
    { content: bal(total.closing), styles: right },
  ]);
  autoTable(doc, {
    startY: 28,
    head: [["Client", "Opening Balance", "Debit (Invoices)", "Receipts", "TDS / GST TDS", "Kasar", "Credit Notes", "Closing Balance"]],
    body: summaryRows,
    styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
    headStyles: { font: "NotoSans", fillColor: [40, 80, 130], textColor: WHITE, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [248, 251, 255] },
    columnStyles: {
      0: { cellWidth: 67 },
      1: { cellWidth: 30, halign: "right" }, 2: { cellWidth: 30, halign: "right" }, 3: { cellWidth: 30, halign: "right" },
      4: { cellWidth: 30, halign: "right" }, 5: { cellWidth: 30, halign: "right" }, 6: { cellWidth: 30, halign: "right" },
      7: { cellWidth: 30, halign: "right" },
    },
    margin: { left: 10, right: 10 },
  });

  // 2) Each client's ledger — receipts, TDS and kasar on their own lines
  const detail: any[][] = [];
  for (const c of sums) {
    detail.push([{ content: c.name, colSpan: 6, styles: { fontStyle: "bold" as const, fillColor: [225, 233, 245] as [number, number, number], textColor: DARK_BLUE } }]);
    for (const e of c.entries) {
      detail.push([
        e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yyyy") : "",
        e.doc_no, e.narration,
        e.debit  > 0 ? formatPdfCurrency(e.debit)  : "—",
        e.credit > 0 ? formatPdfCurrency(e.credit) : "—",
        bal(e.balance),
      ]);
    }
    const totDr = c.entries.reduce((x, e) => x + e.debit, 0);
    const totCr = c.entries.reduce((x, e) => x + e.credit, 0);
    detail.push([
      { content: `Closing balance — ${c.name}`, colSpan: 3, styles: { fontStyle: "bold" as const, fillColor: [240, 244, 250] as [number, number, number] } },
      { content: formatPdfCurrency(totDr), styles: { fontStyle: "bold" as const, fillColor: [240, 244, 250] as [number, number, number], halign: "right" as const } },
      { content: formatPdfCurrency(totCr), styles: { fontStyle: "bold" as const, fillColor: [240, 244, 250] as [number, number, number], halign: "right" as const } },
      { content: bal(c.entries[c.entries.length - 1].balance), styles: { fontStyle: "bold" as const, fillColor: [240, 244, 250] as [number, number, number], halign: "right" as const } },
    ]);
  }
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 8,
    head: [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance"]],
    body: detail,
    styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.2, lineColor: [200, 210, 225], lineWidth: 0.3 },
    headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: WHITE, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 24, halign: "center" }, 1: { cellWidth: 28, halign: "center" }, 2: { cellWidth: 111 },
      3: { cellWidth: 38, halign: "right" }, 4: { cellWidth: 38, halign: "right" }, 5: { cellWidth: 38, halign: "right" },
    },
    margin: { left: 10, right: 10 },
    didDrawPage: (hookData: any) => {
      const pc = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7); setPdfUnicodeFont(doc, "normal"); doc.setTextColor(120, 130, 145);
      doc.text(`Page ${hookData.pageNumber} of ${pc}   |   ${groupName}   |   Confidential`, 148, 208, { align: "center" });
      doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(14, 204, 283, 204);
    },
  });

  const blob = doc.output("blob");
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, blob };
}
