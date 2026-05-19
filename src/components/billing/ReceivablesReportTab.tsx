/**
 * ReceivablesReportTab — Sundry Debtors (Flat list, Tally-inspired)
 *
 * Features:
 *  - Flat client list: Opening | Debit | Credit | Closing (Dr/Cr)
 *  - Click any row → right-side Sheet with running ledger
 *  - Export: Big4-style PDF
 *  - Email individual client ledger from the Sheet
 *  - Send full report to Telegram (all linked users of the firm)
 */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Download, RefreshCw, Search, X, TrendingUp, Users,
  Send, FileText, Mail, MessageCircle, Loader2,
  ArrowUpDown, ChevronUp, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ensurePdfUnicodeFont, formatPdfCurrency, setPdfUnicodeFont,
} from "@/lib/jspdfUnicodeFont";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  entity_type: string;
  openingDr: number;
  openingCr: number;
  debit: number;
  credit: number;
}

interface LedgerEntry {
  entry_date: string;
  doc_no: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

type SortKey = "name" | "closing" | "debit" | "credit";
type SortDir = "asc" | "desc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drCr(net: number): { abs: number; label: "Dr" | "Cr" } {
  return net >= 0 ? { abs: net, label: "Dr" } : { abs: -net, label: "Cr" };
}

function currentFYStart(): string {
  const t = new Date();
  const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  return `${y}-04-01`;
}

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

