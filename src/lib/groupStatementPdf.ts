/**
 * Group statement of account PDF: page 1 is a summary by client (Opening,
 * Debit, Credit, Closing); from page 2 each client's ledger with every receipt,
 * TDS and kasar on its own line; then each firm's bank details.
 */
import { format, parseISO } from "date-fns";
import { ensurePdfUnicodeFont, formatPdfCurrency, setPdfUnicodeFont } from "@/lib/jspdfUnicodeFont";
import type { LedgerEntryKind } from "@/lib/ledgerEntryKinds";
import type { LedgerEntry } from "@/lib/statementOfAccount";
import {
  drawClientSummaryTable, drawFirmBankDetails, pdfBalance, startBreakdownPage, stampPageFooters,
  type FirmBankDetails,
} from "@/lib/multiClientLedgerPdf";

export interface GroupStatementClient { clientId: string; name: string; entries: LedgerEntry[] }

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
  /** Bank details of the firms in the statement, printed at the end. */
  bankDetails?: FirmBankDetails[];
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
  const hdr = { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: WHITE };

  // Page 1 — summary by client: Opening, Debit, Credit, Closing only
  drawClientSummaryTable(doc, autoTable, {
    startY: 28,
    rows: sums.map(c => ({
      name: c.name, opening: c.s.opening, debit: c.s.debit,
      credit: c.s.receipts + c.s.tds + c.s.kasar + c.s.creditNotes, closing: c.s.closing,
    })),
    totalLabel: `GROUP TOTAL (${sums.length} client${sums.length !== 1 ? "s" : ""})`,
  });

  // Page 2 onwards — each client's ledger, receipts, TDS and kasar on their own lines
  const detail: any[][] = [];
  for (const c of sums) {
    detail.push([{ content: c.name, colSpan: 6, styles: { fontStyle: "bold" as const, fillColor: [225, 233, 245] as [number, number, number], textColor: DARK_BLUE } }]);
    for (const e of c.entries) {
      detail.push([
        e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yyyy") : "",
        e.doc_no, e.narration,
        e.debit  > 0 ? formatPdfCurrency(e.debit)  : "—",
        e.credit > 0 ? formatPdfCurrency(e.credit) : "—",
        pdfBalance(e.balance),
      ]);
    }
    const totDr = c.entries.reduce((x, e) => x + e.debit, 0);
    const totCr = c.entries.reduce((x, e) => x + e.credit, 0);
    const sub = { fontStyle: "bold" as const, fillColor: [240, 244, 250] as [number, number, number] };
    detail.push([
      { content: `Closing balance — ${c.name}`, colSpan: 3, styles: sub },
      { content: formatPdfCurrency(totDr), styles: { ...sub, halign: "right" as const } },
      { content: formatPdfCurrency(totCr), styles: { ...sub, halign: "right" as const } },
      { content: pdfBalance(c.entries[c.entries.length - 1].balance), styles: { ...sub, halign: "right" as const } },
    ]);
  }
  autoTable(doc, {
    startY: startBreakdownPage(doc, `Client-wise Ledger — ${groupName}`),
    head: [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance"]],
    body: detail,
    styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.2, lineColor: [200, 210, 225], lineWidth: 0.3 },
    headStyles: { ...hdr, font: "NotoSans" },
    columnStyles: {
      0: { cellWidth: 24, halign: "center" }, 1: { cellWidth: 28, halign: "center" }, 2: { cellWidth: 111 },
      3: { cellWidth: 38, halign: "right" }, 4: { cellWidth: 38, halign: "right" }, 5: { cellWidth: 38, halign: "right" },
    },
    margin: { left: 10, right: 10, bottom: 16 },
  });

  // End of the ledger — bank details of each firm
  drawFirmBankDetails(doc, autoTable, o.bankDetails ?? []);
  stampPageFooters(doc, `${groupName}   |   Confidential`);

  const blob = doc.output("blob");
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, blob };
}
