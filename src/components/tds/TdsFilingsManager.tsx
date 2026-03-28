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
  Download, ArrowRight, RefreshCw, Copy, Clock, AlertTriangle, ExternalLink, Info,
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
}

interface AuditLogEntry {
  id: string; filing_id: string | null; action_type: string;
  old_value: string | null; new_value: string | null;
  changed_by_name: string | null; changed_at: string | null;
  remark: string | null;
}

interface Props {
  clients: ClientOption[];
  users: UserOption[];
  isSuperadmin: boolean;
  resolveFirmId: () => Promise<string | null>;
  onNavigateDataEntry?: (filingId?: string) => void;
}

const CURRENT_FY_START = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const DEFAULT_FY = `${CURRENT_FY_START}-${String(CURRENT_FY_START + 1).slice(2)}`;
const FY_OPTIONS = Array.from({ length: 7 }, (_, i) => { const s = 2020 + i; return `${s}-${String(s + 1).slice(2)}`; });
const QUARTER_OPTIONS = ["Q1", "Q2", "Q3", "Q4"];
const TDS_FORMS = ["24Q", "26Q", "27Q", "27EQ"];

const FILING_STATUSES = [
  "Not Started",
  "Not Applicable",
  "NIL",
  "Data Received",
  "Under Process",
  "Queries Sent to Client",
  "Filed",
  "Processed",
] as const;

const FILING_STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "Not Applicable": "bg-muted/60 text-muted-foreground line-through",
  "NIL": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "Data Received": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Under Process": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "Queries Sent to Client": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Filed": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Processed": "bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
};

const getDueDate = (fy: string, quarter: string): Date => {
  const fyStart = parseInt(fy.split("-")[0]);
  const dates: Record<string, Date> = {
    Q1: new Date(fyStart, 6, 31), Q2: new Date(fyStart, 9, 31),
    Q3: new Date(fyStart + 1, 0, 31), Q4: new Date(fyStart + 1, 4, 31),
  };
  return dates[quarter] || new Date();
};

