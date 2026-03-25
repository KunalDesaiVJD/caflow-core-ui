import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, differenceInDays, isAfter, isBefore, addDays } from "date-fns";
import {
  Plus, Download, AlertTriangle, Clock, FileText, Eye,
  Scale, Receipt, Building2, Shield, Landmark, FileWarning,
  CalendarDays, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NOTICE_TYPES = [
  { value: "income_tax_demand_143_1", label: "IT Demand", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: Scale },
  { value: "scrutiny_notice_143_2", label: "Scrutiny", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400", icon: FileText },
  { value: "deficiency_memo", label: "Deficiency", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400", icon: FileWarning },
  { value: "gstn_notice", label: "GST Notice", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", icon: Receipt },
  { value: "tds_mismatch_26as", label: "TDS Mismatch", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", icon: AlertTriangle },
  { value: "roc_notice", label: "ROC", color: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400", icon: Building2 },
  { value: "pf_esic_notice", label: "PF/ESIC", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: Shield },
  { value: "custom", label: "Custom", color: "bg-muted text-muted-foreground", icon: Landmark },
] as const;

const STATUSES = ["Received", "Under Review", "Reply Drafted", "Reply Filed", "Awaiting Order", "Order Received", "Closed/Dropped"] as const;
const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

function getNoticeTypeMeta(type: string) {
  return NOTICE_TYPES.find(t => t.value === type) || NOTICE_TYPES[7];
}

function getDueDateStyle(dueDate: string | null, extDate: string | null) {
  const d = extDate || dueDate;
  if (!d) return { className: "", label: "" };
  const days = differenceInDays(new Date(d), new Date());
  const prefix = extDate ? "Ext. " : "";
  if (days < 0) return { className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", label: `${prefix}${format(new Date(d), "dd MMM yyyy")} (Overdue)` };
  if (days <= 3) return { className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", label: `${prefix}${format(new Date(d), "dd MMM yyyy")}` };
  if (days <= 7) return { className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400", label: `${prefix}${format(new Date(d), "dd MMM yyyy")}` };
  return { className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", label: `${prefix}${format(new Date(d), "dd MMM yyyy")}` };
}

const priorityColors: Record<string, string> = {
  Critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  High: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Low: "bg-muted text-muted-foreground",
};

export default function NoticeTracker() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [filters, setFilters] = useState({ type: "all", status: "all", priority: "all", client: "all", ay: "" });

  // Form state
  const [form, setForm] = useState({
    client_id: "", notice_type: "income_tax_demand_143_1" as string,
    notice_ref_no: "", assessment_year: "", section: "", department: "",
    notice_date: "", date_received: "", amount_demanded: "", amount_disputed: "",
    reply_due_date: "", extended_due_date: "", assigned_to: "", priority: "Medium",
    remarks: "",
  });

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ["demand_notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demand_notices")
        .select("*, clients(name), users!demand_notices_assigned_to_fkey(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients_list"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name").eq("is_draft", false).is("deleted_at", null).order("name");
      return data || [];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ["staff_list"],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, name").order("name");
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      if (!user?.firm_id) throw new Error("Firm ID not found. Please re-login.");
      const { error } = await supabase.from("demand_notices").insert({
        client_id: values.client_id,
        firm_id: user.firm_id,
        notice_type: values.notice_type,
        notice_ref_no: values.notice_ref_no || null,
        assessment_year: values.assessment_year || null,
        section: values.section || null,
        department: values.department || null,
        notice_date: values.notice_date || null,
        date_received: values.date_received || null,
        amount_demanded: values.amount_demanded ? parseFloat(values.amount_demanded) : null,
        amount_disputed: values.amount_disputed ? parseFloat(values.amount_disputed) : null,
        reply_due_date: values.reply_due_date || null,
        extended_due_date: values.extended_due_date || null,
        assigned_to: values.assigned_to || null,
        priority: values.priority,
        remarks: values.remarks || null,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["demand_notices"] });
      setAddOpen(false);
      setForm({ client_id: "", notice_type: "income_tax_demand_143_1", notice_ref_no: "", assessment_year: "", section: "", department: "", notice_date: "", date_received: "", amount_demanded: "", amount_disputed: "", reply_due_date: "", extended_due_date: "", assigned_to: "", priority: "Medium", remarks: "" });
      toast({ title: "Notice added successfully" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    return notices.filter((n: any) => {
      if (filters.type !== "all" && n.notice_type !== filters.type) return false;
      if (filters.status !== "all" && n.status !== filters.status) return false;
      if (filters.priority !== "all" && n.priority !== filters.priority) return false;
      if (filters.client !== "all" && n.client_id !== filters.client) return false;
      if (filters.ay && !n.assessment_year?.includes(filters.ay)) return false;
      return true;
    });
  }, [notices, filters]);

  // Stat cards
  const stats = useMemo(() => {
    const open = notices.filter((n: any) => n.status !== "Closed/Dropped");
    const now = new Date();
    const weekEnd = addDays(now, 7);
    const dueThisWeek = open.filter((n: any) => {
      const d = n.extended_due_date || n.reply_due_date;
      return d && !isBefore(new Date(d), now) && isBefore(new Date(d), weekEnd);
    });
    const overdue = open.filter((n: any) => {
      const d = n.extended_due_date || n.reply_due_date;
      return d && isBefore(new Date(d), now);
    });
    const awaiting = notices.filter((n: any) => n.status === "Awaiting Order");
    return { open: open.length, dueThisWeek: dueThisWeek.length, overdue: overdue.length, awaiting: awaiting.length };
  }, [notices]);

  const handleExport = () => {
    import("xlsx").then(XLSX => {
      const rows = filtered.map((n: any) => {
        const dueD = n.extended_due_date || n.reply_due_date;
        const daysRemaining = dueD ? differenceInDays(new Date(dueD), new Date()) : "";
        return {
          "Ref No": n.notice_ref_no || "-",
          "Client": n.clients?.name || "-",
          "Notice Type": getNoticeTypeMeta(n.notice_type).label,
          "AY": n.assessment_year || "-",
          "Dept": n.department || "-",
          "Section": n.section || "-",
          "Amount Demanded": n.amount_demanded ?? "",
          "Amount Disputed": n.amount_disputed ?? "",
          "Reply Due": n.reply_due_date || "",
          "Extended Due": n.extended_due_date || "",
          "Assigned To": n.users?.name || "-",
          "Priority": n.priority,
          "Status": n.status,
          "Days Remaining": daysRemaining,
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Notice Register");
      XLSX.writeFile(wb, `Notice_Register_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notice Tracker</h1>
          <p className="text-muted-foreground text-sm">Full lifecycle tracking for demand notices and compliance orders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download size={16} className="mr-1.5" /> Export XLSX
          </Button>
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <Button size="sm"><Plus size={16} className="mr-1.5" /> Add Notice</Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Add New Notice</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Client *</Label>
                    <Select value={form.client_id} onValueChange={v => setForm(p => ({ ...p, client_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>
                        {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notice Type</Label>
                    <Select value={form.notice_type} onValueChange={v => setForm(p => ({ ...p, notice_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Notice Ref No</Label><Input value={form.notice_ref_no} onChange={e => setForm(p => ({ ...p, notice_ref_no: e.target.value }))} /></div>
                  <div><Label>Assessment Year</Label><Input placeholder="2024-25" value={form.assessment_year} onChange={e => setForm(p => ({ ...p, assessment_year: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Section</Label><Input value={form.section} onChange={e => setForm(p => ({ ...p, section: e.target.value }))} /></div>
                  <div><Label>Department</Label><Input value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Notice Date</Label><Input type="date" value={form.notice_date} onChange={e => setForm(p => ({ ...p, notice_date: e.target.value }))} /></div>
                  <div><Label>Date Received</Label><Input type="date" value={form.date_received} onChange={e => setForm(p => ({ ...p, date_received: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Amount Demanded</Label><Input type="number" value={form.amount_demanded} onChange={e => setForm(p => ({ ...p, amount_demanded: e.target.value }))} /></div>
                  <div><Label>Amount Disputed</Label><Input type="number" value={form.amount_disputed} onChange={e => setForm(p => ({ ...p, amount_disputed: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Reply Due Date</Label><Input type="date" value={form.reply_due_date} onChange={e => setForm(p => ({ ...p, reply_due_date: e.target.value }))} /></div>
                  <div><Label>Extended Due Date</Label><Input type="date" value={form.extended_due_date} onChange={e => setForm(p => ({ ...p, extended_due_date: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Assigned To</Label>
                    <Select value={form.assigned_to} onValueChange={v => setForm(p => ({ ...p, assigned_to: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                      <SelectContent>
                        {staff.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Remarks</Label>
                  <Textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} rows={3} />
                </div>
                <Button
                  className="w-full"
                  disabled={!form.client_id || createMutation.isPending}
                  onClick={() => createMutation.mutate(form)}
                >
                  {createMutation.isPending ? "Saving..." : "Save Notice"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Total Open</p>
          <p className="text-3xl font-bold text-foreground">{stats.open}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Due This Week</p>
          <p className="text-3xl font-bold text-amber-600">{stats.dueThisWeek}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Overdue</p>
          <p className="text-3xl font-bold text-destructive">{stats.overdue}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Awaiting Order</p>
          <p className="text-3xl font-bold text-blue-600">{stats.awaiting}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs">Notice Type</Label>
          <Select value={filters.type} onValueChange={v => setFilters(p => ({ ...p, type: v }))}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Priority</Label>
          <Select value={filters.priority} onValueChange={v => setFilters(p => ({ ...p, priority: v }))}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Client</Label>
          <Select value={filters.client} onValueChange={v => setFilters(p => ({ ...p, client: v }))}>
            <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">AY</Label>
          <Input className="w-[100px] h-8 text-xs" placeholder="2024-25" value={filters.ay} onChange={e => setFilters(p => ({ ...p, ay: e.target.value }))} />
        </div>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Ref #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>AY</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Reply Due</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No notices found</TableCell></TableRow>
            ) : filtered.map((n: any) => {
              const typeMeta = getNoticeTypeMeta(n.notice_type);
              const dueStyle = getDueDateStyle(n.reply_due_date, n.extended_due_date);
              return (
                <TableRow key={n.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/notices/${n.id}`)}>
                  <TableCell className="font-mono text-xs">{n.notice_ref_no || "-"}</TableCell>
                  <TableCell className="font-medium">{n.clients?.name || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px]", typeMeta.color)}>
                      {typeMeta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{n.assessment_year || "-"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {n.amount_demanded != null ? `₹${Number(n.amount_demanded).toLocaleString("en-IN")}` : "-"}
                  </TableCell>
                  <TableCell>
                    {dueStyle.label ? (
                      <Badge variant="outline" className={cn("text-[10px]", dueStyle.className)}>{dueStyle.label}</Badge>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-xs">{n.users?.name || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px]", priorityColors[n.priority])}>{n.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">{n.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); navigate(`/notices/${n.id}`); }}>
                      <Eye size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
