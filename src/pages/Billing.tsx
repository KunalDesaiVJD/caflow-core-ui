import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { format, startOfWeek, addDays, isSameDay, startOfMonth, endOfMonth, parseISO, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, IndianRupee, Clock, AlertTriangle, FileText, Send,
  CheckCircle2, Eye, Copy, XCircle, ChevronLeft, ChevronRight,
  Trash2, BarChart3, Percent,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// ─── Types ───
interface Invoice {
  id: string;
  invoice_no: string | null;
  client_id: string | null;
  firm_id: string | null;
  amount: number | null;
  gst_amount: number | null;
  total_amount: number | null;
  status: string | null;
  due_date: string | null;
  invoice_date: string | null;
  invoice_format: string | null;
  subject: string | null;
  paid_at: string | null;
  sent_at: string | null;
  created_at?: string | null;
}

interface ClientMap {
  [id: string]: { name: string; entity_type: string | null };
}

interface TimesheetEntry {
  id: string;
  user_id: string | null;
  client_id: string | null;
  engagement_id: string | null;
  work_date: string | null;
  description: string | null;
  hours: number | null;
  billable: boolean | null;
  is_billable: boolean | null;
  is_invoiced: boolean | null;
  approved_by: string | null;
  service_category_id: string | null;
  minutes: number | null;
}

interface ClientOption { id: string; name: string | null; }
interface UserOption { id: string; name: string | null; }

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  finalized: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  sent: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  voided: "bg-destructive/15 text-destructive",
  overdue: "bg-destructive/15 text-destructive",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const Billing = () => {
  const [activeTab, setActiveTab] = useState("invoices");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Billing & Timesheet</h1>
        <p className="text-sm text-muted-foreground">Invoices, time tracking, and revenue reports</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="invoices" className="gap-2"><FileText size={14} /> Invoices</TabsTrigger>
          <TabsTrigger value="timesheet" className="gap-2"><Clock size={14} /> Timesheet</TabsTrigger>
          <TabsTrigger value="reports" className="gap-2"><BarChart3 size={14} /> Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices"><InvoicesTab /></TabsContent>
        <TabsContent value="timesheet"><TimesheetTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
};

// ═══════════════════════════════════════
// INVOICES TAB
// ═══════════════════════════════════════
function InvoicesTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clientMap, setClientMap] = useState<ClientMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [voidId, setVoidId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let iQuery = supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
    if (!isSuperadmin && firmId) iQuery = iQuery.eq("firm_id", firmId);
    const { data: invData } = await iQuery;

    let cQuery = supabase.from("clients").select("id, name, entity_type");
    if (!isSuperadmin && firmId) cQuery = cQuery.eq("firm_id", firmId);
    const { data: clientData } = await cQuery;

    const cMap: ClientMap = {};
    (clientData || []).forEach(c => { cMap[c.id] = { name: c.name || "Unknown", entity_type: c.entity_type }; });

    setInvoices((invData as Invoice[]) || []);
    setClientMap(cMap);
    setLoading(false);
  }, [firmId, isSuperadmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const enriched = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return invoices.map(inv => {
      let effectiveStatus = inv.status || "draft";
      if (!["paid", "voided"].includes(effectiveStatus) && inv.due_date && new Date(inv.due_date) < today) {
        effectiveStatus = "overdue";
      }
      return { ...inv, effectiveStatus };
    });
  }, [invoices]);

  const stats = useMemo(() => {
    const outstanding = enriched.filter(i => !["paid", "voided"].includes(i.effectiveStatus))
      .reduce((s, i) => s + (i.total_amount || i.amount || 0), 0);
    const collected = enriched.filter(i => i.effectiveStatus === "paid")
      .reduce((s, i) => s + (i.total_amount || i.amount || 0), 0);
    const overdue = enriched.filter(i => i.effectiveStatus === "overdue").length;
    const drafts = enriched.filter(i => i.effectiveStatus === "draft").length;
    return { outstanding, collected, overdue, drafts };
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter(inv => {
    if (statusFilter !== "all" && inv.effectiveStatus !== statusFilter) return false;
    if (search) {
      const cn = clientMap[inv.client_id || ""]?.name || "";
      if (!(inv.invoice_no || "").toLowerCase().includes(search.toLowerCase()) &&
        !cn.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  }), [enriched, statusFilter, search, clientMap]);

  const handleVoid = async () => {
    if (!voidId) return;
    await supabase.from("invoices").update({ status: "voided" }).eq("id", voidId);
    toast({ title: "Invoice voided" });
    setVoidId(null);
    fetchData();
  };

  const handleDuplicate = async (inv: Invoice) => {
    // Get next invoice number
    const { data: lastInv } = await supabase.from("invoices").select("invoice_no")
      .eq("firm_id", firmId).order("invoice_no", { ascending: false }).limit(1);
    let nextNum = 1;
    if (lastInv?.[0]?.invoice_no) {
      const match = lastInv[0].invoice_no.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1]) + 1;
    }
    const newNo = `INV-${String(nextNum).padStart(4, "0")}`;

    const { error } = await supabase.from("invoices").insert({
      ...inv,
      id: undefined,
      invoice_no: newNo,
      status: "draft",
      invoice_date: format(new Date(), "yyyy-MM-dd"),
      due_date: format(addDays(new Date(), 30), "yyyy-MM-dd"),
      sent_at: null,
      paid_at: null,
    } as any);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Duplicated as ${newNo}` }); fetchData(); }
  };

  const handleSend = async (inv: Invoice) => {
    const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
    await supabase.functions.invoke("send-notification", {
      body: { type: "invoice_generated", firm_id: inv.firm_id, client_id: inv.client_id, payload: { invoice_no: inv.invoice_no, amount: total } },
    });
    await supabase.from("invoices").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", inv.id);
    toast({ title: "Invoice sent" });
    fetchData();
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Outstanding", value: `₹${stats.outstanding.toLocaleString("en-IN")}`, icon: IndianRupee },
          { label: "Collected", value: `₹${stats.collected.toLocaleString("en-IN")}`, icon: CheckCircle2 },
          { label: "Overdue", value: stats.overdue, icon: AlertTriangle },
          { label: "Drafts", value: stats.drafts, icon: FileText },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
            <s.icon size={18} className="text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {["draft", "finalized", "sent", "paid", "voided", "overdue"].map(s =>
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Input placeholder="Search invoice or client..." value={search} onChange={e => setSearch(e.target.value)} className="w-[240px]" />
        <div className="flex-1" />
        <Button onClick={() => navigate("/billing/new")} className="gap-1"><Plus size={14} /> New Invoice</Button>
      </div>

      {/* Table */}
      <Card><CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No invoices found.</TableCell></TableRow>
              ) : filtered.map(inv => {
                const clientName = clientMap[inv.client_id || ""]?.name || "—";
                const total = inv.total_amount || (inv.amount || 0) + (inv.gst_amount || 0);
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.invoice_no || "—"}</TableCell>
                    <TableCell className="font-medium">{clientName}</TableCell>
                    <TableCell className="text-sm">{inv.invoice_date ? format(new Date(inv.invoice_date), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">₹{total.toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs capitalize", STATUS_COLORS[inv.effectiveStatus])}>{inv.effectiveStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{inv.due_date ? format(new Date(inv.due_date), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="View/Edit" onClick={() => navigate(`/billing/edit/${inv.id}`)}>
                          <Eye size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => handleDuplicate(inv)}>
                          <Copy size={14} />
                        </Button>
                        {inv.effectiveStatus === "draft" || inv.effectiveStatus === "finalized" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Send" onClick={() => handleSend(inv)}>
                            <Send size={14} />
                          </Button>
                        ) : null}
                        {inv.effectiveStatus !== "voided" && inv.effectiveStatus !== "paid" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Void" onClick={() => setVoidId(inv.id)}>
                            <XCircle size={14} className="text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>

      {/* Void confirmation */}
      <AlertDialog open={!!voidId} onOpenChange={() => setVoidId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Invoice?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently void the invoice. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleVoid}>Void Invoice</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════
// TIMESHEET TAB
// ═══════════════════════════════════════
function TimesheetTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isManager = ["firm_admin", "partner_ca", "manager"].includes(user?.role || "");
  const firmId = user?.firm_id;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState(user?.id || "");

  // Add form state
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [addClient, setAddClient] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addHours, setAddHours] = useState("1");
  const [addBillable, setAddBillable] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    (async () => {
      let q = supabase.from("clients").select("id, name").order("name");
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data } = await q;
      setClients(data || []);
    })();
    (async () => {
      if (isManager || isSuperadmin) {
        let q = supabase.from("users").select("id, name").eq("is_active", true);
        if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
        const { data } = await q;
        setUsers(data || []);
      } else {
        setUsers(user ? [{ id: user.id, name: user.name }] : []);
      }
    })();
  }, [firmId, isSuperadmin, isManager, user]);

  const fetchWeek = useCallback(async () => {
    setLoading(true);
    const from = format(weekDates[0], "yyyy-MM-dd");
    const to = format(weekDates[6], "yyyy-MM-dd");
    let q = supabase.from("timesheets").select("*").gte("work_date", from).lte("work_date", to).order("work_date");
    if (selectedStaff) q = q.eq("user_id", selectedStaff);
    const { data } = await q;
    setEntries((data as TimesheetEntry[]) || []);
    setLoading(false);
  }, [weekDates, selectedStaff]);

  useEffect(() => { fetchWeek(); }, [fetchWeek]);

  const dayEntries = (date: Date) => entries.filter(e => e.work_date && isSameDay(parseISO(e.work_date), date));
  const dayTotals = weekDates.map(d => dayEntries(d).reduce((s, e) => s + (e.hours || 0), 0));
  const weekTotal = dayTotals.reduce((s, t) => s + t, 0);
  const weekBillable = entries.filter(e => e.billable || e.is_billable).reduce((s, e) => s + (e.hours || 0), 0);
  const utilisation = weekTotal > 0 ? Math.round((weekBillable / weekTotal) * 100) : 0;

  const clientName = (id: string | null) => clients.find(c => c.id === id)?.name || "—";

  const handleAdd = async () => {
    if (!addDate || !addClient || !addDesc.trim()) return;
    const hrs = parseFloat(addHours);
    if (isNaN(hrs) || hrs < 0 || hrs > 24) {
      toast({ title: "Hours must be between 0 and 24.", variant: "destructive" });
      return;
    }
    setAddSaving(true);
    const { error } = await supabase.from("timesheets").insert({
      user_id: selectedStaff || user?.id,
      client_id: addClient,
      work_date: format(addDate, "yyyy-MM-dd"),
      description: addDesc.trim(),
      hours: hrs,
      billable: addBillable,
      is_billable: addBillable,
      firm_id: firmId,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Entry added" }); setAddDate(null); setAddClient(""); setAddDesc(""); setAddHours("1"); fetchWeek(); }
    setAddSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("timesheets").delete().eq("id", id);
    fetchWeek();
  };

  const handleApproveWeek = async () => {
    const from = format(weekDates[0], "yyyy-MM-dd");
    const to = format(weekDates[6], "yyyy-MM-dd");
    const { error } = await supabase.from("timesheets")
      .update({ approved_by: user?.id, approved_at: new Date().toISOString() })
      .eq("user_id", selectedStaff)
      .gte("work_date", from).lte("work_date", to)
      .is("approved_by", null);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Week approved" }); fetchWeek(); }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {(isManager || isSuperadmin) && (
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select staff" /></SelectTrigger>
            <SelectContent>
              {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="icon" onClick={() => setWeekStart(w => addDays(w, -7))}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-sm font-medium">{format(weekDates[0], "dd MMM")} — {format(weekDates[6], "dd MMM yyyy")}</span>
        <Button variant="outline" size="icon" onClick={() => setWeekStart(w => addDays(w, 7))}>
          <ChevronRight size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-sm">
          <span>Total: <strong>{weekTotal}h</strong></span>
          <span>Billable: <strong>{weekBillable}h</strong></span>
          <span>Utilisation: <strong>{utilisation}%</strong></span>
        </div>
        {isManager && selectedStaff && selectedStaff !== user?.id && (
          <Button size="sm" variant="outline" onClick={handleApproveWeek}>Approve Week</Button>
        )}
      </div>

      {/* Calendar grid */}
      <Card><CardContent className="p-0">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-7 divide-x divide-border">
              {weekDates.map((date, dayIdx) => {
                const de = dayEntries(date);
                const isToday = isSameDay(date, new Date());
                return (
                  <div key={dayIdx} className={cn("min-h-[160px] flex flex-col", isToday && "bg-accent/30")}>
                    <div className="px-2 py-1.5 border-b border-border text-center">
                      <p className="text-[10px] uppercase text-muted-foreground font-semibold">{WEEKDAYS[dayIdx]}</p>
                      <p className={cn("text-sm font-medium", isToday ? "text-primary" : "text-foreground")}>{format(date, "d")}</p>
                    </div>
                    <div className="flex-1 p-1 space-y-1 overflow-y-auto max-h-[200px]">
                      {de.map(entry => (
                        <div key={entry.id} className={cn(
                          "rounded px-1.5 py-1 text-[11px] leading-tight",
                          entry.approved_by ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800" :
                            (entry.billable || entry.is_billable) ? "bg-primary/10 text-primary border border-primary/20" : "bg-muted text-muted-foreground border border-border"
                        )}>
                          <p className="font-medium truncate">{clientName(entry.client_id)}</p>
                          <p className="truncate opacity-80">{entry.description}</p>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="font-semibold">{entry.hours}h</span>
                            <div className="flex items-center gap-1">
                              {entry.approved_by && <CheckCircle2 size={8} className="text-emerald-600" />}
                              {entry.is_invoiced && <IndianRupee size={8} className="text-blue-600" />}
                              <button onClick={() => handleDelete(entry.id)} className="text-destructive/60 hover:text-destructive">
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-1 border-t border-border">
                      <Popover
                        open={addDate ? isSameDay(addDate, date) : false}
                        onOpenChange={open => {
                          if (open) { setAddDate(date); setAddClient(""); setAddDesc(""); setAddHours("1"); setAddBillable(true); }
                          else setAddDate(null);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full h-6 text-[10px]"><Plus size={10} className="mr-0.5" /> Add</Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3 space-y-3" align="start">
                          <p className="text-sm font-semibold">{format(date, "EEE, dd MMM yyyy")}</p>
                          <div>
                            <Label className="text-xs">Client *</Label>
                            <Select value={addClient} onValueChange={setAddClient}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                              <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Description *</Label>
                            <Textarea value={addDesc} onChange={e => setAddDesc(e.target.value)} className="text-xs h-16 resize-none" placeholder="Work done..." />
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Label className="text-xs">Hours</Label>
                              <Input type="number" step="0.5" min="0.5" max="16" value={addHours} onChange={e => setAddHours(e.target.value)} className="h-8 text-xs" />
                            </div>
                            <div className="flex items-end gap-2 pb-0.5">
                              <Switch checked={addBillable} onCheckedChange={setAddBillable} />
                              <span className="text-xs text-muted-foreground">Billable</span>
                            </div>
                          </div>
                          <Button size="sm" className="w-full" onClick={handleAdd} disabled={addSaving}>{addSaving ? "Saving..." : "Add Entry"}</Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Day totals row */}
            <div className="grid grid-cols-7 border-t border-border bg-muted/30">
              {dayTotals.map((t, i) => (
                <div key={i} className="text-center py-1.5 text-xs font-semibold text-foreground">{t}h</div>
              ))}
            </div>
          </>
        )}
      </CardContent></Card>
    </div>
  );
}

// ═══════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════
function ReportsTab() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const firmId = user?.firm_id;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetEntry[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let iq = supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
      if (!isSuperadmin && firmId) iq = iq.eq("firm_id", firmId);
      const { data: invData } = await iq;

      let tq = supabase.from("timesheets").select("*").order("work_date", { ascending: false }).limit(1000);
      if (!isSuperadmin) tq = tq.eq("user_id", user?.id);
      const { data: tsData } = await tq;

      let uq = supabase.from("users").select("id, name").eq("is_active", true);
      if (!isSuperadmin && firmId) uq = uq.eq("firm_id", firmId);
      const { data: uData } = await uq;

      setInvoices((invData as Invoice[]) || []);
      setTimesheets((tsData as TimesheetEntry[]) || []);
      setUsers(uData || []);
      setLoading(false);
    })();
  }, [firmId, isSuperadmin, user?.id]);

  // Revenue by month
  const revenueByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.filter(i => i.status === "paid").forEach(i => {
      const month = i.paid_at ? format(new Date(i.paid_at), "MMM yyyy") : i.invoice_date ? format(new Date(i.invoice_date), "MMM yyyy") : "Unknown";
      map[month] = (map[month] || 0) + (i.total_amount || i.amount || 0);
    });
    return Object.entries(map).map(([name, revenue]) => ({ name, revenue })).slice(0, 12);
  }, [invoices]);

  // Outstanding aging
  const aging = useMemo(() => {
    const today = new Date();
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    invoices.filter(i => !["paid", "voided"].includes(i.status || "")).forEach(i => {
      const days = i.due_date ? differenceInDays(today, new Date(i.due_date)) : 0;
      const amount = i.total_amount || i.amount || 0;
      if (days <= 30) buckets["0-30"] += amount;
      else if (days <= 60) buckets["31-60"] += amount;
      else if (days <= 90) buckets["61-90"] += amount;
      else buckets["90+"] += amount;
    });
    return Object.entries(buckets).map(([name, amount]) => ({ name, amount }));
  }, [invoices]);

  // Staff utilization
  const staffUtil = useMemo(() => {
    const map: Record<string, { total: number; billable: number }> = {};
    timesheets.forEach(t => {
      const uid = t.user_id || "unknown";
      if (!map[uid]) map[uid] = { total: 0, billable: 0 };
      map[uid].total += t.hours || 0;
      if (t.billable || t.is_billable) map[uid].billable += t.hours || 0;
    });
    return Object.entries(map).map(([uid, data]) => ({
      name: users.find(u => u.id === uid)?.name || "Unknown",
      total: data.total,
      billable: data.billable,
      utilization: data.total > 0 ? Math.round((data.billable / data.total) * 100) : 0,
    }));
  }, [timesheets, users]);

  const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading reports...</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue chart */}
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Month</CardTitle></CardHeader>
          <CardContent>
            {revenueByMonth.length === 0 ? <p className="text-sm text-muted-foreground">No paid invoices yet</p> : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Aging */}
        <Card>
          <CardHeader><CardTitle className="text-base">Outstanding Aging</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={aging} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {aging.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Staff utilization */}
      <Card>
        <CardHeader><CardTitle className="text-base">Staff Utilization</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Total Hours</TableHead>
                <TableHead className="text-right">Billable Hours</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffUtil.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No timesheet data</TableCell></TableRow>
              ) : staffUtil.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-right">{s.total}h</TableCell>
                  <TableCell className="text-right">{s.billable}h</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={cn("text-xs",
                      s.utilization >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
                        s.utilization >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                          "bg-destructive/15 text-destructive"
                    )}>{s.utilization}%</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default Billing;
