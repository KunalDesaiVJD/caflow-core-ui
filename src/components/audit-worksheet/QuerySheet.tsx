/**
 * QuerySheet — Sheet 5 "QUERY SHEET"
 *
 * Phase 3A: Tally-linked type-ahead comboboxes for Group, Ledger, Required Docs.
 * Phase 3B: Full query state machine + priority + pipeline funnel bar.
 * Phase 3C: Row selection (checkboxes), bulk dispatch dialog, "Dispatch All",
 *           due date per row, overdue row highlighting.
 * Phase 3D: useQueryStatusSync wired — client portal changes auto-advance
 *           worksheet status in real time.
 */
import { useState, useRef, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Save, Loader2, MessageSquareWarning,
  Plus, Trash2, Download, Upload, FileSpreadsheet,
  Search, X, BookOpen, Send, CheckCircle2,
  ChevronRight, ArrowRight, AlertTriangle,
  CheckSquare, Square, Calendar, Rocket, BarChart2,
} from "lucide-react";
import { LedgerSidePanel }        from "./LedgerSidePanel";
import { QueryAnalyticsSidebar }  from "./QueryAnalyticsSidebar";
import { QueryCombobox, COMMON_REQUIRED_DOCS } from "./QueryCombobox";
import { useQueryStatusSync } from "./hooks/useQueryStatusSync";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  useQuerySheetStorage,
  STATUS_META, PRIORITY_META,
} from "./hooks/useQuerySheetStorage";
import type { QueryRow, QueryStatus, QueryPriority } from "./hooks/useQuerySheetStorage";
import { useTallyOptions } from "./hooks/useTallyOptions";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Due-date helpers ─────────────────────────────────────────────────────────

function dueDateStatus(due: string | undefined): "overdue" | "soon" | "ok" | "none" {
  if (!due) return "none";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0)  return "overdue";
  if (diff <= 3) return "soon";
  return "ok";
}

