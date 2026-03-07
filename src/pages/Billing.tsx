import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, IndianRupee, Clock, AlertTriangle, FileText, Send,
  CheckCircle2, Pencil, Eye, CreditCard,
} from "lucide-react";

interface Invoice {
  id: string;
  invoice_no: string | null;
  client_id: string | null;
  firm_id: string | null;
  amount: number | null;
  gst_amount: number | null;
  line_items: any;
  status: string | null;
  due_date: string | null;
}

interface ClientMap {
  [id: string]: { name: string; entity_type: string | null };
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/15 text-blue-600",
  paid: "bg-emerald-500/15 text-emerald-600",
  overdue: "bg-destructive/15 text-destructive",
};

const Billing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clientMap, setClientMap] = useState<ClientMap>({});
  const [timesheetHours, setTimesheetHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [editInvoiceNo, setEditInvoiceNo] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Mark paid confirmation
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch invoices
      let iQuery = supabase.from("invoices").select("*").order("due_date", { ascending: false });
      if (!isSuperadmin && firmId) iQuery = iQuery.eq("firm_id", firmId);
      const { data: invData } = await iQuery;

      // Fetch clients for mapping
      let cQuery = supabase.from("clients").select("id, name, entity_type");
      if (!isSuperadmin && firmId) cQuery = cQuery.eq("firm_id", firmId);
      const { data: clientData } = await cQuery;

      const cMap: ClientMap = {};
      (clientData || []).forEach((c) => {
        cMap[c.id] = { name: c.name || "Unknown", entity_type: c.entity_type };
      });

      // Fetch this month's timesheet hours
      const now = new Date();
      const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");
      let tQuery = supabase
        .from("timesheets")
        .select("hours")
        .gte("work_date", monthStart)
        .lte("work_date", monthEnd);
      if (!isSuperadmin && firmId) {
        // Timesheets don't have firm_id, filter by user
      }
      const { data: tsData } = await tQuery;
      const totalHours = (tsData || []).reduce((s, t) => s + (t.hours || 0), 0);

      setInvoices((invData as Invoice[]) || []);
      setClientMap(cMap);
      setTimesheetHours(totalHours);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [firmId, isSuperadmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Compute effective status (mark overdue)
  const enrichedInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return invoices.map((inv) => {
      let effectiveStatus = inv.status || "draft";
      if (effectiveStatus !== "paid" && inv.due_date && new Date(inv.due_date) < today) {
        effectiveStatus = "overdue";
      }
      return { ...inv, effectiveStatus };
    });
  }, [invoices]);

  // Stats
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    const monthStart = startOfMonth(now);

    const outstanding = enrichedInvoices
      .filter((i) => i.effectiveStatus !== "paid")
      .reduce((s, i) => s + (i.amount || 0) + (i.gst_amount || 0), 0);

    const collectedThisMonth = enrichedInvoices
      .filter((i) => i.effectiveStatus === "paid")
      .reduce((s, i) => s + (i.amount || 0) + (i.gst_amount || 0), 0);

    const overdueCount = enrichedInvoices.filter((i) => i.effectiveStatus === "overdue").length;

    return { outstanding, collectedThisMonth, overdueCount, timesheetHours };
  }, [enrichedInvoices, timesheetHours]);

  // Filter
  const filtered = useMemo(() => {
    return enrichedInvoices.filter((inv) => {
      if (statusFilter !== "all" && inv.effectiveStatus !== statusFilter) return false;
      if (search) {
        const clientName = clientMap[inv.client_id || ""]?.name || "";
        if (
          !(inv.invoice_no || "").toLowerCase().includes(search.toLowerCase()) &&
          !clientName.toLowerCase().includes(search.toLowerCase())
        ) return false;
      }
      return true;
    });
  }, [enrichedInvoices, statusFilter, search, clientMap]);

  // Edit handlers
  const openEdit = (inv: Invoice) => {
    setEditInvoice(inv);
    setEditInvoiceNo(inv.invoice_no || "");
    setEditStatus(inv.status || "draft");
    setEditDueDate(inv.due_date || "");
    setEditAmount(inv.amount != null ? String(inv.amount) : "");
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editInvoice) return;
    setEditSaving(true);
    try {
      const newAmount = editAmount ? parseFloat(editAmount) : null;
      const newGst = newAmount != null ? Math.round(newAmount * 0.18 * 100) / 100 : editInvoice.gst_amount;
      const { data: updated, error } = await supabase
        .from("invoices")
        .update({
          invoice_no: editInvoiceNo || null,
          status: editStatus,
          due_date: editDueDate || null,
          amount: newAmount,
          gst_amount: newGst,
        })
        .eq("id", editInvoice.id)
        .select();
      if (error) throw error;
      if (!updated || updated.length === 0) throw new Error("Update failed — no rows modified.");
      toast({ title: "Invoice updated" });
      setEditOpen(false);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  // Mark paid
  const handleMarkPaid = async () => {
    if (!markPaidId) return;
    setMarkingPaid(true);
    try {
      const { error } = await supabase
        .from("invoices")
        .update({ status: "paid" })
        .eq("id", markPaidId);
      if (error) throw error;
      toast({ title: "Invoice marked as paid" });
      setMarkPaidId(null);
      fetchData();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setMarkingPaid(false);
    }
  };

  // Send to client
  const handleSend = async (inv: Invoice) => {
    try {
      const total = (inv.amount || 0) + (inv.gst_amount || 0);
      const { error: fnError } = await supabase.functions.invoke("send-notification", {
        body: {
          type: "invoice_generated",
          firm_id: inv.firm_id,
          client_id: inv.client_id,
          payload: {
            invoice_no: inv.invoice_no,
            amount: total,
          },
        },
      });
      if (fnError) throw fnError;
      // Update status to sent
      await supabase.from("invoices").update({ status: "sent" }).eq("id", inv.id);
      toast({ title: "Invoice sent to client" });
      fetchData();
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    }
  };

  // View PDF (open in new tab with print-friendly HTML)
  const handleViewPdf = (inv: Invoice) => {
    const clientName = clientMap[inv.client_id || ""]?.name || "Client";
    const lineItems = Array.isArray(inv.line_items) ? inv.line_items : [];
    const subtotal = inv.amount || 0;
    const gst = inv.gst_amount || 0;
    const total = subtotal + gst;

    const rows = lineItems.map((item: any, i: number) =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.description || ""}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${item.hours || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${(item.rate || 0).toLocaleString("en-IN")}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${(item.amount || 0).toLocaleString("en-IN")}</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html><html><head><title>Invoice ${inv.invoice_no}</title>
      <style>body{font-family:system-ui,sans-serif;margin:40px;color:#1a1a1a}
      table{width:100%;border-collapse:collapse}
      .header{display:flex;justify-content:space-between;margin-bottom:32px}
      .total-row{font-weight:700}
      @media print{body{margin:20px}}</style></head><body>
      <div class="header">
        <div><h1 style="margin:0;font-size:28px">INVOICE</h1>
        <p style="color:#666;margin:4px 0">${inv.invoice_no || "—"}</p></div>
        <div style="text-align:right">
          <p style="margin:4px 0"><strong>Client:</strong> ${clientName}</p>
          <p style="margin:4px 0"><strong>Due:</strong> ${inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}</p>
          <p style="margin:4px 0"><strong>Status:</strong> ${inv.status || "draft"}</p>
        </div>
      </div>
      <table>
        <thead><tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left">#</th>
          <th style="padding:8px;text-align:left">Description</th>
          <th style="padding:8px;text-align:right">Hours</th>
          <th style="padding:8px;text-align:right">Rate</th>
          <th style="padding:8px;text-align:right">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="4" style="padding:8px;text-align:right">Subtotal</td>
          <td style="padding:8px;text-align:right">₹${subtotal.toLocaleString("en-IN")}</td></tr>
          <tr><td colspan="4" style="padding:8px;text-align:right">GST @ 18%</td>
          <td style="padding:8px;text-align:right">₹${gst.toLocaleString("en-IN")}</td></tr>
          <tr class="total-row"><td colspan="4" style="padding:8px;text-align:right;font-size:18px">Total</td>
          <td style="padding:8px;text-align:right;font-size:18px">₹${total.toLocaleString("en-IN")}</td></tr>
        </tfoot>
      </table>
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:14px">
        <p>Thank you for your business.</p>
      </div>
      <script>window.print()</script></body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const statCards = [
    { label: "Outstanding Amount", value: `₹${stats.outstanding.toLocaleString("en-IN")}`, icon: IndianRupee, color: "text-foreground" },
    { label: "Collected This Month", value: `₹${stats.collectedThisMonth.toLocaleString("en-IN")}`, icon: CheckCircle2, color: "text-emerald-600" },
    { label: "Overdue Invoices", value: stats.overdueCount, icon: AlertTriangle, color: stats.overdueCount > 0 ? "text-destructive" : "text-muted-foreground" },
    { label: "Timesheet Hours (Month)", value: stats.timesheetHours.toFixed(1), icon: Clock, color: "text-foreground" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Billing</h1>
          <p className="text-sm text-muted-foreground">Invoices, payments, and fee management.</p>
        </div>
        <Button onClick={() => navigate("/billing/new")}>
          <Plus className="h-4 w-4 mr-1" /> New Invoice
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
                <s.icon className={cn("h-4 w-4 text-muted-foreground", s.color)} />
              </div>
              <p className={cn("text-2xl font-display font-bold", s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search invoice or client..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[240px]"
        />
      </div>

      {/* Invoice Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Amount (₹)</TableHead>
                  <TableHead className="text-right">GST (₹)</TableHead>
                  <TableHead className="text-right">Total (₹)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No invoices found. Click "New Invoice" to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((inv) => {
                    const clientName = clientMap[inv.client_id || ""]?.name || "—";
                    const total = (inv.amount || 0) + (inv.gst_amount || 0);

                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-sm">{inv.invoice_no || "—"}</TableCell>
                        <TableCell className="font-medium">{clientName}</TableCell>
                        <TableCell className="text-right tabular-nums">{(inv.amount || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right tabular-nums">{(inv.gst_amount || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">₹{total.toLocaleString("en-IN")}</TableCell>
                        <TableCell>
                          <Badge className={cn("text-[10px] capitalize", STATUS_COLORS[inv.effectiveStatus] || STATUS_COLORS.draft)}>
                            {inv.effectiveStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-0.5">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="View PDF" onClick={() => handleViewPdf(inv)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Send" onClick={() => handleSend(inv)}>
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                            {inv.effectiveStatus !== "paid" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Mark Paid" onClick={() => setMarkPaidId(inv.id)}>
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(inv)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Invoice Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>Edit Invoice</SheetTitle></SheetHeader>
          <div className="space-y-4 py-6">
            <div>
              <label className="text-sm font-medium text-foreground">Invoice No</label>
              <Input value={editInvoice?.invoice_no || ""} disabled className="bg-muted" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Status</label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Due Date</label>
              <Input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? "Saving..." : "Save Changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Mark Paid Confirmation */}
      <AlertDialog open={!!markPaidId} onOpenChange={(o) => !o && setMarkPaidId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Invoice as Paid?</AlertDialogTitle>
            <AlertDialogDescription>This will update the invoice status to paid.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkPaid} disabled={markingPaid}>
              {markingPaid ? "Updating..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Billing;
