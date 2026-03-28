import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Download, ArrowRight, Users2, RefreshCw, Copy,
} from "lucide-react";

interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; }
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  prn_no: string | null; tan: string | null; assigned_staff: string | null;
  last_updated_by: string | null; last_updated_at: string | null;
  remarks: string | null; created_at: string | null;
  deductor_type?: string | null; deductor_pan?: string | null;
  responsible_person_pan?: string | null; responsible_person_name?: string | null;
  is_regular_return?: boolean | null; previous_filing_token?: string | null;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigateDataEntry?: (filingId: string) => void;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const FILING_STATUSES = [
  "Not Started", "Data Entry in Progress", "Entries Completed",
  "Return Validated", "Return Prepared", "Submitted", "Accepted",
] as const;

const FILING_STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Data Entry in Progress": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Entries Completed": "bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "Return Validated": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Return Prepared": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "Submitted": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Accepted": "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

const DEDUCTOR_TYPES = [
  "Company", "Individual", "HUF", "Firm", "Trust", "AOP", "Government",
];

const getDueDate = (fy: string, quarter: string): Date => {
  const fyStart = parseInt(fy.split("-")[0]);
  const dates: Record<string, Date> = {
    Q1: new Date(fyStart, 6, 31), Q2: new Date(fyStart, 9, 31),
    Q3: new Date(fyStart + 1, 0, 31), Q4: new Date(fyStart + 1, 4, 31),
  };
  return dates[quarter] || new Date();
};

const getDueDateColor = (fy: string, quarter: string, status: string) => {
  if (["Accepted", "Submitted"].includes(status)) return "text-emerald-600";
  const due = getDueDate(fy, quarter);
  const days = differenceInDays(due, new Date());
  if (days < 0) return "text-destructive font-bold";
  if (days < 7) return "text-amber-600 font-semibold";
  return "text-emerald-600";
};

