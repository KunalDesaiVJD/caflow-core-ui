/**
 * AuditStatusGrid
 *
 * Full audit-status table with:
 *  - Global search (300 ms debounce) across every text field
 *  - Per-column filter row (text inputs + selects inside <thead>)
 *  - Column sorting with asc / desc indicator
 *  - Pagination — 25 rows per page, "Showing X–Y of Z"
 *  - "Add New Audit" button → new blank row inserted at top in edit mode
 *  - Sticky header row + sticky Sr No / Party Name columns
 */
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import AuditChangeLogModal from "./AuditChangeLogModal";
import { cn } from "@/lib/utils";

import AuditStatusFilters from "./AuditStatusFilters";
import AuditStatusRow     from "./AuditStatusRow";
import { useAuditStatus } from "../hooks/useAuditStatus";
import type { StatusEntry, StatusPatch } from "../hooks/useAuditStatus";
import type { ClientOption }             from "../hooks/useClients";
import type { UserOption }               from "../hooks/useUsers";
import type { AuditFirmOption }          from "../hooks/useFirms";
import type { PlanEntry }                from "../hooks/useAuditPlanning";
import { AUDIT_STATUS_OPTIONS, REMARKS_OPTIONS } from "./AuditStatusFilters";

// ─── Constants ────────────────────────────────────────────────────────────────

// 2026-06-25 (V J Desai request) — page-size choices in the footer.
// 25 stays the default for parity with the previous behaviour.
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

const YES_NO_OPTIONS = ["Yes", "No"];

// ─── Separate columns — Audit Employees / Firm / Partner moved to
// Party Name hover tooltip per user request.
const COLS: { label: string; id: string; sortable?: boolean; filterType?: "text"|"select"|"date"|"yesno"|"status"|"person"|"none" }[] = [
  { label: "Sr No",                 id: "_srno",                          filterType: "none"   },
  { label: "Party Name",            id: "party_name",       sortable: true, filterType: "text" },
  { label: "Physical Audit",        id: "physical_audit_conducted",       filterType: "yesno"  },
  { label: "Accounting Data",       id: "accounting_data",                filterType: "yesno"  },
  { label: "Audit Report Prep. By",    id: "audit_report_prepared_by",    filterType: "text"   },
  { label: "Audit Report Checked By",  id: "audit_report_checked_by",     filterType: "text"   },
  { label: "Audit Status",          id: "audit_status",     sortable: true, filterType: "status" },
  { label: "Report Print Date",     id: "report_print_date", sortable: true, filterType: "date" },
  { label: "Phys. Report Recd",     id: "physical_report_received_date",  filterType: "date"   },
  { label: "UDIN Tax Audit",        id: "udin_tax_audit",                 filterType: "text"   },
  { label: "UDIN Statutory",        id: "udin_statutory_audit",           filterType: "text"   },
  { label: "UDIN Date",             id: "udin_date",                      filterType: "date"   },
  { label: "Scanned",               id: "scanned",                        filterType: "yesno"  },
  { label: "3CA/3CB+3CD Prepared By", id: "prepared_by",                   filterType: "person" },
  { label: "3CA/3CB+3CD Checked By",  id: "checked_by",                   filterType: "person" },
  { label: "3CA/3CB+3CD Uploaded By", id: "uploaded_by",                  filterType: "text"   },
  { label: "Remarks",               id: "remarks",                        filterType: "status" },
  { label: "",                      id: "_actions",                       filterType: "none"   },
];

// ─── Blank template for a new row ─────────────────────────────────────────────

