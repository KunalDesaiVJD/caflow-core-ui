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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { format } from "date-fns";
import { BookOpen, Download, Archive, Users, Building2, Share2, Mail, Phone } from "lucide-react";
import { exportToPdf, exportToExcel } from "@/lib/exportUtils";
import * as XLSX from "xlsx";
import JSZip from "jszip";

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
}

async function buildLedgerEntries(
  filters: { clientIds: string[]; firmIds: string[]; fy: string }
): Promise<LedgerEntry[]> {
  const { start, end } = fyToDateRange(filters.fy);
  const entries: LedgerEntry[] = [];

  // 1. First try client_ledger_entries
  let leQuery = supabase.from("client_ledger_entries").select("*")
    .in("client_id", filters.clientIds)
    .in("firm_id", filters.firmIds)
    .gte("entry_date", start).lte("entry_date", end)
    .order("entry_date", { ascending: true });
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
    }));
  }

  // 2. Fallback: build from invoices + receipts directly
  const { data: invoices } = await supabase.from("invoices")
    .select("id, invoice_no, client_id, invoice_date, total_amount, document_type, status")
    .in("client_id", filters.clientIds)
    .in("firm_id", filters.firmIds)
    .in("status", ["finalized", "sent", "overdue", "paid"])
    .gte("invoice_date", start).lte("invoice_date", end)
    .order("invoice_date", { ascending: true });

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
    });
  });

  const { data: receipts } = await supabase.from("billing_receipts")
    .select("id, client_id, receipt_date, amount_received, payment_mode, tds_amount, gst_tds_amount")
    .in("client_id", filters.clientIds)
    .in("firm_id", filters.firmIds)
    .gte("receipt_date", start).lte("receipt_date", end)
    .order("receipt_date", { ascending: true });

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

