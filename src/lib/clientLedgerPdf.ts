import { format, parseISO } from "date-fns";
import { ensurePdfUnicodeFont, setPdfUnicodeFont, formatPdfCurrency } from "@/lib/jspdfUnicodeFont";
import type { LedgerEntry } from "@/lib/statementOfAccount";

const drCr = (net: number) => (net >= 0 ? { abs: net, label: "Dr" as const } : { abs: -net, label: "Cr" as const });

/** One client's statement of account (portrait A4): the ledger lines with receipt / TDS / kasar on their own rows. */
export async function buildClientLedgerPdf(o: {
  clientName: string; firmLabel: string; logoDataUrl: string | null;
  fromDate: string; toDate: string; entries: LedgerEntry[]; fallbackClosing: number;
}): Promise<{ base64: string; blob: Blob }> {
  const { clientName, firmLabel, logoDataUrl: logo, fromDate, toDate, entries, fallbackClosing } = o;
  const jsPDF   = (await import("jspdf")).default;
  const autoTable = (await import("jspdf-autotable")).default;
  const DARK_BLUE: [number, number, number] = [26, 58, 92];

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await ensurePdfUnicodeFont(doc);

  doc.setFillColor(...DARK_BLUE); doc.rect(0, 0, 210, 24, "F");
  let textX = 14;
  if (logo) { try { doc.addImage(logo, logo.includes("image/png") ? "PNG" : "JPEG", 12, 2, 30, 20); textX = 48; } catch { /**/ } }

  doc.setTextColor(255, 255, 255);
  setPdfUnicodeFont(doc, "bold"); doc.setFontSize(13);
  doc.text("STATEMENT OF ACCOUNT", textX, 10);
  setPdfUnicodeFont(doc, "normal"); doc.setFontSize(8);
  doc.text(`${firmLabel}   |   Client: ${clientName}`, textX, 16);
  doc.text(`Period: ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}   |   Generated: ${format(new Date(), "d MMM yyyy HH:mm")}`, textX, 21);

  // Footer totals the rows actually printed, so Dr − Cr = closing balance.
  const totDr = entries.reduce((s, e) => s + e.debit, 0);
  const totCr = entries.reduce((s, e) => s + e.credit, 0);
  const close = entries.length ? entries[entries.length - 1].balance : fallbackClosing;
  const tableRows: any[][] = entries.map(e => [
    e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yyyy") : "",
    e.doc_no, e.narration,
    e.debit  > 0 ? formatPdfCurrency(e.debit)  : "—",
    e.credit > 0 ? formatPdfCurrency(e.credit) : "—",
    formatPdfCurrency(e.balance),
  ]);

  const { abs: ca, label: cl } = drCr(close);
  tableRows.push([
    { content: "CLOSING BALANCE", colSpan: 3, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number] } },
    { content: formatPdfCurrency(totDr),  styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
    { content: formatPdfCurrency(totCr), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
    { content: `${formatPdfCurrency(ca)} ${cl}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255,255,255] as [number,number,number], halign: "right" as const } },
  ]);

  autoTable(doc, {
    startY: 28,
    head: [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]],
    body: tableRows,
    styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200,210,225], lineWidth: 0.3 },
    headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255,255,255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248,251,255] },
    columnStyles: {
      0: { cellWidth: 22, halign: "center" as const },
      1: { cellWidth: 22, halign: "center" as const },
      2: { cellWidth: 74 },
      3: { cellWidth: 24, halign: "right" as const },
      4: { cellWidth: 24, halign: "right" as const },
      5: { cellWidth: 24, halign: "right" as const },
    },
    margin: { left: 10, right: 10 },
    didDrawPage: (hookData: any) => {
      const pc = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7); setPdfUnicodeFont(doc, "normal"); doc.setTextColor(120,130,145);
      doc.text(`Page ${hookData.pageNumber} of ${pc}   |   CAFlow — Confidential`, 105, 290, { align: "center" });
      doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(10, 287, 200, 287);
    },
  });

  const blob = doc.output("blob");
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, blob };
}
