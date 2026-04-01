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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Download, ArrowRight, RefreshCw, Copy, Clock, AlertTriangle, ExternalLink, Info, Settings, Database,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ClientOption { id: string; name: string | null; pan: string | null; tan_number?: string | null; deleted_at?: string | null; }
interface UserOption { id: string; name: string | null; }

interface TdsFiling {
  id: string; client_id: string; firm_id: string; financial_year: string;
  quarter: string; tds_forms: string[] | null; work_status: string;
  date_of_filing: string | null; acknowledgment_number: string | null;
  prn_no: string | null; tan: string | null; assigned_staff: string | null;
  last_updated_by: string | null; last_updated_at: string | null;
  remarks: string | null; created_at: string | null;
  ack_file_url?: string | null;
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
  const [deletedClients, setDeletedClients] = useState<Map<string, { name: string | null; deleted_at: string }>>(new Map()); // client_id -> { name, deleted_at }
  const [ackUploading, setAckUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fyFilter, setFyFilter] = useState(DEFAULT_FY);
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");

  // Copy filing dialog
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySource, setCopySource] = useState<TdsFiling | null>(null);
  const [copyQuarter, setCopyQuarter] = useState("Q1");
  const [copyFy, setCopyFy] = useState(DEFAULT_FY);
  const [copying, setCopying] = useState(false);

  // Migration
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ challans: number; deductees: number; entries: number } | null>(null);

  // History drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFiling, setHistoryFiling] = useState<TdsFiling | null>(null);
  const [historyLogs, setHistoryLogs] = useState<AuditLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Helper: get quarter period end date
  const getQuarterEndDate = (fy: string, quarter: string): Date => {
    const fyStart = parseInt(fy.split("-")[0]);
    const ends: Record<string, Date> = {
      Q1: new Date(fyStart, 5, 30),   // Jun 30
      Q2: new Date(fyStart, 8, 30),   // Sep 30
      Q3: new Date(fyStart, 11, 31),  // Dec 31
      Q4: new Date(fyStart + 1, 2, 31), // Mar 31
    };
    return ends[quarter] || new Date();
  };

  const fetchFilings = useCallback(async () => {
    setLoading(true);
    const firmId = await resolveFirmId();
    let q = supabase.from("tds_filings").select("*").order("created_at", { ascending: false }).limit(500);
    if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
    if (fyFilter !== "all") q = q.eq("financial_year", fyFilter);
    if (quarterFilter !== "all") q = q.eq("quarter", quarterFilter);
    if (clientFilter !== "all") q = q.eq("client_id", clientFilter);
    const { data } = await q;
    const allFilings = (data || []) as TdsFiling[];

    // Fetch deleted clients info (including name) for filings' client IDs
    const clientIds = [...new Set(allFilings.map(f => f.client_id))];
    const delMap = new Map<string, { name: string | null; deleted_at: string }>();
    if (clientIds.length > 0) {
      const { data: delClients } = await supabase.from("clients")
        .select("id, name, deleted_at")
        .in("id", clientIds)
        .not("deleted_at", "is", null);
      for (const dc of (delClients || [])) {
        if (dc.deleted_at) delMap.set(dc.id, { name: dc.name || null, deleted_at: dc.deleted_at });
      }
    }
    setDeletedClients(delMap);
    setFilings(allFilings);
    setLoading(false);
  }, [isSuperadmin, resolveFirmId, fyFilter, quarterFilter, clientFilter]);

  useEffect(() => { fetchFilings(); }, [fetchFilings]);

  const filtered = useMemo(() => {
    return filings.filter(f => {
      if (formFilter !== "all" && !(f.tds_forms || []).includes(formFilter)) return false;
      if (statusFilter !== "all" && f.work_status !== statusFilter) return false;

      // Deleted client filtering
      const deletedInfo = deletedClients.get(f.client_id);
      if (deletedInfo) {
        const periodEnd = getQuarterEndDate(f.financial_year, f.quarter);
        const deletionDate = new Date(deletedInfo.deleted_at);
        // If period is after deletion and filing wasn't already filed/processed → hide
        if (periodEnd >= deletionDate && !["Filed", "Processed"].includes(f.work_status)) {
          return false;
        }
      }
      return true;
    });
  }, [filings, formFilter, statusFilter, deletedClients]);

  // Check if a filing belongs to a deleted client (for archived styling)
  const isArchivedFiling = (f: TdsFiling): boolean => {
    return deletedClients.has(f.client_id);
  };

  // ACK file upload/view/delete (Issue 7)
  const uploadAckFile = async (filing: TdsFiling, file: File) => {
    setAckUploading(filing.id);
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `${filing.id}/ack.${ext}`;
    const { error } = await supabase.storage.from('tds-ack-files').upload(path, file, { upsert: true });
    if (error) { toast({ title: "Upload failed", description: error.message, variant: "destructive" }); }
    else {
      await supabase.from('tds_filings').update({ ack_file_url: path } as any).eq('id', filing.id);
      fetchFilings();
      toast({ title: "ACK file uploaded" });
    }
    setAckUploading(null);
  };
  const viewAckFile = async (filing: TdsFiling) => {
    if (!filing.ack_file_url) return;
    const { data } = await supabase.storage.from('tds-ack-files').createSignedUrl(filing.ack_file_url, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };
  const deleteAckFile = async (filing: TdsFiling) => {
    if (!filing.ack_file_url) return;
    await supabase.storage.from('tds-ack-files').remove([filing.ack_file_url]);
    await supabase.from('tds_filings').update({ ack_file_url: null } as any).eq('id', filing.id);
    fetchFilings();
    toast({ title: "ACK file removed" });
  };

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

    // Block 'Filed' if ack number is missing (Issue 10)
    if (newStatus === "Filed" && !filing.acknowledgment_number) {
      toast({ title: "Cannot mark as Filed", description: "Acknowledgment number is required before marking as Filed.", variant: "destructive" });
      return;
    }

    // Soft warning for Processed without ack number
    if (newStatus === "Processed" && !filing.acknowledgment_number) {
      toast({ title: "Warning", description: "Acknowledgment number is missing for this filing.", variant: "default" });
    }

    const updatePayload: Record<string, any> = {
      work_status: newStatus,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    };

    // Auto-set filing date when status changes to 'Filed' and date is blank
    if (newStatus === "Filed" && !filing.date_of_filing) {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD for date input
      updatePayload.date_of_filing = today;
    }

    const { error } = await supabase.from("tds_filings").update(updatePayload).eq("id", filing.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await logAuditEntry(filing.id, "STATUS_CHANGE", oldStatus, newStatus);
      if (updatePayload.date_of_filing) {
        await logAuditEntry(filing.id, "FILING_DATE_SET", null, updatePayload.date_of_filing, "Auto-set on filing");
      }
      fetchFilings();
    }
  };

  const handleInlineUpdate = async (filing: TdsFiling, field: string, value: any) => {
    // Prevent changing filing date after status is 'Filed'
    if (field === "date_of_filing" && filing.work_status === "Filed" && filing.date_of_filing) {
      toast({ title: "Locked", description: "Filing date cannot be modified after filing.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("tds_filings").update({
      [field]: value,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    }).eq("id", filing.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      // If setting date on a Filed row for the first time, log it
      if (field === "date_of_filing" && filing.work_status === "Filed") {
        await logAuditEntry(filing.id, "FILING_DATE_SET", filing.date_of_filing || null, value, "Historical correction");
      }
      fetchFilings();
    }
  };

  const openCopyDialog = (f: TdsFiling) => {
    setCopySource(f);
    const nextQ = f.quarter === "Q1" ? "Q2" : f.quarter === "Q2" ? "Q3" : f.quarter === "Q3" ? "Q4" : "Q1";
    const nextFy = f.quarter === "Q4" ? (() => { const s = parseInt(f.financial_year.split("-")[0]) + 1; return `${s}-${String(s + 1).slice(2)}`; })() : f.financial_year;
    setCopyQuarter(nextQ);
    setCopyFy(nextFy);
    setCopyDialogOpen(true);
  };

  const confirmCopyFiling = async () => {
    if (!copySource) return;
    setCopying(true);
    const { error } = await supabase.from("tds_filings").insert({
      client_id: copySource.client_id,
      firm_id: copySource.firm_id,
      financial_year: copyFy,
      quarter: copyQuarter,
      tds_forms: copySource.tds_forms,
      work_status: "Not Started",
      tan: copySource.tan,
      last_updated_by: user?.id,
      last_updated_at: new Date().toISOString(),
    } as any);
    setCopying(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Filing copied to ${copyQuarter} ${copyFy}` }); setCopyDialogOpen(false); fetchFilings(); }
  };

  // Migration logic
  const runMigration = async () => {
    setMigrating(true);
    setMigrationResult(null);
    try {
      const firmId = await resolveFirmId();
      let q = supabase.from("tds_entries").select("*").eq("migrated", false).limit(1000);
      if (!isSuperadmin && firmId) q = q.eq("firm_id", firmId);
      const { data: entries, error: fetchErr } = await q;
      if (fetchErr) throw fetchErr;
      if (!entries || entries.length === 0) {
        toast({ title: "No unmigrated entries found" });
        setMigrating(false);
        return;
      }
      const challanGroups = new Map<string, any[]>();
      for (const e of entries) {
        const key = `${e.client_id}|${e.form_type}|${e.challan_bsr_code || ""}|${e.challan_serial_no || ""}|${e.challan_date || ""}`;
        if (!challanGroups.has(key)) challanGroups.set(key, []);
        challanGroups.get(key)!.push(e);
      }
      let challanCount = 0, deducteeCount = 0;
      for (const [, group] of challanGroups) {
        const first = group[0];
        const { data: existingFilings } = await supabase.from("tds_filings").select("id").eq("client_id", first.client_id).eq("financial_year", first.financial_year || "2025-26").limit(1);
        let filingId: string;
        if (existingFilings && existingFilings.length > 0) { filingId = existingFilings[0].id; }
        else {
          const { data: newFiling, error: fErr } = await supabase.from("tds_filings").insert({ client_id: first.client_id, firm_id: first.firm_id || firmId, financial_year: first.financial_year || "2025-26", quarter: "Q1", tds_forms: [first.form_type || "26Q"], work_status: "Data Received", tan: first.tan || null, last_updated_by: user?.id, last_updated_at: new Date().toISOString() } as any).select("id").single();
          if (fErr) continue;
          filingId = newFiling.id;
        }
        const totalChallanAmount = first.challan_amount || group.reduce((s: number, e: any) => s + (e.tds_amount || 0), 0);
        const { data: challan, error: cErr } = await supabase.from("tds_challans").insert({ filing_id: filingId, client_id: first.client_id, firm_id: first.firm_id || firmId, form_type: first.form_type || "26Q", financial_year: first.financial_year || "2025-26", quarter: "Q1", bsr_code: first.challan_bsr_code || null, challan_serial_no: first.challan_serial_no || null, deposit_date: first.challan_date || null, total_challan_amount: totalChallanAmount, total_tax_deposited: totalChallanAmount } as any).select("id").single();
        if (cErr) continue;
        challanCount++;
        for (const e of group) {
          await supabase.from("tds_deductees").insert({ challan_id: challan.id, filing_id: filingId, client_id: e.client_id, firm_id: e.firm_id || firmId, form_type: e.form_type || "26Q", financial_year: e.financial_year || "2025-26", quarter: "Q1", deductee_name: e.party_name || "", deductee_pan: e.deductee_pan || e.pan || null, section_code: e.section_code || e.section || "", amount_paid_credited: e.amount || null, date_of_payment: e.date || null, rate_of_tds: e.tds_rate || null, tds_amount: e.tds_amount || null, total_tax_deducted: e.tds_amount || null, pan_not_available: false } as any);
          deducteeCount++;
          await supabase.from("tds_entries").update({ migrated: true, migrated_at: new Date().toISOString() } as any).eq("id", e.id);
        }
      }
      setMigrationResult({ challans: challanCount, deductees: deducteeCount, entries: entries.length });
      toast({ title: `Migration complete: ${entries.length} entries → ${challanCount} challans + ${deducteeCount} deductees` });
    } catch (err: any) {
      toast({ title: "Migration error", description: err.message, variant: "destructive" });
    }
    setMigrating(false);
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <Settings size={14} /> Options
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportFilings} className="gap-2">
              <Download size={14} /> Export Filings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMigrationOpen(true)} className="gap-2">
              <Database size={14} /> Migrate Legacy Data
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
                  const archived = isArchivedFiling(f);
                  return (
                    <TableRow key={f.id} className={cn(isNA && "bg-muted/30", archived && "bg-muted/40 opacity-70")}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(f.id)}
                          onCheckedChange={() => toggleSelect(f.id)}
                          disabled={archived}
                        />
                      </TableCell>
                      <TableCell className="font-medium sticky left-0 bg-background">
                        <span className={cn(archived && "line-through text-muted-foreground")}>{client?.name || deletedClients.get(f.client_id)?.name || "—"}</span>
                        {archived && <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0">Archived</Badge>}
                      </TableCell>
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
                        {archived ? (
                          <Badge className={cn("text-xs", FILING_STATUS_COLORS[f.work_status] || "bg-muted")}>{f.work_status}</Badge>
                        ) : (
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
                        )}
                      </TableCell>
                      <TableCell className={getDueDateColor(f.financial_year, f.quarter, f.work_status)}>
                        {format(getDueDate(f.financial_year, f.quarter), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const isFiled = f.work_status === "Filed" || f.work_status === "Processed";
                          const hasDate = !!f.date_of_filing;
                          const isLocked = isFiled && hasDate;
                          return (
                            <div className="relative group">
                              <Input
                                type="date"
                                className={cn("h-7 w-32 text-xs", isLocked && "bg-muted cursor-not-allowed opacity-70")}
                                defaultValue={f.date_of_filing || ""}
                                disabled={isLocked}
                                onBlur={e => {
                                  if (e.target.value !== (f.date_of_filing || ""))
                                    handleInlineUpdate(f, "date_of_filing", e.target.value || null);
                                }}
                              />
                              {isLocked && (
                                <span className="absolute -top-5 left-0 hidden group-hover:block text-[10px] bg-foreground text-background px-1.5 py-0.5 rounded whitespace-nowrap z-20">
                                  🔒 Filing date locked after filing
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Input className="h-7 w-28 text-xs" defaultValue={f.acknowledgment_number || ""}
                            onBlur={e => { if (e.target.value !== (f.acknowledgment_number || "")) handleInlineUpdate(f, "acknowledgment_number", e.target.value || null); }}
                          />
                          {/* Issue 7: ACK file upload */}
                          <div className="flex items-center gap-1">
                            {f.ack_file_url ? (
                              <>
                                <button className="text-[9px] text-primary hover:underline" onClick={() => viewAckFile(f)} title="View ACK">📄 View</button>
                                <button className="text-[9px] text-destructive hover:underline" onClick={() => deleteAckFile(f)} title="Remove ACK">✕</button>
                              </>
                            ) : (
                              <label className={cn("text-[9px] text-muted-foreground hover:text-primary cursor-pointer", ackUploading === f.id && "opacity-50 pointer-events-none")}>
                                {ackUploading === f.id ? "Uploading..." : "📎 Attach ACK"}
                                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { const fl = e.target.files?.[0]; if (fl) uploadAckFile(f, fl); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                        </div>
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
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy Filing" onClick={() => openCopyDialog(f)}>
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

      {/* Copy Filing Dialog */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Copy Filing</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Copy <strong>{clients.find(c => c.id === copySource?.client_id)?.name}</strong> — {copySource?.tds_forms?.join(", ")} to a new quarter. Only deductor details are copied; no challan/deductee data.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quarter</Label>
                <Select value={copyQuarter} onValueChange={setCopyQuarter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUARTER_OPTIONS.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">FY</Label>
                <Select value={copyFy} onValueChange={setCopyFy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FY_OPTIONS.map(fy => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmCopyFiling} disabled={copying}>{copying ? "Copying..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Migration Dialog */}
      <Dialog open={migrationOpen} onOpenChange={setMigrationOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Migrate Legacy TDS Data</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Migrates from <code className="bg-muted px-1 rounded">tds_entries</code> into <code className="bg-muted px-1 rounded">tds_challans</code> + <code className="bg-muted px-1 rounded">tds_deductees</code>.</p>
            {migrationResult && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Migration Complete</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{migrationResult.entries} entries → {migrationResult.challans} challans + {migrationResult.deductees} deductees</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMigrationOpen(false)}>Close</Button>
            <Button onClick={runMigration} disabled={migrating}>{migrating ? "Migrating..." : "Run Migration"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
