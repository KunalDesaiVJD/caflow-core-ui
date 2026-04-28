/**
 * QuerySheet — Sheet 5 "QUERY SHEET"
 *
 * Phase 3A: Tally-linked type-ahead comboboxes for Group, Ledger, and
 *           Required Documents fields.  Shows "TB" badge when Tally data
 *           is available.
 *
 * Phase 3B: Full query state machine
 *   draft → raised → dispatched → response_received → resolved | escalated
 *   • Pipeline funnel bar (counts per state) at top
 *   • Status pill + quick advance/escalate buttons per row
 *   • Priority badge (High/Medium/Low) — click to cycle
 *   • Filter by state + filter by priority
 *   • allCorrected gate: resolved || correction_status = "Yes"
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
  ChevronRight, Flag, ArrowRight, AlertTriangle,
} from "lucide-react";
import { LedgerSidePanel } from "./LedgerSidePanel";
import { QueryCombobox, COMMON_REQUIRED_DOCS } from "./QueryCombobox";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useQuerySheetStorage, STATUS_META, PRIORITY_META } from "./hooks/useQuerySheetStorage";
import type { QueryRow, QueryStatus, QueryPriority } from "./hooks/useQuerySheetStorage";
import { useTallyOptions } from "./hooks/useTallyOptions";
import type { AuditWorksheetData } from "./hooks/useAuditWorksheetData";

// ─── Excel helpers ────────────────────────────────────────────────────────────

const HEADERS = [
  "SR.", "GROUP/SUBGROUP", "LEDGER", "QUERY DESCRIPTION",
  "REQUIRED DOCUMENTS", "REMARK", "CORRECTION STATUS",
  "QUERY STATUS", "PRIORITY",
];

function exportToExcel(queries: QueryRow[], clientName: string, fy: string) {
  const rows = queries.map((q, i) => [
    i + 1,
    q.head,
    q.particulars,
    q.query_description,
    q.required_documents,
    q.remark,
    q.correction_status || "Pending",
    q.query_status,
    q.priority,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Queries");
  const safeName = (clientName || "Client").replace(/[^a-zA-Z0-9_-]/g, "_");
  XLSX.writeFile(wb, `Queries_${safeName}_${fy || "FY"}.xlsx`);
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 18 }, { wch: 22 }, { wch: 35 },
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 10 },
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
        const dataRows = raw.filter((row, i) => {
          if (i === 0) return false;
          return row.some((c: any) => c !== undefined && c !== null && c !== "");
        });
        const VALID_STATUSES: QueryStatus[] = ["draft","raised","dispatched","response_received","resolved","escalated"];
        const VALID_PRIO: QueryPriority[]   = ["High","Medium","Low"];
        const parsed: Array<Omit<QueryRow, "id">> = dataRows.map((row: any[]) => ({
          head:               String(row[1] ?? ""),
          particulars:        String(row[2] ?? ""),
          query_description:  String(row[3] ?? ""),
          required_documents: String(row[4] ?? ""),
          remark:             String(row[5] ?? ""),
          correction_status:  (["Yes","No"].includes(String(row[6] ?? "")) ? String(row[6]) : "") as "" | "Yes" | "No",
          query_status:       (VALID_STATUSES.includes(String(row[7] ?? "") as QueryStatus) ? String(row[7]) : "raised") as QueryStatus,
          priority:           (VALID_PRIO.includes(String(row[8] ?? "") as QueryPriority) ? String(row[8]) : "Medium") as QueryPriority,
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
        const m = STATUS_META[s];
        const active = activeFilter === s;
        const cnt = counts[s];
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
              <span>{m.label}</span>
              {cnt > 0 && <span className={cn("font-bold", active ? m.color : "")}>{cnt}</span>}
            </button>
          </div>
        );
      })}
      {/* Escalated */}
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
            <AlertTriangle size={9} />
            <span>Escalated</span>
            <span className="font-bold">{counts.escalated}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Status pill + actions ────────────────────────────────────────────────────

