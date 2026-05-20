import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { format } from "date-fns";
import { BookOpen, Download, Archive, Users, Building2, Share2, Mail, Phone, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { exportToPdf, exportToExcel } from "@/lib/exportUtils";
import { buildClientGstins } from "@/lib/gstinUtils";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { ensurePdfUnicodeFont, formatPdfCurrency, setPdfUnicodeFont } from "@/lib/jspdfUnicodeFont";
import { resolveFirmNameForDate, type LegalNameChange } from "@/lib/firmName";

const fmtINR = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getCurrentFY(): string {
  const now = new Date();
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${yr}-${String(yr + 1).slice(2)}`;
}

function getFYOptions(): string[] {
  const current = new Date().getFullYear();
  const fys: string[] = [];
  for (let y = current + 1; y >= current - 5; y--) {
    fys.push(`${y}-${String(y + 1).slice(2)}`);
  }
  return fys;
}

function fyToDateRange(fy: string): { start: string; end: string } {
  const [startYearStr] = fy.split("-");
  const startYear = parseInt(startYearStr, 10);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

interface LedgerEntry {
  id: string;
  entry_date: string;
  entry_type: string;
  document_id: string | null;
  debit_amount: number;
  credit_amount: number;
  narration: string;
  client_id: string;
  firm_id?: string;
}

async function buildLedgerEntries(
  filters: { clientIds: string[]; firmIds: string[]; fy?: string; from?: string; to?: string }
): Promise<LedgerEntry[]> {
  const { start, end } = (filters.from && filters.to)
    ? { start: filters.from, end: filters.to }
    : fyToDateRange(filters.fy || getCurrentFY());
  const entries: LedgerEntry[] = [];

  // 1. First try client_ledger_entries
  let leQuery = supabase.from("client_ledger_entries").select("*")
    .in("client_id", filters.clientIds)
    .gte("entry_date", start).lte("entry_date", end)
    .order("entry_date", { ascending: true });
  if (filters.firmIds.length > 0) leQuery = leQuery.in("firm_id", filters.firmIds);
  const { data: leData } = await leQuery;

  if (leData && leData.length > 0) {
    return leData.map(e => ({
      id: e.id,
      entry_date: e.entry_date,
      entry_type: e.entry_type,
      document_id: e.document_id,
      debit_amount: Number(e.debit_amount) || 0,
      credit_amount: Number(e.credit_amount) || 0,
      narration: e.narration || "",
      client_id: e.client_id,
      firm_id: e.firm_id || undefined,
    }));
  }

  // 2. Fallback: build from invoices + receipts directly
  let invQuery = supabase.from("invoices")
    .select("id, invoice_no, client_id, firm_id, invoice_date, total_amount, document_type, status, tds_section_code, tds_rate, tds_amount")
    .in("client_id", filters.clientIds)
    .in("status", ["finalized", "sent", "overdue", "paid"])
    .gte("invoice_date", start).lte("invoice_date", end)
    .order("invoice_date", { ascending: true });
  if (filters.firmIds.length > 0) invQuery = invQuery.in("firm_id", filters.firmIds);
  const { data: invoices } = await invQuery;

  (invoices || []).forEach(inv => {
    const isCredit = inv.document_type === "credit_note";
    entries.push({
      id: `inv-${inv.id}`,
      entry_date: inv.invoice_date,
      entry_type: isCredit ? "credit_note" : "invoice",
      document_id: inv.id,
      debit_amount: isCredit ? 0 : Number(inv.total_amount) || 0,
      credit_amount: isCredit ? Number(inv.total_amount) || 0 : 0,
      narration: isCredit ? `Credit note issued — ${inv.invoice_no}` : `Invoice raised — ${inv.invoice_no}`,
      client_id: inv.client_id || "",
      firm_id: inv.firm_id || undefined,
    });
    // TDS deductible entry — added once invoice TDS columns migration is applied
    if (!isCredit && (inv as any).tds_amount && Number((inv as any).tds_amount) > 0) {
      entries.push({
        id: `itds-${inv.id}`,
        entry_date: inv.invoice_date,
        entry_type: "adjustment",
        document_id: inv.id,
        debit_amount: 0,
        credit_amount: Number((inv as any).tds_amount),
        narration: `TDS deductible u/s ${(inv as any).tds_section_code || ""} @ ${(inv as any).tds_rate || ""}%`,
        client_id: inv.client_id || "",
      });
    }
  });

  let rcptQuery = supabase.from("billing_receipts")
    .select("id, client_id, firm_id, receipt_date, amount_received, payment_mode, tds_amount, gst_tds_amount")
    .in("client_id", filters.clientIds)
    .gte("receipt_date", start).lte("receipt_date", end)
    .order("receipt_date", { ascending: true });
  if (filters.firmIds.length > 0) rcptQuery = rcptQuery.in("firm_id", filters.firmIds);
  const { data: receipts } = await rcptQuery;

  (receipts || []).forEach(r => {
    entries.push({
      id: `rct-${r.id}`,
      entry_date: r.receipt_date,
      entry_type: "receipt",
      document_id: r.id,
      debit_amount: 0,
      credit_amount: Number(r.amount_received) || 0,
      narration: `Payment received — ${r.payment_mode}`,
      client_id: r.client_id,
      firm_id: r.firm_id || undefined,
    });
    if (Number(r.tds_amount) > 0) {
      entries.push({
        id: `tds-${r.id}`,
        entry_date: r.receipt_date,
        entry_type: "adjustment",
        document_id: r.id,
        debit_amount: 0,
        credit_amount: Number(r.tds_amount),
        narration: "TDS deducted",
        client_id: r.client_id,
      });
    }
    if (Number(r.gst_tds_amount) > 0) {
      entries.push({
        id: `gsttds-${r.id}`,
        entry_date: r.receipt_date,
        entry_type: "adjustment",
        document_id: r.id,
        debit_amount: 0,
        credit_amount: Number(r.gst_tds_amount),
        narration: "GST TDS deducted",
        client_id: r.client_id,
      });
    }
  });

  entries.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return entries;
}

async function loadLogoBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null as any);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ═══════════════════════════════════════
// CLIENT LEDGER VIEW
// ═══════════════════════════════════════
function ClientLedgerView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<{ id: string; name: string; email?: string | null; compliance_flags?: Record<string, any> | null; gstin_states?: Record<string, string> | null; gstin?: string[] | null }[]>([]);
  const [firms, setFirms] = useState<{ id: string; name: string; logo_url?: string; legal_name_changes?: LegalNameChange[] | null }[]>([]);
  const [clientId, setClientId] = useState("");
  const [firmId, setFirmId] = useState("");
  const [selectedGstin, setSelectedGstin] = useState<string>("all");
  const [obDraftGstin, setObDraftGstin] = useState<string>("all");
  const [fy, setFy] = useState(getCurrentFY());
  const [fromDate, setFromDate] = useState(() => fyToDateRange(getCurrentFY()).start);
  const [toDate, setToDate] = useState(() => fyToDateRange(getCurrentFY()).end);
  const [entries, setEntries] = useState<any[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // ── Email dialog state ────────────────────────────────────────────────
  const [emailOpen,    setEmailOpen]    = useState(false);
  const [emailTo,      setEmailTo]      = useState("");
  const [emailCCList,  setEmailCCList]  = useState<string[]>([]);
  const [emailCCInput, setEmailCCInput] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMsg,     setEmailMsg]     = useState("");
  const [emailSending, setEmailSending] = useState(false);

  // ── Opening balance state ─────────────────────────────────────────────
  const [obAmount, setObAmount] = useState<number>(0);
  const [obDate, setObDate] = useState<string>("");
  const [obNarration, setObNarration] = useState<string>("");
  const [obId, setObId] = useState<string | null>(null);
  const [obDialogOpen, setObDialogOpen] = useState(false);
  const [obDraftAmount, setObDraftAmount] = useState<string>("");
  const [obDraftDate, setObDraftDate] = useState<string>("");
  const [obDraftNarration, setObDraftNarration] = useState<string>("");
  const [obSaving, setObSaving] = useState(false);

  const selectedClientEmails = useMemo(() => {
    const c = clients.find(x => x.id === clientId);
    if (!c) return [];
    const arr: string[] = [];
    if (c.email) arr.push(c.email);
    const extra = Array.isArray((c.compliance_flags as any)?.extra_emails) ? (c.compliance_flags as any).extra_emails as string[] : [];
    extra.forEach(e => { if (e && !arr.includes(e)) arr.push(e); });
    return arr;
  }, [clients, clientId]);

  const clientGstins = useMemo(() => {
    const c = clients.find(x => x.id === clientId);
    return buildClientGstins(c?.gstin_states, c?.gstin);
  }, [clients, clientId]);

  useEffect(() => { setSelectedGstin("all"); }, [clientId]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: f }] = await Promise.all([
        supabase.from("clients").select("id, name, email, compliance_flags, gstin_states, gstin").eq("is_draft", false).is("deleted_at", null).order("name"),
        supabase.from("firms").select("id, name, logo_url, legal_name_changes").order("name"),
      ]);
      setClients(c || []);
      setFirms(f || []);
      if (user?.firm_id) setFirmId(user.firm_id);
    })();
  }, [user]);

  const loadEntries = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const entries = await buildLedgerEntries({ clientIds: [clientId], firmIds: firmId && firmId !== "all" ? [firmId] : [], from: fromDate, to: toDate });

      // Load invoice numbers for document_ids
      const docIds = entries.filter(e => e.document_id && (e.entry_type === "invoice" || e.entry_type === "credit_note")).map(e => e.document_id!);
      if (docIds.length > 0) {
        const { data: invs } = await supabase.from("invoices").select("id, invoice_no").in("id", docIds);
        const map: Record<string, string> = {};
        (invs || []).forEach(i => { if (i.invoice_no) map[i.id] = i.invoice_no; });
        setInvoiceMap(map);
      } else {
        setInvoiceMap({});
      }

      setEntries(entries);

      // Fetch opening balance
      if (clientId) {
        let obQ = (supabase as any)
          .from("client_billing_opening_balances")
          .select("*")
          .eq("client_id", clientId);
        if (firmId && firmId !== "all") obQ = obQ.eq("firm_id", firmId);
        if (selectedGstin && selectedGstin !== "all") obQ = obQ.eq("gstin", selectedGstin);
        else obQ = obQ.is("gstin", null);
        const { data: obData } = await obQ.maybeSingle();
        if (obData) {
          setObAmount(Number(obData.amount) || 0);
          setObDate(obData.balance_date || "");
          setObNarration(obData.narration || "");
          setObId(obData.id);
        } else {
          setObAmount(0); setObDate(""); setObNarration(""); setObId(null);
        }
      }
    } catch (err: any) {
      toast({ title: "Error loading ledger", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }, [clientId, firmId, selectedGstin, fromDate, toDate, toast]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const rows = useMemo(() => {
    let balance = obAmount;
    return entries.map(e => {
      const debit = Number(e.debit_amount) || 0;
      const credit = Number(e.credit_amount) || 0;
      balance += debit - credit;
      let docNo = "";
      if (e.entry_type === "invoice" || e.entry_type === "credit_note") {
        docNo = e.document_id ? (invoiceMap[e.document_id] || e.document_id.slice(0, 8)) : "";
      } else if (e.entry_type === "receipt") {
        docNo = e.document_id ? `RCT-${e.document_id.slice(0, 6)}` : "";
      }
      let narration = e.narration || "";
      if (!narration) {
        if (e.entry_type === "invoice") narration = "Invoice raised";
        else if (e.entry_type === "credit_note") narration = "Credit note issued";
        else if (e.entry_type === "receipt") narration = "Payment received";
        else if (e.entry_type === "adjustment") narration = "Adjustment";
      }
      const firmName = firms.find(f => f.id === e.firm_id)?.name || "";
      return { ...e, debit, credit, balance, docNo, narration, firmName };
    });
  }, [entries, invoiceMap, firms, obAmount]);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const closingBalance = obAmount + totalDebit - totalCredit;

  const clientName = clients.find(c => c.id === clientId)?.name || "";

  const handleSaveOpeningBalance = async () => {
    if (!clientId) return;
    const resolvedFirmId = firmId && firmId !== "all" ? firmId : user?.firm_id;
    if (!resolvedFirmId) { toast({ title: "Select a firm first", variant: "destructive" }); return; }
    if (!obDraftDate) { toast({ title: "Balance date is required", variant: "destructive" }); return; }
    setObSaving(true);
    try {
      const payload = {
        firm_id: resolvedFirmId,
        client_id: clientId,
        balance_date: obDraftDate,
        amount: Number(obDraftAmount) || 0,
        narration: obDraftNarration.trim() || null,
        gstin: obDraftGstin && obDraftGstin !== "all" ? obDraftGstin : null,
        created_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      if (obId) {
        await (supabase as any).from("client_billing_opening_balances").update(payload).eq("id", obId);
      } else {
        await (supabase as any).from("client_billing_opening_balances").insert(payload);
      }
      toast({ title: "Opening balance saved" });
      setObDialogOpen(false);
      loadEntries();
    } catch (err: any) {
      toast({ title: "Error saving opening balance", description: err.message, variant: "destructive" });
    }
    setObSaving(false);
  };

  const handleDownloadXlsx = () => {
    const cName = clients.find(c => c.id === clientId)?.name || "Client";
    const fName = firmId === "all" ? "All Firms" : (firms.find(f => f.id === firmId)?.name || "");
    const aoa: any[][] = [];
    aoa.push(["CLIENT LEDGER STATEMENT"]);
    aoa.push([`Client: ${cName}`]);
    aoa.push([`Firm: ${fName}`]);
    aoa.push([`Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}`]);
    aoa.push([`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`]);
    aoa.push([]);
    aoa.push(["Sr.", "Date", "Document No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]);
    // Opening balance row
    if (obDate) {
      aoa.push([
        "",
        format(new Date(obDate), "dd/MM/yyyy"),
        "—",
        `Opening Balance${obNarration ? ` — ${obNarration}` : ""}`,
        obAmount > 0 ? obAmount : "",
        obAmount < 0 ? Math.abs(obAmount) : "",
        obAmount,
      ]);
    }
    rows.forEach((r, i) => aoa.push([
      i + 1,
      r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
      r.docNo, r.narration,
      r.debit || "", r.credit || "", r.balance,
    ]));
    aoa.push([]);
    aoa.push(["", "CLOSING BALANCE", "", "", totalDebit, totalCredit, closingBalance]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 4 }, { wch: 12 }, { wch: 14 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 6 } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: 6 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Client Ledger");
    XLSX.writeFile(wb, `Ledger_${cName}_${fromDate}_${toDate}.xlsx`);
  };

  const handleDownloadPdf = async () => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const cName = clients.find(c => c.id === clientId)?.name || "Client";
    const isAllFirms = firmId === "all";
    const fName = isAllFirms ? "All Firms" : (firms.find(f => f.id === firmId)?.name || "");
    const selectedFirm = !isAllFirms ? firms.find(f => f.id === firmId) : null;
    const logoBase64 = selectedFirm?.logo_url ? await loadLogoBase64(selectedFirm.logo_url) : null;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 210, 22, "F");

    let textStartX = 14;
    if (logoBase64) {
      try {
        const imgFmt = logoBase64.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(logoBase64, imgFmt, 14, 2, 30, 18);
        textStartX = 48;
      } catch { /* ignore logo error */ }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    setPdfUnicodeFont(doc, "bold");
    doc.text("CLIENT LEDGER STATEMENT", textStartX, 9);
    doc.setFontSize(8);
    setPdfUnicodeFont(doc, "normal");
    doc.text(`Firm: ${fName}   |   Client: ${cName}`, textStartX, 15);
    doc.text(`Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}   |   Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, textStartX, 20);

    const head = isAllFirms
      ? [["Firm", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]]
      : [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]];

    const tableRows: any[][] = [];
    if (obDate) {
      const obBaseRow = [
        format(new Date(obDate), "dd/MM/yyyy"),
        "—",
        `Opening Balance${obNarration ? ` — ${obNarration}` : ""}`,
        obAmount > 0 ? formatPdfCurrency(obAmount) : "—",
        obAmount < 0 ? formatPdfCurrency(Math.abs(obAmount)) : "—",
        formatPdfCurrency(obAmount),
      ];
      tableRows.push(isAllFirms ? ["—", ...obBaseRow] : obBaseRow);
    }
    rows.forEach(r => {
      const baseRow = [
        r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
        r.docNo, r.narration,
        r.debit > 0 ? formatPdfCurrency(r.debit) : "—",
        r.credit > 0 ? formatPdfCurrency(r.credit) : "—",
        formatPdfCurrency(r.balance),
      ];
      tableRows.push(isAllFirms ? [r.firmName, ...baseRow] : baseRow);
    });

    const closingColSpan = isAllFirms ? 4 : 3;
    tableRows.push([
      { content: "CLOSING BALANCE", colSpan: closingColSpan, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: formatPdfCurrency(totalDebit), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(totalCredit), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(closingBalance), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);

    const colStylesNormal = {
      0: { cellWidth: 22, halign: "center" as const },
      1: { cellWidth: 22, halign: "center" as const },
      2: { cellWidth: 80 },
      3: { cellWidth: 24, halign: "right" as const },
      4: { cellWidth: 24, halign: "right" as const },
      5: { cellWidth: 24, halign: "right" as const },
    };
    const colStylesAllFirms = {
      0: { cellWidth: 28 },
      1: { cellWidth: 20, halign: "center" as const },
      2: { cellWidth: 18, halign: "center" as const },
      3: { cellWidth: 58 },
      4: { cellWidth: 22, halign: "right" as const },
      5: { cellWidth: 22, halign: "right" as const },
      6: { cellWidth: 22, halign: "right" as const },
    };

    autoTable(doc, {
      startY: 26,
      head,
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: isAllFirms ? colStylesAllFirms : colStylesNormal,
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        setPdfUnicodeFont(doc, "normal");
        doc.setFontSize(7); doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 105, 290, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.5);
        doc.line(10, 287, 200, 287);
      },
    });
    doc.save(`Ledger_${cName}_${fromDate}_${toDate}.pdf`);
  };

  // ── Build PDF as Blob (shared by email send) ──────────────────────────
  const buildClientLedgerPdfBlob = async (): Promise<{ blob: Blob; filename: string }> => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const cName = clients.find(c => c.id === clientId)?.name || "Client";
    const isAllFirms = firmId === "all";
    const fName = isAllFirms ? "All Firms" : (firms.find(f => f.id === firmId)?.name || "");
    const selectedFirm = !isAllFirms ? firms.find(f => f.id === firmId) : null;
    const logoBase64 = selectedFirm?.logo_url ? await loadLogoBase64(selectedFirm.logo_url) : null;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 210, 22, "F");

    let textStartX = 14;
    if (logoBase64) {
      try {
        const imgFmt = logoBase64.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(logoBase64, imgFmt, 14, 2, 30, 18);
        textStartX = 48;
      } catch { /* ignore logo error */ }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    setPdfUnicodeFont(doc, "bold");
    doc.text("CLIENT LEDGER STATEMENT", textStartX, 9);
    doc.setFontSize(8);
    setPdfUnicodeFont(doc, "normal");
    doc.text(`Firm: ${fName}   |   Client: ${cName}`, textStartX, 15);
    doc.text(`Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}   |   Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, textStartX, 20);

    const head = isAllFirms
      ? [["Firm", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]]
      : [["Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]];

    const tableRows: any[][] = [];
    if (obDate) {
      const obBaseRow = [
        format(new Date(obDate), "dd/MM/yyyy"),
        "—",
        `Opening Balance${obNarration ? ` — ${obNarration}` : ""}`,
        obAmount > 0 ? formatPdfCurrency(obAmount) : "—",
        obAmount < 0 ? formatPdfCurrency(Math.abs(obAmount)) : "—",
        formatPdfCurrency(obAmount),
      ];
      tableRows.push(isAllFirms ? ["—", ...obBaseRow] : obBaseRow);
    }
    rows.forEach(r => {
      const baseRow = [
        r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
        r.docNo, r.narration,
        r.debit > 0 ? formatPdfCurrency(r.debit) : "—",
        r.credit > 0 ? formatPdfCurrency(r.credit) : "—",
        formatPdfCurrency(r.balance),
      ];
      tableRows.push(isAllFirms ? [r.firmName, ...baseRow] : baseRow);
    });

    const closingColSpan = isAllFirms ? 4 : 3;
    tableRows.push([
      { content: "CLOSING BALANCE", colSpan: closingColSpan, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: formatPdfCurrency(totalDebit), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(totalCredit), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(closingBalance), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);

    const colStylesNormal = {
      0: { cellWidth: 22, halign: "center" as const },
      1: { cellWidth: 22, halign: "center" as const },
      2: { cellWidth: 80 },
      3: { cellWidth: 24, halign: "right" as const },
      4: { cellWidth: 24, halign: "right" as const },
      5: { cellWidth: 24, halign: "right" as const },
    };
    const colStylesAllFirms = {
      0: { cellWidth: 28 },
      1: { cellWidth: 20, halign: "center" as const },
      2: { cellWidth: 18, halign: "center" as const },
      3: { cellWidth: 58 },
      4: { cellWidth: 22, halign: "right" as const },
      5: { cellWidth: 22, halign: "right" as const },
      6: { cellWidth: 22, halign: "right" as const },
    };

    autoTable(doc, {
      startY: 26,
      head,
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: isAllFirms ? colStylesAllFirms : colStylesNormal,
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        setPdfUnicodeFont(doc, "normal");
        doc.setFontSize(7); doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 105, 290, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.5);
        doc.line(10, 287, 200, 287);
      },
    });

    const pdfBlob = doc.output("blob");
    const filename = `Ledger_${cName}_${fromDate}_${toDate}.pdf`;
    return { blob: pdfBlob, filename };
  };

  // ── Open email compose dialog ─────────────────────────────────────────
  const openEmailDialog = () => {
    const cName = clients.find(c => c.id === clientId)?.name || "Client";
    const allEmails = selectedClientEmails;
    setEmailTo(allEmails[0] || "");
    setEmailCCList(allEmails.slice(1));
    setEmailCCInput("");
    setEmailSubject(`Ledger Statement — ${cName} — ${fy}`);
    setEmailMsg(
      `Dear Sir/Madam,\n\nPlease find attached the Ledger Statement for ${cName} for the period ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}.\n\nKindly review and confirm the balances at your earliest convenience.\n\nRegards`
    );
    setEmailOpen(true);
  };

  // ── Send ledger by email ──────────────────────────────────────────────
  const handleEmailLedger = async () => {
    if (!emailTo.trim()) {
      toast({ title: "Please enter a recipient email address", variant: "destructive" });
      return;
    }
    setEmailSending(true);
    try {
      const { blob: pdfBlob, filename: pdfFilename } = await buildClientLedgerPdfBlob();
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const pdfBase64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const cName = clients.find(c => c.id === clientId)?.name || "Client";
      const safeClient = cName.replace(/[^a-zA-Z0-9]/g, "_");
      const allCC = [...emailCCList, ...(emailCCInput.trim() ? [emailCCInput.trim()] : [])].filter(e => e && e !== emailTo.trim());

      await supabase.functions.invoke("send-notification", {
        body: {
          type: "ledger_statement",
          firm_id: firmId !== "all" ? firmId : undefined,
          direct_email: emailTo.trim(),
          custom_cc: allCC,
          payload: {
            client_name: cName,
            custom_subject: emailSubject || `Ledger Statement — ${cName} — ${fy}`,
            custom_message: emailMsg,
            pdf_base64: pdfBase64,
            pdf_filename: pdfFilename || `Ledger_${safeClient}_${fromDate}_${toDate}.pdf`,
          },
        },
      });
      toast({ title: `Ledger emailed to ${emailTo.trim()}${allCC.length ? ` + ${allCC.length} CC` : ""}` });
      setEmailOpen(false);
    } catch (err: any) {
      console.error("[ClientLedgerEmail]", err);
      toast({ title: "Failed to send email", description: err.message, variant: "destructive" });
    }
    setEmailSending(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <SearchableSelect
          options={clients.map(c => ({ value: c.id, label: c.name }))}
          value={clientId}
          onValueChange={setClientId}
          placeholder="Select Client"
          searchPlaceholder="Search client..."
          className="w-[220px]"
        />
        <Select value={firmId} onValueChange={setFirmId}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select Firm" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Firms</SelectItem>
            {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {clientGstins.length > 1 && (
          <Select value={selectedGstin} onValueChange={setSelectedGstin}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All States" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {clientGstins.map(({ gstin, state }) => (
                <SelectItem key={gstin} value={gstin}>{state} — {gstin}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={fy} onValueChange={v => { setFy(v); const r = fyToDateRange(v); setFromDate(r.start); setToDate(r.end); }}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {getFYOptions().map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
        </div>
      </div>

      {/* Opening Balance Info Bar */}
      {clientId && (
        <div className="flex items-center gap-3 text-sm bg-muted/40 rounded-md px-3 py-2">
          <span className="text-muted-foreground font-medium">Opening Balance:</span>
          {obDate ? (
            <>
              <span className={`font-semibold tabular-nums ${obAmount >= 0 ? "text-orange-600" : "text-green-600"}`}>
                {obAmount >= 0 ? fmtINR(obAmount) + " Dr" : fmtINR(Math.abs(obAmount)) + " Cr"}
              </span>
              <span className="text-muted-foreground text-xs">as of {format(new Date(obDate), "dd/MM/yyyy")}</span>
              {obNarration && <span className="text-muted-foreground text-xs">· {obNarration}</span>}
            </>
          ) : (
            <span className="text-muted-foreground italic text-xs">Not set</span>
          )}
          <Button variant="outline" size="sm" className="h-6 text-xs px-2 ml-auto"
            onClick={() => {
              setObDraftAmount(String(obAmount || ""));
              setObDraftDate(obDate || "");
              setObDraftNarration(obNarration || "");
              setObDraftGstin(selectedGstin);
              setObDialogOpen(true);
            }}
          >
            {obId ? "Edit" : "Set"} Opening Balance
          </Button>
        </div>
      )}

      {!clientId ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <BookOpen size={36} className="mx-auto mb-2 opacity-40" />
          <p>Select a client to view their ledger</p>
        </CardContent></Card>
      ) : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div id="client-ledger-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Document No</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right">Debit (₹)</TableHead>
                  <TableHead className="text-right">Credit (₹)</TableHead>
                  <TableHead className="text-right">Balance (₹)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obDate && clientId && (
                  <TableRow className="bg-blue-50/50">
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(obDate), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">—</TableCell>
                    <TableCell className="text-xs text-muted-foreground italic">
                      Opening Balance{obNarration ? ` — ${obNarration}` : ""}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold">
                      {obAmount > 0 ? fmtINR(obAmount) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold">
                      {obAmount < 0 ? fmtINR(Math.abs(obAmount)) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold text-primary">
                      {fmtINR(obAmount)}
                    </TableCell>
                  </TableRow>
                )}
                {rows.length === 0 && !obDate ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No entries found</TableCell></TableRow>
                ) : rows.map((r, i) => (
                  <TableRow key={r.id || i}>
                    <TableCell>{r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : ""}</TableCell>
                    <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                    <TableCell>{r.narration}</TableCell>
                    <TableCell className="text-right">{r.debit > 0 ? fmtINR(r.debit) : "—"}</TableCell>
                    <TableCell className="text-right">{r.credit > 0 ? fmtINR(r.credit) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{fmtINR(r.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell colSpan={3}>Closing Balance</TableCell>
                    <TableCell className="text-right">{fmtINR(totalDebit)}</TableCell>
                    <TableCell className="text-right">{fmtINR(totalCredit)}</TableCell>
                    <TableCell className="text-right">{fmtINR(closingBalance)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
          {rows.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleDownloadXlsx} className="gap-1"><Download size={14} /> Export XLSX</Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"><Download size={14} /> Export PDF</Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => {
                const phone = prompt("Enter WhatsApp number (e.g. 9876543210):");
                if (phone) {
                  const cleanPhone = phone.replace(/\D/g, "");
                  const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
                  const msg = encodeURIComponent(`Dear Client,\n\nPlease find your ledger statement for FY ${fy}.\n\nRegards`);
                  window.open(`https://wa.me/${fullPhone}?text=${msg}`, "_blank");
                  // Also trigger PDF download
                  handleDownloadPdf();
                }
              }}>
                <Share2 size={14} /> Send via WhatsApp
              </Button>
              <Button
                size="sm"
                className="gap-1 bg-[#1A2744] hover:bg-[#243460] text-white"
                onClick={openEmailDialog}
              >
                <Mail size={14} /> Send via Email
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Email Ledger Dialog ──────────────────────────────────────────── */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={18} /> Email Ledger Statement
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* To field with chip selection */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">To <span className="text-destructive">*</span></Label>
              {selectedClientEmails.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedClientEmails.map(email => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setEmailTo(email)}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${emailTo === email ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary"}`}
                    >
                      {email}
                    </button>
                  ))}
                </div>
              )}
              <Input
                type="email"
                placeholder="Or type a custom To address..."
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
              />
            </div>
            {/* CC field with chip selection */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">CC <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              {selectedClientEmails.filter(e => e !== emailTo).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedClientEmails.filter(e => e !== emailTo).map(email => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setEmailCCList(prev => prev.includes(email) ? prev.filter(x => x !== email) : [...prev, email])}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${emailCCList.includes(email) ? "bg-blue-600 text-white border-blue-600" : "bg-muted text-muted-foreground border-border hover:border-blue-400"}`}
                    >
                      {email}
                    </button>
                  ))}
                </div>
              )}
              {emailCCList.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {emailCCList.map(email => (
                    <span key={email} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs">
                      {email}
                      <button type="button" onClick={() => setEmailCCList(prev => prev.filter(e => e !== email))}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                placeholder="Add CC address and press Enter..."
                value={emailCCInput}
                onChange={e => setEmailCCInput(e.target.value)}
                onKeyDown={e => {
                  if ((e.key === "Enter" || e.key === ",") && emailCCInput.trim()) {
                    e.preventDefault();
                    const email = emailCCInput.trim().replace(/,$/, "");
                    if (email && !emailCCList.includes(email)) setEmailCCList(prev => [...prev, email]);
                    setEmailCCInput("");
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cl-email-subject">Subject</Label>
              <Input
                id="cl-email-subject"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cl-email-msg">Message</Label>
              <Textarea
                id="cl-email-msg"
                rows={5}
                value={emailMsg}
                onChange={e => setEmailMsg(e.target.value)}
                className="text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Download size={12} /> PDF ledger will be auto-attached.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={emailSending}>
              Cancel
            </Button>
            <Button
              className="bg-[#1A2744] hover:bg-[#243460] text-white gap-1"
              onClick={handleEmailLedger}
              disabled={emailSending}
            >
              {emailSending
                ? <><span className="animate-spin mr-1">⏳</span> Sending…</>
                : <><Mail size={14} /> Send Email</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Opening Balance Dialog */}
      <Dialog open={obDialogOpen} onOpenChange={setObDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Opening Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {clientGstins.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">GSTIN / State</Label>
                <Select value={obDraftGstin} onValueChange={setObDraftGstin}>
                  <SelectTrigger className="text-xs h-8"><SelectValue placeholder="Select GSTIN" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States (combined)</SelectItem>
                    {clientGstins.map(({ gstin, state }) => (
                      <SelectItem key={gstin} value={gstin}>{state} — {gstin}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Balance As Of Date *</Label>
              <Input type="date" value={obDraftDate} onChange={e => setObDraftDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount (₹) — positive = Dr (client owes you), negative = Cr (advance paid)</Label>
              <Input type="number" value={obDraftAmount} onChange={e => setObDraftAmount(e.target.value)} placeholder="e.g. 50000 or -10000" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Narration (optional)</Label>
              <Input value={obDraftNarration} onChange={e => setObDraftNarration(e.target.value)} placeholder="e.g. Balance b/f from previous year" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setObDialogOpen(false)} disabled={obSaving}>Cancel</Button>
            <Button onClick={handleSaveOpeningBalance} disabled={obSaving}>
              {obSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════
// GROUP LEDGER VIEW
// ═══════════════════════════════════════
function GroupLedgerView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [firms, setFirms] = useState<{ id: string; name: string; logo_url?: string; legal_name_changes?: LegalNameChange[] | null }[]>([]);
  const [groupId, setGroupId] = useState("");
  const [firmIds, setFirmIds] = useState<string[]>([]);
  const [fy, setFy] = useState(getCurrentFY());
  const [fromDate, setFromDate] = useState(() => fyToDateRange(getCurrentFY()).start);
  const [toDate, setToDate] = useState(() => fyToDateRange(getCurrentFY()).end);
  const [data, setData] = useState<{ clientId: string; clientName: string; entries: any[] }[]>([]);
  const [groupObMap, setGroupObMap] = useState<Record<string, { amount: number; date: string; narration: string }>>({});
  const [invoiceMap, setInvoiceMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // ── Email dialog state ──────────────────────────────────────────────
  const [emailOpen, setEmailOpen]       = useState(false);
  const [emailTo, setEmailTo]           = useState("");
  const [emailCC, setEmailCC]           = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMsg, setEmailMsg]         = useState("");
  const [emailSending, setEmailSending] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: g }, { data: f }] = await Promise.all([
        supabase.from("client_groups").select("id, name").order("name"),
        supabase.from("firms").select("id, name, logo_url, legal_name_changes").order("name"),
      ]);
      setGroups(g || []);
      setFirms(f || []);
      if (user?.firm_id) setFirmIds([user.firm_id]);
    })();
  }, [user]);

  const loadData = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);

    // Resolve "all" or empty → pass [] to buildLedgerEntries (skips firm filter = all firms)
    let resolvedFirmIds: string[] = [];
    if (firmIds.length > 0 && firmIds[0] !== "all") {
      resolvedFirmIds = firmIds;
    }

    const { data: memberships } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupId);
    const clientIds = (memberships || []).map(m => m.client_id);
    if (clientIds.length === 0) { setData([]); setLoading(false); return; }

    const { data: clients } = await supabase.from("clients").select("id, name").in("id", clientIds);
    const clientMap: Record<string, string> = {};
    (clients || []).forEach(c => { clientMap[c.id] = c.name || "Unknown"; });

    const entries = await buildLedgerEntries({ clientIds, firmIds: resolvedFirmIds, from: fromDate, to: toDate });

    const docIds = entries.filter(e => e.document_id && (e.entry_type === "invoice" || e.entry_type === "credit_note")).map(e => e.document_id!);
    if (docIds.length > 0) {
      const { data: invs } = await supabase.from("invoices").select("id, invoice_no").in("id", docIds);
      const map: Record<string, string> = {};
      (invs || []).forEach(i => { if (i.invoice_no) map[i.id] = i.invoice_no; });
      setInvoiceMap(map);
    }

    const grouped: Record<string, any[]> = {};
    entries.forEach(e => {
      const cid = e.client_id;
      if (!grouped[cid]) grouped[cid] = [];
      grouped[cid].push(e);
    });

    // Fetch per-client opening balances
    const { data: obRows } = await (supabase as any)
      .from("client_billing_opening_balances")
      .select("client_id, amount, balance_date, narration")
      .in("client_id", clientIds);
    const newObMap: Record<string, { amount: number; date: string; narration: string }> = {};
    (obRows || []).forEach((ob: any) => {
      newObMap[ob.client_id] = { amount: Number(ob.amount) || 0, date: ob.balance_date || "", narration: ob.narration || "" };
    });
    setGroupObMap(newObMap);

    const result = clientIds
      .filter(cid => grouped[cid]?.length > 0)
      .map(cid => ({ clientId: cid, clientName: clientMap[cid] || "Unknown", entries: grouped[cid] }));
    setData(result);
    setLoading(false);
  }, [groupId, firmIds, fromDate, toDate, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const getDocNo = (e: any) => {
    if (e.entry_type === "invoice" || e.entry_type === "credit_note") return e.document_id ? (invoiceMap[e.document_id] || e.document_id.slice(0, 8)) : "";
    if (e.entry_type === "receipt") return e.document_id ? `RCT-${e.document_id.slice(0, 6)}` : "";
    return "";
  };

  // ── Shared PDF builder — used by both Download and Email ──────────
  const buildGroupLedgerPdfBlob = async (): Promise<Blob> => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const groupName = groups.find(g => g.id === groupId)?.name || "Group";
    const isAllFirms = firmIds[0] === "all" || firmIds.length === 0;
    const selectedFirmNames = isAllFirms
      ? "All Firms"
      : firms.filter(f => firmIds.includes(f.id)).map(f => f.name).join(", ");

    const singleFirm = !isAllFirms && firmIds.length === 1 ? firms.find(f => f.id === firmIds[0]) : null;
    const logoBase64 = singleFirm?.logo_url ? await loadLogoBase64(singleFirm.logo_url) : null;

    const firmNameMap: Record<string, string> = {};
    firms.forEach(f => { firmNameMap[f.id] = f.name; });

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const LIGHT_BLUE = [232, 240, 250] as [number, number, number];
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 22, "F");

    let textStartX = 14;
    if (logoBase64) {
      try {
        const imgFmt = logoBase64.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(logoBase64, imgFmt, 14, 2, 30, 18);
        textStartX = 48;
      } catch { /* ignore logo error */ }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    setPdfUnicodeFont(doc, "bold");
    doc.text("GROUP LEDGER STATEMENT", textStartX, 10);
    doc.setFontSize(9);
    setPdfUnicodeFont(doc, "normal");
    doc.text(`Group: ${groupName}   |   Firm(s): ${selectedFirmNames}   |   Period: ${format(new Date(fromDate), "dd/MM/yyyy")} – ${format(new Date(toDate), "dd/MM/yyyy")}`, textStartX, 17);
    doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 297 - 14, 17, { align: "right" });

    const tableHead = isAllFirms
      ? [["Firm", "Client", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]]
      : [["Client", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]];

    const subtotalColSpan = isAllFirms ? 5 : 4;
    const getDocNoLocal = (e: any) => {
      if (e.entry_type === "invoice" || e.entry_type === "credit_note") return e.document_id ? (invoiceMap[e.document_id] || e.document_id.slice(0, 8)) : "";
      if (e.entry_type === "receipt") return e.document_id ? `RCT-${e.document_id.slice(0, 6)}` : "";
      return "";
    };

    const tableRows: any[][] = [];
    data.forEach(({ clientId, clientName, entries }) => {
      const ob = groupObMap[clientId];
      let bal = ob?.amount || 0;
      // Opening balance row per client
      if (ob?.date) {
        const obBaseRow = [
          clientName,
          format(new Date(ob.date), "dd/MM/yyyy"),
          "—",
          `Opening Balance${ob.narration ? ` — ${ob.narration}` : ""}`,
          ob.amount > 0 ? formatPdfCurrency(ob.amount) : "—",
          ob.amount < 0 ? formatPdfCurrency(Math.abs(ob.amount)) : "—",
          formatPdfCurrency(ob.amount),
        ];
        tableRows.push(isAllFirms ? ["—", ...obBaseRow] : obBaseRow);
      }
      entries.forEach((e: any) => {
        const d = Number(e.debit_amount) || 0;
        const c = Number(e.credit_amount) || 0;
        bal += d - c;
        const rowBase = [
          clientName,
          e.entry_date ? format(new Date(e.entry_date), "dd/MM/yyyy") : "",
          getDocNoLocal(e),
          e.narration || "",
          d > 0 ? formatPdfCurrency(d) : "—",
          c > 0 ? formatPdfCurrency(c) : "—",
          formatPdfCurrency(bal),
        ];
        if (isAllFirms) tableRows.push([firmNameMap[e.firm_id || ""] || "", ...rowBase]);
        else tableRows.push(rowBase);
      });
      const subtotalD = entries.reduce((s: number, e: any) => s + (Number(e.debit_amount) || 0), 0);
      const subtotalC = entries.reduce((s: number, e: any) => s + (Number(e.credit_amount) || 0), 0);
      tableRows.push([
        { content: `Subtotal — ${clientName}`, colSpan: subtotalColSpan, styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE } },
        { content: formatPdfCurrency(subtotalD), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
        { content: formatPdfCurrency(subtotalC), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
        { content: formatPdfCurrency(subtotalD - subtotalC), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
      ]);
    });

    const grandD = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.debit_amount) || 0), 0), 0);
    const grandC = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.credit_amount) || 0), 0), 0);
    tableRows.push([
      { content: "GRAND TOTAL", colSpan: subtotalColSpan, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: formatPdfCurrency(grandD), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(grandC), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(grandD - grandC), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);

    const colStylesNormal = {
      0: { cellWidth: 40 }, 1: { cellWidth: 22, halign: "center" as const }, 2: { cellWidth: 22, halign: "center" as const },
      3: { cellWidth: 70 }, 4: { cellWidth: 28, halign: "right" as const }, 5: { cellWidth: 28, halign: "right" as const }, 6: { cellWidth: 30, halign: "right" as const },
    };
    const colStylesAllFirms = {
      0: { cellWidth: 30 }, 1: { cellWidth: 35 }, 2: { cellWidth: 20, halign: "center" as const }, 3: { cellWidth: 20, halign: "center" as const },
      4: { cellWidth: 60 }, 5: { cellWidth: 27, halign: "right" as const }, 6: { cellWidth: 27, halign: "right" as const }, 7: { cellWidth: 28, halign: "right" as const },
    };

    autoTable(doc, {
      startY: 26,
      head: tableHead,
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: isAllFirms ? colStylesAllFirms : colStylesNormal,
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        setPdfUnicodeFont(doc, "normal");
        doc.setFontSize(7);
        doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 148.5, 205, { align: "center" });
        doc.setDrawColor(...DARK_BLUE);
        doc.setLineWidth(0.5);
        doc.line(10, 202, 287, 202);
      },
    });

    return doc.output("blob");
  };

  // ── Open email dialog — pre-fill subject ────────────────────────────
  const openEmailDialog = () => {
    const groupName = groups.find(g => g.id === groupId)?.name || "Group";
    // Pick firm active in this ledger view; resolve the name in force at the ledger period end.
    const activeFirmId = (firmIds.length > 0 && firmIds[0] !== "all") ? firmIds[0] : (firms[0]?.id ?? "");
    const activeFirm   = firms.find(f => f.id === activeFirmId) ?? firms[0] ?? null;
    const signatureName = resolveFirmNameForDate(activeFirm as any, toDate) || activeFirm?.name || "";
    setEmailSubject(`Group Ledger Statement — ${groupName}`);
    setEmailMsg(`Dear Sir/Madam,\n\nPlease find attached the Group Ledger Statement for ${groupName} for the period ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}.\n\nKindly confirm the balances at your earliest.\n\nRegards,\n${signatureName}`);
    setEmailTo("");
    setEmailCC("");
    setEmailOpen(true);
  };

  // ── Send group ledger by email ──────────────────────────────────────
  const handleEmailLedger = async () => {
    if (!emailTo.trim()) {
      toast({ title: "Please enter a recipient email address", variant: "destructive" });
      return;
    }
    setEmailSending(true);
    try {
      toast({ title: "Generating PDF…" });
      const pdfBlob = await buildGroupLedgerPdfBlob();

      // Convert Blob → base64 string
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      const groupName = groups.find(g => g.id === groupId)?.name || "Group";
      const firmId = (firmIds.length > 0 && firmIds[0] !== "all") ? firmIds[0] : (firms[0]?.id ?? "");
      const safeGroup = groupName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);

      const toAddresses = emailTo.split(",").map(e => e.trim()).filter(Boolean);
      const ccAddresses = emailCC.split(",").map(e => e.trim()).filter(Boolean);

      // Send to each To address (CC is included in the message text for now)
      for (const addr of toAddresses) {
        await supabase.functions.invoke("send-notification", {
          body: {
            type: "ledger_statement",
            firm_id: firmId,
            direct_email: addr,
            payload: {
              client_name: groupName,
              custom_subject: emailSubject || `Group Ledger Statement — ${groupName}`,
              custom_message: emailMsg,
              pdf_base64: pdfBase64,
              pdf_filename: `GroupLedger_${safeGroup}_${fromDate}_${toDate}.pdf`,
              ...(ccAddresses.length > 0 ? { cc_note: `CC: ${ccAddresses.join(", ")}` } : {}),
            },
          },
        });
      }

      toast({ title: `Ledger emailed to ${toAddresses.join(", ")}` });
      setEmailOpen(false);
    } catch (err: any) {
      console.error("[GroupLedgerEmail]", err);
      toast({ title: "Failed to send email", description: err.message, variant: "destructive" });
    }
    setEmailSending(false);
  };

  const handleDownloadXlsx = () => {
    const groupName = groups.find(g => g.id === groupId)?.name || "Group";
    const selectedFirmNames = firmIds[0] === "all"
      ? "All Firms"
      : firms.filter(f => firmIds.includes(f.id)).map(f => f.name).join(", ");

    // Build AOA (array-of-arrays) for professional formatting
    const aoa: any[][] = [];
    // Title block
    aoa.push(["GROUP LEDGER STATEMENT"]);
    aoa.push([`Group: ${groupName}`]);
    aoa.push([`Firm(s): ${selectedFirmNames}`]);
    aoa.push([`Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}`]);
    aoa.push([`Generated on: ${format(new Date(), "dd/MM/yyyy HH:mm")}`]);
    aoa.push([]); // blank row

    // Column headers
    aoa.push(["Sr.", "Client", "Date", "Document No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]);

    let srNo = 1;
    data.forEach(({ clientId, clientName, entries }) => {
      const ob = groupObMap[clientId];
      let bal = ob?.amount || 0;
      // Opening balance row per client
      if (ob?.date) {
        aoa.push([
          "", clientName,
          format(new Date(ob.date), "dd/MM/yyyy"),
          "—",
          `Opening Balance${ob.narration ? ` — ${ob.narration}` : ""}`,
          ob.amount > 0 ? ob.amount : "",
          ob.amount < 0 ? Math.abs(ob.amount) : "",
          ob.amount,
        ]);
      }
      entries.forEach(e => {
        const d = Number(e.debit_amount) || 0;
        const c = Number(e.credit_amount) || 0;
        bal += d - c;
        aoa.push([
          srNo++,
          clientName,
          e.entry_date ? format(new Date(e.entry_date), "dd/MM/yyyy") : "",
          getDocNo(e),
          e.narration || "",
          d || "",
          c || "",
          bal,
        ]);
      });
      // Subtotal row
      const subtotalD = entries.reduce((s: number, e: any) => s + (Number(e.debit_amount) || 0), 0);
      const subtotalC = entries.reduce((s: number, e: any) => s + (Number(e.credit_amount) || 0), 0);
      aoa.push(["", `Subtotal — ${clientName}`, "", "", "", subtotalD, subtotalC, subtotalD - subtotalC]);
      aoa.push([]); // blank row between clients
    });

    // Grand total
    const grandD = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.debit_amount) || 0), 0), 0);
    const grandC = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.credit_amount) || 0), 0), 0);
    aoa.push(["", "GRAND TOTAL", "", "", "", grandD, grandC, grandD - grandC]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column widths
    ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

    // Merge title cells A1:H1 through A5:H5
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: 7 } },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Group Ledger");
    XLSX.writeFile(wb, `GroupLedger_${groupName}_${fromDate}_${toDate}.xlsx`);
  };

  const handleDownloadPdf = async () => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const groupName = groups.find(g => g.id === groupId)?.name || "Group";
    const isAllFirms = firmIds[0] === "all" || firmIds.length === 0;
    const selectedFirmNames = isAllFirms
      ? "All Firms"
      : firms.filter(f => firmIds.includes(f.id)).map(f => f.name).join(", ");

    // Load logo for single-firm selection
    const singleFirm = !isAllFirms && firmIds.length === 1 ? firms.find(f => f.id === firmIds[0]) : null;
    const logoBase64 = singleFirm?.logo_url ? await loadLogoBase64(singleFirm.logo_url) : null;

    // Build firm name lookup map
    const firmNameMap: Record<string, string> = {};
    firms.forEach(f => { firmNameMap[f.id] = f.name; });

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const LIGHT_BLUE = [232, 240, 250] as [number, number, number];
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 22, "F");

    let textStartX = 14;
    if (logoBase64) {
      try {
        const imgFmt = logoBase64.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(logoBase64, imgFmt, 14, 2, 30, 18);
        textStartX = 48;
      } catch { /* ignore logo error */ }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    setPdfUnicodeFont(doc, "bold");
    doc.text("GROUP LEDGER STATEMENT", textStartX, 10);
    doc.setFontSize(9);
    setPdfUnicodeFont(doc, "normal");
    doc.text(`Group: ${groupName}   |   Firm(s): ${selectedFirmNames}   |   Period: ${format(new Date(fromDate), "dd/MM/yyyy")} – ${format(new Date(toDate), "dd/MM/yyyy")}`, textStartX, 17);
    doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 297 - 14, 17, { align: "right" });

    // Table header — add Firm column when all firms
    const tableHead = isAllFirms
      ? [["Firm", "Client", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]]
      : [["Client", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]];

    const subtotalColSpan = isAllFirms ? 5 : 4;

    const tableRows: any[][] = [];
    data.forEach(({ clientName, entries }) => {
      let bal = 0;
      entries.forEach((e: any) => {
        const d = Number(e.debit_amount) || 0;
        const c = Number(e.credit_amount) || 0;
        bal += d - c;
        const rowBase = [
          clientName,
          e.entry_date ? format(new Date(e.entry_date), "dd/MM/yyyy") : "",
          getDocNo(e),
          e.narration || "",
          d > 0 ? formatPdfCurrency(d) : "—",
          c > 0 ? formatPdfCurrency(c) : "—",
          formatPdfCurrency(bal),
        ];
        if (isAllFirms) {
          tableRows.push([firmNameMap[e.firm_id || ""] || "", ...rowBase]);
        } else {
          tableRows.push(rowBase);
        }
      });
      const subtotalD = entries.reduce((s: number, e: any) => s + (Number(e.debit_amount) || 0), 0);
      const subtotalC = entries.reduce((s: number, e: any) => s + (Number(e.credit_amount) || 0), 0);
      tableRows.push([
        { content: `Subtotal — ${clientName}`, colSpan: subtotalColSpan, styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE } },
        { content: formatPdfCurrency(subtotalD), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
        { content: formatPdfCurrency(subtotalC), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
        { content: formatPdfCurrency(subtotalD - subtotalC), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
      ]);
    });

    const grandD = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.debit_amount) || 0), 0), 0);
    const grandC = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.credit_amount) || 0), 0), 0);
    tableRows.push([
      { content: "GRAND TOTAL", colSpan: subtotalColSpan, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: formatPdfCurrency(grandD), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(grandC), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(grandD - grandC), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);

    const colStylesNormal = {
      0: { cellWidth: 40 },
      1: { cellWidth: 22, halign: "center" as const },
      2: { cellWidth: 22, halign: "center" as const },
      3: { cellWidth: 70 },
      4: { cellWidth: 28, halign: "right" as const },
      5: { cellWidth: 28, halign: "right" as const },
      6: { cellWidth: 30, halign: "right" as const },
    };
    const colStylesAllFirms = {
      0: { cellWidth: 30 },
      1: { cellWidth: 35 },
      2: { cellWidth: 20, halign: "center" as const },
      3: { cellWidth: 20, halign: "center" as const },
      4: { cellWidth: 60 },
      5: { cellWidth: 27, halign: "right" as const },
      6: { cellWidth: 27, halign: "right" as const },
      7: { cellWidth: 28, halign: "right" as const },
    };

    autoTable(doc, {
      startY: 26,
      head: tableHead,
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: isAllFirms ? colStylesAllFirms : colStylesNormal,
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        setPdfUnicodeFont(doc, "normal");
        doc.setFontSize(7);
        doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 148.5, 205, { align: "center" });
        doc.setDrawColor(...DARK_BLUE);
        doc.setLineWidth(0.5);
        doc.line(10, 202, 287, 202);
      },
    });

    doc.save(`GroupLedger_${groupName}_${fromDate}_${toDate}.pdf`);
  };

  const handleDownloadZip = async () => {
    if (!groupId) return;
    toast({ title: "Generating ZIP..." });
    const { data: memberships } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupId);
    const clientIds = (memberships || []).map(m => m.client_id);
    if (clientIds.length === 0) return;

    const resolvedFirmIds = (firmIds.length === 0 || firmIds[0] === "all") ? [] : firmIds;
    let zipInvQuery = supabase.from("invoices").select("id, invoice_no, client_id")
      .in("client_id", clientIds).eq("financial_year", fy);
    if (resolvedFirmIds.length > 0) zipInvQuery = zipInvQuery.in("firm_id", resolvedFirmIds);
    const { data: invoices } = await zipInvQuery;
    if (!invoices?.length) { toast({ title: "No invoices found" }); return; }

    const { data: clients } = await supabase.from("clients").select("id, name").in("id", clientIds);
    const cMap: Record<string, string> = {};
    (clients || []).forEach(c => { cMap[c.id] = c.name || "Unknown"; });

    const zip = new JSZip();
    // For simplicity, add a text manifest - full PDF generation would require HTML rendering
    invoices.forEach(inv => {
      const fileName = `${(inv.invoice_no || inv.id.slice(0, 8)).replace(/\//g, "-")}_${(cMap[inv.client_id!] || "client").replace(/\s/g, "_")}.txt`;
      zip.file(fileName, `Invoice: ${inv.invoice_no}\nClient: ${cMap[inv.client_id!]}\nID: ${inv.id}`);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `Invoices_Group_${fy}.zip`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: `ZIP with ${invoices.length} invoices downloaded` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <SearchableSelect
          options={groups.map(g => ({ value: g.id, label: g.name }))}
          value={groupId}
          onValueChange={setGroupId}
          placeholder="Select Group"
          searchPlaceholder="Search group..."
          className="w-[220px]"
        />
        <Select
          value={firmIds[0] === "all" ? "all" : (firmIds[0] || "")}
          onValueChange={v => {
            if (v === "all") setFirmIds(["all"]);
            else setFirmIds([v]);
          }}
        >
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Firm" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Firms</SelectItem>
            {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fy} onValueChange={v => { setFy(v); const r = fyToDateRange(v); setFromDate(r.start); setToDate(r.end); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {getFYOptions().map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
        </div>
      </div>

      {!groupId ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Users size={36} className="mx-auto mb-2 opacity-40" />
          <p>Select a client group to view combined ledger</p>
        </CardContent></Card>
      ) : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : data.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No entries found for this group</CardContent></Card>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Document No</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Debit (₹)</TableHead>
                <TableHead className="text-right">Credit (₹)</TableHead>
                <TableHead className="text-right">Balance (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(({ clientId, clientName, entries }, gi) => {
                const ob = groupObMap[clientId];
                let bal = ob?.amount || 0;
                const clientRows = entries.map((e: any, ei: number) => {
                  const d = Number(e.debit_amount) || 0;
                  const c = Number(e.credit_amount) || 0;
                  bal += d - c;
                  return (
                    <TableRow key={`${gi}-${ei}`}>
                      {ei === 0 && <TableCell rowSpan={entries.length + (ob?.date ? 2 : 1)} className="font-medium align-top border-r">{clientName}</TableCell>}
                      <TableCell>{e.entry_date ? format(new Date(e.entry_date), "dd/MM/yyyy") : ""}</TableCell>
                      <TableCell className="font-mono text-xs">{getDocNo(e)}</TableCell>
                      <TableCell>{e.narration || ""}</TableCell>
                      <TableCell className="text-right">{d > 0 ? fmtINR(d) : "—"}</TableCell>
                      <TableCell className="text-right">{c > 0 ? fmtINR(c) : "—"}</TableCell>
                      <TableCell className="text-right font-medium">{fmtINR(bal)}</TableCell>
                    </TableRow>
                  );
                });
                const subtotalD = entries.reduce((s: number, e: any) => s + (Number(e.debit_amount) || 0), 0);
                const subtotalC = entries.reduce((s: number, e: any) => s + (Number(e.credit_amount) || 0), 0);
                const obRow = ob?.date ? (
                  <TableRow key={`ob-${gi}`} className="bg-blue-50/50 italic text-muted-foreground">
                    <TableCell>{format(new Date(ob.date), "dd/MM/yyyy")}</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>{`Opening Balance${ob.narration ? ` — ${ob.narration}` : ""}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{ob.amount > 0 ? fmtINR(ob.amount) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{ob.amount < 0 ? fmtINR(Math.abs(ob.amount)) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtINR(ob.amount)}</TableCell>
                  </TableRow>
                ) : null;
                return [
                  ...(obRow ? [obRow] : []),
                  ...clientRows,
                  <TableRow key={`sub-${gi}`} className="bg-muted/30 font-semibold">
                    <TableCell colSpan={4} className="text-right">Subtotal — {clientName}</TableCell>
                    <TableCell className="text-right">{fmtINR(subtotalD)}</TableCell>
                    <TableCell className="text-right">{fmtINR(subtotalC)}</TableCell>
                    <TableCell className="text-right">{fmtINR(subtotalD - subtotalC)}</TableCell>
                  </TableRow>,
                ];
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={4}>Grand Total</TableCell>
                <TableCell className="text-right">{fmtINR(data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.debit_amount) || 0), 0), 0))}</TableCell>
                <TableCell className="text-right">{fmtINR(data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.credit_amount) || 0), 0), 0))}</TableCell>
                <TableCell className="text-right">{fmtINR(
                  data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0), 0), 0)
                )}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleDownloadXlsx} className="gap-1"><Download size={14} /> Export XLSX</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"><Download size={14} /> Export PDF</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadZip} className="gap-1"><Archive size={14} /> Download All Invoices (ZIP)</Button>
            <Button variant="outline" size="sm" onClick={openEmailDialog} className="gap-1"><Mail size={14} /> Email Ledger</Button>
          </div>

          {/* ── Email Ledger Dialog ─────────────────────────────────────── */}
          <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Mail size={18} /> Email Group Ledger</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1">
                  <Label htmlFor="gl-email-to">To <span className="text-destructive">*</span></Label>
                  <Input
                    id="gl-email-to"
                    type="text"
                    placeholder="email@example.com, another@example.com"
                    value={emailTo}
                    onChange={e => setEmailTo(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Separate multiple addresses with commas</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gl-email-cc">CC <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="gl-email-cc"
                    type="text"
                    placeholder="cc@example.com"
                    value={emailCC}
                    onChange={e => setEmailCC(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gl-email-subject">Subject</Label>
                  <Input
                    id="gl-email-subject"
                    type="text"
                    value={emailSubject}
                    onChange={e => setEmailSubject(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gl-email-msg">Message</Label>
                  <Textarea
                    id="gl-email-msg"
                    rows={5}
                    value={emailMsg}
                    onChange={e => setEmailMsg(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  📎 The Group Ledger PDF will be attached automatically.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={emailSending}>Cancel</Button>
                <Button onClick={handleEmailLedger} disabled={emailSending || !emailTo.trim()} className="gap-1">
                  {emailSending ? "Sending…" : <><Mail size={14} /> Send Email</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// FIRM REVENUE LEDGER VIEW
// ═══════════════════════════════════════
function FirmRevenueLedgerView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [firms, setFirms] = useState<{ id: string; name: string; logo_url?: string; legal_name_changes?: LegalNameChange[] | null }[]>([]);
  const [firmId, setFirmId] = useState("");
  const [fy, setFy] = useState(getCurrentFY());
  const [fromDate, setFromDate] = useState(() => fyToDateRange(getCurrentFY()).start);
  const [toDate, setToDate] = useState(() => fyToDateRange(getCurrentFY()).end);
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [entries, setEntries] = useState<any[]>([]);
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [invoiceMap, setInvoiceMap] = useState<Record<string, { no: string; type: string }>>({});
  const [loading, setLoading] = useState(false);

  // ── Email dialog state ──────────────────────────────────────────────
  const [emailOpen, setEmailOpen]       = useState(false);
  const [emailTo, setEmailTo]           = useState("");
  const [emailCC, setEmailCC]           = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMsg, setEmailMsg]         = useState("");
  const [emailSending, setEmailSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: f } = await supabase.from("firms").select("id, name, logo_url, legal_name_changes").order("name");
      setFirms(f || []);
      if (user?.firm_id) setFirmId(user.firm_id);
    })();
  }, [user]);

  const loadData = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);

    // Query client_ledger_entries directly by firm_id — avoids huge IN(allClientIds) that can miss NULL firm_id rows
    const { data: leData } = await supabase.from("client_ledger_entries")
      .select("*")
      .eq("firm_id", firmId)
      .gte("entry_date", fromDate).lte("entry_date", toDate)
      .order("entry_date", { ascending: true });

    let allEntries: LedgerEntry[] = [];

    if (leData && leData.length > 0) {
      allEntries = leData.map(e => ({
        id: e.id,
        entry_date: e.entry_date,
        entry_type: e.entry_type,
        document_id: e.document_id,
        debit_amount: Number(e.debit_amount) || 0,
        credit_amount: Number(e.credit_amount) || 0,
        narration: e.narration || "",
        client_id: e.client_id,
        firm_id: e.firm_id || undefined,
      }));
    } else {
      // Fallback: query invoices + receipts directly by firm_id
      const { data: invoices } = await supabase.from("invoices")
        .select("id, invoice_no, client_id, firm_id, invoice_date, total_amount, document_type, status, tds_section_code, tds_rate, tds_amount")
        .eq("firm_id", firmId)
        .in("status", ["finalized", "sent", "overdue", "paid"])
        .gte("invoice_date", fromDate).lte("invoice_date", toDate)
        .order("invoice_date", { ascending: true });

      (invoices || []).forEach(inv => {
        const isCredit = inv.document_type === "credit_note";
        allEntries.push({
          id: `inv-${inv.id}`,
          entry_date: inv.invoice_date,
          entry_type: isCredit ? "credit_note" : "invoice",
          document_id: inv.id,
          debit_amount: isCredit ? 0 : Number(inv.total_amount) || 0,
          credit_amount: isCredit ? Number(inv.total_amount) || 0 : 0,
          narration: isCredit ? `Credit note issued — ${inv.invoice_no}` : `Invoice raised — ${inv.invoice_no}`,
          client_id: inv.client_id || "",
          firm_id: inv.firm_id || undefined,
        });
      });

      const { data: receipts } = await supabase.from("billing_receipts")
        .select("id, client_id, firm_id, receipt_date, amount_received, payment_mode, tds_amount, gst_tds_amount")
        .eq("firm_id", firmId)
        .gte("receipt_date", fromDate).lte("receipt_date", toDate)
        .order("receipt_date", { ascending: true });

      (receipts || []).forEach(r => {
        allEntries.push({
          id: `rct-${r.id}`,
          entry_date: r.receipt_date,
          entry_type: "receipt",
          document_id: r.id,
          debit_amount: 0,
          credit_amount: Number(r.amount_received) || 0,
          narration: `Payment received — ${r.payment_mode}`,
          client_id: r.client_id,
          firm_id: r.firm_id || undefined,
        });
      });

      allEntries.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    }

    // Apply docType filter
    if (docTypeFilter === "invoice") allEntries = allEntries.filter(e => e.entry_type === "invoice");
    else if (docTypeFilter === "credit_note") allEntries = allEntries.filter(e => e.entry_type === "credit_note");

    setEntries(allEntries);

    // Fetch client names from unique client_ids in results
    const clientIds = [...new Set(allEntries.map(e => e.client_id).filter(Boolean))];
    if (clientIds.length > 0) {
      const { data: clients } = await supabase.from("clients").select("id, name").in("id", clientIds);
      const cm: Record<string, string> = {};
      (clients || []).forEach(c => { cm[c.id] = c.name || "Unknown"; });
      setClientMap(cm);
    } else {
      setClientMap({});
    }

    const docIds = allEntries.filter(e => e.document_id && (e.entry_type === "invoice" || e.entry_type === "credit_note")).map(e => e.document_id!);
    if (docIds.length > 0) {
      const { data: invs } = await supabase.from("invoices").select("id, invoice_no, document_type").in("id", docIds);
      const im: Record<string, { no: string; type: string }> = {};
      (invs || []).forEach(i => { im[i.id] = { no: i.invoice_no || "", type: i.document_type || "" }; });
      setInvoiceMap(im);
    } else {
      setInvoiceMap({});
    }
    setLoading(false);
  }, [firmId, fromDate, toDate, docTypeFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const rows = useMemo(() => {
    let running = 0;
    return entries.map(e => {
      const d = Number(e.debit_amount) || 0;
      const c = Number(e.credit_amount) || 0;
      running += d - c;
      const inv = e.document_id ? invoiceMap[e.document_id] : null;
      return { ...e, debit: d, credit: c, running, docNo: inv?.no || (e.entry_type === "receipt" && e.document_id ? `RCT-${e.document_id.slice(0, 6)}` : ""), docType: inv?.type || e.entry_type, clientName: clientMap[e.client_id] || "" };
    });
  }, [entries, invoiceMap, clientMap]);

  const totalInvoiced = rows.filter(r => r.entry_type === "invoice").reduce((s, r) => s + r.debit, 0);
  const totalCN = rows.filter(r => r.entry_type === "credit_note").reduce((s, r) => s + r.credit, 0);
  const totalReceived = rows.filter(r => r.entry_type === "receipt").reduce((s, r) => s + r.credit, 0);
  const netOutstanding = totalInvoiced - totalCN - totalReceived;

  // ── Build PDF blob for email ───────────────────────────────────────
  const buildFirmLedgerPdfBlob = async (): Promise<Blob> => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const fName = firms.find(f => f.id === firmId)?.name || "Firm";
    const selectedFirm = firms.find(f => f.id === firmId);
    const logoBase64 = selectedFirm?.logo_url ? await loadLogoBase64(selectedFirm.logo_url) : null;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 22, "F");
    let textStartX = 14;
    if (logoBase64) {
      try { doc.addImage(logoBase64, logoBase64.includes("image/png") ? "PNG" : "JPEG", 14, 2, 30, 18); textStartX = 48; } catch { /* ignore */ }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13); setPdfUnicodeFont(doc, "bold");
    doc.text("FIRM REVENUE LEDGER", textStartX, 10);
    doc.setFontSize(8); setPdfUnicodeFont(doc, "normal");
    doc.text(`Firm: ${fName}   |   Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}`, textStartX, 17);
    doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 297 - 14, 17, { align: "right" });
    const totalD = rows.reduce((s, r) => s + r.debit, 0);
    const totalC = rows.reduce((s, r) => s + r.credit, 0);
    const tableRows: any[][] = [
      [format(new Date(fromDate), "dd/MM/yyyy"), "—", "—", "Opening Balance (Balance B/F)", "—", "—", formatPdfCurrency(0)],
      ...rows.map(r => [
        r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
        r.docNo, r.clientName, r.docType,
        r.debit > 0 ? formatPdfCurrency(r.debit) : "—",
        r.credit > 0 ? formatPdfCurrency(r.credit) : "—",
        formatPdfCurrency(r.running),
      ]),
    ];
    tableRows.push([
      { content: "GRAND TOTAL", colSpan: 4, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: formatPdfCurrency(totalD), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(totalC), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(rows[rows.length - 1]?.running || 0), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);
    autoTable(doc, {
      startY: 26,
      head: [["Date", "Doc No", "Client", "Type", "Debit (₹)", "Credit (₹)", "Running Total (₹)"]],
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" as const }, 1: { cellWidth: 22, halign: "center" as const },
        2: { cellWidth: 55 }, 3: { cellWidth: 25 },
        4: { cellWidth: 30, halign: "right" as const }, 5: { cellWidth: 30, halign: "right" as const }, 6: { cellWidth: 32, halign: "right" as const },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        setPdfUnicodeFont(doc, "normal"); doc.setFontSize(7); doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 148.5, 205, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.5); doc.line(10, 202, 287, 202);
      },
    });
    return doc.output("blob");
  };

  const openFirmEmailDialog = () => {
    const fName = firms.find(f => f.id === firmId)?.name || "Firm";
    const activeFirm = firms.find(f => f.id === firmId) ?? null;
    const signatureName = resolveFirmNameForDate(activeFirm as any, toDate) || activeFirm?.name || "";
    setEmailSubject(`Firm Revenue Ledger — ${fName}`);
    setEmailMsg(`Dear Sir/Madam,\n\nPlease find attached the Firm Revenue Ledger for ${fName} for the period ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}.\n\nRegards,\n${signatureName}`);
    setEmailTo("");
    setEmailCC("");
    setEmailOpen(true);
  };

  const handleFirmEmailLedger = async () => {
    if (!emailTo.trim()) {
      toast({ title: "Please enter a recipient email address", variant: "destructive" });
      return;
    }
    setEmailSending(true);
    try {
      toast({ title: "Generating PDF…" });
      const pdfBlob = await buildFirmLedgerPdfBlob();
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });
      const fName = firms.find(f => f.id === firmId)?.name || "Firm";
      const safeName = fName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
      const toAddresses = emailTo.split(",").map(e => e.trim()).filter(Boolean);
      const ccAddresses = emailCC.split(",").map(e => e.trim()).filter(Boolean);
      for (const addr of toAddresses) {
        await supabase.functions.invoke("send-notification", {
          body: {
            type: "ledger_statement",
            firm_id: firmId,
            direct_email: addr,
            payload: {
              client_name: fName,
              custom_subject: emailSubject || `Firm Revenue Ledger — ${fName}`,
              custom_message: emailMsg,
              pdf_base64: pdfBase64,
              pdf_filename: `FirmRevenue_${safeName}_${fromDate}_${toDate}.pdf`,
              ...(ccAddresses.length > 0 ? { cc_note: `CC: ${ccAddresses.join(", ")}` } : {}),
            },
          },
        });
      }
      toast({ title: `Ledger emailed to ${toAddresses.join(", ")}` });
      setEmailOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to send email", description: err.message, variant: "destructive" });
    }
    setEmailSending(false);
  };

  const handleDownloadXlsx = () => {
    const fName = firms.find(f => f.id === firmId)?.name || "Firm";
    const aoa: any[][] = [];
    aoa.push(["FIRM REVENUE LEDGER"]);
    aoa.push([`Firm: ${fName}`]);
    aoa.push([`Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}`]);
    aoa.push([`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`]);
    aoa.push([]);
    aoa.push(["Sr.", "Date", "Document No", "Client", "Type", "Debit (₹)", "Credit (₹)", "Running Total (₹)"]);
    aoa.push(["", format(new Date(fromDate), "dd/MM/yyyy"), "—", "—", "Opening Balance (Balance B/F)", "", "", 0]);
    rows.forEach((r, i) => aoa.push([
      i + 1,
      r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
      r.docNo, r.clientName, r.docType,
      r.debit || "", r.credit || "", r.running,
    ]));
    aoa.push([]);
    const totalD = rows.reduce((s, r) => s + r.debit, 0);
    const totalC = rows.reduce((s, r) => s + r.credit, 0);
    aoa.push(["", "TOTAL", "", "", "", totalD, totalC, rows[rows.length - 1]?.running || 0]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 4 }, { wch: 12 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Firm Revenue");
    XLSX.writeFile(wb, `FirmRevenue_${fName}_${fromDate}_${toDate}.xlsx`);
  };

  const handleDownloadPdf = async () => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const fName = firms.find(f => f.id === firmId)?.name || "Firm";
    const selectedFirm = firms.find(f => f.id === firmId);
    const logoBase64 = selectedFirm?.logo_url ? await loadLogoBase64(selectedFirm.logo_url) : null;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    await ensurePdfUnicodeFont(doc);
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 22, "F");

    let textStartX = 14;
    if (logoBase64) {
      try {
        const imgFmt = logoBase64.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(logoBase64, imgFmt, 14, 2, 30, 18);
        textStartX = 48;
      } catch { /* ignore logo error */ }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    setPdfUnicodeFont(doc, "bold");
    doc.text("FIRM REVENUE LEDGER", textStartX, 10);
    doc.setFontSize(8);
    setPdfUnicodeFont(doc, "normal");
    doc.text(`Firm: ${fName}   |   Period: ${format(new Date(fromDate), "dd/MM/yyyy")} to ${format(new Date(toDate), "dd/MM/yyyy")}`, textStartX, 17);
    doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 297 - 14, 17, { align: "right" });
    const totalD = rows.reduce((s, r) => s + r.debit, 0);
    const totalC = rows.reduce((s, r) => s + r.credit, 0);
    const tableRows: any[][] = [
      [format(new Date(fromDate), "dd/MM/yyyy"), "—", "—", "Opening Balance (Balance B/F)", "—", "—", formatPdfCurrency(0)],
      ...rows.map(r => [
        r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
        r.docNo, r.clientName, r.docType,
        r.debit > 0 ? formatPdfCurrency(r.debit) : "—",
        r.credit > 0 ? formatPdfCurrency(r.credit) : "—",
        formatPdfCurrency(r.running),
      ]),
    ];
    tableRows.push([
      { content: "GRAND TOTAL", colSpan: 4, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: formatPdfCurrency(totalD), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(totalC), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: formatPdfCurrency(rows[rows.length - 1]?.running || 0), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);
    autoTable(doc, {
      startY: 26,
      head: [["Date", "Doc No", "Client", "Type", "Debit (₹)", "Credit (₹)", "Running Total (₹)"]],
      body: tableRows,
      styles: { font: "NotoSans", fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { font: "NotoSans", fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" as const },
        1: { cellWidth: 22, halign: "center" as const },
        2: { cellWidth: 55 },
        3: { cellWidth: 25 },
        4: { cellWidth: 30, halign: "right" as const },
        5: { cellWidth: 30, halign: "right" as const },
        6: { cellWidth: 32, halign: "right" as const },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        setPdfUnicodeFont(doc, "normal");
        doc.setFontSize(7); doc.setTextColor(120, 130, 145);
        doc.text(`Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`, 148.5, 205, { align: "center" });
        doc.setDrawColor(...DARK_BLUE); doc.setLineWidth(0.5);
        doc.line(10, 202, 287, 202);
      },
    });
    doc.save(`FirmRevenue_${fName}_${fromDate}_${toDate}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Select value={firmId} onValueChange={setFirmId}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select Firm" /></SelectTrigger>
          <SelectContent>
            {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fy} onValueChange={v => { setFy(v); const r = fyToDateRange(v); setFromDate(r.start); setToDate(r.end); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {getFYOptions().map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
        </div>
        <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="invoice">Invoices</SelectItem>
            <SelectItem value="credit_note">Credit Notes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!firmId ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Building2 size={36} className="mx-auto mb-2 opacity-40" />
          <p>Select a firm to view revenue ledger</p>
        </CardContent></Card>
      ) : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Document No</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Debit (₹)</TableHead>
                <TableHead className="text-right">Credit (₹)</TableHead>
                <TableHead className="text-right">Running Total (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No entries found</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={r.id || i}>
                  <TableCell>{r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : ""}</TableCell>
                  <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                  <TableCell>{r.clientName}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{r.docType}</Badge></TableCell>
                  <TableCell className="text-right">{r.debit > 0 ? fmtINR(r.debit) : "—"}</TableCell>
                  <TableCell className="text-right">{r.credit > 0 ? fmtINR(r.credit) : "—"}</TableCell>
                  <TableCell className="text-right font-medium">{fmtINR(r.running)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {rows.length > 0 && (
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={4}>Summary</TableCell>
                  <TableCell className="text-right">{fmtINR(rows.reduce((s, r) => s + r.debit, 0))}</TableCell>
                  <TableCell className="text-right">{fmtINR(rows.reduce((s, r) => s + r.credit, 0))}</TableCell>
                  <TableCell className="text-right">{fmtINR(rows[rows.length - 1]?.running || 0)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><CardContent className="py-3 text-center">
              <p className="text-xs text-muted-foreground">Total Invoiced</p>
              <p className="text-lg font-bold text-foreground">{fmtINR(totalInvoiced)}</p>
            </CardContent></Card>
            <Card><CardContent className="py-3 text-center">
              <p className="text-xs text-muted-foreground">Credit Notes</p>
              <p className="text-lg font-bold text-foreground">{fmtINR(totalCN)}</p>
            </CardContent></Card>
            <Card><CardContent className="py-3 text-center">
              <p className="text-xs text-muted-foreground">Received</p>
              <p className="text-lg font-bold text-foreground">{fmtINR(totalReceived)}</p>
            </CardContent></Card>
            <Card><CardContent className="py-3 text-center">
              <p className="text-xs text-muted-foreground">Net Outstanding</p>
              <p className="text-lg font-bold text-foreground">{fmtINR(netOutstanding)}</p>
            </CardContent></Card>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleDownloadXlsx} className="gap-1"><Download size={14} /> Export XLSX</Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"><Download size={14} /> Export PDF</Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => {
              const phone = prompt("Enter WhatsApp number (e.g. 9876543210):");
              if (phone) {
                const cleanPhone = phone.replace(/\D/g, "");
                const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
                const fName = firms.find(f => f.id === firmId)?.name || "Firm";
                const msg = encodeURIComponent(`Dear Team,\n\nPlease find the Firm Revenue Ledger for ${fName} — FY ${fy}.\n\nRegards`);
                window.open(`https://wa.me/${fullPhone}?text=${msg}`, "_blank");
                handleDownloadPdf();
              }
            }}>
              <Share2 size={14} /> Send via WhatsApp
            </Button>
            <Button size="sm" className="gap-1 bg-[#1A2744] hover:bg-[#243460] text-white" onClick={openFirmEmailDialog}>
              <Mail size={14} /> Send via Email
            </Button>
          </div>

          {/* ── Firm Revenue Email Dialog ─────────────────────────────── */}
          <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Mail size={18} /> Email Firm Revenue Ledger</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1">
                  <Label htmlFor="frl-email-to">To <span className="text-destructive">*</span></Label>
                  <Input id="frl-email-to" type="text" placeholder="email@example.com, another@example.com"
                    value={emailTo} onChange={e => setEmailTo(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Separate multiple addresses with commas</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="frl-email-cc">CC <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="frl-email-cc" type="text" placeholder="cc@example.com"
                    value={emailCC} onChange={e => setEmailCC(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="frl-email-subject">Subject</Label>
                  <Input id="frl-email-subject" type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="frl-email-msg">Message</Label>
                  <Textarea id="frl-email-msg" rows={5} value={emailMsg} onChange={e => setEmailMsg(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={emailSending}>Cancel</Button>
                <Button className="gap-1 bg-[#1A2744] hover:bg-[#243460] text-white" onClick={handleFirmEmailLedger} disabled={emailSending}>
                  {emailSending ? "Sending…" : <><Mail size={14} /> Send Email</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN LEDGER TAB
// ═══════════════════════════════════════
export default function LedgerTab() {
  const [view, setView] = useState("client");

  return (
    <div className="space-y-4">
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="client" className="gap-1"><BookOpen size={14} /> Client Ledger</TabsTrigger>
          <TabsTrigger value="group" className="gap-1"><Users size={14} /> Group Ledger</TabsTrigger>
          <TabsTrigger value="firm" className="gap-1"><Building2 size={14} /> Firm Revenue Ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="client"><ClientLedgerView /></TabsContent>
        <TabsContent value="group"><GroupLedgerView /></TabsContent>
        <TabsContent value="firm"><FirmRevenueLedgerView /></TabsContent>
      </Tabs>
    </div>
  );
}