async function loadLogoBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReceivablesReportTab() {
  const { user } = useAuth();
  const firmId = user?.firm_id ?? null;

  // ── State ─────────────────────────────────────────────────────────────────

  const [fromDate, setFromDate] = useState(currentFYStart());
  const [toDate,   setToDate]   = useState(todayStr());
  const [loading,  setLoading]  = useState(false);
  const [rows,     setRows]     = useState<ClientRow[]>([]);
  const [firmName, setFirmName] = useState<string>("");
  const [firmLogoUrl, setFirmLogoUrl] = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [sortKey,  setSortKey]  = useState<SortKey>("name");
  const [sortDir,  setSortDir]  = useState<SortDir>("asc");

  // Sheet (ledger)
  const [sheetClient, setSheetClient] = useState<ClientRow | null>(null);
  const [sheetEntries, setSheetEntries] = useState<LedgerEntry[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);

  // Email dialog
  const [emailClient, setEmailClient] = useState<ClientRow | null>(null);
  const [emailSending, setEmailSending] = useState(false);

  // Telegram
  const [tgSending, setTgSending] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // ── Fetch report data ─────────────────────────────────────────────────────

  const fetchReport = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    try {
      const [
        { data: firmData },
        { data: clients, error: cErr },
        { data: invoices, error: iErr },
        { data: receipts, error: rErr },
      ] = await Promise.all([
        supabase.from("firms").select("name, settings").eq("id", firmId).single(),
        supabase.from("clients").select("id, name, email, entity_type").eq("firm_id", firmId).order("name"),
        supabase.from("invoices").select("client_id, invoice_date, total_amount").eq("firm_id", firmId).neq("status", "voided"),
        supabase.from("billing_receipts").select("client_id, receipt_date, amount_received, tds_amount").eq("firm_id", firmId),
      ]);

      if (cErr) throw cErr;
      if (iErr) throw iErr;
      if (rErr) throw rErr;

      setFirmName(firmData?.name ?? "");
      const logo = (firmData?.settings as any)?.logo_url ?? null;
      setFirmLogoUrl(logo);

      const built: ClientRow[] = (clients || []).map(c => {
        let openingDr = 0, openingCr = 0, debit = 0, credit = 0;

        for (const inv of invoices || []) {
          if (inv.client_id !== c.id) continue;
          const amt = Number(inv.total_amount || 0);
          if (!amt) continue;
          if (inv.invoice_date && inv.invoice_date < fromDate) {
            openingDr += amt;
          } else if (inv.invoice_date && inv.invoice_date >= fromDate && inv.invoice_date <= toDate) {
            debit += amt;
          }
        }

        for (const rec of receipts || []) {
          if (rec.client_id !== c.id) continue;
          const amt = Number(rec.amount_received || 0) + Number(rec.tds_amount || 0);
          if (!amt) continue;
          if (rec.receipt_date && rec.receipt_date < fromDate) {
            openingCr += amt;
          } else if (rec.receipt_date && rec.receipt_date >= fromDate && rec.receipt_date <= toDate) {
            credit += amt;
          }
        }

        return { id: c.id, name: c.name || "—", email: c.email ?? null, entity_type: c.entity_type ?? "", openingDr, openingCr, debit, credit };
      });

      setRows(built);
    } catch (e: any) {
      toast.error(e.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [firmId, fromDate, toDate]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  // ── Fetch ledger for sheet ────────────────────────────────────────────────

  async function openLedger(client: ClientRow) {
    setSheetClient(client);
    setSheetEntries([]);
    setSheetLoading(true);
    try {
      const [
        { data: invData },
        { data: recData },
      ] = await Promise.all([
        supabase.from("invoices")
          .select("id, invoice_no, invoice_date, total_amount, document_type, status")
          .eq("client_id", client.id)
          .eq("firm_id", firmId!)
          .neq("status", "voided")
          .gte("invoice_date", fromDate)
          .lte("invoice_date", toDate)
          .order("invoice_date"),
        supabase.from("billing_receipts")
          .select("id, receipt_date, amount_received, tds_amount, payment_mode, remarks")
          .eq("client_id", client.id)
          .eq("firm_id", firmId!)
          .gte("receipt_date", fromDate)
          .lte("receipt_date", toDate)
          .order("receipt_date"),
      ]);

      const entries: LedgerEntry[] = [];
      const opening = client.openingDr - client.openingCr;

      // Add opening balance row
      if (opening !== 0) {
        entries.push({
          entry_date: fromDate,
          doc_no: "—",
          narration: "Opening Balance",
          debit: opening > 0 ? opening : 0,
          credit: opening < 0 ? -opening : 0,
          balance: opening,
        });
      }

      // Merge and sort by date
      type TmpEntry = { date: string; doc_no: string; narration: string; debit: number; credit: number };
      const tmp: TmpEntry[] = [];

      for (const inv of invData || []) {
        const isCredit = inv.document_type === "credit_note";
        const amt = Number(inv.total_amount || 0);
        tmp.push({
          date: inv.invoice_date || fromDate,
          doc_no: inv.invoice_no || inv.id.slice(0, 8).toUpperCase(),
          narration: isCredit ? `Credit Note` : `Invoice`,
          debit: isCredit ? 0 : amt,
          credit: isCredit ? amt : 0,
        });
      }

      for (const rec of recData || []) {
        const amt = Number(rec.amount_received || 0) + Number(rec.tds_amount || 0);
        tmp.push({
          date: rec.receipt_date,
          doc_no: rec.id.slice(0, 8).toUpperCase(),
          narration: `Receipt — ${rec.payment_mode || ""}${rec.remarks ? ` (${rec.remarks})` : ""}`.trim().replace(/—\s*$/, "").trim(),
          debit: 0,
          credit: amt,
        });
      }

      tmp.sort((a, b) => a.date.localeCompare(b.date));

      let balance = opening;
      for (const t of tmp) {
        balance += t.debit - t.credit;
        entries.push({
          entry_date: t.date,
          doc_no: t.doc_no,
          narration: t.narration,
          debit: t.debit,
          credit: t.credit,
          balance,
        });
      }

      setSheetEntries(entries);
    } catch (e: any) {
      toast.error("Could not load ledger: " + e.message);
    } finally {
      setSheetLoading(false);
    }
  }

  // ── Derived / sorted list ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let r = rows;
    if (search) r = r.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    if (hideZero) r = r.filter(c => {
      const opening = c.openingDr - c.openingCr;
      const closing = opening + c.debit - c.credit;
      return Math.abs(closing) > 0.005 || c.debit > 0 || c.credit > 0 || Math.abs(opening) > 0.005;
    });
    // Sort
    return [...r].sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      if (sortKey === "name") { va = a.name; vb = b.name; }
      else if (sortKey === "debit") { va = a.debit; vb = b.debit; }
      else if (sortKey === "credit") { va = a.credit; vb = b.credit; }
      else {
        va = (a.openingDr - a.openingCr) + a.debit - a.credit;
        vb = (b.openingDr - b.openingCr) + b.debit - b.credit;
      }
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, search, hideZero, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const grandTotal = useMemo(() => {
    let openingDr = 0, openingCr = 0, debit = 0, credit = 0;
    for (const r of filtered) {
      openingDr += r.openingDr; openingCr += r.openingCr;
      debit += r.debit; credit += r.credit;
    }
    return { openingDr, openingCr, debit, credit };
  }, [filtered]);

  // ── Big4 PDF Export ───────────────────────────────────────────────────────

  async function generateReportPdf(): Promise<{ base64: string; blob: Blob }> {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE: [number, number, number] = [26, 58, 92];
    const ACCENT: [number, number, number]    = [215, 120, 30];

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);

    const logoBase64 = firmLogoUrl ? await loadLogoBase64(firmLogoUrl) : null;

    // Header band
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 24, "F");

    let textX = 14;
    if (logoBase64) {
      try {
        doc.addImage(logoBase64, logoBase64.includes("image/png") ? "PNG" : "JPEG", 12, 2, 32, 20);
        textX = 50;
      } catch { /* ignore */ }
    }

    doc.setTextColor(255, 255, 255);
    setPdfUnicodeFont(doc, "bold");
    doc.setFontSize(14);
    doc.text("SUNDRY DEBTORS — STATEMENT OF ACCOUNTS", textX, 10);
    setPdfUnicodeFont(doc, "normal");
    doc.setFontSize(8);
    doc.text(firmName, textX, 16);
    doc.text(
      `Period: ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}   |   Generated: ${format(new Date(), "d MMM yyyy, HH:mm")}`,
      textX, 21,
    );

    // Right-side summary box
    const gtOpenNet = grandTotal.openingDr - grandTotal.openingCr;
    const gtClose   = gtOpenNet + grandTotal.debit - grandTotal.credit;
    doc.setFontSize(7);
    doc.text(`Clients: ${filtered.length}   |   Net Receivable: ₹${fmtINR(Math.abs(gtClose))} ${gtClose >= 0 ? "Dr" : "Cr"}`, 200, 21, { align: "right" });

    // Table data
    const tableRows = filtered.map(r => {
      const openNet = r.openingDr - r.openingCr;
      const close   = openNet + r.debit - r.credit;
      const { abs: openAbs, label: openLbl } = drCr(openNet);
      const { abs: closeAbs, label: closeLbl } = drCr(close);
      return [
        r.name,
        openNet === 0 ? "—" : `${fmtINR(openAbs)} ${openLbl}`,
        r.debit > 0 ? fmtINR(r.debit) : "—",
        r.credit > 0 ? fmtINR(r.credit) : "—",
        close === 0 ? "—" : `${fmtINR(closeAbs)} ${closeLbl}`,
      ];
    });

    // Grand total row
    const { abs: gtOpenAbs, label: gtOpenLbl } = drCr(gtOpenNet);
    const { abs: gtCloseAbs, label: gtCloseLbl } = drCr(gtClose);
    tableRows.push([
      { content: "GRAND TOTAL", styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number] } },
      { content: `${fmtINR(gtOpenAbs)} ${gtOpenLbl}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
      { content: fmtINR(grandTotal.debit), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
      { content: fmtINR(grandTotal.credit), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
      { content: `${fmtINR(gtCloseAbs)} ${gtCloseLbl}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
    ]);

    autoTable(doc, {
      startY: 28,
      head: [["Particulars", "Opening Balance", "Debit (₹)", "Credit (₹)", "Closing Balance"]],
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8.5, cellPadding: 3, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: [40, 80, 130], textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 42, halign: "right" as const },
        2: { cellWidth: 42, halign: "right" as const },
        3: { cellWidth: 42, halign: "right" as const },
        4: { cellWidth: 42, halign: "right" as const },
      },
      margin: { left: 14, right: 14 },
      didDrawPage: (hookData: any) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7);
        setPdfUnicodeFont(doc, "normal");
        doc.setTextColor(120, 130, 145);
        doc.text(
          `Page ${hookData.pageNumber} of ${pageCount}   |   ${firmName}   |   Confidential — For Internal Use Only`,
          148, 208, { align: "center" },
        );
        doc.setDrawColor(...DARK_BLUE);
        doc.setLineWidth(0.4);
        doc.line(14, 204, 283, 204);
      },
    });

    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];
    return { base64, blob };
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const { blob } = await generateReportPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Sundry_Debtors_${fromDate}_to_${toDate}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("PDF export failed: " + e.message);
    } finally {
      setExportingPdf(false);
    }
  }

  // ── Client ledger PDF (for email / download from sheet) ───────────────────

  async function generateClientLedgerPdf(client: ClientRow, entries: LedgerEntry[]): Promise<{ base64: string; blob: Blob }> {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE: [number, number, number] = [26, 58, 92];

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);

    const logoBase64 = firmLogoUrl ? await loadLogoBase64(firmLogoUrl) : null;
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 210, 24, "F");

    let textX = 14;
    if (logoBase64) {
      try {
        doc.addImage(logoBase64, logoBase64.includes("image/png") ? "PNG" : "JPEG", 12, 2, 30, 20);
        textX = 48;
      } catch { /* ignore */ }
    }

    doc.setTextColor(255, 255, 255);
    setPdfUnicodeFont(doc, "bold");
    doc.setFontSize(13);
    doc.text("CLIENT LEDGER STATEMENT", textX, 10);
    setPdfUnicodeFont(doc, "normal");
    doc.setFontSize(8);
    doc.text(`${firmName}   |   Client: ${client.name}`, textX, 16);
    doc.text(`Period: ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}   |   Generated: ${format(new Date(), "d MMM yyyy HH:mm")}`, textX, 21);

    const openNet = client.openingDr - client.openingCr;
    const closingNet = openNet + client.debit - client.credit;

    const tableRows = entries.map(e => [
      e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yyyy") : "",
      e.doc_no,
      e.narration,
      e.debit > 0 ? formatPdfCurrency(e.debit) : "—",
      e.credit > 0 ? formatPdfCurrency(e.credit) : "—",
      formatPdfCurrency(e.balance),
    ]);

    const { abs: closeAbs, label: closeLbl } = drCr(closingNet);
    tableRows.push([
      { content: "CLOSING BALANCE", colSpan: 3, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number] } },
      { content: formatPdfCurrency(client.debit), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
      { content: formatPdfCurrency(client.credit), styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
      { content: `${formatPdfCurrency(closeAbs)} ${closeLbl}`, styles: { fontStyle: "bold" as const, fillColor: DARK_BLUE, textColor: [255, 255, 255] as [number, number, number], halign: "right" as const } },
    ]);

    autoTable(doc, {
      startY: 28,
      head: [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]],
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" as const },
        1: { cellWidth: 22, halign: "center" as const },
        2: { cellWidth: 82 },
        3: { cellWidth: 24, halign: "right" as const },
        4: { cellWidth: 24, halign: "right" as const },
        5: { cellWidth: 24, halign: "right" as const },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData: any) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7);
        setPdfUnicodeFont(doc, "normal");
        doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 105, 290, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.4); doc.line(10, 287, 200, 287);
      },
    });

    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];
    return { base64, blob };
  }

  async function handleDownloadClientPdf() {
    if (!sheetClient) return;
    try {
      const { blob } = await generateClientLedgerPdf(sheetClient, sheetEntries);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Ledger_${sheetClient.name.replace(/\s+/g, "_")}_${toDate}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error("PDF failed: " + e.message); }
  }

  // ── Email Ledger ──────────────────────────────────────────────────────────

  async function handleSendEmail() {
    if (!emailClient) return;
    setEmailSending(true);
    try {
      await openLedger(emailClient); // ensure entries loaded
      // Wait for sheet entries if they're not ready yet — brief poll
      await new Promise(r => setTimeout(r, 600));
      const entries = sheetClient?.id === emailClient.id ? sheetEntries : [];
      const { base64 } = await generateClientLedgerPdf(emailClient, entries);
      const { error } = await supabase.functions.invoke("send-notification", {
        body: {
          type: "ledger_statement",
          firm_id: firmId,
          direct_email: emailClient.email,
          payload: {
            client_name: emailClient.name,
            custom_subject: `Statement of Account — ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}`,
            custom_message: `Please find attached your statement of account for the period ${format(parseISO(fromDate), "d MMM yyyy")} to ${format(parseISO(toDate), "d MMM yyyy")}. Kindly review and revert if any discrepancies are noticed.`,
            pdf_base64: base64,
            pdf_filename: `Ledger_${emailClient.name.replace(/\s+/g, "_")}_${toDate}.pdf`,
          },
        },
      });
      if (error) throw new Error(error.message);
      toast.success(`Ledger sent to ${emailClient.email}`);
      setEmailClient(null);
    } catch (e: any) {
      toast.error("Email failed: " + e.message);
    } finally {
      setEmailSending(false);
    }
  }

  // ── Telegram send ─────────────────────────────────────────────────────────

  async function handleSendTelegram() {
    setTgSending(true);
    try {
      const { base64 } = await generateReportPdf();
      const { error } = await supabase.functions.invoke("send-telegram-report", {
        body: {
          firm_id: firmId,
          pdf_base64: base64,
          filename: `Sundry_Debtors_${fromDate}_to_${toDate}.pdf`,
          caption: `📊 *Sundry Debtors Report*\n_${firmName}_\nPeriod: ${format(parseISO(fromDate), "d MMM yyyy")} → ${format(parseISO(toDate), "d MMM yyyy")}\nClients: ${filtered.length}`,
        },
      });
      if (error) throw new Error(error.message);
      toast.success("Report sent to all linked Telegram users");
    } catch (e: any) {
      toast.error("Telegram send failed: " + e.message);
    } finally {
      setTgSending(false);
    }
  }

  // ── Sort icon helper ──────────────────────────────────────────────────────

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown size={11} className="ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp size={11} className="ml-1 text-orange-500" />
      : <ChevronDown size={11} className="ml-1 text-orange-500" />;
  }

  // ── Derived totals for Grand Total row ───────────────────────────────────

  const gtOpenNet  = grandTotal.openingDr - grandTotal.openingCr;
  const gtClose    = gtOpenNet + grandTotal.debit - grandTotal.credit;
  const { abs: gtOpenAbs,  label: gtOpenLbl  } = drCr(gtOpenNet);
  const { abs: gtCloseAbs, label: gtCloseLbl } = drCr(gtClose);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 text-xs w-36" />
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={fetchReport} disabled={loading}>
          <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Apply
        </Button>

        <div className="flex-1" />

        <div className="relative w-48">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client…" className="h-8 pl-8 pr-7 text-xs" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X size={11} /></button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Switch id="hz" checked={hideZero} onCheckedChange={setHideZero} className="scale-75 origin-left" />
          <Label htmlFor="hz" className="text-xs cursor-pointer text-muted-foreground">Hide nil balance</Label>
        </div>

        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleExportPdf} disabled={exportingPdf || loading}>
          {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export PDF
        </Button>

        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50" onClick={handleSendTelegram} disabled={tgSending || loading}>
          {tgSending ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} Telegram
        </Button>
      </div>

      {/* ── Report frame ── */}
      <div className="rounded-lg border border-[#1A2744]/20 overflow-hidden shadow-sm">
        {/* Title bar */}
        <div className="bg-[#1A2744] text-white px-5 py-2.5">
          <div className="font-semibold text-sm">Sundry Debtors</div>
          <div className="text-xs text-white/60">{firmName} · {format(parseISO(fromDate), "d-MMM-yy")} to {format(parseISO(toDate), "d-MMM-yy")}</div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_150px_120px_120px_150px_80px] bg-muted/60 border-b px-4 py-2 text-[11px] font-semibold text-muted-foreground">
          <button className="text-left flex items-center" onClick={() => toggleSort("name")}>
            Particulars <SortIcon col="name" />
          </button>
          <div className="text-right">Opening Balance</div>
          <button className="flex items-center justify-end w-full" onClick={() => toggleSort("debit")}>
            Debit <SortIcon col="debit" />
          </button>
          <button className="flex items-center justify-end w-full" onClick={() => toggleSort("credit")}>
            Credit <SortIcon col="credit" />
          </button>
          <button className="flex items-center justify-end w-full" onClick={() => toggleSort("closing")}>
            Closing Balance <SortIcon col="closing" />
          </button>
          <div className="text-center">Actions</div>
        </div>

        {/* Body */}
        <div className="divide-y">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_150px_120px_120px_150px_80px] px-4 py-2.5 gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full ml-auto" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-12 mx-auto" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Users className="mx-auto h-10 w-10 mb-3 opacity-20" />
              No clients with balances found for this period.
            </div>
          ) : (
            filtered.map((r, idx) => {
              const openNet  = r.openingDr - r.openingCr;
              const close    = openNet + r.debit - r.credit;
              const { abs: openAbs, label: openLbl } = drCr(openNet);
              const { abs: closeAbs, label: closeLbl } = drCr(close);

              return (
                <div
                  key={r.id}
                  className={cn(
                    "grid grid-cols-[1fr_150px_120px_120px_150px_80px] px-4 py-2.5 text-[12px] hover:bg-blue-50/50 cursor-pointer transition-colors",
                    idx % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                  )}
                  onClick={() => openLedger(r)}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText size={11} className="text-muted-foreground flex-shrink-0" />
                    <span className="font-medium truncate text-[#1A2744] hover:underline">{r.name}</span>
                  </div>
                  <div className="text-right tabular-nums">
                    {openNet === 0 ? <span className="text-muted-foreground">—</span> : (
                      <>
                        {fmtINR(openAbs)}&nbsp;
                        <span className={cn("text-[10px]", openLbl === "Cr" ? "text-green-600" : "text-orange-600")}>{openLbl}</span>
                      </>
                    )}
                  </div>
                  <div className="text-right tabular-nums">{r.debit > 0 ? fmtINR(r.debit) : <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-right tabular-nums">{r.credit > 0 ? fmtINR(r.credit) : <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-right tabular-nums font-semibold">
                    {close === 0 ? <span className="text-muted-foreground">—</span> : (
                      <>
                        {fmtINR(closeAbs)}&nbsp;
                        <span className={cn("text-[10px]", closeLbl === "Cr" ? "text-green-600" : "text-orange-600")}>{closeLbl}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                    {r.email && (
                      <button
                        title={`Email ledger to ${r.email}`}
                        className="p-1 rounded text-muted-foreground hover:text-blue-600 hover:bg-blue-50"
                        onClick={() => setEmailClient(r)}
                      >
                        <Mail size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Grand Total */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-[1fr_150px_120px_120px_150px_80px] px-4 py-3 bg-[#1A2744] text-white text-[12px] font-bold">
            <div className="flex items-center gap-1.5">
              <TrendingUp size={13} className="text-orange-400" /> Grand Total
              <span className="text-[10px] font-normal text-white/60 ml-1">({filtered.length} clients)</span>
            </div>
            <div className="text-right tabular-nums">
              {fmtINR(gtOpenAbs)}&nbsp;<span className={cn("text-[10px] font-normal", gtOpenLbl === "Cr" ? "text-green-300" : "text-orange-300")}>{gtOpenLbl}</span>
            </div>
            <div className="text-right tabular-nums">{fmtINR(grandTotal.debit)}</div>
            <div className="text-right tabular-nums">{fmtINR(grandTotal.credit)}</div>
            <div className="text-right tabular-nums">
              {fmtINR(gtCloseAbs)}&nbsp;<span className={cn("text-[10px] font-normal", gtCloseLbl === "Cr" ? "text-green-300" : "text-orange-300")}>{gtCloseLbl}</span>
            </div>
            <div />
          </div>
        )}
      </div>

      <div className="flex gap-4 text-[11px] text-muted-foreground">
        <span><span className="text-orange-600 font-semibold">Dr</span> = amount owed to firm</span>
        <span><span className="text-green-600 font-semibold">Cr</span> = advance / overpaid</span>
        <span>Click any row to view ledger</span>
        <span><Mail size={10} className="inline" /> = send ledger to client email</span>
      </div>

      {/* ── Client Ledger Sheet ── */}
      <Sheet open={!!sheetClient} onOpenChange={open => { if (!open) setSheetClient(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
          <SheetHeader className="bg-[#1A2744] text-white px-6 py-4 flex-shrink-0">
            <SheetTitle className="text-white flex items-center justify-between">
              <div>
                <div className="text-base font-bold">{sheetClient?.name}</div>
                <div className="text-xs text-white/60 font-normal mt-0.5">
                  Ledger · {format(parseISO(fromDate), "d MMM yyyy")} to {format(parseISO(toDate), "d MMM yyyy")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 text-[#1A2744] text-xs gap-1 bg-white/90 hover:bg-white" onClick={handleDownloadClientPdf}>
                  <Download size={12} /> PDF
                </Button>
                {sheetClient?.email && (
                  <Button size="sm" variant="outline" className="h-8 text-[#1A2744] text-xs gap-1 bg-white/90 hover:bg-white" onClick={() => { setEmailClient(sheetClient); }}>
                    <Mail size={12} /> Email
                  </Button>
                )}
              </div>
            </SheetTitle>
          </SheetHeader>

          {/* Summary cards */}
          {sheetClient && (
            <div className="grid grid-cols-4 border-b bg-slate-50 flex-shrink-0">
              {[
                { label: "Opening", net: sheetClient.openingDr - sheetClient.openingCr },
                { label: "Debit", net: sheetClient.debit },
                { label: "Credit", net: -sheetClient.credit },
                { label: "Closing", net: (sheetClient.openingDr - sheetClient.openingCr) + sheetClient.debit - sheetClient.credit },
              ].map(card => {
                const { abs, label } = drCr(card.net);
                return (
                  <div key={card.label} className="px-4 py-3 border-r last:border-r-0 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{card.label}</div>
                    <div className={cn("font-semibold text-sm tabular-nums", label === "Cr" ? "text-green-700" : card.net === 0 ? "text-muted-foreground" : "text-orange-700")}>
                      {card.net === 0 ? "Nil" : `₹${fmtINR(abs)}`}
                    </div>
                    {card.net !== 0 && <div className={cn("text-[9px]", label === "Cr" ? "text-green-600" : "text-orange-600")}>{label}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Ledger table */}
          <div className="flex-1 overflow-auto">
            {sheetLoading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading ledger…
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground w-24">Date</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-24">Doc No</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Narration</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground w-28">Debit (₹)</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground w-28">Credit (₹)</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground w-28">Balance (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sheetEntries.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No transactions in this period</td></tr>
                  ) : (
                    sheetEntries.map((e, i) => {
                      const { abs: balAbs, label: balLbl } = drCr(e.balance);
                      return (
                        <tr key={i} className={cn(i % 2 === 0 ? "bg-white" : "bg-slate-50/50", "hover:bg-blue-50/30")}>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.entry_date ? format(parseISO(e.entry_date), "dd/MM/yy") : ""}</td>
                          <td className="px-2 py-2 font-mono text-muted-foreground">{e.doc_no}</td>
                          <td className="px-2 py-2 text-foreground">{e.narration}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.debit > 0 ? fmtINR(e.debit) : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.credit > 0 ? fmtINR(e.credit) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", balLbl === "Cr" ? "text-green-700" : e.balance === 0 ? "text-muted-foreground" : "text-orange-700")}>
                            {e.balance === 0 ? "Nil" : `${fmtINR(balAbs)} ${balLbl}`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Email Confirmation Dialog ── */}
      <Dialog open={!!emailClient} onOpenChange={open => { if (!open && !emailSending) setEmailClient(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Mail size={16} className="text-blue-600" /> Send Ledger Statement
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2 py-1">
            <p>Send ledger PDF to <span className="font-semibold text-foreground">{emailClient?.name}</span>?</p>
            <p className="text-xs">Recipient: <span className="font-mono">{emailClient?.email}</span></p>
            <p className="text-xs">Period: {format(parseISO(fromDate), "d MMM yyyy")} → {format(parseISO(toDate), "d MMM yyyy")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={emailSending} onClick={() => setEmailClient(null)}>Cancel</Button>
            <Button size="sm" disabled={emailSending} onClick={handleSendEmail} className="gap-1.5">
              {emailSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {emailSending ? "Sending…" : "Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