const makeBlankRow = (fy?: string): StatusEntry => ({
  id: "__new__", firm_id: "", client_id: null, party_name: null,
  physical_audit_conducted: "No", accounting_data: "No",
  audit_employees: null, audit_report_prepared_by: null, audit_report_checked_by: null,
  audit_status: null, audit_status_other: null,
  report_print_date: null, firm: null, partner: null,
  udin_tax_audit: null, udin_statutory_audit: null, udin_date: null,
  physical_report_received_date: null, scanned: "No",
  prepared_by: null, checked_by: null, uploaded_by: null, upload_date: null,
  remarks: null, remarks_other: null, engagement_id: null, financial_year: fy ?? null, created_at: "",
});

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  firmId:          string;
  clients:         ClientOption[];
  users:           UserOption[];
  auditFirms:      AuditFirmOption[];
  planEntries:     PlanEntry[];
  isSuperadmin?:   boolean;
  /** When set, only rows matching this client_id are shown (Select Client mode) */
  clientIdFilter?: string | null;
  /** Financial year filter e.g. "2024-25" — auto-populates from audit_engagements */
  selectedFY?:     string;
  /** Issue 2: when the grid is rendered inside the fullscreen overlay, use
   *  the entire remaining viewport height for the scroll container so the
   *  table actually fits the screen instead of staying capped at
   *  100vh - 320px (which left huge empty space below). */
  maximized?:      boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusGrid({ firmId, clients, users, auditFirms, planEntries, isSuperadmin, clientIdFilter, selectedFY, maximized }: Props) {
  const { rows, loading, useLs, reload, addRow, updateRow, removeRow } = useAuditStatus(firmId, isSuperadmin, selectedFY);

  // ── Search (debounced 300 ms) ──────────────────────────────────────────────
  const [searchRaw, setSearchRaw] = useState("");
  const [search,    setSearch]    = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchRaw]);

  // ── Quick-filter bar ───────────────────────────────────────────────────────
  // 2026-06-25 (V J Desai) — status filter is now a multi-select. Empty
  // array means "All Statuses"; non-empty means an OR-list of statuses.
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  // 2026-06-25 (V J Desai) — Completed / Pending chip.
  // "Completed" = scanned Yes (audit fully signed off).
  // "Pending"   = scanned "No" OR blank.
  const [scanFilter, setScanFilter] = useState<"all" | "completed" | "pending">("all");

  // ── Per-column filters ─────────────────────────────────────────────────────
  const [colFilters,    setColFilters]    = useState<Record<string, string>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);

  function setColFilter(id: string, val: string) {
    setColFilters(p => ({ ...p, [id]: val }));
    setPage(1);
  }
  function clearColFilters() {
    setColFilters({});
    setPage(1);
  }
  const hasColFilters = Object.values(colFilters).some(Boolean);

  // ── Sorting ───────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("asc");
  function toggleSort(field: string) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  // ── New row ───────────────────────────────────────────────────────────────
  const [addingNew, setAddingNew] = useState(false);

  // ── History modal ─────────────────────────────────────────────────────────
  const [historyRowId, setHistoryRowId] = useState<string | null>(null);
  const historyRow = historyRowId ? rows.find(r => r.id === historyRowId) : null;

  // ── Autosave state aggregation (2026-06-25, V J Desai) ───────────────────
  // Rows report their lifecycle here so the filter bar can show one global
  // pill ("Saving 3 changes…" / "All changes saved" / "1 failed"). We store
  // a Map (row id → state) rather than counters so a repeat "saving" for the
  // same row doesn't double-count.
  type RowSaveState = "idle" | "saving" | "saved" | "error";
  const [rowSaveStates, setRowSaveStates] = useState<Map<string, RowSaveState>>(new Map());
  const handleRowSaveStateChange = useCallback((id: string, state: RowSaveState) => {
    setRowSaveStates(prev => {
      const cur = prev.get(id);
      if (cur === state) return prev;
      const next = new Map(prev);
      if (state === "idle") next.delete(id); else next.set(id, state);
      return next;
    });
  }, []);
  const savingCount = useMemo(
    () => [...rowSaveStates.values()].filter(s => s === "saving").length,
    [rowSaveStates],
  );
  const errorCount = useMemo(
    () => [...rowSaveStates.values()].filter(s => s === "error").length,
    [rowSaveStates],
  );
  // A rolling "just saved" flag so the pill reads "All changes saved" for a
  // beat after the last save finishes, before fading back to idle. Reset on
  // any new saving-in-flight.
  const [savedRecently, setSavedRecently] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (savingCount > 0 || errorCount > 0) { setSavedRecently(false); return; }
    // Everything just settled — flag as saved for 2 s.
    setSavedRecently(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedRecently(false), 2000);
  }, [savingCount, errorCount]);

  // Reset page when filters change
  useEffect(() => setPage(1), [search, statusFilter, scanFilter, colFilters, pageSize]);

  // ── Filtering + sorting ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = rows;

    // Client-scope filter (Select Client mode — applied before all other filters)
    if (clientIdFilter) result = result.filter(r => r.client_id === clientIdFilter);

    // Global text search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        Object.values(r).some(v => v && typeof v === "string" && v.toLowerCase().includes(q))
      );
    }

    // Quick-filter bar: Audit Status
    if (statusFilter.length > 0) {
      const wanted = new Set(statusFilter);
      result = result.filter(r => wanted.has(r.audit_status || ""));
    }

    // Completed / Pending scan chip
    if (scanFilter === "completed") {
      result = result.filter(r => (r.scanned || "").trim().toLowerCase() === "yes");
    } else if (scanFilter === "pending") {
      result = result.filter(r => {
        const v = (r.scanned || "").trim().toLowerCase();
        return v !== "yes"; // "no" OR blank
      });
    }

    // Per-column filters.
    // 2026-06-25 (V J Desai) — the "status" filterType now stores its
    // selection as a pipe-separated multi-value string (e.g.
    // "REPORT SIGNED|REPORT PRINTED"). Any of the tokens matches the row
    // (OR semantics). Yes/no and text stay single-value as before.
    Object.entries(colFilters).forEach(([id, val]) => {
      if (!val || val === "all") return;
      const colDef = COLS.find(c => c.id === id);
      result = result.filter(r => {
        const rv = String((r as any)[id] ?? "");
        if (colDef?.filterType === "status") {
          const wanted = new Set(val.split("|").filter(Boolean));
          return wanted.has(rv);
        }
        if (colDef?.filterType === "yesno") {
          return rv === val;
        }
        if (colDef?.filterType === "person") {
          // Compound filter — a name substring AND/OR a completion state
          // ("Done" = field non-blank, "Not Done" = blank). Encoded as a
          // small JSON object since colFilters only stores one string per
          // column; see PersonFilterPanel below.
          let parsed: { name?: string; done?: "yes" | "no" | "" } = {};
          try { parsed = JSON.parse(val); } catch { /* ignore malformed filter value */ }
          const nameOk = !parsed.name || rv.toLowerCase().includes(parsed.name.toLowerCase());
          const doneOk = !parsed.done || (parsed.done === "yes" ? rv.trim() !== "" : rv.trim() === "");
          return nameOk && doneOk;
        }
        // Substring match for text / date columns
        return rv.toLowerCase().includes(val.toLowerCase());
      });
    });

    // Sort
    if (sortField) {
      result = [...result].sort((a, b) => {
        const va: string = ((a as any)[sortField] || "").toLowerCase();
        const vb: string = ((b as any)[sortField] || "").toLowerCase();
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }

    return result;
  }, [rows, search, statusFilter, scanFilter, colFilters, sortField, sortDir, clientIdFilter]);

  // Counts for the scan chips — reflect the CURRENT scope (search + other
  // filters applied) so the auditor sees "of the 87 clients I'm looking at,
  // 12 are done and 75 remain" rather than a firm-wide total that ignores
  // the visible slice. Excludes the scanFilter itself so switching between
  // Completed / Pending doesn't zero the opposite chip.
  const scanChipCounts = useMemo(() => {
    let base = rows;
    if (clientIdFilter) base = base.filter(r => r.client_id === clientIdFilter);
    if (search) {
      const q = search.toLowerCase();
      base = base.filter(r => Object.values(r).some(v => v && typeof v === "string" && v.toLowerCase().includes(q)));
    }
    if (statusFilter.length > 0) {
      const wanted = new Set(statusFilter);
      base = base.filter(r => wanted.has(r.audit_status || ""));
    }
    let completed = 0, pending = 0;
    for (const r of base) {
      if ((r.scanned || "").trim().toLowerCase() === "yes") completed++;
      else pending++;
    }
    return { completed, pending };
  }, [rows, search, statusFilter, clientIdFilter]);

  // ── Pagination slice ──────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const startIdx = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx   = Math.min(page * pageSize, filtered.length);

  // ── Handlers ──────────────────────────────────────────────────────────────
  // BUG A: keep form open on failure so the user can retry; only close on success.
  async function handleAddNew(patch: StatusPatch) {
    const result = await addRow({
      client_id:                     patch.client_id                     ?? null,
      party_name:                    patch.party_name                    ?? null,
      physical_audit_conducted:      patch.physical_audit_conducted      ?? "No",
      accounting_data:               patch.accounting_data               ?? "No",
      audit_employees:               patch.audit_employees               ?? null,
      audit_report_prepared_by:      patch.audit_report_prepared_by      ?? null,
      audit_report_checked_by:       patch.audit_report_checked_by       ?? null,
      audit_status:                  patch.audit_status                  ?? null,
      audit_status_other:            patch.audit_status_other            ?? null,
      report_print_date:             patch.report_print_date             ?? null,
      firm:                          patch.firm                          ?? null,
      partner:                       patch.partner                       ?? null,
      udin_tax_audit:                patch.udin_tax_audit                ?? null,
      udin_statutory_audit:          patch.udin_statutory_audit          ?? null,
      udin_date:                     patch.udin_date                     ?? null,
      physical_report_received_date: patch.physical_report_received_date ?? null,
      scanned:                       patch.scanned                       ?? "No",
      prepared_by:                   patch.prepared_by                   ?? null,
      checked_by:                    patch.checked_by                    ?? null,
      uploaded_by:                   patch.uploaded_by                   ?? null,
      upload_date:                   patch.upload_date                   ?? null,
      remarks:                       patch.remarks                       ?? null,
      remarks_other:                 patch.remarks_other                 ?? null,
      engagement_id:                 patch.engagement_id                 ?? null,
      financial_year:                patch.financial_year                ?? selectedFY ?? null,
    });
    // Only close the new-row form when the insert actually succeeded
    if (result !== null) {
      setAddingNew(false);
      setPage(1); // navigate to first page so user can see the new row
    }
  }

  // ── Sort icon helper ──────────────────────────────────────────────────────
  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ChevronsUpDown size={10} className="opacity-40 ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp   size={10} className="ml-0.5 text-indigo-200" />
      : <ChevronDown size={10} className="ml-0.5 text-indigo-200" />;
  }

  // ── Distinct audit firms for column filter ────────────────────────────────
  const firmNames = useMemo(() => [...new Set(auditFirms.map(f => f.name))].sort(), [auditFirms]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 w-full min-w-0">

      {/* Filter toolbar (search + status filter + refresh + clear filters + autosave pill) */}
      <AuditStatusFilters
        search={searchRaw}          onSearch={v => { setSearchRaw(v); setPage(1); }}
        statusFilter={statusFilter} onStatus={v => { setStatusFilter(v); setPage(1); }}
        scanFilter={scanFilter}     onScanFilter={v => { setScanFilter(v); setPage(1); }}
        completedCount={scanChipCounts.completed}
        pendingCount={scanChipCounts.pending}
        onRefresh={reload}
        savingCount={savingCount}
        errorCount={errorCount}
        savedRecently={savedRecently}
        hasColFilters={hasColFilters}
        onClearFilters={clearColFilters}
      />

      {/* Table */}
      <div className={cn("border rounded-lg overflow-hidden w-full", maximized && "border-0 rounded-none")}>
        <div
          className="overflow-auto w-full"
          // Maximized mode uses nearly the whole viewport (minus the card
          // header + filter bar above ≈ 140 px). Non-maximized keeps the
          // original 320 px reservation for the surrounding page chrome.
          style={{ maxHeight: maximized ? "calc(100vh - 140px)" : "calc(100vh - 320px)" }}
        >
          <table className="border-collapse text-xs" style={{ minWidth: 1850, tableLayout: "fixed" }}>

            {/* ── Sticky header row ── */}
            <thead className="sticky top-0 z-30">
              <tr className="bg-indigo-700 text-white text-[10px] uppercase tracking-wide">
                {COLS.map(col => {
                  const activeFilter = colFilters[col.id];
                  // "person" stores a small JSON blob (name + done state) —
                  // show a readable summary in the tooltip instead of raw JSON.
                  let activeFilterLabel = activeFilter;
                  if (activeFilter && col.filterType === "person") {
                    try {
                      const p = JSON.parse(activeFilter);
                      const parts: string[] = [];
                      if (p.name) parts.push(`name~"${p.name}"`);
                      if (p.done) parts.push(p.done === "yes" ? "Done" : "Not Done");
                      activeFilterLabel = parts.join(", ") || activeFilter;
                    } catch { /* keep raw string */ }
                  }
                  return (
                    <th
                      key={col.id}
                      title={col.label}
                      onClick={col.sortable ? () => toggleSort(col.id) : undefined}
                      className={cn(
                        "border border-indigo-600 px-2 py-2.5 text-left whitespace-nowrap select-none",
                        col.id === "_srno"      && "sticky left-0 z-40 bg-indigo-700 w-10",
                        col.id === "party_name" && "sticky left-10 z-40 bg-indigo-700 min-w-[140px]",
                        col.id === "_actions"   && "w-16 text-center",
                        col.sortable && "cursor-pointer hover:bg-indigo-600",
                      )}
                    >
                      <div className="flex items-center justify-between gap-0.5">
                        {/* Label + sort icon */}
                        <span className="flex items-center gap-0.5 truncate">
                          {col.label}
                          {col.sortable && <SortIcon field={col.id} />}
                        </span>

                        {/* Per-column filter button (all cols except _srno) */}
                        {col.filterType !== "none" && (
                          <Popover
                            open={openFilterCol === col.id}
                            onOpenChange={open => setOpenFilterCol(open ? col.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <button
                                onClick={e => e.stopPropagation()}
                                title={activeFilter ? `Filtered: ${activeFilterLabel}` : `Filter ${col.label}`}
                                className={cn(
                                  "flex-shrink-0 p-0.5 rounded hover:bg-indigo-500 transition-colors",
                                  activeFilter
                                    ? "text-yellow-300"
                                    : "text-indigo-300 hover:text-white",
                                )}
                              >
                                <Filter size={9} />
                              </button>
                            </PopoverTrigger>

                            <PopoverContent
                              className="p-2 z-50"
                              style={{ width: col.filterType === "status" || col.filterType === "person" ? 220 : 176 }}
                              align="start"
                              side="bottom"
                            >
                              {col.filterType === "yesno" ? (
                                /* Yes / No select */
                                <Select
                                  value={activeFilter || "all"}
                                  onValueChange={v => {
                                    setColFilter(col.id, v === "all" ? "" : v);
                                    setOpenFilterCol(null);
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all" className="text-xs">All</SelectItem>
                                    <SelectItem value="Yes"  className="text-xs">Yes</SelectItem>
                                    <SelectItem value="No"   className="text-xs">No</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : col.filterType === "status" ? (
                                // 2026-06-25 (V J Desai) — per-column status
                                // filter is now a multi-select with search
                                // and "Select All", matching the accountants
                                // reference. Selection stored as pipe-joined
                                // string in colFilters[col.id]; the filter
                                // pass splits on "|" for OR-match. Reused
                                // (2026-09-27) for the Remarks column too —
                                // same OR-match mechanism, different option list.
                                <StatusMultiFilter
                                  options={col.id === "remarks" ? REMARKS_OPTIONS : AUDIT_STATUS_OPTIONS}
                                  selection={
                                    activeFilter
                                      ? new Set(activeFilter.split("|").filter(Boolean))
                                      : new Set<string>()
                                  }
                                  onChange={(next) => {
                                    const arr = Array.from(next);
                                    setColFilter(col.id, arr.length === 0 ? "" : arr.join("|"));
                                  }}
                                />
                              ) : col.filterType === "person" ? (
                                // 2026-09-27 — Prepared By / Checked By: a name
                                // search plus a completion (Done/Not Done) state,
                                // encoded together as one JSON string.
                                <PersonFilterPanel
                                  value={activeFilter || ""}
                                  onChange={v => setColFilter(col.id, v)}
                                  doneLabel={col.id === "prepared_by" ? "Prepared" : "Checked"}
                                />
                              ) : (
                                /* Free-text input for text / date columns */
                                <div className="flex items-center gap-1">
                                  <Input
                                    autoFocus
                                    className="h-7 text-xs flex-1"
                                    placeholder="Filter…"
                                    value={activeFilter || ""}
                                    onChange={e => setColFilter(col.id, e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter" || e.key === "Escape")
                                        setOpenFilterCol(null);
                                    }}
                                    onClick={e => e.stopPropagation()}
                                  />
                                  {activeFilter && (
                                    <button
                                      onClick={() => {
                                        setColFilter(col.id, "");
                                        setOpenFilterCol(null);
                                      }}
                                      className="text-muted-foreground hover:text-foreground flex-shrink-0"
                                    >
                                      <X size={12} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={COLS.length} className="px-3 py-2 border border-border">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : safePageRows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="py-16 text-center text-muted-foreground">
                    {rows.length === 0
                      ? selectedFY
                        ? `No audit entries found for FY ${selectedFY}. Add planning entries or create engagements first.`
                        : "Select an Assessment Year above to see audit clients"
                      : "No rows match the current filters"}
                  </td>
                </tr>
              ) : (
                safePageRows.map((row, idx) => (
                  <AuditStatusRow
                    key={row.id}
                    row={row}
                    srNo={startIdx + idx}
                    clients={clients}
                    users={users}
                    auditFirms={auditFirms}
                    planEntries={planEntries}
                    onSave={updateRow}
                    onDelete={removeRow}
                    onHistory={id => setHistoryRowId(id)}
                    onSaveStateChange={handleRowSaveStateChange}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer: count + page-size + pagination ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[11px] text-muted-foreground">
            {filtered.length === 0
              ? "No rows"
              : `Showing ${startIdx}–${endIdx} of ${filtered.length} row${filtered.length !== 1 ? "s" : ""}` +
                (rows.length !== filtered.length ? ` (${rows.length} total)` : "")
            }
          </p>

          {/* 2026-06-25 (V J Desai) — page-size selector: 25 / 50 / 100. */}
          <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>Rows per page:</span>
            <div className="inline-flex rounded-md border border-border overflow-hidden h-6">
              {PAGE_SIZE_OPTIONS.map(sz => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setPageSize(sz)}
                  className={cn(
                    "px-2 text-[11px] font-medium transition-colors",
                    sz !== PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1] && "border-r border-border",
                    pageSize === sz
                      ? "bg-indigo-600 text-white"
                      : "bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="sm" variant="outline" className="h-7 w-7 p-0"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft size={13} />
            </Button>

            {/* Page numbers — show at most 5 */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | "…")[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`ellipsis-${i}`} className="text-xs px-1 text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={p}
                    size="sm"
                    variant={p === page ? "default" : "outline"}
                    className={cn("h-7 w-7 p-0 text-xs", p === page && "bg-indigo-600 hover:bg-indigo-700")}
                    onClick={() => setPage(p as number)}
                  >
                    {p}
                  </Button>
                )
              )}

            <Button
              size="sm" variant="outline" className="h-7 w-7 p-0"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight size={13} />
            </Button>
          </div>
        )}
      </div>

      {/* Change history modal */}
      <AuditChangeLogModal
        recordId={historyRowId}
        partyName={historyRow?.party_name ?? null}
        open={!!historyRowId}
        onClose={() => setHistoryRowId(null)}
      />
    </div>
  );
}

// ─── Per-column Audit Status multi-select filter ─────────────────────────────
// V J Desai request (2026-06-25) — replaces the single-select dropdown on
// the AUDIT STATUS column header with a search + Select All + checkbox list
// so the auditor can filter by two or more statuses at once
// (e.g. "REPORT PRINTED" + "REPORT SIGNED" for the closing sweep).
function StatusMultiFilter({
  options,
  selection,
  onChange,
}: {
  /** 2026-09-27 — generalized to take the option list explicitly (was
   *  hardcoded to AUDIT_STATUS_OPTIONS) so the Remarks column can reuse the
   *  exact same multi-select + OR-match mechanism with its own vocabulary. */
  options: string[];
  selection: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter(s => s.toLowerCase().includes(q))
    : options;

  const allVisibleChecked =
    visible.length > 0 && visible.every(s => selection.has(s));

  const toggle = (s: string) => {
    const next = new Set(selection);
    if (next.has(s)) next.delete(s); else next.add(s);
    onChange(next);
  };
  const toggleAll = () => {
    if (allVisibleChecked) {
      const next = new Set(selection);
      visible.forEach(s => next.delete(s));
      onChange(next);
    } else {
      const next = new Set(selection);
      visible.forEach(s => next.add(s));
      onChange(next);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
      <div className="relative">
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search…"
          className="h-7 text-xs pr-6"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={toggleAll}
        className="flex items-center gap-2 px-1.5 py-1 rounded text-[11px] font-medium hover:bg-muted"
      >
        <span
          className={cn(
            "inline-flex items-center justify-center h-3.5 w-3.5 rounded border",
            allVisibleChecked
              ? "bg-indigo-600 border-indigo-600 text-white"
              : "border-input",
          )}
        >
          {allVisibleChecked && <span className="text-[9px] leading-none">✓</span>}
        </span>
        Select All {q && `(${visible.length})`}
      </button>

      <div className="max-h-56 overflow-y-auto pr-0.5">
        {visible.map(s => {
          const checked = selection.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-[11px] hover:bg-muted text-left"
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
                  checked
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "border-input",
                )}
              >
                {checked && <span className="text-[9px] leading-none">✓</span>}
              </span>
              <span className="truncate">{s}</span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <div className="px-1.5 py-2 text-[11px] text-muted-foreground italic">
            No match for “{query}”.
          </div>
        )}
      </div>

      {selection.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border-t border-border pt-1.5 mt-0.5"
        >
          <X size={11} /> Clear ({selection.size})
        </button>
      )}
    </div>
  );
}

// ─── Prepared By / Checked By compound filter ─────────────────────────────────
// 2026-09-27 — name search PLUS a Done/Not-Done completion toggle, for the
// two 3CA/3CB+3CD columns. Both halves are stored together as one JSON
// string in colFilters[col.id] (`{"name":"...", "done":"yes"|"no"|""}`) so
// the existing "one string per column" filter store doesn't need reshaping;
// see the "person" branch in the filter-application useMemo above.
function PersonFilterPanel({
  value, onChange, doneLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  /** e.g. "Prepared" / "Checked" — used in the toggle's labels. */
  doneLabel: string;
}) {
  let parsed: { name?: string; done?: "yes" | "no" | "" } = {};
  try { parsed = value ? JSON.parse(value) : {}; } catch { parsed = {}; }
  const name = parsed.name || "";
  const done = parsed.done || "";

  function commit(next: { name?: string; done?: "yes" | "no" | "" }) {
    const merged = { name: next.name ?? name, done: next.done ?? done };
    onChange(!merged.name && !merged.done ? "" : JSON.stringify(merged));
  }

  return (
    <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
      <div className="relative">
        <Input
          autoFocus
          value={name}
          onChange={e => commit({ name: e.target.value })}
          placeholder="Filter by name…"
          className="h-7 text-xs pr-6"
        />
        {name && (
          <button
            type="button"
            onClick={() => commit({ name: "" })}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-1">{doneLabel}?</p>
        <div className="inline-flex rounded-md border border-border overflow-hidden h-6 w-full">
          {([
            { v: "" as const,    label: "All" },
            { v: "yes" as const, label: "Yes" },
            { v: "no" as const,  label: "No" },
          ]).map((opt, i) => (
            <button
              key={opt.v || "all"}
              type="button"
              onClick={() => commit({ done: opt.v })}
              className={cn(
                "flex-1 text-[11px] font-medium transition-colors",
                i > 0 && "border-l border-border",
                done === opt.v ? "bg-indigo-600 text-white" : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {(name || done) && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border-t border-border pt-1.5 mt-0.5"
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>
  );
}