export function TdsFilingsManager({ clients, users, isSuperadmin, resolveFirmId, onNavigateDataEntry }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filings, setFilings] = useState<TdsFiling[]>([]);
  const [loading, setLoading] = useState(true);
  const [fyFilter, setFyFilter] = useState(DEFAULT_FY);
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Add/Edit drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");

  const fetchFilings = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (quarterFilter !== "all") q = q.eq("quarter", quarterFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data } = await q;
    setFilings((data || []) as TdsFiling[]);
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, fyFilter, quarterFilter, clientFilter]);

  useEffect(() => { fetchFilings(); }, [fetchFilings]);

  const filtered = useMemo(() => {
    return filings.filter(f => {
      if (formFilter !== "all" && !(f.tds_forms || []).includes(formFilter)) return false;
      if (statusFilter !== "all" && f.work_status !== statusFilter) return false;
      return true;
    });
  }, [filings, formFilter, statusFilter]);

  const openAddDrawer = () => {
    setLastCreatedId(null);
    setFormData({
      client_id: clientFilter !== "all" ? clientFilter : "",
      tan: "",
      financial_year: fyFilter !== "all" ? fyFilter : DEFAULT_FY,
      quarter: quarterFilter !== "all" ? quarterFilter : "Q1",
      forms: { "24Q": false, "26Q": true, "27Q": false, "27EQ": false },
      return_type: "regular",
      previous_token: "",
      deductor_type: "Company",
      deductor_pan: "",
      responsible_person_pan: "",
      responsible_person_name: "",
      assigned_staff: "",
      remarks: "",
    });
    setDrawerOpen(true);
  };

  const handleClientSelect = (clientId: string) => {
    const client = clients.find(c => c.id === clientId) as any;
    setFormData(prev => ({
      ...prev,
      client_id: clientId,
      tan: client?.tan_number || prev.tan || "",
      deductor_pan: client?.pan || prev.deductor_pan || "",
    }));
  };

  const handleSaveFiling = async () => {
    if (!formData.client_id) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    const selectedForms = Object.entries(formData.forms as Record<string, boolean>)
      .filter(([_, v]) => v).map(([k]) => k);
    if (selectedForms.length === 0) {
      toast({ title: "Select at least one form type", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const firmId = await resolveFirmId();
      const payload: Record<string, any> = {
        client_id: formData.client_id,
        firm_id: firmId,
        financial_year: formData.financial_year,
        quarter: formData.quarter,
        tds_forms: selectedForms,
        work_status: "Not Started",
        tan: formData.tan || null,
        assigned_staff: formData.assigned_staff || null,
        remarks: formData.remarks || null,
        deductor_type: formData.deductor_type || null,
        deductor_pan: formData.deductor_pan || null,
        responsible_person_pan: formData.responsible_person_pan || null,
        responsible_person_name: formData.responsible_person_name || null,
        is_regular_return: formData.return_type === "regular",
        previous_filing_token: formData.return_type === "correction" ? formData.previous_token || null : null,
        last_updated_by: user?.id,
        last_updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase.from("tds_filings").insert(payload as any).select("id").single();
      if (error) throw error;
      setLastCreatedId(data.id);
      toast({ title: "Filing created successfully" });
      fetchFilings();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleInlineUpdate = async (filing: TdsFiling, field: string, value: any) => {
    const { error } = await supabase.from("tds_filings").update({
      [field]: value,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else fetchFilings();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("tds_filings").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); fetchFilings(); }
  };

  const handleCopyFiling = async (f: TdsFiling) => {
    const nextQ = f.quarter === "Q1" ? "Q2" : f.quarter === "Q2" ? "Q3" : f.quarter === "Q3" ? "Q4" : "Q1";
    const nextFy = f.quarter === "Q4" ? (() => {
      const s = parseInt(f.financial_year.split("-")[0]) + 1;
      return `${s}-${String(s + 1).slice(2)}`;
    })() : f.financial_year;
    const { error } = await supabase.from("tds_filings").insert({
      client_id: f.client_id,
      firm_id: f.firm_id,
      financial_year: nextFy,
      quarter: nextQ,
      tds_forms: f.tds_forms,
      work_status: "Not Started",
      tan: f.tan,
      assigned_staff: f.assigned_staff,
      deductor_type: f.deductor_type,
      deductor_pan: f.deductor_pan,
      responsible_person_pan: f.responsible_person_pan,
      responsible_person_name: f.responsible_person_name,
      is_regular_return: true,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    } as any);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Filing copied to ${nextQ} ${nextFy}` }); fetchFilings(); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(f => f.id)));
  };

  const handleBulkAction = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    if (bulkAction.startsWith("status:")) {
      const newStatus = bulkAction.replace("status:", "");
      for (const id of ids) {
        await supabase.from("tds_filings").update({
          work_status: newStatus,
          last_updated_by: user?.id,
          last_updated_at: new Date().toISOString(),
        }).eq("id", id);
      }
      toast({ title: `${ids.length} filings updated to ${newStatus}` });
    } else if (bulkAction.startsWith("assign:")) {
      const staffId = bulkAction.replace("assign:", "");
      for (const id of ids) {
        await supabase.from("tds_filings").update({
          assigned_staff: staffId,
          last_updated_by: user?.id,
          last_updated_at: new Date().toISOString(),
        }).eq("id", id);
      }
      const staffName = users.find(u => u.id === staffId)?.name || "staff";
      toast({ title: `${ids.length} filings assigned to ${staffName}` });
    }
    setSelectedIds(new Set());
    setBulkAction("");
    fetchFilings();
  };

  const exportFilings = () => {
    const rows = filtered.map(f => {
      const c = clients.find(c => c.id === f.client_id);
      return `<tr>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${c?.name || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.tan || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.tds_forms?.join(", ") || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.quarter}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.financial_year}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.work_status}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.date_of_filing ? format(new Date(f.date_of_filing), "dd/MM/yyyy") : "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.acknowledgment_number || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.prn_no || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${users.find(u => u.id === f.assigned_staff)?.name || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.remarks || "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>TDS Filing Sheet</title><style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px;border:1px solid #ccc;padding:6px}@media print{@page{size:landscape}}</style></head><body>
      <h2>TDS Filing Sheet — FY: ${fyFilter} | Qtr: ${quarterFilter}</h2>
      <table><thead><tr><th>Client</th><th>TAN</th><th>Form</th><th>Qtr</th><th>FY</th><th>Status</th><th>Filing Date</th><th>Ack No</th><th>PRN</th><th>Due Date</th><th>Assigned</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => w.print(), 500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Filings Management</h2>
        <p className="text-sm text-muted-foreground">Create, track, and manage TDS/TCS return filings</p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">FY</Label>
          <Select value={fyFilter} onValueChange={setFyFilter}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FY</SelectItem>
              {FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Quarter</Label>
          <Select value={quarterFilter} onValueChange={setQuarterFilter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Form</Label>
          <Select value={formFilter} onValueChange={setFormFilter}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {TDS_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button size="sm" className="gap-1" onClick={openAddDrawer}>
          <Plus size={14} /> Add Filing
        </Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={exportFilings}>
          <Download size={14} /> Export
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Select value={bulkAction} onValueChange={setBulkAction}>
            <SelectTrigger className="w-[200px] h-8">
              <SelectValue placeholder="Bulk Action..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__header_status" disabled>── Update Status ──</SelectItem>
              {FILING_STATUSES.map(s => (
                <SelectItem key={`status:${s}`} value={`status:${s}`}>{s}</SelectItem>
              ))}
              <SelectItem value="__header_assign" disabled>── Assign Staff ──</SelectItem>
              {users.map(u => (
                <SelectItem key={`assign:${u.id}`} value={`assign:${u.id}`}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" onClick={handleBulkAction} disabled={!bulkAction}>
            <RefreshCw size={14} className="mr-1" /> Apply
          </Button>
        </div>
      )}

      {/* Main Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="min-w-[150px] sticky left-0 bg-background z-10">Client</TableHead>
                  <TableHead>TAN</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead className="min-w-[150px]">Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Filing Date</TableHead>
                  <TableHead>Ack No</TableHead>
                  <TableHead>PRN</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 14 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                      No filings found. Click "Add Filing" to create one.
                    </TableCell>
                  </TableRow>
                ) : filtered.map(f => {
                  const client = clients.find(c => c.id === f.client_id);
                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium sticky left-0 bg-background">{client?.name || "—"}</TableCell>
                      <TableCell>
                        <Input className="h-7 w-24 text-xs" defaultValue={f.tan || ""}
                          onBlur={e => { if (e.target.value !== (f.tan || "")) handleInlineUpdate(f, "tan", e.target.value); }}
                        />
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{f.tds_forms?.join(", ")}</Badge></TableCell>
                      <TableCell>{f.quarter}</TableCell>
                      <TableCell>{f.financial_year}</TableCell>
                      <TableCell>
                        <Select value={f.work_status} onValueChange={v => handleInlineUpdate(f, "work_status", v)}>
                          <SelectTrigger className="h-7 text-xs w-[160px]">
                            <Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status])}>{f.work_status}</Badge>
                          </SelectTrigger>
                          <SelectContent>{FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className={getDueDateColor(f.financial_year, f.quarter, f.work_status)}>
                        {format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell>
                        <Input type="date" className="h-7 w-32 text-xs" defaultValue={f.date_of_filing || ""}
                          onBlur={e => { if (e.target.value !== (f.date_of_filing || "")) handleInlineUpdate(f, "date_of_filing", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 w-28 text-xs" defaultValue={f.acknowledgment_number || ""}
                          onBlur={e => { if (e.target.value !== (f.acknowledgment_number || "")) handleInlineUpdate(f, "acknowledgment_number", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 w-24 text-xs" defaultValue={f.prn_no || ""}
                          onBlur={e => { if (e.target.value !== (f.prn_no || "")) handleInlineUpdate(f, "prn_no", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={f.assigned_staff || ""} onValueChange={v => handleInlineUpdate(f, "assigned_staff", v || null)}>
                          <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 w-28 text-xs" defaultValue={f.remarks || ""}
                          onBlur={e => { if (e.target.value !== (f.remarks || "")) handleInlineUpdate(f, "remarks", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy to next quarter" onClick={() => handleCopyFiling(f)}>
                            <Copy size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(f.id)}>
                            <Trash2 size={14} className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add Filing Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{lastCreatedId ? "Filing Created" : "Add New Filing"}</SheetTitle>
          </SheetHeader>

          {lastCreatedId ? (
            <div className="py-6 space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-lg font-semibold text-foreground">Filing record created!</p>
              <p className="text-sm text-muted-foreground">
                You can now proceed to enter data for this filing.
              </p>
              <div className="flex gap-3 justify-center pt-4">
                <Button variant="outline" onClick={() => { setDrawerOpen(false); setLastCreatedId(null); }}>
                  Close
                </Button>
                <Button className="gap-1" onClick={() => {
                  setDrawerOpen(false);
                  onNavigateDataEntry?.(lastCreatedId);
                }}>
                  Go to Data Entry <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="py-4 space-y-4">
                {/* Client */}
                <div className="space-y-1">
                  <Label>Client *</Label>
                  <Select value={formData.client_id || ""} onValueChange={handleClientSelect}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.pan})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* TAN */}
                <div className="space-y-1">
                  <Label>TAN *</Label>
                  <Input value={formData.tan || ""} onChange={e => setFormData(prev => ({ ...prev, tan: e.target.value.toUpperCase() }))}
                    placeholder="ABCD12345E" maxLength={10} />
                </div>

                {/* FY and Quarter */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Financial Year *</Label>
                    <Select value={formData.financial_year} onValueChange={v => setFormData(prev => ({ ...prev, financial_year: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Quarter *</Label>
                    <Select value={formData.quarter} onValueChange={v => setFormData(prev => ({ ...prev, quarter: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Form Types */}
                <div className="space-y-2">
                  <Label>Form Type *</Label>
                  <div className="flex gap-4">
                    {TDS_FORMS.map(form => (
                      <label key={form} className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={formData.forms?.[form] || false}
                          onCheckedChange={(checked) => setFormData(prev => ({
                            ...prev,
                            forms: { ...prev.forms, [form]: !!checked },
                          }))}
                        />
                        {form}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Return Type */}
                <div className="space-y-2">
                  <Label>Type of Return</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="radio" name="return_type" value="regular"
                        checked={formData.return_type === "regular"}
                        onChange={() => setFormData(prev => ({ ...prev, return_type: "regular" }))}
                        className="accent-primary" />
                      Regular Return
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="radio" name="return_type" value="correction"
                        checked={formData.return_type === "correction"}
                        onChange={() => setFormData(prev => ({ ...prev, return_type: "correction" }))}
                        className="accent-primary" />
                      Correction Return
                    </label>
                  </div>
                </div>

                {formData.return_type === "correction" && (
                  <div className="space-y-1">
                    <Label>Previous Filing Token No</Label>
                    <Input value={formData.previous_token || ""}
                      onChange={e => setFormData(prev => ({ ...prev, previous_token: e.target.value }))}
                      placeholder="Enter previous token number" />
                  </div>
                )}

                {/* Deductor Details */}
                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Deductor Details</p>
                  <div className="space-y-1">
                    <Label>Deductor Type</Label>
                    <Select value={formData.deductor_type || "Company"}
                      onValueChange={v => setFormData(prev => ({ ...prev, deductor_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{DEDUCTOR_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Deductor PAN</Label>
                    <Input value={formData.deductor_pan || ""}
                      onChange={e => setFormData(prev => ({ ...prev, deductor_pan: e.target.value.toUpperCase() }))}
                      maxLength={10} placeholder="Auto-fills from client" />
                  </div>
                </div>

                {/* Responsible Person */}
                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Responsible Person</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>PAN</Label>
                      <Input value={formData.responsible_person_pan || ""}
                        onChange={e => setFormData(prev => ({ ...prev, responsible_person_pan: e.target.value.toUpperCase() }))}
                        maxLength={10} />
                    </div>
                    <div className="space-y-1">
                      <Label>Name</Label>
                      <Input value={formData.responsible_person_name || ""}
                        onChange={e => setFormData(prev => ({ ...prev, responsible_person_name: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* Assigned Staff */}
                <div className="space-y-1">
                  <Label>Assigned Staff</Label>
                  <Select value={formData.assigned_staff || ""} onValueChange={v => setFormData(prev => ({ ...prev, assigned_staff: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

                {/* Remarks */}
                <div className="space-y-1">
                  <Label>Remarks</Label>
                  <Textarea value={formData.remarks || ""}
                    onChange={e => setFormData(prev => ({ ...prev, remarks: e.target.value }))}
                    rows={2} />
                </div>
              </div>

              <SheetFooter>
                <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveFiling} disabled={saving}>
                  {saving ? "Saving..." : "Create Filing"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