const getDueDateColor = (fy: string, quarter: string, status: string) => {
  if (["Filed", "Processed", "Not Applicable", "NIL"].includes(status)) return "text-emerald-600";
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

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");

  // History drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFiling, setHistoryFiling] = useState<TdsFiling | null>(null);
  const [historyLogs, setHistoryLogs] = useState<AuditLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

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

  const logAuditEntry = async (filingId: string, actionType: string, oldVal: string | null, newVal: string | null, remark?: string) => {
    const firmId = await resolveFirmId();
    await supabase.from("tds_filing_audit_log").insert({
      filing_id: filingId,
      firm_id: firmId,
      action_type: actionType,
      old_value: oldVal,
      new_value: newVal,
      changed_by: user?.id,
      changed_by_name: user?.name || user?.email || "Unknown",
      remark: remark || null,
    } as any);
  };

  const handleStatusChange = async (filing: TdsFiling, newStatus: string) => {
    const oldStatus = filing.work_status;
    if (oldStatus === newStatus) return;

    // Soft warning for Processed without ack number
    if (newStatus === "Processed" && !filing.acknowledgment_number) {
      toast({ title: "Warning", description: "Acknowledgment number is missing for this filing.", variant: "default" });
    }

    const { error } = await supabase.from("tds_filings").update({
      work_status: newStatus,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await logAuditEntry(filing.id, "STATUS_CHANGE", oldStatus, newStatus);
      fetchFilings();
    }
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
        const filing = filings.find(f => f.id === id);
        if (filing) {
          await supabase.from("tds_filings").update({
            work_status: newStatus,
            last_updated_by: user?.id,
            last_updated_at: new Date().toISOString(),
          }).eq("id", id);
          await logAuditEntry(id, "STATUS_CHANGE", filing.work_status, newStatus);
        }
      }
      toast({ title: `${ids.length} filings updated to ${newStatus}` });
    }
    setSelectedIds(new Set());
    setBulkAction("");
    fetchFilings();
  };

  // History drawer
  const openHistory = async (filing: TdsFiling) => {
    setHistoryFiling(filing);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setNewNote("");
    const { data } = await supabase.from("tds_filing_audit_log")
      .select("*")
      .eq("filing_id", filing.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    setHistoryLogs((data || []) as AuditLogEntry[]);
    setHistoryLoading(false);
  };

  const addNote = async () => {
    if (!historyFiling || !newNote.trim()) return;
    setAddingNote(true);
    await logAuditEntry(historyFiling.id, "NOTE_ADDED", null, null, newNote.trim());
    setNewNote("");
    // Refresh
    const { data } = await supabase.from("tds_filing_audit_log")
      .select("*")
      .eq("filing_id", historyFiling.id)
      .order("changed_at", { ascending: false })
      .limit(100);
    setHistoryLogs((data || []) as AuditLogEntry[]);
    setAddingNote(false);
    toast({ title: "Note added" });
  };

  const exportFilings = () => {
    const rows = filtered.map(f => {
      const c = clients.find(c => c.id === f.client_id);
      return `<tr>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${c?.name || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${c?.tan_number || f.tan || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.tds_forms?.join(", ") || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.quarter}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.financial_year}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.work_status}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.date_of_filing ? format(new Date(f.date_of_filing), "dd/MM/yyyy") : "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.acknowledgment_number || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.prn_no || "—"}</td>
        <td style="border:1px solid #ccc;padding:6px;font-size:12px">${f.remarks || "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>TDS Filing Sheet</title><style>body{font-family:system-ui;margin:20px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;font-size:11px;border:1px solid #ccc;padding:6px}@media print{@page{size:landscape}}</style></head><body>
      <h2>TDS Filing Sheet — FY: ${fyFilter} | Qtr: ${quarterFilter}</h2>
      <table><thead><tr><th>Client</th><th>TAN</th><th>Form</th><th>Qtr</th><th>FY</th><th>Status</th><th>Due Date</th><th>Filing Date</th><th>Ack No</th><th>PRN</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const w = window.open(URL.createObjectURL(blob), "_blank");
    if (w) setTimeout(() => w.print(), 500);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Filings Management</h2>
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Info size={14} />
          Filings are created automatically when TDS service is activated in Client Module.
        </p>
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
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1" onClick={exportFilings}>
          <Download size={14} /> Export
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Select value={bulkAction} onValueChange={setBulkAction}>
            <SelectTrigger className="w-[220px] h-8">
              <SelectValue placeholder="Bulk Action..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__header_status" disabled>── Update Status ──</SelectItem>
              {FILING_STATUSES.map(s => (
                <SelectItem key={`status:${s}`} value={`status:${s}`}>{s}</SelectItem>
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
                  <TableHead className="min-w-[180px]">Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Filing Date</TableHead>
                  <TableHead>Ack No</TableHead>
                  <TableHead>PRN No</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 13 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                )) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      No filings found. Filings are created when TDS service is activated for a client.
                    </TableCell>
                  </TableRow>
                ) : filtered.map(f => {
                  const client = clients.find(c => c.id === f.client_id);
                  const clientTan = client?.tan_number || f.tan;
                  const isNA = f.work_status === "Not Applicable";
                  return (
                    <TableRow key={f.id} className={cn(isNA && "bg-muted/30")}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium sticky left-0 bg-background">{client?.name || "—"}</TableCell>
                      <TableCell>
                        {clientTan ? (
                          <span className="font-mono text-xs">{clientTan}</span>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1 cursor-pointer">
                            <AlertTriangle size={10} /> TAN Missing
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{f.tds_forms?.join(", ")}</Badge></TableCell>
                      <TableCell>{f.quarter}</TableCell>
                      <TableCell>{f.financial_year}</TableCell>
                      <TableCell>
                        <Select value={f.work_status} onValueChange={v => handleStatusChange(f, v)}>
                          <SelectTrigger className="h-7 text-xs w-[180px]">
                            <Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status] || "bg-muted")}>{f.work_status}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {FILING_STATUSES.map(s => (
                              <SelectItem key={s} value={s}>
                                <span className={cn(s === "Not Applicable" && "line-through")}>{s}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
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
                        <Input className="h-7 w-28 text-xs" defaultValue={f.remarks || ""}
                          onBlur={e => { if (e.target.value !== (f.remarks || "")) handleInlineUpdate(f, "remarks", e.target.value || null); }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="History" onClick={() => openHistory(f)}>
                            <Clock size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy to next quarter" onClick={() => handleCopyFiling(f)}>
                            <Copy size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Go to Data Entry" onClick={() => onNavigateDataEntry?.(f.id)}>
                            <ArrowRight size={14} />
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

      {/* History Drawer */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">
              History — {clients.find(c => c.id === historyFiling?.client_id)?.name} | {historyFiling?.tds_forms?.join(", ")} | {historyFiling?.quarter} | {historyFiling?.financial_year}
            </SheetTitle>
          </SheetHeader>

          <div className="py-4 space-y-4">
            {historyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : historyLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No history entries yet.</p>
            ) : (
              <div className="space-y-2">
                {historyLogs.map(log => (
                  <div key={log.id} className="p-3 border rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{log.changed_by_name || "System"}</span>
                      <span className="text-xs text-muted-foreground">
                        {log.changed_at ? format(new Date(log.changed_at), "dd/MM/yyyy HH:mm") : "—"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] mr-1">{log.action_type}</Badge>
                      {log.old_value && log.new_value && (
                        <span>{log.old_value} → {log.new_value}</span>
                      )}
                    </div>
                    {log.remark && <p className="text-xs text-foreground bg-muted/50 rounded p-1.5">{log.remark}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Add note */}
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Add note</Label>
              <div className="flex gap-2">
                <Input
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Type a note..."
                  className="flex-1 h-8 text-sm"
                  onKeyDown={e => { if (e.key === "Enter" && newNote.trim()) addNote(); }}
                />
                <Button size="sm" onClick={addNote} disabled={addingNote || !newNote.trim()}>
                  {addingNote ? "..." : "Add"}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