function QueryStatusCell({
  row,
  onAdvance,
  onSetStatus,
}: {
  row:         QueryRow;
  onAdvance:   () => void;
  onSetStatus: (s: QueryStatus) => void;
}) {
  const m    = STATUS_META[row.query_status];
  const next = row.query_status !== "resolved" && row.query_status !== "escalated"
    ? (row.query_status === "response_received" ? "resolved" : null)
    : null;
  const canAdvance = !["resolved", "escalated"].includes(row.query_status);

  return (
    <div className="flex flex-col gap-1 items-start">
      {/* Status pill */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer",
              m.bg, m.color, m.border,
            )}
          >
            {m.label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="text-xs">
          {(Object.keys(STATUS_META) as QueryStatus[]).map(s => {
            const sm = STATUS_META[s];
            return (
              <DropdownMenuItem
                key={s}
                onClick={() => onSetStatus(s)}
                className={cn("gap-2", s === row.query_status && "font-semibold")}
              >
                <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", sm.bg, "border", sm.border)} />
                {sm.label}
                {s === row.query_status && " ✓"}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onSetStatus("escalated")}
            className="text-red-600 gap-2"
          >
            <AlertTriangle size={10} /> Escalate
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Advance button */}
      {canAdvance && (
        <button
          type="button"
          onClick={onAdvance}
          title={`Advance to ${STATUS_META[Object.keys(STATUS_META).find(k => k === (row.query_status === "response_received" ? "resolved" : { draft:"raised", raised:"dispatched", dispatched:"response_received", response_received:"resolved" }[row.query_status])) as QueryStatus]?.label ?? "next step"}`}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
        >
          <ArrowRight size={9} />
          {STATUS_META[{
            draft:             "raised",
            raised:            "dispatched",
            dispatched:        "response_received",
            response_received: "resolved",
            resolved:          "resolved",
            escalated:         "escalated",
          }[row.query_status] as QueryStatus]?.label ?? "next"}
        </button>
      )}
    </div>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({
  priority, onClick,
}: {
  priority: QueryPriority;
  onClick:  () => void;
}) {
  const m = PRIORITY_META[priority];
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to change priority"
      className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-semibold border transition-colors",
        m.bg, m.color, "border-current/20 hover:opacity-80",
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", m.dot)} />
      {priority}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuerySheet({
  data, engagementId, onSaved,
  externalPrefill, onPrefillConsumed,
}: Props) {
  const {
    queries, addQuery, addQueryPrefilled, updateQuery, deleteQuery, bulkAddQueries,
    advanceStatus, setQueryStatus, cyclePriority,
    manualSave, saving, allCorrected, pendingCount, statusCounts,
  } = useQuerySheetStorage(engagementId, data.engagement?.firm_id);

  // Phase 3A: Tally options
  const { groups, getLedgersForGroup, hasTallyData } = useTallyOptions(
    data.engagement?.client_id,
    data.financialYear,
  );

  // Consume externalPrefill
  useEffect(() => {
    if (!externalPrefill) return;
    addQueryPrefilled(externalPrefill.head, externalPrefill.particulars, externalPrefill.note);
    onPrefillConsumed?.();
  }, [externalPrefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewLedger,      setViewLedger]      = useState<{ name: string; group: string } | null>(null);
  const [dispatchingId,   setDispatchingId]   = useState<string | null>(null);

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
        // Also advance status to dispatched if still in raised
        if (row.query_status === "raised") setQueryStatus(row.id, "dispatched");
      }
      toast.success("Query dispatched to client portal");
    } catch (err: any) {
      toast.error(err.message || "Dispatch failed");
    } finally {
      setDispatchingId(null);
    }
  };

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [searchText,    setSearchText]    = useState("");
  const [statusFilter,  setStatusFilter]  = useState<QueryStatus | "all">("all");
  const [priorityFilter,setPriorityFilter]= useState<QueryPriority | "all">("all");

  const displayedQueries = useMemo(() => {
    return queries.filter(q => {
      if (statusFilter   !== "all" && q.query_status !== statusFilter)   return false;
      if (priorityFilter !== "all" && q.priority     !== priorityFilter) return false;
      if (searchText) {
        const s = searchText.toLowerCase();
        if (!(q.head?.toLowerCase().includes(s)
          || q.particulars?.toLowerCase().includes(s)
          || q.query_description?.toLowerCase().includes(s)
          || q.required_documents?.toLowerCase().includes(s)
          || q.remark?.toLowerCase().includes(s))) return false;
      }
      return true;
    });
  }, [queries, statusFilter, priorityFilter, searchText]);

  // ── Import state ─────────────────────────────────────────────────────────────
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

  return (
    <div className="space-y-0 bg-card border rounded-lg overflow-hidden">

      {/* ══════════ PAGE HEADER ══════════ */}
      <div className="bg-orange-600 text-white px-6 py-4">
        <div className="flex items-center gap-2">
          <MessageSquareWarning size={18} />
          <span className="text-base font-semibold tracking-wide">{data.firmName || "CA Firm"}</span>
          {hasTallyData && (
            <span className="ml-2 text-[10px] font-bold bg-white/20 border border-white/30 rounded px-1.5 py-px">
              TB Linked
            </span>
          )}
        </div>
        <p className="text-[13px] font-bold opacity-95 tracking-widest uppercase">
          Query of Client{data.clientName ? ` — ${data.clientName}` : ""}
        </p>
      </div>

      {/* ══════════ PIPELINE FUNNEL (Phase 3B) ══════════ */}
      <PipelineFunnel
        counts={statusCounts}
        activeFilter={statusFilter}
        onFilter={setStatusFilter}
      />

      {/* ══════════ SUB-HEADER ══════════ */}
      <div className="border-b bg-muted/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => { addQuery(); setConfirmDeleteId(null); }}
          >
            <Plus size={12} /> Add New Query
          </Button>

          <span className="text-xs text-muted-foreground">
            {queries.length === 0
              ? "No queries yet"
              : `${queries.length} ${queries.length === 1 ? "query" : "queries"}`}
          </span>

          {/* Priority filter chips */}
          {queries.length > 0 && (
            <div className="flex items-center gap-1">
              {(["High","Medium","Low"] as QueryPriority[]).map(p => {
                const cnt = queries.filter(q => q.priority === p).length;
                if (cnt === 0) return null;
                const m = PRIORITY_META[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriorityFilter(priorityFilter === p ? "all" : p)}
                    className={cn(
                      "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors",
                      priorityFilter === p
                        ? cn(m.bg, m.color, "border-current")
                        : "text-muted-foreground border-transparent hover:bg-muted/40",
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", m.dot)} /> {p} {cnt}
                  </button>
                );
              })}
            </div>
          )}

          {activeFilters && (
            <button
              type="button"
              onClick={() => { setStatusFilter("all"); setPriorityFilter("all"); setSearchText(""); }}
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <X size={10} /> clear filters
            </button>
          )}
          {activeFilters && (
            <span className="text-[10px] text-muted-foreground">
              {displayedQueries.length} of {queries.length}
            </span>
          )}

          {/* Search */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search queries…"
              className="h-7 pl-6 pr-6 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44"
            />
            {searchText && (
              <button type="button" onClick={() => setSearchText("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline"
            className="gap-1 h-7 text-xs border-green-600 text-green-700 hover:bg-green-50"
            onClick={() => exportToExcel(queries, data.clientName, data.financialYear)}
            disabled={queries.length === 0}
            title="Export all queries to Excel">
            <FileSpreadsheet size={12} /> Export Excel
          </Button>
          <Button size="sm" variant="outline"
            className="gap-1 h-7 text-xs border-[#1A2744] text-[#1A2744] hover:bg-[#1A2744]/5"
            onClick={() => fileInputRef.current?.click()}
            title="Import queries from Excel">
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
        <table className="w-full text-sm border-collapse min-w-[980px]">
          <thead>
            <tr className="bg-orange-600 text-white text-[11px] uppercase tracking-wide">
              <th className="border border-orange-500 px-2 py-2.5 text-center w-12">Sr.</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[140px]">
                Group/Subgroup
                {hasTallyData && <span className="ml-1 text-[8px] font-bold bg-white/20 rounded px-0.5">TB</span>}
              </th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[150px]">
                Ledger
                {hasTallyData && <span className="ml-1 text-[8px] font-bold bg-white/20 rounded px-0.5">TB</span>}
              </th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[190px]">Query Description</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[150px]">Required Documents</th>
              <th className="border border-orange-500 px-3 py-2.5 text-left min-w-[120px]">Remark</th>
              <th className="border border-orange-500 px-2 py-2.5 text-center min-w-[110px]">Status</th>
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
                    className="ml-2 text-primary underline text-xs">
                    clear filters
                  </button>
                </td>
              </tr>
            ) : (
              displayedQueries.map((row, idx) => {
                const sm = STATUS_META[row.query_status];
                const pm = PRIORITY_META[row.priority];
                const isResolved = row.query_status === "resolved";
                const isEscalated = row.query_status === "escalated";

                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "align-top transition-colors",
                      isResolved  ? "bg-green-50/60 hover:bg-green-50" : "",
                      isEscalated ? "bg-red-50/60   hover:bg-red-50"   : "",
                      !isResolved && !isEscalated ? "bg-background hover:bg-muted/10" : "",
                    )}
                  >
                    {/* Sr + Priority */}
                    <td className="border border-border px-2 py-2 text-center align-middle">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-mono text-muted-foreground">{idx + 1}</span>
                        <PriorityBadge priority={row.priority} onClick={() => cyclePriority(row.id)} />
                      </div>
                    </td>

                    {/* Group/Subgroup — Phase 3A combobox */}
                    <td className="border border-border px-2 py-2 align-top">
                      <QueryCombobox
                        value={row.head}
                        onChange={v => updateQuery(row.id, "head", v)}
                        options={hasTallyData ? groups : []}
                        placeholder="Group/Subgroup…"
                        isTallyLinked={hasTallyData}
                      />
                    </td>

                    {/* Ledger — Phase 3A combobox filtered by group */}
                    <td className="border border-border px-2 py-2 align-top">
                      <div className="flex items-center gap-1">
                        <QueryCombobox
                          value={row.particulars}
                          onChange={v => updateQuery(row.id, "particulars", v)}
                          options={hasTallyData ? getLedgersForGroup(row.head) : []}
                          placeholder="Ledger…"
                          isTallyLinked={hasTallyData}
                          className="flex-1 min-w-0"
                        />
                        {row.particulars && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 flex-shrink-0 text-blue-600 hover:bg-blue-50"
                            title={`View ledger: ${row.particulars}`}
                            onClick={() => setViewLedger({ name: row.particulars, group: row.head })}
                          >
                            <BookOpen size={12} />
                          </Button>
                        )}
                      </div>
                    </td>

                    {/* Query Description */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Textarea
                        rows={2}
                        className="text-xs resize-none w-full min-h-[52px]"
                        placeholder="Describe the query…"
                        value={row.query_description}
                        onChange={e => updateQuery(row.id, "query_description", e.target.value)}
                      />
                    </td>

                    {/* Required Documents — Phase 3A combobox with templates */}
                    <td className="border border-border px-2 py-2 align-top">
                      <QueryCombobox
                        value={row.required_documents}
                        onChange={v => updateQuery(row.id, "required_documents", v)}
                        options={COMMON_REQUIRED_DOCS}
                        placeholder="Documents needed…"
                      />
                    </td>

                    {/* Remark */}
                    <td className="border border-border px-2 py-2 align-top">
                      <Input
                        className="h-7 text-xs w-full"
                        placeholder="Remark…"
                        value={row.remark}
                        onChange={e => updateQuery(row.id, "remark", e.target.value)}
                      />
                    </td>

                    {/* Status — Phase 3B state machine */}
                    <td className="border border-border px-2 py-2 align-middle">
                      <QueryStatusCell
                        row={row}
                        onAdvance={() => advanceStatus(row.id)}
                        onSetStatus={s => setQueryStatus(row.id, s)}
                      />
                    </td>

                    {/* Delete */}
                    <td className="border border-border px-2 py-2 align-middle text-center">
                      {confirmDeleteId === row.id ? (
                        <div className="flex flex-col gap-1">
                          <Button size="sm" variant="destructive"
                            className="h-6 text-[10px] px-1 w-full"
                            onClick={() => { deleteQuery(row.id); setConfirmDeleteId(null); }}>
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost"
                            className="h-6 text-[10px] px-1 w-full"
                            onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          onClick={() => setConfirmDeleteId(row.id)}>
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </td>

                    {/* Dispatch to Client */}
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
            ? queries.length === 0
              ? "No queries — pipeline unblocked"
              : `✓ All ${queries.length} ${queries.length === 1 ? "query" : "queries"} resolved`
            : `${pendingCount} of ${queries.length} pending resolution`}
        </p>
        {saving && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" /> Auto-saving…
          </p>
        )}
      </div>

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

      {/* ══════════ IMPORT PREVIEW MODAL ══════════ */}
      <Dialog open={!!importPreview} onOpenChange={() => setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload size={16} className="text-[#1A2744]" />
              Import Queries Preview
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
                  {["#", "Group/Subgroup", "Ledger", "Query Description", "Status", "Priority"].map(h => (
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
