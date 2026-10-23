import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Plus, CalendarIcon, Receipt, Trash2, Pencil, Scissors, Download } from "lucide-react";
import { buildClientGstins } from "@/lib/gstinUtils";
import { BILLING_RPC_RECEIPT_POSTING } from "@/lib/billingFlags";

/**
 * Flip the legacy invoices.status to 'paid' once the invoice is fully settled.
 * The amount_paid trigger keeps amount_due net of cash + TDS + GST-TDS across ALL
 * receipts, so this mirrors post_receipt (the RPC path) instead of comparing a
 * single receipt's cash amount to the invoice total.
 */
async function markInvoicePaidIfSettled(invoiceId: string, paidOn: string) {
  await supabase.from("invoices")
    .update({ status: "paid", paid_at: paidOn })
    .eq("id", invoiceId)
    .lte("amount_due", 0.005)
    .not("status", "in", "(voided,draft)");
}

const PAYMENT_MODES = ["Cash", "Cheque", "NEFT", "UPI", "RTGS", "Other"];

function getFYFromDate(dateStr: string): string {
  const d = new Date(dateStr);
  const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

interface ReceiptRow {
  id: string;
  client_id: string;
  firm_id: string;
  invoice_id: string | null;
  receipt_type: string;
  receipt_date: string;
  amount_received: number;
  payment_mode: string;
  payment_reference: string | null;
  tds_amount: number | null;
  gst_tds_amount: number | null;
  tds_date: string | null;
  remarks: string | null;
  created_at: string | null;
}

interface KasarRow {
  id: string;
  client_id: string;
  firm_id: string;
  invoice_id: string | null;
  kasar_date: string;
  amount: number;
  narration: string | null;
  financial_year: string | null;
  created_at: string | null;
}

export default function ReceiptsTab({ overrideFirmId }: { overrideFirmId?: string | null } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const firmId = overrideFirmId ?? user?.firm_id;
  const isSuperadmin = user?.role === "superadmin";

  // List state
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [invoiceMap, setInvoiceMap] = useState<Record<string, string>>({});

  // Filters
  const [clientFilter, setClientFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [firmFilter, setFirmFilter] = useState("all");
  const [fyFilter, setFyFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");

  // Filter data
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [responsiblePersons, setResponsiblePersons] = useState<{ id: string; name: string }[]>([]);
  const [groupClientIds, setGroupClientIds] = useState<string[]>([]);
  const [responsibleClientIds, setResponsibleClientIds] = useState<string[]>([]);

  // Receipt Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Receipt Form state
  const [receiptType, setReceiptType] = useState<"against_invoice" | "on_account" | "allocate">("against_invoice");
  const [formClientId, setFormClientId] = useState("");
  const [formInvoiceId, setFormInvoiceId] = useState("");
  const [receiptDate, setReceiptDate] = useState<Date | undefined>(new Date());
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [tdsAmount, setTdsAmount] = useState("");
  const [gstTdsAmount, setGstTdsAmount] = useState("");
  const [tdsDate, setTdsDate] = useState<Date | undefined>(undefined);
  const [remarks, setRemarks] = useState("");
  const [clientInvoices, setClientInvoices] = useState<any[]>([]);
  const [formClientGstins, setFormClientGstins] = useState<{ gstin: string; state: string }[]>([]);
  const [formGstin, setFormGstin] = useState<string>("all");
  // Q1: the receipt's owning firm, selectable in the dialog (defaults to the
  // current firm context). Lets multi-firm users book a receipt to the right firm.
  const [formFirmId, setFormFirmId] = useState<string>("");
  // Multi-invoice allocation: invoice_id -> amount (string) for "allocate" mode.
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  // Kasar state
  const [kasars, setKasars] = useState<KasarRow[]>([]);
  const [kasarLoading, setKasarLoading] = useState(false);
  const [kasarDialogOpen, setKasarDialogOpen] = useState(false);
  const [savingKasar, setSavingKasar] = useState(false);
  const [editingKasarId, setEditingKasarId] = useState<string | null>(null);
  const [kasarClientId, setKasarClientId] = useState("");
  const [kasarDate, setKasarDate] = useState<Date | undefined>(new Date());
  const [kasarAmount, setKasarAmount] = useState("");
  const [kasarNarration, setKasarNarration] = useState("");
  const [kasarInvoiceId, setKasarInvoiceId] = useState("none");
  const [kasarInvoices, setKasarInvoices] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const effectiveFirmId = firmFilter !== "all" ? firmFilter : (isSuperadmin ? null : firmId);

    // Page past PostgREST's 1000-row cap so the register (and its totals) are complete.
    const rData: any[] = [];
    for (let from = 0; ; from += 1000) {
      let rQuery = supabase.from("billing_receipts").select("*").order("receipt_date", { ascending: false }).order("id")
        .range(from, from + 999);
      if (effectiveFirmId) rQuery = rQuery.eq("firm_id", effectiveFirmId);
      const { data } = await rQuery;
      rData.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const { data: cData } = await supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null);
    const { data: firmData } = await supabase.from("firms").select("id, name, display_name");
    const { data: groupData } = await supabase.from("client_groups").select("id, name");
    const { data: usersData } = await supabase.from("users").select("id, name").neq("role", "client").eq("is_active", true);

    const cm: Record<string, string> = {};
    (cData || []).forEach((c: any) => { cm[c.id] = c.name || "Unknown"; });

    const invoiceIds = [...new Set((rData || []).map((r: any) => r.invoice_id).filter(Boolean))];
    const im: Record<string, string> = {};
    if (invoiceIds.length > 0) {
      const { data: invData } = await supabase.from("invoices").select("id, invoice_no").in("id", invoiceIds);
      (invData || []).forEach((i: any) => { im[i.id] = i.invoice_no || "—"; });
    }

    setReceipts((rData as ReceiptRow[]) || []);
    setClientMap(cm);
    setInvoiceMap(im);
    setClients((cData || []).map((c: any) => ({ id: c.id, name: c.name || "Unknown" })));
    setFirms((firmData || []).map((f: any) => ({ id: f.id, name: (f as any).display_name || f.name })));
    setGroups((groupData || []).map((g: any) => ({ id: g.id, name: g.name })));
    setResponsiblePersons((usersData || []).map((u: any) => ({ id: u.id, name: u.name })));
    setLoading(false);
  }, [firmId, isSuperadmin, firmFilter]);

  const fetchKasars = useCallback(async () => {
    setKasarLoading(true);
    const effectiveFirmId = firmFilter !== "all" ? firmFilter : (isSuperadmin ? null : firmId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any).from("billing_kasars").select("*").order("kasar_date", { ascending: false });
    if (effectiveFirmId) q = q.eq("firm_id", effectiveFirmId);
    const { data } = await q;
    setKasars(data || []);
    setKasarLoading(false);
  }, [firmId, isSuperadmin, firmFilter]);

  useEffect(() => { fetchData(); fetchKasars(); }, [fetchData, fetchKasars]);

  useEffect(() => {
    if (groupFilter === "all") { setGroupClientIds([]); return; }
    (async () => {
      const { data } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupFilter);
      setGroupClientIds((data || []).map((d: any) => d.client_id));
    })();
  }, [groupFilter]);

  useEffect(() => {
    if (responsibleFilter === "all") { setResponsibleClientIds([]); return; }
    (async () => {
      const { data } = await supabase.from("clients").select("id").eq("responsible_person_id", responsibleFilter).eq("is_draft", false).is("deleted_at", null);
      setResponsibleClientIds((data || []).map((d: any) => d.id));
    })();
  }, [responsibleFilter]);

  useEffect(() => {
    if (!formClientId) { setFormClientGstins([]); setFormGstin("all"); return; }
    (async () => {
      const { data } = await supabase.from("clients").select("gstin_states, gstin").eq("id", formClientId).maybeSingle();
      const list = buildClientGstins(data?.gstin_states as Record<string, string> | null, data?.gstin as string[] | null);
      setFormClientGstins(list);
      setFormGstin("all");
    })();
  }, [formClientId]);

  useEffect(() => {
    if (!formClientId || (receiptType !== "against_invoice" && receiptType !== "allocate")) { setClientInvoices([]); return; }
    (async () => {
      let q = supabase.from("invoices").select("id, invoice_no, total_amount, due_date")
        .eq("client_id", formClientId)
        .eq("document_type", "invoice")
        .in("status", ["finalized", "sent", "overdue"])
        .order("invoice_date", { ascending: false });
      if (firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setClientInvoices(data || []);
    })();
  }, [formClientId, receiptType, firmId]);

  useEffect(() => {
    if (!kasarClientId) { setKasarInvoices([]); return; }
    (async () => {
      let q = supabase.from("invoices").select("id, invoice_no, total_amount, due_date")
        .eq("client_id", kasarClientId)
        .eq("document_type", "invoice")
        .in("status", ["finalized", "sent", "overdue", "paid"])
        .order("invoice_date", { ascending: false });
      if (firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setKasarInvoices(data || []);
    })();
  }, [kasarClientId, firmId]);

  // Derive available FY options from loaded receipts
  const fyOptions = useMemo(() => {
    const fys = new Set(receipts.map(r => r.receipt_date ? getFYFromDate(r.receipt_date) : "").filter(Boolean));
    return [...fys].sort().reverse();
  }, [receipts]);

  // Multi-invoice allocation totals (must match the gross settlement).
  const allocTotal = Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0);
  const settlementTotal = (Number(amountReceived) || 0) + (Number(tdsAmount) || 0) + (Number(gstTdsAmount) || 0);

  const filtered = useMemo(() => receipts.filter(r => {
    if (clientFilter !== "all" && r.client_id !== clientFilter) return false;
    if (modeFilter !== "all" && r.payment_mode !== modeFilter.toLowerCase()) return false;
    if (fyFilter !== "all" && r.receipt_date && getFYFromDate(r.receipt_date) !== fyFilter) return false;
    if (groupFilter !== "all" && !groupClientIds.includes(r.client_id)) return false;
    if (responsibleFilter !== "all" && !responsibleClientIds.includes(r.client_id)) return false;
    return true;
  }), [receipts, clientFilter, modeFilter, fyFilter, groupFilter, groupClientIds, responsibleFilter, responsibleClientIds]);

  const totals = useMemo(() => ({
    amount: filtered.reduce((s, r) => s + (Number(r.amount_received) || 0), 0),
    tds: filtered.reduce((s, r) => s + (Number(r.tds_amount) || 0), 0),
    gstTds: filtered.reduce((s, r) => s + (Number((r as any).gst_tds_amount) || 0), 0),
  }), [filtered]);

  // Excel export of the register exactly as filtered on screen, with totals.
  const handleExportXlsx = () => {
    const aoa: any[][] = [
      ["RECEIPTS REGISTER"],
      [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
      [],
      ["Date", "Client", "Type", "Amount (₹)", "Mode", "Reference", "Against Invoice", "TDS (₹)", "GST TDS (₹)", "Remarks"],
      ...filtered.map(r => [
        r.receipt_date ? format(new Date(r.receipt_date), "dd/MM/yyyy") : "",
        clientMap[r.client_id] || "",
        r.receipt_type === "against_invoice" ? "Against Invoice" : "On Account",
        Number(r.amount_received) || 0,
        r.payment_mode || "",
        (r as any).payment_reference || "",
        r.invoice_id ? (invoiceMap[r.invoice_id] || "") : "",
        Number(r.tds_amount) || 0,
        Number((r as any).gst_tds_amount) || 0,
        (r as any).remarks || "",
      ]),
      [`Total (${filtered.length} receipts)`, "", "", totals.amount, "", "", "", totals.tds, totals.gstTds, ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Receipts");
    XLSX.writeFile(wb, `Receipts_${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  const filteredKasars = useMemo(() => kasars.filter(k => {
    if (clientFilter !== "all" && k.client_id !== clientFilter) return false;
    if (groupFilter !== "all" && !groupClientIds.includes(k.client_id)) return false;
    if (responsibleFilter !== "all" && !responsibleClientIds.includes(k.client_id)) return false;
    return true;
  }), [kasars, clientFilter, groupFilter, groupClientIds, responsibleFilter, responsibleClientIds]);

  const resetForm = () => {
    setEditingId(null);
    setReceiptType("against_invoice");
    setFormClientId("");
    setFormInvoiceId("");
    setReceiptDate(new Date());
    setAmountReceived("");
    setPaymentMode("");
    setPaymentReference("");
    setTdsAmount("");
    setGstTdsAmount("");
    setTdsDate(undefined);
    setRemarks("");
    setClientInvoices([]);
    setFormClientGstins([]);
    setFormGstin("all");
    setFormFirmId(firmFilter !== "all" ? firmFilter : (firmId ?? ""));
    setAllocations({});
  };

  const resetKasarForm = () => {
    setEditingKasarId(null);
    setKasarClientId("");
    setKasarDate(new Date());
    setKasarAmount("");
    setKasarNarration("");
    setKasarInvoiceId("none");
    setKasarInvoices([]);
  };

  const resolveFirmId = async (): Promise<string | null> => {
    if (firmId) return firmId;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const metaFirm = session?.user?.user_metadata?.firm_id;
      if (metaFirm) return metaFirm;
      if (session?.user?.id) {
        const { data: profile } = await supabase.from("users").select("firm_id").eq("id", session.user.id).maybeSingle();
        if (profile?.firm_id) return profile.firm_id;
      }
    } catch {}
    return null;
  };

  const handleEdit = (r: ReceiptRow) => {
    setEditingId(r.id);
    setFormFirmId(r.firm_id || "");
    setReceiptType(r.receipt_type as "against_invoice" | "on_account");
    setFormClientId(r.client_id);
    setFormInvoiceId(r.invoice_id || "");
    setReceiptDate(r.receipt_date ? new Date(r.receipt_date + "T00:00:00") : new Date());
    setAmountReceived(String(r.amount_received));
    setPaymentMode(r.payment_mode || "");
    setPaymentReference(r.payment_reference || "");
    setTdsAmount(r.tds_amount ? String(r.tds_amount) : "");
    setGstTdsAmount(r.gst_tds_amount ? String(r.gst_tds_amount) : "");
    setTdsDate(r.tds_date ? new Date(r.tds_date + "T00:00:00") : undefined);
    setRemarks(r.remarks || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const hasAmount = Number(amountReceived) > 0;
    const hasTds = Number(tdsAmount) > 0 || Number(gstTdsAmount) > 0;
    if (!formClientId || !receiptDate) {
      toast({ title: "Please fill all mandatory fields", variant: "destructive" });
      return;
    }
    // A receipt amount is not compulsory when only TDS / GST TDS is being recorded.
    if (!hasAmount && !hasTds) {
      toast({ title: "Enter a receipt amount, or a TDS / GST TDS amount", variant: "destructive" });
      return;
    }
    if (hasAmount && !paymentMode) {
      toast({ title: "Please select the payment mode", variant: "destructive" });
      return;
    }
    // Q1: honour the firm chosen in the dialog; fall back to the resolved firm.
    const resolvedFirmId = formFirmId || await resolveFirmId();
    if (!resolvedFirmId) {
      toast({ title: "Unable to resolve firm. Please select a firm and try again.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const dateStr = format(receiptDate, "yyyy-MM-dd");
    const amt = Number(amountReceived) || 0;
    const tds = Number(tdsAmount) || 0;
    const gstTds = Number(gstTdsAmount) || 0;
    // TDS-only entries carry no payment mode of their own; the table requires one, so store "Other".
    const mode = paymentMode || "Other";
    const invoiceId = receiptType === "against_invoice" && formInvoiceId ? formInvoiceId : null;
    const fy = getFYFromDate(dateStr);

    try {
      // Multi-invoice allocation: one on-account receipt split across invoices.
      if (receiptType === "allocate") {
        if (allocTotal <= 0 || Math.abs(allocTotal - settlementTotal) > 0.01) {
          toast({ title: "Total allocated must equal the settlement (amount + TDS + GST-TDS)", variant: "destructive" });
          return;
        }
        let newReceiptId: string | null = null;
        if (BILLING_RPC_RECEIPT_POSTING) {
          const { data, error } = await (supabase as any).rpc("post_receipt", {
            p_firm_id: resolvedFirmId, p_client_id: formClientId, p_invoice_id: null,
            p_receipt_type: "on_account", p_receipt_date: dateStr, p_amount: amt,
            p_payment_mode: mode, p_payment_reference: paymentReference || null,
            p_tds: tds || 0, p_gst_tds: gstTds || 0,
            p_tds_date: tds > 0 && tdsDate ? format(tdsDate, "yyyy-MM-dd") : null,
            p_remarks: remarks || null, p_gstin: formGstin && formGstin !== "all" ? formGstin : null,
            p_created_by: user?.id, p_financial_year: fy,
          });
          if (error) throw error;
          newReceiptId = data as string;
        } else {
          const { data: nr, error: rErr } = await supabase.from("billing_receipts").insert({
            firm_id: resolvedFirmId, client_id: formClientId, invoice_id: null,
            receipt_type: "on_account", receipt_date: dateStr, amount_received: amt,
            payment_mode: mode.toLowerCase(), payment_reference: paymentReference || null,
            tds_amount: tds || null, gst_tds_amount: gstTds || null,
            tds_date: tds > 0 && tdsDate ? format(tdsDate, "yyyy-MM-dd") : null,
            remarks: remarks || null, gstin: formGstin && formGstin !== "all" ? formGstin : null,
            created_by: user?.id,
          }).select("id").single();
          if (rErr) throw rErr;
          newReceiptId = nr.id;
          if (amt > 0) await supabase.from("client_ledger_entries").insert({
            firm_id: resolvedFirmId, client_id: formClientId, entry_date: dateStr, entry_type: "receipt",
            document_id: newReceiptId, debit_amount: 0, credit_amount: amt,
            narration: `Payment received — ${mode}`, financial_year: fy,
          });
          if (tds > 0) await supabase.from("client_ledger_entries").insert({ firm_id: resolvedFirmId, client_id: formClientId, entry_date: dateStr, entry_type: "adjustment", document_id: newReceiptId, debit_amount: 0, credit_amount: tds, narration: "TDS deducted", financial_year: fy });
          if (gstTds > 0) await supabase.from("client_ledger_entries").insert({ firm_id: resolvedFirmId, client_id: formClientId, entry_date: dateStr, entry_type: "adjustment", document_id: newReceiptId, debit_amount: 0, credit_amount: gstTds, narration: "GST TDS deducted", financial_year: fy });
        }
        const allocRows = clientInvoices
          .filter((inv: any) => Number(allocations[inv.id]) > 0)
          .map((inv: any) => ({ receipt_id: newReceiptId, invoice_id: inv.id, amount: Number(allocations[inv.id]) }));
        if (allocRows.length > 0) {
          const { error: aErr } = await (supabase as any).from("billing_receipt_allocations").insert(allocRows);
          if (aErr) throw aErr;
        }
        toast({ title: `Receipt allocated across ${allocRows.length} invoice(s).` });
        setDialogOpen(false);
        resetForm();
        fetchData();
        return;
      }

      if (editingId) {
        // UPDATE existing receipt
        const { error: uErr } = await supabase.from("billing_receipts").update({
          client_id: formClientId,
          invoice_id: invoiceId,
          receipt_type: receiptType,
          receipt_date: dateStr,
          amount_received: amt,
          payment_mode: mode.toLowerCase(),
          payment_reference: paymentReference || null,
          tds_amount: tds || null,
          gst_tds_amount: gstTds || null,
          tds_date: tds > 0 && tdsDate ? format(tdsDate, "yyyy-MM-dd") : null,
          remarks: remarks || null,
          gstin: formGstin && formGstin !== "all" ? formGstin : null,
        }).eq("id", editingId);
        if (uErr) throw uErr;

        if (receiptType === "against_invoice" && invoiceId) await markInvoicePaidIfSettled(invoiceId, dateStr);

        // Delete old ledger entries and re-create them fresh
        await supabase.from("client_ledger_entries").delete().eq("document_id", editingId);

        if (amt > 0) await supabase.from("client_ledger_entries").insert({
          firm_id: resolvedFirmId,
          client_id: formClientId,
          entry_date: dateStr,
          entry_type: "receipt",
          document_id: editingId,
          debit_amount: 0,
          credit_amount: amt,
          narration: `Payment received — ${mode}`,
          financial_year: fy,
        });

        if (tds > 0) {
          await supabase.from("client_ledger_entries").insert({
            firm_id: resolvedFirmId,
            client_id: formClientId,
            entry_date: dateStr,
            entry_type: "adjustment",
            document_id: editingId,
            debit_amount: 0,
            credit_amount: tds,
            narration: `TDS deducted — Date: ${tdsDate ? format(tdsDate, "dd/MM/yyyy") : dateStr}`,
            financial_year: fy,
          });
        }

        if (gstTds > 0) {
          await supabase.from("client_ledger_entries").insert({
            firm_id: resolvedFirmId,
            client_id: formClientId,
            entry_date: dateStr,
            entry_type: "adjustment",
            document_id: editingId,
            debit_amount: 0,
            credit_amount: gstTds,
            narration: "GST TDS deducted",
            financial_year: fy,
          });
        }

        toast({ title: "Receipt updated. Ledger entries refreshed." });
      } else if (BILLING_RPC_RECEIPT_POSTING) {
        // Phase 2 cutover: atomic posting — receipt + ledger rows + invoice
        // settlement in ONE transactional RPC (no partial-write window).
        const { error: rpcErr } = await (supabase as any).rpc("post_receipt", {
          p_firm_id: resolvedFirmId,
          p_client_id: formClientId,
          p_invoice_id: invoiceId || null,
          p_receipt_type: receiptType,
          p_receipt_date: dateStr,
          p_amount: amt,
          p_payment_mode: mode,
          p_payment_reference: paymentReference || null,
          p_tds: tds || 0,
          p_gst_tds: gstTds || 0,
          p_tds_date: tds > 0 && tdsDate ? format(tdsDate, "yyyy-MM-dd") : null,
          p_remarks: remarks || null,
          p_gstin: formGstin && formGstin !== "all" ? formGstin : null,
          p_created_by: user?.id,
          p_financial_year: fy,
        });
        if (rpcErr) throw rpcErr;
        toast({ title: "Receipt recorded (atomic). Client ledger updated." });
      } else {
        // INSERT new receipt
        const { data: newReceipt, error: rErr } = await supabase.from("billing_receipts").insert({
          firm_id: resolvedFirmId,
          client_id: formClientId,
          invoice_id: invoiceId,
          receipt_type: receiptType,
          receipt_date: dateStr,
          amount_received: amt,
          payment_mode: mode.toLowerCase(),
          payment_reference: paymentReference || null,
          tds_amount: tds || null,
          gst_tds_amount: gstTds || null,
          tds_date: tds > 0 && tdsDate ? format(tdsDate, "yyyy-MM-dd") : null,
          remarks: remarks || null,
          gstin: formGstin && formGstin !== "all" ? formGstin : null,
          created_by: user?.id,
        }).select("id").single();

        if (rErr) throw rErr;
        const receiptId = newReceipt.id;

        if (receiptType === "against_invoice" && invoiceId) await markInvoicePaidIfSettled(invoiceId, dateStr);

        if (amt > 0) await supabase.from("client_ledger_entries").insert({
          firm_id: resolvedFirmId,
          client_id: formClientId,
          entry_date: dateStr,
          entry_type: "receipt",
          document_id: receiptId,
          debit_amount: 0,
          credit_amount: amt,
          narration: `Payment received — ${mode}`,
          financial_year: fy,
        });

        if (tds > 0) {
          await supabase.from("client_ledger_entries").insert({
            firm_id: resolvedFirmId,
            client_id: formClientId,
            entry_date: dateStr,
            entry_type: "adjustment",
            document_id: receiptId,
            debit_amount: 0,
            credit_amount: tds,
            narration: `TDS deducted — Date: ${tdsDate ? format(tdsDate, "dd/MM/yyyy") : dateStr}`,
            financial_year: fy,
          });
        }

        if (gstTds > 0) {
          await supabase.from("client_ledger_entries").insert({
            firm_id: resolvedFirmId,
            client_id: formClientId,
            entry_date: dateStr,
            entry_type: "adjustment",
            document_id: receiptId,
            debit_amount: 0,
            credit_amount: gstTds,
            narration: "GST TDS deducted",
            financial_year: fy,
          });
        }

        toast({ title: "Receipt recorded successfully. Client ledger updated." });
      }

      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast({ title: "Error saving receipt", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this receipt? All ledger entries will also be removed and this cannot be undone.")) return;
    const { error: ledgerErr } = await supabase.from("client_ledger_entries").delete().eq("document_id", id);
    if (ledgerErr) { toast({ title: "Error deleting ledger entries", description: ledgerErr.message, variant: "destructive" }); return; }
    const { error } = await supabase.from("billing_receipts").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Receipt deleted" }); fetchData(); }
  };

  const handleEditKasar = (k: KasarRow) => {
    setEditingKasarId(k.id);
    setKasarClientId(k.client_id);
    setKasarDate(k.kasar_date ? new Date(k.kasar_date + "T00:00:00") : new Date());
    setKasarAmount(String(k.amount));
    setKasarNarration(k.narration || "");
    setKasarInvoiceId(k.invoice_id || "none");
    setKasarDialogOpen(true);
  };

  const handleSaveKasar = async () => {
    if (!kasarClientId || !kasarDate || !kasarAmount || Number(kasarAmount) <= 0) {
      toast({ title: "Please fill all mandatory fields", variant: "destructive" });
      return;
    }
    const resolvedFirmId = await resolveFirmId();
    if (!resolvedFirmId) {
      toast({ title: "Unable to resolve firm. Please refresh and try again.", variant: "destructive" });
      return;
    }

    setSavingKasar(true);
    const dateStr = format(kasarDate, "yyyy-MM-dd");
    const amt = Number(kasarAmount);
    const fy = getFYFromDate(dateStr);
    const invId = kasarInvoiceId && kasarInvoiceId !== "none" ? kasarInvoiceId : null;
    const narration = kasarNarration ? `Kasar — ${kasarNarration}` : "Kasar settlement";

    try {
      if (editingKasarId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: uErr } = await (supabase as any).from("billing_kasars").update({
          client_id: kasarClientId,
          kasar_date: dateStr,
          amount: amt,
          narration: kasarNarration || null,
          invoice_id: invId,
          financial_year: fy,
        }).eq("id", editingKasarId);
        if (uErr) throw uErr;

        await supabase.from("client_ledger_entries").delete().eq("document_id", editingKasarId);
        await supabase.from("client_ledger_entries").insert({
          firm_id: resolvedFirmId,
          client_id: kasarClientId,
          entry_date: dateStr,
          entry_type: "kasar",
          document_id: editingKasarId,
          debit_amount: 0,
          credit_amount: amt,
          narration,
          financial_year: fy,
        });

        toast({ title: "Kasar updated. Ledger refreshed." });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newKasar, error: kErr } = await (supabase as any).from("billing_kasars").insert({
          firm_id: resolvedFirmId,
          client_id: kasarClientId,
          kasar_date: dateStr,
          amount: amt,
          narration: kasarNarration || null,
          invoice_id: invId,
          financial_year: fy,
          created_by: user?.id,
        }).select("id").single();
        if (kErr) throw kErr;

        await supabase.from("client_ledger_entries").insert({
          firm_id: resolvedFirmId,
          client_id: kasarClientId,
          entry_date: dateStr,
          entry_type: "kasar",
          document_id: newKasar.id,
          debit_amount: 0,
          credit_amount: amt,
          narration,
          financial_year: fy,
        });

        toast({ title: "Kasar added. Client ledger updated." });
      }

      setKasarDialogOpen(false);
      resetKasarForm();
      fetchKasars();
    } catch (err: any) {
      toast({ title: "Error saving kasar", description: err.message, variant: "destructive" });
    } finally {
      setSavingKasar(false);
    }
  };

  const handleDeleteKasar = async (id: string) => {
    await supabase.from("client_ledger_entries").delete().eq("document_id", id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("billing_kasars").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Kasar deleted" }); fetchKasars(); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <Select value={firmFilter} onValueChange={v => { setFirmFilter(v); setGroupFilter("all"); setResponsibleFilter("all"); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Firms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Firms</SelectItem>
            {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fyFilter} onValueChange={setFyFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="All FY" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All FY</SelectItem>
            {fyOptions.map(fy => <SelectItem key={fy} value={fy}>FY {fy}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupFilter} onValueChange={v => { setGroupFilter(v); setFirmFilter("all"); setResponsibleFilter("all"); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Groups" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={responsibleFilter} onValueChange={v => { setResponsibleFilter(v); setFirmFilter("all"); setGroupFilter("all"); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Responsible Person" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Persons</SelectItem>
            {responsiblePersons.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <SearchableSelect
          options={[{ value: "all", label: "All Clients" }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
          value={clientFilter}
          onValueChange={setClientFilter}
          placeholder="All Clients"
          searchPlaceholder="Search client..."
          className="w-[180px]"
        />
        <Select value={modeFilter} onValueChange={setModeFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="All Modes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modes</SelectItem>
            {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="outline" className="gap-1" onClick={handleExportXlsx} disabled={filtered.length === 0}>
          <Download size={14} /> Export Excel
        </Button>
        <Button className="gap-1" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus size={14} /> New Receipt
        </Button>
      </div>

      {/* Receipts Table */}
      <Card><CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Against Invoice</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No receipts found.</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{r.receipt_date ? format(new Date(r.receipt_date), "dd/MM/yyyy") : "—"}</TableCell>
                  <TableCell className="font-medium">{clientMap[r.client_id] || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {r.receipt_type === "against_invoice" ? "Against Invoice" : "On Account"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {Number(r.amount_received) > 0 ? `₹${Number(r.amount_received).toLocaleString("en-IN")}` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {Number(r.amount_received) > 0 ? r.payment_mode : <Badge variant="secondary" className="text-xs">TDS only</Badge>}
                  </TableCell>
                  <TableCell className="text-sm font-mono">{r.invoice_id ? (invoiceMap[r.invoice_id] || "—") : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {(r.tds_amount || 0) > 0 ? `₹${Number(r.tds_amount).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => handleEdit(r)}>
                        <Pencil size={13} className="text-blue-600" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDelete(r.id)}>
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {filtered.length > 0 && (
              <TableFooter>
                <TableRow className="font-semibold">
                  <TableCell colSpan={3}>Total ({filtered.length} receipt{filtered.length !== 1 ? "s" : ""})</TableCell>
                  <TableCell className="text-right tabular-nums">₹{totals.amount.toLocaleString("en-IN")}</TableCell>
                  <TableCell colSpan={2} />
                  <TableCell className="text-right tabular-nums">₹{totals.tds.toLocaleString("en-IN")}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </CardContent></Card>

      {/* Kasar Section */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Scissors size={15} className="text-orange-600" /> Kasar (Write-off / Discount Settlement)
            </CardTitle>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={() => { resetKasarForm(); setKasarDialogOpen(true); }}>
              <Plus size={13} /> Add Kasar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {kasarLoading ? (
            <div className="p-4 space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : filteredKasars.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 pb-4">No kasar entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKasars.map(k => (
                  <TableRow key={k.id}>
                    <TableCell className="text-sm">{k.kasar_date ? format(new Date(k.kasar_date), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell className="font-medium">{clientMap[k.client_id] || "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-orange-700">₹{Number(k.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{k.narration || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => handleEditKasar(k)}>
                          <Pencil size={13} className="text-blue-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDeleteKasar(k.id)}>
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Receipt Dialog (Create / Edit) */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) resetForm(); setDialogOpen(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt size={18} /> {editingId ? "Edit Receipt" : "New Receipt"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="font-medium">Receipt Type *</Label>
              <RadioGroup value={receiptType} onValueChange={(v: any) => { setReceiptType(v); setFormInvoiceId(""); }} className="flex gap-6">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="against_invoice" id="rt-against" />
                  <Label htmlFor="rt-against" className="cursor-pointer">Against Invoice</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="on_account" id="rt-onaccount" />
                  <Label htmlFor="rt-onaccount" className="cursor-pointer">On Account</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="allocate" id="rt-allocate" />
                  <Label htmlFor="rt-allocate" className="cursor-pointer">Split across invoices</Label>
                </div>
              </RadioGroup>
            </div>

            {firms.length > 1 && (
              <div className="space-y-1">
                <Label>Firm *</Label>
                <Select value={formFirmId} onValueChange={setFormFirmId}>
                  <SelectTrigger><SelectValue placeholder="Select firm" /></SelectTrigger>
                  <SelectContent>
                    {firms.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>Client *</Label>
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name }))}
                value={formClientId}
                onValueChange={setFormClientId}
                placeholder="Select client"
                searchPlaceholder="Search client..."
                className="w-full"
              />
            </div>

            {formClientGstins.length > 1 && (
              <div className="space-y-1">
                <Label>GSTIN / State</Label>
                <Select value={formGstin} onValueChange={setFormGstin}>
                  <SelectTrigger><SelectValue placeholder="Select GSTIN" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States (combined)</SelectItem>
                    {formClientGstins.map(({ gstin, state }) => (
                      <SelectItem key={gstin} value={gstin}>{state} — {gstin}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {receiptType === "against_invoice" && formClientId && (
              <div className="space-y-1">
                <Label>Against Invoice</Label>
                <Select value={formInvoiceId} onValueChange={setFormInvoiceId}>
                  <SelectTrigger><SelectValue placeholder="Select invoice" /></SelectTrigger>
                  <SelectContent>
                    {clientInvoices.length === 0 ? (
                      <SelectItem value="__none" disabled>No outstanding invoices</SelectItem>
                    ) : clientInvoices.map((inv: any) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_no} — ₹{Number(inv.total_amount || 0).toLocaleString("en-IN")} — Due: {inv.due_date ? format(new Date(inv.due_date), "dd/MM/yyyy") : "N/A"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {receiptType === "allocate" && formClientId && (
              <div className="space-y-1">
                <Label>Allocate to invoices</Label>
                {clientInvoices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No outstanding invoices for this client.</p>
                ) : (
                  <div className="rounded-md border divide-y">
                    {clientInvoices.map((inv: any) => (
                      <div key={inv.id} className="flex items-center gap-2 px-2 py-1.5">
                        <div className="flex-1 text-xs">
                          {inv.invoice_no} — ₹{Number(inv.total_amount || 0).toLocaleString("en-IN")}
                        </div>
                        <Input type="number" className="w-28 h-8 text-xs" placeholder="0.00" min="0" step="0.01"
                          value={allocations[inv.id] ?? ""}
                          onChange={e => setAllocations(prev => ({ ...prev, [inv.id]: e.target.value }))} />
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-2 py-1.5 text-xs font-medium">
                      <span>Allocated</span>
                      <span className={cn(Math.abs(allocTotal - settlementTotal) > 0.005 && "text-destructive")}>
                        ₹{allocTotal.toLocaleString("en-IN")} / ₹{settlementTotal.toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">Total allocated must equal the settlement (amount + TDS + GST-TDS).</p>
              </div>
            )}

            <div className="space-y-1">
              <Label>Receipt Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !receiptDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {receiptDate ? format(receiptDate, "dd/MM/yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={receiptDate} onSelect={setReceiptDate} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label>Amount Received (₹){!(Number(tdsAmount) > 0 || Number(gstTdsAmount) > 0) && " *"}</Label>
              <Input type="number" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} placeholder="0.00" min="0" step="0.01" />
              <p className="text-[11px] text-muted-foreground">Optional when you enter TDS / GST TDS below — leave blank to record TDS only.</p>
            </div>

            <div className="space-y-1">
              <Label>Payment Mode{Number(amountReceived) > 0 && " *"}</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Payment Reference</Label>
              <Input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} placeholder="Cheque No / UTR / Transaction ID" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>TDS Amount (₹)</Label>
                <Input type="number" value={tdsAmount} onChange={e => setTdsAmount(e.target.value)} placeholder="0" min="0" />
              </div>
              <div className="space-y-1">
                <Label>GST TDS Amount (₹)</Label>
                <Input type="number" value={gstTdsAmount} onChange={e => setGstTdsAmount(e.target.value)} placeholder="0" min="0" />
              </div>
            </div>

            {Number(tdsAmount) > 0 && (
              <div className="space-y-1">
                <Label>TDS Deduction Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !tdsDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {tdsDate ? format(tdsDate, "dd/MM/yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={tdsDate} onSelect={setTdsDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            <div className="space-y-1">
              <Label>Remarks</Label>
              <Input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update Receipt" : "Save Receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kasar Dialog */}
      <Dialog open={kasarDialogOpen} onOpenChange={open => { if (!open) resetKasarForm(); setKasarDialogOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors size={18} /> {editingKasarId ? "Edit Kasar" : "Add Kasar"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Client *</Label>
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name }))}
                value={kasarClientId}
                onValueChange={setKasarClientId}
                placeholder="Select client"
                searchPlaceholder="Search client..."
                className="w-full"
              />
            </div>

            <div className="space-y-1">
              <Label>Kasar Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !kasarDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {kasarDate ? format(kasarDate, "dd/MM/yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={kasarDate} onSelect={setKasarDate} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input type="number" value={kasarAmount} onChange={e => setKasarAmount(e.target.value)} placeholder="0.00" min="0.01" step="0.01" />
            </div>

            {kasarClientId && (
              <div className="space-y-1">
                <Label>Settle Against Invoice (optional)</Label>
                <Select value={kasarInvoiceId} onValueChange={setKasarInvoiceId}>
                  <SelectTrigger><SelectValue placeholder="Select invoice (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {kasarInvoices.map((inv: any) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_no} — ₹{Number(inv.total_amount || 0).toLocaleString("en-IN")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>Narration</Label>
              <Input value={kasarNarration} onChange={e => setKasarNarration(e.target.value)} placeholder="Reason for kasar / write-off" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setKasarDialogOpen(false); resetKasarForm(); }} disabled={savingKasar}>Cancel</Button>
            <Button onClick={handleSaveKasar} disabled={savingKasar}>
              {savingKasar ? "Saving..." : editingKasarId ? "Update Kasar" : "Add Kasar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
