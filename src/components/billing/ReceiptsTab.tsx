import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Plus, CalendarIcon, Receipt, Trash2 } from "lucide-react";

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

export default function ReceiptsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const firmId = user?.firm_id;
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
  const [groupFilter, setGroupFilter] = useState("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");

  // Filter data
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [responsiblePersons, setResponsiblePersons] = useState<{ id: string; name: string }[]>([]);
  const [groupClientIds, setGroupClientIds] = useState<string[]>([]);
  const [responsibleClientIds, setResponsibleClientIds] = useState<string[]>([]);

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [receiptType, setReceiptType] = useState<"against_invoice" | "on_account">("against_invoice");
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

  // Client invoices for "against invoice"
  const [clientInvoices, setClientInvoices] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let rQuery = supabase.from("billing_receipts").select("*").order("receipt_date", { ascending: false });
    if (!isSuperadmin && firmId) rQuery = rQuery.eq("firm_id", firmId);
    if (firmFilter !== "all") rQuery = rQuery.eq("firm_id", firmFilter);
    const { data: rData } = await rQuery;

    let cQuery = supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).neq("is_active", false);
    if (!isSuperadmin && firmId) cQuery = cQuery.eq("firm_id", firmId);
    const { data: cData } = await cQuery;

    const { data: firmData } = await supabase.from("firms").select("id, name, display_name");
    const { data: groupData } = await supabase.from("client_groups").select("id, name");
    const { data: usersData } = await supabase.from("users").select("id, name").neq("role", "client").eq("is_active", true);

    const cm: Record<string, string> = {};
    (cData || []).forEach((c: any) => { cm[c.id] = c.name || "Unknown"; });

    // Fetch invoice numbers for receipts
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

  useEffect(() => { fetchData(); }, [fetchData]);

  // Group filter
  useEffect(() => {
    if (groupFilter === "all") { setGroupClientIds([]); return; }
    (async () => {
      const { data } = await supabase.from("client_group_memberships").select("client_id").eq("group_id", groupFilter);
      setGroupClientIds((data || []).map((d: any) => d.client_id));
    })();
  }, [groupFilter]);

  // Responsible person filter
  useEffect(() => {
    if (responsibleFilter === "all") { setResponsibleClientIds([]); return; }
    (async () => {
      const { data } = await supabase.from("clients").select("id").eq("responsible_person_id", responsibleFilter).eq("is_draft", false).is("deleted_at", null);
      setResponsibleClientIds((data || []).map((d: any) => d.id));
    })();
  }, [responsibleFilter]);

  // Fetch invoices when client changes in form
  useEffect(() => {
    if (!formClientId || receiptType !== "against_invoice") { setClientInvoices([]); return; }
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

  const filtered = useMemo(() => receipts.filter(r => {
    if (clientFilter !== "all" && r.client_id !== clientFilter) return false;
    if (modeFilter !== "all" && r.payment_mode !== modeFilter.toLowerCase()) return false;
    if (groupFilter !== "all" && !groupClientIds.includes(r.client_id)) return false;
    if (responsibleFilter !== "all" && !responsibleClientIds.includes(r.client_id)) return false;
    return true;
  }), [receipts, clientFilter, modeFilter, groupFilter, groupClientIds, responsibleFilter, responsibleClientIds]);

  const resetForm = () => {
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

  const handleSave = async () => {
    if (!formClientId || !receiptDate || !amountReceived || Number(amountReceived) <= 0 || !paymentMode) {
      toast({ title: "Please fill all mandatory fields", variant: "destructive" });
      return;
    }
    const resolvedFirmId = await resolveFirmId();
    if (!resolvedFirmId) {
      toast({ title: "Unable to resolve firm. Please refresh and try again.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const dateStr = format(receiptDate, "yyyy-MM-dd");
    const amt = Number(amountReceived);
    const tds = Number(tdsAmount) || 0;
    const gstTds = Number(gstTdsAmount) || 0;
    const invoiceId = receiptType === "against_invoice" && formInvoiceId ? formInvoiceId : null;
    const fy = getFYFromDate(dateStr);

    try {
      // Step 1: Insert receipt
      const { data: newReceipt, error: rErr } = await supabase.from("billing_receipts").insert({
        firm_id: resolvedFirmId,
        client_id: formClientId,
        invoice_id: invoiceId,
        receipt_type: receiptType,
        receipt_date: dateStr,
        amount_received: amt,
        payment_mode: paymentMode.toLowerCase(),
        payment_reference: paymentReference || null,
        tds_amount: tds || null,
        gst_tds_amount: gstTds || null,
        tds_date: tds > 0 && tdsDate ? format(tdsDate, "yyyy-MM-dd") : null,
        remarks: remarks || null,
        created_by: user?.id,
      }).select("id").single();

      if (rErr) throw rErr;
      const receiptId = newReceipt.id;

      // Step 2: Update invoice status if against_invoice
      if (receiptType === "against_invoice" && invoiceId) {
        const inv = clientInvoices.find(i => i.id === invoiceId);
        if (inv && amt >= (inv.total_amount || 0)) {
          await supabase.from("invoices").update({ status: "paid", paid_at: dateStr }).eq("id", invoiceId);
        }
      }

      // Step 3: Ledger entry for payment
      await supabase.from("client_ledger_entries").insert({
        firm_id: resolvedFirmId,
        client_id: formClientId,
        entry_date: dateStr,
        entry_type: "receipt",
        document_id: receiptId,
        debit_amount: 0,
        credit_amount: amt,
        narration: `Payment received — ${paymentMode}`,
        financial_year: fy,
      });

      // Step 4: TDS ledger entry
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

      // Step 5: GST TDS ledger entry
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
    const { error } = await supabase.from("billing_receipts").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Receipt deleted" }); fetchData(); }
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
        <Button className="gap-1" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus size={14} /> New Receipt
        </Button>
      </div>

      {/* Table */}
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
                  <TableCell className="text-right font-semibold tabular-nums">₹{Number(r.amount_received).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-sm">{r.payment_mode}</TableCell>
                  <TableCell className="text-sm font-mono">{r.invoice_id ? (invoiceMap[r.invoice_id] || "—") : "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {(r.tds_amount || 0) > 0 ? `₹${Number(r.tds_amount).toLocaleString("en-IN")}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDelete(r.id)}>
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>

      {/* Create Receipt Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Receipt size={18} /> New Receipt</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Receipt Type */}
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
              </RadioGroup>
            </div>

            {/* Client */}
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

            {/* Against Invoice */}
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

            {/* Receipt Date */}
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

            {/* Amount */}
            <div className="space-y-1">
              <Label>Amount Received (₹) *</Label>
              <Input type="number" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} placeholder="0.00" min="0.01" step="0.01" />
            </div>

            {/* Payment Mode */}
            <div className="space-y-1">
              <Label>Payment Mode *</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Payment Reference */}
            <div className="space-y-1">
              <Label>Payment Reference</Label>
              <Input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} placeholder="Cheque No / UTR / Transaction ID" />
            </div>

            {/* TDS */}
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

            {/* TDS Date */}
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

            {/* Remarks */}
            <div className="space-y-1">
              <Label>Remarks</Label>
              <Input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Receipt"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