// ═══════════════════════════════════════
// CLIENT LEDGER VIEW
// ═══════════════════════════════════════
function ClientLedgerView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [firmId, setFirmId] = useState("");
  const [fy, setFy] = useState(getCurrentFY());
  const [entries, setEntries] = useState<any[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: f }] = await Promise.all([
        supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).order("name"),
        supabase.from("firms").select("id, name").order("name"),
      ]);
      setClients(c || []);
      setFirms(f || []);
      if (user?.firm_id) setFirmId(user.firm_id);
    })();
  }, [user]);

  const loadEntries = useCallback(async () => {
    if (!clientId || !firmId) return;
    setLoading(true);
    try {
      const entries = await buildLedgerEntries({ clientIds: [clientId], firmIds: [firmId], fy });

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
    } catch (err: any) {
      toast({ title: "Error loading ledger", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }, [clientId, firmId, fy, toast]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const rows = useMemo(() => {
    let balance = 0;
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
      return { ...e, debit, credit, balance, docNo, narration };
    });
  }, [entries, invoiceMap]);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const closingBalance = totalDebit - totalCredit;

  const clientName = clients.find(c => c.id === clientId)?.name || "";

  const handleDownloadPdf = () => {
    const el = document.getElementById("client-ledger-table");
    if (el) exportToPdf(el, `Ledger_${clientName}_${fy}.pdf`);
  };

  const handleDownloadXlsx = () => {
    exportToExcel([{
      sheetName: "Ledger",
      rows: rows.map(r => ({
        Date: r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
        "Document No": r.docNo,
        Narration: r.narration,
        "Debit (₹)": r.debit,
        "Credit (₹)": r.credit,
        "Balance (₹)": r.balance,
      })),
    }], `Ledger_${clientName}_${fy}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select Client" /></SelectTrigger>
          <SelectContent>
            {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={firmId} onValueChange={setFirmId}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select Firm" /></SelectTrigger>
          <SelectContent>
            {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {getFYOptions().map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

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
                {rows.length === 0 ? (
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
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1"><Download size={14} /> Download PDF</Button>
              <Button variant="outline" size="sm" onClick={handleDownloadXlsx} className="gap-1"><Download size={14} /> Download XLSX</Button>
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
                <Share2 size={14} /> Send Ledger
              </Button>
            </div>
          )}
        </>
      )}
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
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [groupId, setGroupId] = useState("");
  const [firmIds, setFirmIds] = useState<string[]>([]);
  const [fy, setFy] = useState(getCurrentFY());
  const [data, setData] = useState<{ clientName: string; entries: any[] }[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: g }, { data: f }] = await Promise.all([
        supabase.from("client_groups").select("id, name").order("name"),
        supabase.from("firms").select("id, name").order("name"),
      ]);
      setGroups(g || []);
      setFirms(f || []);
      if (user?.firm_id) setFirmIds([user.firm_id]);
    })();
  }, [user]);

  const loadData = useCallback(async () => {
    if (!groupId || firmIds.length === 0) return;
    setLoading(true);

    // Resolve "all" → actual firm IDs
    let resolvedFirmIds = firmIds;
    if (firmIds[0] === "all") {
      resolvedFirmIds = firms.map(f => f.id);
    }
    if (resolvedFirmIds.length === 0) { setData([]); setLoading(false); return; }

    const { data: memberships } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupId);
    const clientIds = (memberships || []).map(m => m.client_id);
    if (clientIds.length === 0) { setData([]); setLoading(false); return; }

    const { data: clients } = await supabase.from("clients").select("id, name").in("id", clientIds);
    const clientMap: Record<string, string> = {};
    (clients || []).forEach(c => { clientMap[c.id] = c.name || "Unknown"; });

    const entries = await buildLedgerEntries({ clientIds, firmIds: resolvedFirmIds, fy });

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

    const result = clientIds
      .filter(cid => grouped[cid]?.length > 0)
      .map(cid => ({ clientName: clientMap[cid] || "Unknown", entries: grouped[cid] }));
    setData(result);
    setLoading(false);
  }, [groupId, firmIds, fy, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const getDocNo = (e: any) => {
    if (e.entry_type === "invoice" || e.entry_type === "credit_note") return e.document_id ? (invoiceMap[e.document_id] || e.document_id.slice(0, 8)) : "";
    if (e.entry_type === "receipt") return e.document_id ? `RCT-${e.document_id.slice(0, 6)}` : "";
    return "";
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
    aoa.push([`Financial Year: ${fy}`]);
    aoa.push([`Generated on: ${format(new Date(), "dd/MM/yyyy HH:mm")}`]);
    aoa.push([]); // blank row

    // Column headers
    aoa.push(["Sr.", "Client", "Date", "Document No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]);

    let srNo = 1;
    data.forEach(({ clientName, entries }) => {
      let bal = 0;
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
    XLSX.writeFile(wb, `GroupLedger_${groupName}_${fy}.xlsx`);
  };

  const handleDownloadPdf = async () => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const groupName = groups.find(g => g.id === groupId)?.name || "Group";
    const selectedFirmNames = firmIds[0] === "all"
      ? "All Firms"
      : firms.filter(f => firmIds.includes(f.id)).map(f => f.name).join(", ");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    // Corporate header bar
    const DARK_BLUE = [26, 58, 92] as [number, number, number];
    const LIGHT_BLUE = [232, 240, 250] as [number, number, number];
    doc.setFillColor(...DARK_BLUE);
    doc.rect(0, 0, 297, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("GROUP LEDGER STATEMENT", 14, 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Group: ${groupName}   |   Firm(s): ${selectedFirmNames}   |   FY: ${fy}`, 14, 17);

    // Generation timestamp (right-aligned)
    const genText = `Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
    doc.text(genText, 297 - 14, 17, { align: "right" });

    // Table
    const tableRows: any[][] = [];
    data.forEach(({ clientName, entries }) => {
      let bal = 0;
      entries.forEach((e: any) => {
        const d = Number(e.debit_amount) || 0;
        const c = Number(e.credit_amount) || 0;
        bal += d - c;
        tableRows.push([
          clientName,
          e.entry_date ? format(new Date(e.entry_date), "dd/MM/yyyy") : "",
          getDocNo(e),
          e.narration || "",
          d > 0 ? d.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—",
          c > 0 ? c.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—",
          bal.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
        ]);
      });
      // Subtotal
      const subtotalD = entries.reduce((s: number, e: any) => s + (Number(e.debit_amount) || 0), 0);
      const subtotalC = entries.reduce((s: number, e: any) => s + (Number(e.credit_amount) || 0), 0);
      tableRows.push([
        { content: `Subtotal — ${clientName}`, colSpan: 4, styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE } },
        { content: subtotalD.toLocaleString("en-IN", { minimumFractionDigits: 2 }), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
        { content: subtotalC.toLocaleString("en-IN", { minimumFractionDigits: 2 }), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
        { content: (subtotalD - subtotalC).toLocaleString("en-IN", { minimumFractionDigits: 2 }), styles: { fontStyle: "bold", fillColor: LIGHT_BLUE, textColor: DARK_BLUE, halign: "right" } },
      ]);
    });

    // Grand total row
    const grandD = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.debit_amount) || 0), 0), 0);
    const grandC = data.reduce((s, d) => s + d.entries.reduce((ss: number, e: any) => ss + (Number(e.credit_amount) || 0), 0), 0);
    tableRows.push([
      { content: "GRAND TOTAL", colSpan: 4, styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255] } },
      { content: grandD.toLocaleString("en-IN", { minimumFractionDigits: 2 }), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: grandC.toLocaleString("en-IN", { minimumFractionDigits: 2 }), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
      { content: (grandD - grandC).toLocaleString("en-IN", { minimumFractionDigits: 2 }), styles: { fontStyle: "bold", fillColor: DARK_BLUE, textColor: [255, 255, 255], halign: "right" } },
    ]);

    autoTable(doc, {
      startY: 26,
      head: [["Client", "Date", "Doc No", "Narration", "Debit (₹)", "Credit (₹)", "Balance (₹)"]],
      body: tableRows,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: [200, 210, 225], lineWidth: 0.3 },
      headStyles: { fillColor: DARK_BLUE, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: [248, 251, 255] },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 22, halign: "center" },
        2: { cellWidth: 22, halign: "center" },
        3: { cellWidth: 70 },
        4: { cellWidth: 28, halign: "right" },
        5: { cellWidth: 28, halign: "right" },
        6: { cellWidth: 30, halign: "right" },
      },
      margin: { left: 10, right: 10 },
      didDrawPage: (hookData) => {
        // Footer on every page
        const pageCount = (doc as any).internal.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(120, 130, 145);
        doc.text(
          `Page ${hookData.pageNumber} of ${pageCount}   |   CAFlow — Confidential`,
          148.5, 205, { align: "center" }
        );
        // Bottom border line
        doc.setDrawColor(...DARK_BLUE);
        doc.setLineWidth(0.5);
        doc.line(10, 202, 287, 202);
      },
    });

    doc.save(`GroupLedger_${groupName}_${fy}.pdf`);
  };

  const handleDownloadZip = async () => {
    if (!groupId || firmIds.length === 0) return;
    toast({ title: "Generating ZIP..." });
    const { data: memberships } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupId);
    const clientIds = (memberships || []).map(m => m.client_id);
    if (clientIds.length === 0) return;

    const resolvedFirmIds = firmIds[0] === "all" ? firms.map(f => f.id) : firmIds;
    const { data: invoices } = await supabase.from("invoices").select("id, invoice_no, client_id")
      .in("client_id", clientIds).in("firm_id", resolvedFirmIds).eq("financial_year", fy);
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
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select Group" /></SelectTrigger>
          <SelectContent>
            {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
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
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {getFYOptions().map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
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
              {data.map(({ clientName, entries }, gi) => {
                let bal = 0;
                const clientRows = entries.map((e: any, ei: number) => {
                  const d = Number(e.debit_amount) || 0;
                  const c = Number(e.credit_amount) || 0;
                  bal += d - c;
                  return (
                    <TableRow key={`${gi}-${ei}`}>
                      {ei === 0 && <TableCell rowSpan={entries.length + 1} className="font-medium align-top border-r">{clientName}</TableCell>}
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
                return [
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
          </div>
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
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [firmId, setFirmId] = useState("");
  const [fy, setFy] = useState(getCurrentFY());
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [entries, setEntries] = useState<any[]>([]);
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [invoiceMap, setInvoiceMap] = useState<Record<string, { no: string; type: string }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: f } = await supabase.from("firms").select("id, name").order("name");
      setFirms(f || []);
      if (user?.firm_id) setFirmId(user.firm_id);
    })();
  }, [user]);

  const loadData = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);

    // Get all clients for the firm to pass to buildLedgerEntries
    const { data: allClients } = await supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null);
    const allClientIds = (allClients || []).map(c => c.id);
    const cm: Record<string, string> = {};
    (allClients || []).forEach(c => { cm[c.id] = c.name || "Unknown"; });

    let allEntries = await buildLedgerEntries({ clientIds: allClientIds, firmIds: [firmId], fy });

    // Apply docType filter
    if (docTypeFilter === "invoice") allEntries = allEntries.filter(e => e.entry_type === "invoice");
    else if (docTypeFilter === "credit_note") allEntries = allEntries.filter(e => e.entry_type === "credit_note");

    setEntries(allEntries);
    setClientMap(cm);

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
  }, [firmId, fy, docTypeFilter]);

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

  const handleDownloadXlsx = () => {
    exportToExcel([{
      sheetName: "Revenue Ledger",
      rows: rows.map(r => ({
        Date: r.entry_date ? format(new Date(r.entry_date), "dd/MM/yyyy") : "",
        "Document No": r.docNo, Client: r.clientName, Type: r.docType,
        "Debit (₹)": r.debit, "Credit (₹)": r.credit, "Running Total (₹)": r.running,
      })),
    }], `FirmRevenue_${fy}.xlsx`);
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
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {getFYOptions().map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
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

          <Button variant="outline" size="sm" onClick={handleDownloadXlsx} className="gap-1"><Download size={14} /> Download XLSX</Button>
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