function fmtDueDate(due: string): string {
  const d = new Date(due);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ─── Excel helpers ────────────────────────────────────────────────────────────

const HEADERS = [
  "SR.", "GROUP/SUBGROUP", "LEDGER", "QUERY DESCRIPTION",
  "REQUIRED DOCUMENTS", "REMARK", "CORRECTION STATUS",
  "QUERY STATUS", "PRIORITY", "DUE DATE",
];

function exportToExcel(queries: QueryRow[], clientName: string, fy: string) {
  const rows = queries.map((q, i) => [
    i + 1, q.head, q.particulars, q.query_description,
    q.required_documents, q.remark,
    q.correction_status || "Pending",
    q.query_status, q.priority, q.due_date || "",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Queries");
  XLSX.writeFile(wb, `Queries_${(clientName || "Client").replace(/[^a-zA-Z0-9_-]/g, "_")}_${fy || "FY"}.xlsx`);
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Queries");
  XLSX.writeFile(wb, "QuerySheet_Template_CAFlow.xlsx");
}

function parseWorkbook(file: File): Promise<Array<Omit<QueryRow, "id">>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        const dataRows = raw.filter((row, i) => i !== 0 && row.some((c: any) => c !== undefined && c !== null && c !== ""));
        const VALID_S: QueryStatus[] = ["draft","raised","dispatched","response_received","resolved","escalated"];
        const VALID_P: QueryPriority[]   = ["High","Medium","Low"];
        const parsed: Array<Omit<QueryRow, "id">> = dataRows.map((row: any[]) => ({
          head:               String(row[1] ?? ""),
          particulars:        String(row[2] ?? ""),
          query_description:  String(row[3] ?? ""),
          required_documents: String(row[4] ?? ""),
          remark:             String(row[5] ?? ""),
          correction_status:  (["Yes","No"].includes(String(row[6] ?? "")) ? String(row[6]) : "") as "" | "Yes" | "No",
          query_status:       (VALID_S.includes(String(row[7] ?? "") as QueryStatus) ? String(row[7]) : "raised") as QueryStatus,
          priority:           (VALID_P.includes(String(row[8] ?? "") as QueryPriority) ? String(row[8]) : "Medium") as QueryPriority,
          due_date:           String(row[9] ?? "") || "",
        }));
        resolve(parsed.filter(r => r.head || r.particulars || r.query_description));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueryPrefill {
  head:        string;
  particulars: string;
  note?:       string;
}

interface Props {
  data:               AuditWorksheetData;
  engagementId:       string;
  onSaved?:           () => void;
  externalPrefill?:   QueryPrefill | null;
  onPrefillConsumed?: () => void;
}

// ─── Pipeline funnel bar ──────────────────────────────────────────────────────

const FUNNEL_STEPS: QueryStatus[] = [
  "draft", "raised", "dispatched", "response_received", "resolved",
];

function PipelineFunnel({
  counts, activeFilter, onFilter,
}: {
  counts:       Record<QueryStatus, number>;
  activeFilter: QueryStatus | "all";
  onFilter:     (s: QueryStatus | "all") => void;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-4 py-2 border-b bg-muted/10">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-1">Pipeline</span>
      {FUNNEL_STEPS.map((s, i) => {
        const m   = STATUS_META[s];
        const cnt = counts[s];
        const active = activeFilter === s;
        return (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="text-muted-foreground/50 flex-shrink-0" />}
            <button
              type="button"
              onClick={() => onFilter(active ? "all" : s)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                active
                  ? cn(m.bg, m.color, m.border)
                  : "text-muted-foreground border-transparent hover:border-border hover:bg-muted/40",
              )}
            >
              {m.label}{cnt > 0 && <span className={cn("font-bold", active ? m.color : "")}>{cnt}</span>}
            </button>
          </div>
        );
      })}
      {counts.escalated > 0 && (
        <div className="flex items-center gap-1 ml-1">
          <span className="text-[10px] text-muted-foreground/50">|</span>
          <button
            type="button"
            onClick={() => onFilter(activeFilter === "escalated" ? "all" : "escalated")}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
              activeFilter === "escalated"
                ? cn(STATUS_META.escalated.bg, STATUS_META.escalated.color, STATUS_META.escalated.border)
                : "text-red-600 border-transparent hover:border-red-200 hover:bg-red-50",
            )}
          >
            <AlertTriangle size={9} /> Escalated <span className="font-bold">{counts.escalated}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Status cell ──────────────────────────────────────────────────────────────

function QueryStatusCell({ row, onAdvance, onSetStatus }: {
  row: QueryRow;
  onAdvance:   () => void;
  onSetStatus: (s: QueryStatus) => void;
}) {
  const m         = STATUS_META[row.query_status];
  const canAdvance = !["resolved","escalated"].includes(row.query_status);
  const nextLabel  = canAdvance
    ? STATUS_META[{ draft:"raised", raised:"dispatched", dispatched:"response_received", response_received:"resolved", resolved:"resolved", escalated:"escalated" }[row.query_status] as QueryStatus]?.label
    : null;

  const dueStatus = dueDateStatus(row.due_date);

  return (
    <div className="flex flex-col gap-1 items-start">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button"
            className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer", m.bg, m.color, m.border)}>
            {m.label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="text-xs">
          {(Object.keys(STATUS_META) as QueryStatus[]).map(s => {
            const sm = STATUS_META[s];
            return (
              <DropdownMenuItem key={s} onClick={() => onSetStatus(s)}
                className={cn("gap-2", s === row.query_status && "font-semibold")}>
                <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", sm.bg, "border", sm.border)} />
                {sm.label}{s === row.query_status && " ✓"}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onSetStatus("escalated")} className="text-red-600 gap-2">
            <AlertTriangle size={10} /> Escalate
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canAdvance && nextLabel && (
        <button type="button" onClick={onAdvance}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
          <ArrowRight size={9} /> {nextLabel}
        </button>
      )}

      {/* Due date */}
      {dueStatus !== "none" && (
        <span className={cn(
          "inline-flex items-center gap-0.5 text-[9px] font-medium",
          dueStatus === "overdue" ? "text-red-600" : dueStatus === "soon" ? "text-amber-600" : "text-muted-foreground",
        )}>
          <Calendar size={9} />
          {dueStatus === "overdue" ? "Overdue " : "Due "}
          {fmtDueDate(row.due_date!)}
        </span>
      )}
    </div>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority, onClick }: { priority: QueryPriority; onClick: () => void }) {
  const m = PRIORITY_META[priority];
  return (
    <button type="button" onClick={onClick} title="Click to change priority"
      className={cn("inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-semibold border transition-colors", m.bg, m.color, "border-current/20 hover:opacity-80")}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", m.dot)} />{priority}
    </button>
  );
}

// ─── Bulk Dispatch Dialog (Phase 3C) ─────────────────────────────────────────

function BulkDispatchDialog({
  open, onClose,
  rows, engagementId, clientId, firmId, financialYear,
  onDispatched,
}: {
  open:          boolean;
  onClose:       () => void;
  rows:          QueryRow[];
  engagementId:  string;
  clientId:      string;
  firmId:        string | null;
  financialYear: string;
  onDispatched:  (dispatched: { id: string; clientQueryId: string }[]) => void;
}) {
  const [dueDate,   setDueDate]   = useState("");
  const [priority,  setPriority]  = useState<"keep" | QueryPriority>("keep");
  const [saving,    setSaving]    = useState(false);

  // Reset when opening
  useEffect(() => {
    if (open) { setDueDate(""); setPriority("keep"); }
  }, [open]);

  const undispatched = rows.filter(r => !r.dispatched_query_id);

  const dispatch = async () => {
    if (!undispatched.length) { onClose(); return; }
    setSaving(true);
    const results: { id: string; clientQueryId: string }[] = [];
    try {
      for (const row of undispatched) {
        const { data: created, error } = await supabase
          .from("audit_client_queries" as any)
          .insert({
            query_text:         row.query_description || row.head,
            required_documents: row.required_documents || null,
            ledger_name:        row.particulars || null,
            group_name:         row.head || null,
            priority:           priority === "keep" ? (row.priority || "Medium") : priority,
            due_date:           dueDate || row.due_date || null,
            engagement_id:      engagementId,
            client_id:          clientId,
            firm_id:            firmId,
            financial_year:     financialYear,
            status:             "Open",
            source:             "worksheet",
            source_ref_id:      row.id,
          } as any)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (created) results.push({ id: row.id, clientQueryId: (created as any).id });
      }
      toast.success(`${results.length} ${results.length === 1 ? "query" : "queries"} dispatched to client portal`);
      onDispatched(results);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Dispatch failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Rocket size={15} className="text-orange-600" />
            Dispatch {undispatched.length} {undispatched.length === 1 ? "Query" : "Queries"} to Client
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Preview */}
          <div className="rounded-md border bg-muted/30 max-h-36 overflow-y-auto divide-y text-xs">
            {undispatched.slice(0, 10).map(r => (
              <div key={r.id} className="px-3 py-1.5 flex items-center gap-2">
                <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", PRIORITY_META[r.priority].dot)} />
                <span className="flex-1 truncate font-medium">{r.head || r.particulars || "(no group)"}</span>
                {r.particulars && r.head && (
                  <span className="text-muted-foreground truncate max-w-[100px]">{r.particulars}</span>
                )}
              </div>
            ))}
            {undispatched.length > 10 && (
              <div className="px-3 py-1.5 text-muted-foreground">
                … and {undispatched.length - 10} more
              </div>
            )}
          </div>

          {/* Due date */}
          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1">
              <Calendar size={11} /> Response Due Date
              <span className="text-muted-foreground font-normal">(optional — applies to all)</span>
            </label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="h-8 text-xs" />
          </div>

          {/* Priority override */}
          <div className="space-y-1">
            <label className="text-xs font-medium">Priority Override</label>
            <div className="flex gap-1.5 flex-wrap">
              {(["keep", "High", "Medium", "Low"] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[11px] font-medium border transition-colors",
                    priority === p
                      ? p === "keep"
                        ? "bg-foreground text-background border-foreground"
                        : cn(PRIORITY_META[p].bg, PRIORITY_META[p].color, "border-current")
                      : "text-muted-foreground border-transparent hover:bg-muted/60",
                  )}
                >
                  {p === "keep" ? "Keep original" : p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={dispatch} disabled={saving || undispatched.length === 0}
            className="gap-1.5 bg-orange-600 hover:bg-orange-700">
            {saving
              ? <Loader2 size={13} className="animate-spin" />
              : <Rocket size={13} />}
            Dispatch {undispatched.length} {undispatched.length === 1 ? "Query" : "Queries"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuerySheet({
  data, engagementId, onSaved,
  externalPrefill, onPrefillConsumed,
}: Props) {
  const {
    queries, addQuery, addQueryPrefilled, updateQuery, deleteQuery, bulkAddQueries,
    advanceStatus, setQueryStatus, bulkSetStatus, syncStatusFromClient, cyclePriority,
    manualSave, saving, allCorrected, pendingCount, statusCounts,
  } = useQuerySheetStorage(engagementId, data.engagement?.firm_id);

  // Phase 3A: Tally options
  const { groups, getLedgersForGroup, hasTallyData } = useTallyOptions(
    data.engagement?.client_id, data.financialYear,
  );

  // Phase 3D: bidirectional sync
  useQueryStatusSync({ engagementId, queries, syncStatusFromClient });

  // Consume externalPrefill
  useEffect(() => {
    if (!externalPrefill) return;
    addQueryPrefilled(externalPrefill.head, externalPrefill.particulars, externalPrefill.note);
    onPrefillConsumed?.();
  }, [externalPrefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state ───────────────────────────────────────────────────────────
  const [confirmDeleteId,  setConfirmDeleteId]  = useState<string | null>(null);
  const [viewLedger,       setViewLedger]       = useState<{ name: string; group: string } | null>(null);
  const [dispatchingId,    setDispatchingId]    = useState<string | null>(null);
  const [dispatchingAll,   setDispatchingAll]   = useState(false);

  // Phase 3F: analytics sidebar
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Phase 3C: selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false);
  const [bulkTargetRows,   setBulkTargetRows]   = useState<QueryRow[]>([]);

  // Filters
  const [searchText,     setSearchText]     = useState("");
  const [statusFilter,   setStatusFilter]   = useState<QueryStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<QueryPriority | "all">("all");

  const displayedQueries = useMemo(() => queries.filter(q => {
    if (statusFilter   !== "all" && q.query_status !== statusFilter)   return false;
    if (priorityFilter !== "all" && q.priority     !== priorityFilter) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      if (!(q.head?.toLowerCase().includes(s) || q.particulars?.toLowerCase().includes(s)
        || q.query_description?.toLowerCase().includes(s) || q.required_documents?.toLowerCase().includes(s)
        || q.remark?.toLowerCase().includes(s))) return false;
    }
    return true;
  }), [queries, statusFilter, priorityFilter, searchText]);

  // Active overdue count
  const overdueCount = useMemo(
    () => queries.filter(q => dueDateStatus(q.due_date) === "overdue" && !["resolved","escalated"].includes(q.query_status)).length,
    [queries],
  );

  // ── Selection helpers ────────────────────────────────────────────────────────
  const allDisplayedSelected =
    displayedQueries.length > 0 && displayedQueries.every(q => selectedIds.has(q.id));

  const toggleSelectAll = () => {
    if (allDisplayedSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedQueries.map(q => q.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => queries.filter(q => selectedIds.has(q.id)),
    [queries, selectedIds],
  );

  // ── Single dispatch ──────────────────────────────────────────────────────────
  const dispatchToClient = async (row: QueryRow) => {
    if (!data.engagement?.client_id) { toast.error("No client linked"); return; }
    setDispatchingId(row.id);
    try {
      const { data: created, error } = await supabase
        .from("audit_client_queries" as any)
        .insert({
          query_text:         row.query_description || row.head,
          required_documents: row.required_documents || null,
          ledger_name:        row.particulars || null,
          group_name:         row.head || null,
          priority:           row.priority || "Medium",
          due_date:           row.due_date || null,
          engagement_id:      engagementId,
          client_id:          data.engagement.client_id,
          firm_id:            data.engagement.firm_id || null,
          financial_year:     data.financialYear || null,
          status:             "Open",
          source:             "worksheet",
          source_ref_id:      row.id,
        } as any)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (created) {
        updateQuery(row.id, "dispatched_query_id" as any, (created as any).id);
        if (row.query_status === "raised" || row.query_status === "draft")
          setQueryStatus(row.id, "dispatched");
      }
      toast.success("Query dispatched to client portal");
    } catch (err: any) {
      toast.error(err.message || "Dispatch failed");
    } finally { setDispatchingId(null); }
  };

  // ── Dispatch All ─────────────────────────────────────────────────────────────
  const openDispatchAll = () => {
    const undispatched = queries.filter(q => !q.dispatched_query_id && q.query_status !== "resolved" && q.query_status !== "escalated");
    if (undispatched.length === 0) { toast.info("All queries have already been dispatched"); return; }
    setBulkTargetRows(undispatched);
    setBulkDispatchOpen(true);
  };

  // ── Open Bulk Dispatch for selection ─────────────────────────────────────────
  const openBulkDispatch = () => {
    setBulkTargetRows(selectedRows);
    setBulkDispatchOpen(true);
  };

  // ── Called after BulkDispatchDialog succeeds ─────────────────────────────────
  const handleBulkDispatched = (results: { id: string; clientQueryId: string }[]) => {
    for (const { id, clientQueryId } of results) {
      updateQuery(id, "dispatched_query_id" as any, clientQueryId);
      setQueryStatus(id, "dispatched");
    }
    setSelectedIds(new Set());
  };

  // ── Import ───────────────────────────────────────────────────────────────────
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<Array<Omit<QueryRow, "id">> | null>(null);
  const [importing,     setImporting]     = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseWorkbook(file);
      if (rows.length === 0) toast.error("No valid data rows found.");
      else setImportPreview(rows);
    } catch { toast.error("Could not parse file. Use the CAFlow template."); }
    e.target.value = "";
  };

  const confirmImport = () => {
    if (!importPreview) return;
    setImporting(true);
    bulkAddQueries(importPreview);
    toast.success(`${importPreview.length} ${importPreview.length === 1 ? "query" : "queries"} imported.`);
    setImportPreview(null);
    setImporting(false);
  };

  const activeFilters = statusFilter !== "all" || priorityFilter !== "all" || !!searchText;
  const undispatchedCount = queries.filter(q => !q.dispatched_query_id && !["resolved","escalated"].includes(q.query_status)).length;

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-orange-600 text-white px-6 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          <MessageSquareWarning size={18} />
          <span className="text-base font-semibold tracking-wide">{data.firmName || "CA Firm"}</span>
          {hasTallyData && (
            <span className="text-[10px] font-bold bg-white/20 border border-white/30 rounded px-1.5 py-px">TB Linked</span>
          )}
          {overdueCount > 0 && (
            <span className="ml-auto text-[10px] font-bold bg-red-700/80 border border-red-400/50 rounded-full px-2 py-0.5 flex items-center gap-1">
              <AlertTriangle size={9} /> {overdueCount} overdue
            </span>
          )}
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          Query of Client{data.clientName ? ` — ${data.clientName}` : ""}
        </p>
      </div>

      {/* ══════════ PIPELINE FUNNEL ══════════ */}
      <PipelineFunnel counts={statusCounts} activeFilter={statusFilter} onFilter={setStatusFilter} />

      {/* ══════════ SUB-HEADER ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline"
            className="gap-1.5 h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => { addQuery(); setConfirmDeleteId(null); }}>
            <Plus size={12} /> Add New Query
          </Button>

          {/* Dispatch All */}
          {undispatchedCount > 0 && (
            <Button size="sm" variant="outline"
              className="gap-1.5 h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
              onClick={openDispatchAll}
              disabled={dispatchingAll}
              title={`Dispatch all ${undispatchedCount} un-dispatched queries`}>
              {dispatchingAll
                ? <Loader2 size={11} className="animate-spin" />
                : <Rocket size={11} />}
              Dispatch All ({undispatchedCount})
            </Button>
          )}

          <span className="text-xs text-muted-foreground">
            {queries.length === 0 ? "No queries yet"
              : `${queries.length} ${queries.length === 1 ? "query" : "queries"}`}
          </span>

          {/* Priority filter chips */}
          {queries.length > 0 && (
            <div className="flex items-center gap-1">
              {(["High","Medium","Low"] as QueryPriority[]).map(p => {
                const cnt = queries.filter(q => q.priority === p).length;
                if (!cnt) return null;
                const m = PRIORITY_META[p];
                return (
                  <button key={p} type="button"
                    onClick={() => setPriorityFilter(priorityFilter === p ? "all" : p)}
                    className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors",
                      priorityFilter === p ? cn(m.bg, m.color, "border-current") : "text-muted-foreground border-transparent hover:bg-muted/40")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", m.dot)} /> {p} {cnt}
                  </button>
                );
              })}
            </div>
          )}

          {activeFilters && (
            <>
              <button type="button"
                onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); setSearchText(""); }}
                className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                <X size={10} /> clear
              </button>
              <span className="text-[10px] text-muted-foreground">
                {displayedQueries.length} of {queries.length}
              </span>
            </>
          )}

          {/* Search */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Search queries…"
              className="h-7 pl-6 pr-6 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44" />
            {searchText && (
              <button type="button" onClick={() => setSearchText("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Phase 3F: Analytics toggle */}
          <Button size="sm" variant="outline"
            className={cn(
              "gap-1 h-7 text-xs transition-colors",
              showAnalytics
                ? "border-orange-400 bg-orange-50 text-orange-700"
                : "border-muted-foreground/30 text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setShowAnalytics(v => !v)}>
            <BarChart2 size={12} />
            Analytics
          </Button>

          <Button size="sm" variant="outline"
            className="gap-1 h-7 text-xs border-green-600 text-green-700 hover:bg-green-50"
            onClick={() => exportToExcel(queries, data.clientName, data.financialYear)}
            disabled={queries.length === 0}>
            <FileSpreadsheet size={12} /> Export Excel
          </Button>
          <Button size="sm" variant="outline"
            className="gap-1 h-7 text-xs border-[#1A2744] text-[#1A2744] hover:bg-[#1A2744]/5"
            onClick={() => fileInputRef.current?.click()}>
            <Upload size={12} /> Import Excel
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
            className="hidden" onChange={handleFileChange} />
          <Button size="sm" className="gap-1 h-7 text-xs bg-orange-600 hover:bg-orange-700"
            onClick={async () => { await manualSave(); onSaved?.(); }} disabled={saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </Button>
        </div>
      </div>

      {/* ══════════ BULK ACTION TOOLBAR (Phase 3C) ══════════ */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-blue-50/60 text-xs">
          <span className="font-semibold text-blue-700">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline"
            className="h-6 text-[10px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-100"
            onClick={openBulkDispatch}>
            <Rocket size={10} /> Dispatch Selected
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1">
                Set Status <ChevronRight size={9} className="rotate-90" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="text-xs">
              {(Object.keys(STATUS_META) as QueryStatus[]).map(s => (
                <DropdownMenuItem key={s} onClick={() => { bulkSetStatus(Array.from(selectedIds), s); setSelectedIds(new Set()); }}>
                  <span className={cn("inline-block w-2 h-2 rounded-full mr-2", STATUS_META[s].bg, "border", STATUS_META[s].border)} />
                  {STATUS_META[s].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1">
                Set Priority <ChevronRight size={9} className="rotate-90" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="text-xs">
              {(["High","Medium","Low"] as QueryPriority[]).map(p => (
                <DropdownMenuItem key={p}
                  onClick={() => {
                    for (const id of selectedIds) updateQuery(id, "priority", p);
                    setSelectedIds(new Set());
                  }}>
                  <span className={cn("w-2 h-2 rounded-full mr-2 inline-block", PRIORITY_META[p].dot)} />
                  {p}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-[10px]">
            <X size={10} /> Deselect all
          </button>
        </div>
      )}

      {/* Download template */}
      <div className="border-b bg-muted/10 px-4 py-1.5 flex items-center gap-1">
        <Download size={11} className="text-muted-foreground" />
        <button type="button"
          className="text-[11px] text-primary underline underline-offset-2 hover:text-primary/80"
          onClick={downloadTemplate}>
          Download blank import template (QuerySheet_Template_CAFlow.xlsx)
        </button>
      </div>

      {/* ══════════ TABLE ══════════ */}
      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[1000px]">
          <thead>
            <tr className="bg-orange-600 text-white text-[11px] uppercase tracking-wide">
              {/* Checkbox + Sr */}
              <th className="border border-orange-500 px-2 py-2.5 text-center w-14">
                <div className="flex flex-col items-center gap-1">
                  <button type="button" onClick={toggleSelectAll}
                    className="text-white/80 hover:text-white transition-colors">
                    {allDisplayedSelected && displayedQueries.length > 0
                      ? <CheckSquare size={13} />
                      : <Square size={13} />}
                  </button>
                  <span className="text-[9px]">Sr.</span>
                </div>
              </th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[140px]">
                Group/Subgroup{hasTallyData && <span className="ml-1 text-[8px] font-bold bg-white/20 rounded px-0.5">TB</span>}
              </th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[150px]">
                Ledger{hasTallyData && <span className="ml-1 text-[8px] font-bold bg-white/20 rounded px-0.5">TB</span>}
              </th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[190px]">Query Description</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[150px]">Required Documents</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[120px]">Remark</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center min-w-[110px]">Status / Due</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center w-16">Del</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center w-20">Dispatch</th>
            </tr>
          </thead>
          <tbody>
            {queries.length === 0 ? (
              <tr>
                <td colSpan={9} className="border border-border py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <MessageSquareWarning size={28} className="text-muted-foreground/40" />
                    <span className="text-sm">No queries yet.</span>
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={addQuery}>
                      <Plus size={12} /> Add First Query
                    </Button>
                  </div>
                </td>
              </tr>
            ) : displayedQueries.length === 0 ? (
              <tr>
                <td colSpan={9} className="border border-border py-8 text-center text-muted-foreground text-sm">
                  No queries match the current filters
                  <button type="button"
                    onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); setSearchText(""); }}
                    className="ml-2 text-primary underline text-xs">clear filters</button>
                </td>
              </tr>
            ) : (
              displayedQueries.map((row, idx) => {
                const isResolved  = row.query_status === "resolved";
                const isEscalated = row.query_status === "escalated";
                const dueState    = dueDateStatus(row.due_date);
                const isSelected  = selectedIds.has(row.id);

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "align-top transition-colors",
                      isSelected   ? "bg-blue-50/70" : "",
                      !isSelected && isResolved   ? "bg-green-50/60 hover:bg-green-50" : "",
                      !isSelected && isEscalated  ? "bg-red-50/60   hover:bg-red-50"   : "",
                      !isSelected && dueState === "overdue" && !isResolved && !isEscalated
                        ? "bg-red-50/40 hover:bg-red-50/60" : "",
                      !isSelected && dueState === "soon" && !isResolved && !isEscalated
                        ? "bg-amber-50/30" : "",
                      !isSelected && !isResolved && !isEscalated && dueState === "ok"
                        ? "bg-background hover:bg-muted/10" : "",
                    )}
                  >
                    {/* Checkbox + Sr + Priority */}
                    <td className="border border-border px-2 py-2 text-center align-middle">
                      <div className="flex flex-col items-center gap-1">
                        <button type="button" onClick={() => toggleSelect(row.id)}
                          className="text-muted-foreground hover:text-foreground transition-colors">
                          {isSelected ? <CheckSquare size={13} className="text-blue-600" /> : <Square size={13} />}
                        </button>
                        <span className="text-[10px] font-mono text-muted-foreground">{idx + 1}</span>
                        <PriorityBadge priority={row.priority} onClick={() => cyclePriority(row.id)} />
                      </div>
                    </td>

                    {/* Group — Phase 3A combobox */}
                    <td className="border border-border px-2 py-2 align-top">
                      <QueryCombobox value={row.head} onChange={v => updateQuery(row.id, "head", v)}
                        options={hasTallyData ? groups : []} placeholder="Group/Subgroup…"
                        isTallyLinked={hasTallyData} />
                    </td>

                    {/* Ledger — Phase 3A combobox filtered by group */}
                    <td className="border border-border px-2 py-2 align-top">
                      <div className="flex items-center gap-1">
                        <QueryCombobox value={row.particulars} onChange={v => updateQuery(row.id, "particulars", v)}
                          options={hasTallyData ? getLedgersForGroup(row.head) : []} placeholder="Ledger…"
                          isTallyLinked={hasTallyData} className="flex-1 min-w-0" />
                        {row.particulars && (
                          <Button size="sm" variant="ghost"
                            className="h-7 w-7 p-0 flex-shrink-0 text-blue-600 hover:bg-blue-50"
                            onClick={() => setViewLedger({ name: row.particulars, group: row.head })}>
                            <BookOpen size={12} />
                          </Button>
                        )}
                      </div>
                    </td>

                    {/* Query Description */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Textarea rows={2} className="text-xs resize-none w-full min-h-[52px]"
                        placeholder="Describe the query…" value={row.query_description}
                        onChange={e => updateQuery(row.id, "query_description", e.target.value)} />
                    </td>

                    {/* Required Documents — Phase 3A */}
                    <td className="border border-border px-2 py-2 align-top">
                      <QueryCombobox value={row.required_documents}
                        onChange={v => updateQuery(row.id, "required_documents", v)}
                        options={COMMON_REQUIRED_DOCS} placeholder="Documents needed…" />
                    </td>

                    {/* Remark */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input className="h-7 text-xs w-full" placeholder="Remark…"
                        value={row.remark} onChange={e => updateQuery(row.id, "remark", e.target.value)} />
                    </td>

                    {/* Status + Due Date — Phase 3B/C */}
                    <td className="border border-border px-2 py-2 align-middle">
                      <QueryStatusCell row={row}
                        onAdvance={() => advanceStatus(row.id)}
                        onSetStatus={s => setQueryStatus(row.id, s)} />
                      {/* Due date input */}
                      <div className="mt-1.5">
                        <input type="date" value={row.due_date || ""}
                          onChange={e => updateQuery(row.id, "due_date" as any, e.target.value)}
                          className={cn(
                            "h-5 text-[9px] w-full rounded border bg-background px-1 focus:outline-none focus:ring-1 focus:ring-ring",
                            dueState === "overdue" ? "border-red-300 bg-red-50 text-red-700"
                              : dueState === "soon"  ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-input text-muted-foreground",
                          )} />
                      </div>
                    </td>

                    {/* Delete */}
                    <td className="border border-border px-2 py-2 align-middle text-center">
                      {confirmDeleteId === row.id ? (
                        <div className="flex flex-col gap-1">
                          <Button size="sm" variant="destructive" className="h-6 text-[10px] px-1 w-full"
                            onClick={() => { deleteQuery(row.id); setConfirmDeleteId(null); setSelectedIds(prev => { const n = new Set(prev); n.delete(row.id); return n; }); }}>
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1 w-full"
                            onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          onClick={() => setConfirmDeleteId(row.id)}>
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </td>

                    {/* Dispatch */}
                    <td className="border border-border px-2 py-2 align-middle text-center">
                      {row.dispatched_query_id ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <CheckCircle2 size={13} className="text-green-600" />
                          <span className="text-[9px] text-green-700">Sent</span>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Dispatch to client portal"
                          disabled={dispatchingId === row.id}
                          onClick={() => dispatchToClient(row)}>
                          {dispatchingId === row.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Send size={12} />}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <div className="border-t bg-muted/20 px-4 py-2 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {allCorrected
            ? queries.length === 0 ? "No queries — pipeline unblocked"
              : `✓ All ${queries.length} ${queries.length === 1 ? "query" : "queries"} resolved`
            : `${pendingCount} of ${queries.length} pending resolution`}
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>

      {/* ══════════ ANALYTICS SIDEBAR (Phase 3F) ══════════ */}
      <QueryAnalyticsSidebar
        open={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        queries={queries}
        onJumpStatus={s => setStatusFilter(s)}
      />

      {/* ══════════ LEDGER SIDE PANEL ══════════ */}
      <LedgerSidePanel
        open={!!viewLedger}
        ledgerName={viewLedger?.name ?? ""}
        parentGroup={viewLedger?.group ?? ""}
        clientId={data.engagement?.client_id}
        financialYear={data.financialYear}
        onClose={() => setViewLedger(null)}
        onRaiseQuery={(group, ledger, note) => {
          setViewLedger(null);
          addQueryPrefilled(group, ledger, note);
        }}
      />

      {/* ══════════ BULK DISPATCH DIALOG (Phase 3C) ══════════ */}
      <BulkDispatchDialog
        open={bulkDispatchOpen}
        onClose={() => { setBulkDispatchOpen(false); setBulkTargetRows([]); }}
        rows={bulkTargetRows}
        engagementId={engagementId}
        clientId={data.engagement?.client_id || ""}
        firmId={data.engagement?.firm_id || null}
        financialYear={data.financialYear}
        onDispatched={handleBulkDispatched}
      />

      {/* ══════════ IMPORT PREVIEW MODAL ══════════ */}
      <Dialog open={!!importPreview} onOpenChange={() => setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload size={16} className="text-[#1A2744]" /> Import Queries Preview
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground px-1">
            You are about to import{" "}
            <span className="font-semibold text-foreground">{importPreview?.length}</span>{" "}
            {(importPreview?.length ?? 0) === 1 ? "query" : "queries"}.{" "}
            Existing queries will <strong>not</strong> be deleted.
          </p>
          <div className="overflow-auto rounded border flex-1 min-h-0">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/60">
                  {["#","Group/Subgroup","Ledger","Query Description","Status","Priority"].map(h => (
                    <TableHead key={h} className="text-xs py-2">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(importPreview ?? []).slice(0, 5).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="w-8 text-center text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-[100px] truncate">{r.head || "—"}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{r.particulars || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.query_description || "—"}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px]", STATUS_META[r.query_status]?.bg, STATUS_META[r.query_status]?.color)}>
                        {STATUS_META[r.query_status]?.label ?? r.query_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px]", PRIORITY_META[r.priority]?.bg, PRIORITY_META[r.priority]?.color)}>
                        {r.priority}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(importPreview?.length ?? 0) > 5 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-2 text-xs">
                      … and {(importPreview?.length ?? 0) - 5} more rows
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button size="sm" className="bg-[#1A2744] hover:bg-[#1A2744]/90 text-white gap-1.5"
              onClick={confirmImport} disabled={importing}>
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Import All ({importPreview?.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
