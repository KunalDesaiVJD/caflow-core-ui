/**
 * Shared layout pieces for ledger PDFs that cover several clients (group
 * statement of account, group ledger):
 *   page 1   — summary by client: Opening, Debit, Credit, Closing only
 *   page 2+  — the client-wise breakdown (drawn by the caller)
 *   end      — bank details of every firm whose ledger is in the PDF
 * Page numbers are stamped once at the end so "Page x of n" is always right.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatPdfCurrency, setPdfUnicodeFont } from "@/lib/jspdfUnicodeFont";

type RGB = [number, number, number];
const DARK_BLUE: RGB = [26, 58, 92];
const WHITE: RGB = [255, 255, 255];

export interface ClientSummaryRow { name: string; opening: number; debit: number; credit: number; closing: number }

export interface FirmBankDetails { firmId?: string; firmName: string; bankName: string; accountNumber: string; ifsc: string; branch: string }

/** Balance with Dr/Cr suffix; "—" when nil. */
export function pdfBalance(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return `${formatPdfCurrency(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;
}
const pdfAmount = (n: number) => (n > 0.005 ? formatPdfCurrency(n) : "—");

/** Bank details as saved in Firm Settings → Bank & Billing (firms.bank_details, falling back to settings.billing). */
export function firmBankDetailsOf(firm: { id?: string | null; name?: string | null; bank_details?: any; settings?: any }): FirmBankDetails | null {
  const bd = firm.bank_details || {};
  const billing = firm.settings?.billing || {};
  const d: FirmBankDetails = {
    ...(firm.id ? { firmId: firm.id } : {}),
    firmName: firm.name || "—",
    bankName: bd.bank_name || billing.bank_name || "",
    accountNumber: bd.account_number || bd.account_no || billing.account_number || "",
    ifsc: bd.ifsc || billing.ifsc || "",
    branch: bd.branch || billing.branch || "",
  };
  return d.bankName || d.accountNumber || d.ifsc ? d : null;
}

/** Bank details for the given firms, in firm-name order. Firms with none saved are left out. */
export async function loadFirmBankDetails(firmIds: string[]): Promise<FirmBankDetails[]> {
  const ids = Array.from(new Set(firmIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const { data } = await (supabase as any).from("firms").select("id, name, bank_details, settings").in("id", ids).order("name");
  return ((data || []) as any[]).map(firmBankDetailsOf).filter(Boolean) as FirmBankDetails[];
}

/**
 * Page-1 summary table: Client | Opening | Debit | Credit | Closing. A total row is added only when
 * `totalLabel` is given — statements that go to clients leave it out, so each client sees only
 * their own closing balance, never a combined figure for the group or the firms.
 */
export function drawClientSummaryTable(doc: any, autoTable: any, o: {
  startY: number; rows: ClientSummaryRow[]; totalLabel?: string; firstColumn?: string;
}) {
  const total = o.rows.reduce((t, r) => ({
    opening: t.opening + r.opening, debit: t.debit + r.debit, credit: t.credit + r.credit, closing: t.closing + r.closing,
  }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  const tot = { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: WHITE };
  const totR = { ...tot, halign: "right" as const };
  const body: any[][] = o.rows.map(r => [r.name, pdfBalance(r.opening), pdfAmount(r.debit), pdfAmount(r.credit), pdfBalance(r.closing)]);
  if (o.totalLabel) body.push([
    { content: o.totalLabel, styles: tot },
    { content: pdfBalance(total.opening), styles: totR }, { content: pdfAmount(total.debit), styles: totR },
    { content: pdfAmount(total.credit), styles: totR }, { content: pdfBalance(total.closing), styles: totR },
  ]);
  autoTable(doc, {
    startY: o.startY,
    head: [[o.firstColumn || "Client", "Opening Balance", "Debit (₹)", "Credit (₹)", "Closing Balance"]],
    body,
    styles: { font: "NotoSans", fontSize: 8.5, cellPadding: 3, lineColor: [200, 210, 225], lineWidth: 0.3 },
    headStyles: { font: "NotoSans", fillColor: [40, 80, 130], textColor: WHITE, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [248, 251, 255] },
    columnStyles: {
      0: { cellWidth: 97 },
      1: { cellWidth: 45, halign: "right" }, 2: { cellWidth: 45, halign: "right" },
      3: { cellWidth: 45, halign: "right" }, 4: { cellWidth: 45, halign: "right" },
    },
    margin: { left: 10, right: 10, bottom: 16 },
  });
}

/** Starts the client-wise breakdown on a fresh page with a small heading; returns the Y to start the table at. */
export function startBreakdownPage(doc: any, title: string): number {
  doc.addPage();
  doc.setTextColor(...DARK_BLUE);
  setPdfUnicodeFont(doc, "bold"); doc.setFontSize(11);
  doc.text(title, 10, 14);
  doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(10, 16.5, 287, 16.5);
  return 21;
}

/** Bank details of each firm, after the last table. Nothing is drawn when no firm has bank details saved. */
export function drawFirmBankDetails(doc: any, autoTable: any, banks: FirmBankDetails[]) {
  if (banks.length === 0) return;
  const pageH = doc.internal.pageSize.getHeight();
  let y = ((doc as any).lastAutoTable?.finalY ?? 20) + 10;
  // Keep the heading with at least the first rows of the table.
  if (y + 12 + banks.length * 7 > pageH - 16) { doc.addPage(); y = 16; }
  doc.setTextColor(...DARK_BLUE);
  setPdfUnicodeFont(doc, "bold"); doc.setFontSize(10);
  doc.text(banks.length > 1 ? "Bank Details for Payment (firm-wise)" : "Bank Details for Payment", 10, y);
  autoTable(doc, {
    startY: y + 3,
    head: [["Firm", "Bank", "Account No", "IFSC", "Branch"]],
    body: banks.map(b => [b.firmName, b.bankName || "—", b.accountNumber || "—", b.ifsc || "—", b.branch || "—"]),
    styles: { font: "NotoSans", fontSize: 8.5, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
    headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: WHITE, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 80, fontStyle: "bold" }, 1: { cellWidth: 65 }, 2: { cellWidth: 50 }, 3: { cellWidth: 35 }, 4: { cellWidth: 47 } },
    margin: { left: 10, right: 10, bottom: 16 },
  });
}

/** "Page x of n | label" footer on every page (landscape A4). Call once, after everything is drawn. */
export function stampPageFooters(doc: any, label: string) {
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(10, 202, 287, 202);
    setPdfUnicodeFont(doc, "normal"); doc.setFontSize(7); doc.setTextColor(120, 130, 145);
    doc.text(`Page ${i} of ${n}   |   ${label}`, 148.5, 206, { align: "center" });
  }
}

/** What one client owes one firm at the end of the period (negative = advance / credit balance). */
export interface PaymentAdviceRow { clientName: string; firmId: string; firmName: string; closing: number }

/**
 * Lines of a payment advice, one per client per firm, sorted by client then firm. Nil balances
 * are left out; a credit balance is shown as an advance so the client knows nothing is due.
 */
export function paymentAdviceLines(rows: PaymentAdviceRow[]) {
  return rows
    .filter(r => Math.abs(r.closing) >= 0.5)
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.firmName.localeCompare(b.firmName))
    .map(r => ({ ...r, payable: r.closing > 0 ? r.closing : 0, advance: r.closing < 0 ? -r.closing : 0 }));
}

/**
 * "Payment advice" at the end of a statement: for every client, the amount payable to each firm
 * with that firm's bank details — one cheque / transfer per line, nothing for the client to add up.
 */
export function drawPaymentAdvice(doc: any, autoTable: any, rows: PaymentAdviceRow[], banks: FirmBankDetails[]) {
  const lines = paymentAdviceLines(rows);
  const pageH = doc.internal.pageSize.getHeight();
  let y = ((doc as any).lastAutoTable?.finalY ?? 20) + 10;
  if (y + 24 + Math.min(lines.length, 4) * 7 > pageH - 16) { doc.addPage(); y = 16; }
  doc.setTextColor(...DARK_BLUE);
  setPdfUnicodeFont(doc, "bold"); doc.setFontSize(10);
  doc.text("Payment Advice — amount payable to each firm", 10, y);
  setPdfUnicodeFont(doc, "normal"); doc.setFontSize(8); doc.setTextColor(90, 100, 115);
  doc.text("Please make a separate payment for each line below, in favour of the firm named, quoting the client name.", 10, y + 5);
  if (lines.length === 0) {
    doc.setTextColor(...DARK_BLUE); doc.setFontSize(9);
    doc.text("No amount is payable as on the closing date of this statement.", 10, y + 12);
    return;
  }
  const bankOf = (firmId: string, firmName: string) =>
    banks.find(b => b.firmId === firmId) ?? banks.find(b => b.firmName === firmName);
  let lastClient = "";
  const body = lines.map(l => {
    const b = bankOf(l.firmId, l.firmName);
    const first = l.clientName !== lastClient;
    lastClient = l.clientName;
    return [
      first ? l.clientName : "",
      l.firmName,
      l.payable > 0 ? formatPdfCurrency(l.payable) : `Nil (advance ${formatPdfCurrency(l.advance)})`,
      b?.bankName || "—", b?.accountNumber || "—", b?.ifsc || "—",
    ];
  });
  autoTable(doc, {
    startY: y + 8,
    head: [["Client", "Pay to (firm)", "Amount payable (₹)", "Bank", "Account No", "IFSC"]],
    body,
    styles: { font: "NotoSans", fontSize: 8.5, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
    headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: WHITE, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 64, fontStyle: "bold" }, 1: { cellWidth: 64 }, 2: { cellWidth: 42, halign: "right", fontStyle: "bold" },
      3: { cellWidth: 45 }, 4: { cellWidth: 32 }, 5: { cellWidth: 30 },
    },
    margin: { left: 10, right: 10, bottom: 16 },
  });
}
