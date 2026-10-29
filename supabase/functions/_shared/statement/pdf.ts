/**
 * Statement of account PDF — one layout for every statement the Report tab downloads, emails or
 * WhatsApps, and the Telegram bot sends (pure code: jsPDF and the fonts are passed in).
 *
 * Group: page 1 is a summary by client (Opening, Debit, Credit, Closing — no group total, so
 * each client sees only their own balance); from page 2 each client's ledger with every
 * receipt, TDS and kasar on its own line; then the payment advice.
 * Single client (`single: true`): the same ledger table and payment advice, without the
 * summary page.
 * Payment advice: the amount each client owes each firm with that firm's bank details, so
 * every line is one cheque / transfer.
 */
import { formatPdfCurrency, registerPdfFont, setPdfUnicodeFont, type PdfFontFiles } from "./font.ts";
import type { LedgerEntryKind } from "./kinds.ts";
import type { LedgerEntry } from "./entries.ts";
import {
  drawClientSummaryTable, drawFirmBankDetails, drawPaymentAdvice, pdfBalance, startBreakdownPage, stampPageFooters,
  type FirmBankDetails, type PaymentAdviceRow,
} from "./layout.ts";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return { y, m, d }; };
/** "2026-04-01" → "1 Apr 2026" */
export const longDate = (iso: string) => { const { y, m, d } = ymd(iso); return `${d} ${MONTHS[m - 1]} ${y}`; };
/** "2026-04-01" → "01/04/2026" */
export const shortDate = (iso: string) => { const { y, m, d } = ymd(iso); return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`; };
/** Now in India, "29 Oct 2026, 14:05" — the same on a browser and on the server (UTC). */
export function generatedStamp(now = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

export interface StatementPdfDeps {
  /** jsPDF constructor and the autoTable function (the app and the edge function load their own copies). */
  jsPDF: any; autoTable: any;
  fonts: PdfFontFiles;
}

export interface StatementPdfInput {
  groupName: string; firmLabel: string; logoDataUrl: string | null;
  fromDate: string; toDate: string; perClient: GroupStatementClient[];
  /** Bank details of the firms in the statement, printed at the end. */
  bankDetails?: FirmBankDetails[];
  /** Closing balance of each client with each firm — printed as the payment advice. */
  payments?: PaymentAdviceRow[];
  /** One client's statement: no summary page, title "Statement of Account". */
  single?: boolean;
}

/** Draws the statement and returns the jsPDF document (caller picks blob / bytes / base64). */
export function renderStatementPdf(deps: StatementPdfDeps, o: StatementPdfInput): any {
  const { jsPDF, autoTable } = deps;
  const DARK_BLUE: [number, number, number] = [26, 58, 92];
  const WHITE: [number, number, number] = [255, 255, 255];
  const { groupName, firmLabel, logoDataUrl: logo, fromDate, toDate, perClient } = o;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  registerPdfFont(doc, deps.fonts);

  doc.setFillColor(...DARK_BLUE); doc.rect(0, 0, 297, 24, "F");
  let textX = 14;
  if (logo) { try { doc.addImage(logo, logo.includes("image/png") ? "PNG" : "JPEG", 12, 2, 32, 20); textX = 50; } catch { /* ignore */ } }
  doc.setTextColor(...WHITE);
  setPdfUnicodeFont(doc, "bold"); doc.setFontSize(14);
  const single = !!o.single;
  doc.text(single ? "STATEMENT OF ACCOUNT" : "GROUP STATEMENT OF ACCOUNT", textX, 10);
  setPdfUnicodeFont(doc, "normal"); doc.setFontSize(8);
  doc.text(`${groupName}   |   ${firmLabel}`, textX, 16);
  doc.text(`Period: ${longDate(fromDate)} to ${longDate(toDate)}   |   Generated: ${generatedStamp()}`, textX, 21);

  const sums = perClient.map(c => ({ ...c, s: summariseEntries(c.entries) }));
  const hdr = { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: WHITE };

  // Page 1 — summary by client: Opening, Debit, Credit, Closing only. No group total: the
  // statement goes to the clients, and each should see only their own balance.
  if (!single) {
    drawClientSummaryTable(doc, autoTable, {
      startY: 28,
      rows: sums.map(c => ({
        name: c.name, opening: c.s.opening, debit: c.s.debit,
        credit: c.s.receipts + c.s.tds + c.s.kasar + c.s.creditNotes, closing: c.s.closing,
      })),
    });
  }

  // Page 2 onwards — each client's ledger, receipts, TDS and kasar on their own lines
  const detail: any[][] = [];
  for (const c of sums) {
    detail.push([{ content: c.name, colSpan: 6, styles: { fontStyle: "bold" as const, fillColor: [225, 233, 245] as [number, number, number], textColor: DARK_BLUE } }]);
    for (const e of c.entries) {
      detail.push([
        e.entry_date ? shortDate(e.entry_date) : "",
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
    startY: single ? 30 : startBreakdownPage(doc, `Client-wise Ledger — ${groupName}`),
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

  // End of the ledger — what to pay each firm (with its bank details), or just the bank details
  if (o.payments) drawPaymentAdvice(doc, autoTable, o.payments, o.bankDetails ?? []);
  else drawFirmBankDetails(doc, autoTable, o.bankDetails ?? []);
  stampPageFooters(doc, `${groupName}   |   Confidential`);
  return doc;
}
