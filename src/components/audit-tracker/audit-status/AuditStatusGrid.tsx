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
import { useState, useMemo, useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import AuditStatusFilters from "./AuditStatusFilters";
import AuditStatusRow     from "./AuditStatusRow";
import { useAuditStatus } from "../hooks/useAuditStatus";
import type { StatusEntry, StatusPatch } from "../hooks/useAuditStatus";
import type { ClientOption }             from "../hooks/useClients";
import type { UserOption }               from "../hooks/useUsers";
import type { AuditFirmOption }          from "../hooks/useFirms";
import type { PlanEntry }                from "../hooks/useAuditPlanning";
import { AUDIT_STATUS_OPTIONS }          from "./AuditStatusFilters";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const YES_NO_OPTIONS = ["Yes", "No"];

// Column definitions — id maps to StatusEntry field (or "" for computed)
const COLS: { label: string; id: string; sortable?: boolean; filterType?: "text"|"select"|"date"|"yesno"|"status"|"none" }[] = [
  { label: "Sr No",             id: "_srno",                      filterType: "none"   },
  { label: "Party Name",        id: "party_name",     sortable: true, filterType: "text"   },
  { label: "Physical Audit",    id: "physical_audit_conducted",   filterType: "yesno"  },
  { label: "Accounting Data",   id: "accounting_data",            filterType: "yesno"  },
  { label: "Audit Employees",   id: "audit_employees",            filterType: "text"   },
  { label: "Report Prep. By",   id: "audit_report_prepared_by",   filterType: "text"   },
  { label: "Audit Status",      id: "audit_status",   sortable: true, filterType: "status" },
  { label: "Report Print Date", id: "report_print_date", sortable: true, filterType: "date" },
  { label: "Firm",              id: "firm",                       filterType: "text"   },
  { label: "Partner",           id: "partner",                    filterType: "text"   },
  { label: "UDIN (Tax)",        id: "udin_tax_audit",             filterType: "text"   },
  { label: "UDIN (Statutory)",  id: "udin_statutory_audit",       filterType: "text"   },
  { label: "UDIN Date",         id: "udin_date",      sortable: true, filterType: "date" },
  { label: "Phys. Report Recd", id: "physical_report_received_date", sortable: true, filterType: "date" },
  { label: "Scanned",           id: "scanned",                    filterType: "yesno"  },
  { label: "3CA Prepared By",   id: "prepared_by",                filterType: "text"   },
  { label: "3CA Checked By",    id: "checked_by",                 filterType: "text"   },
  { label: "3CA Uploaded By",   id: "uploaded_by",                filterType: "text"   },
  { label: "Remarks",           id: "remarks",                    filterType: "text"   },
  { label: "Actions",           id: "_actions",                   filterType: "none"   },
];

// ─── Blank template for a new row ─────────────────────────────────────────────

const BLANK_ROW: StatusEntry = {
  id: "__new__", firm_id: "", client_id: null, party_name: null,
  physical_audit_conducted: "No", accounting_data: "No",
  audit_employees: null, audit_report_prepared_by: null,
  audit_status: null, audit_status_other: null,
  report_print_date: null, firm: null, partner: null,
  udin_tax_audit: null, udin_statutory_audit: null, udin_date: null,
  physical_report_received_date: null, scanned: "No",
  prepared_by: null, checked_by: null, uploaded_by: null,
  remarks: null, engagement_id: null, created_at: "",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  firmId:      string;
  clients:     ClientOption[];
  users:       UserOption[];
  auditFirms:  AuditFirmOption[];
  planEntries: PlanEntry[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusGrid({ firmId, clients, users, auditFirms, planEntries }: Props) {
  const { rows, loading, useLs, reload, addRow, updateRow, removeRow } = useAuditStatus(firmId);

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
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [physFilter,    setPhysFilter]    = useState("all");
  const [scannedFilter, setScannedFilter] = useState("all");

  // ── Per-column filter row ──────────────────────────────────────────────────
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  function setColFilter(id: string, val: string) {
    setColFilters(p => ({ ...p, [id]: val }));
    setPage(1);
  }

  // ── Sorting ───────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("asc");
  function toggleSort(field: string) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);

  // ── New row ───────────────────────────────────────────────────────────────
  const [addingNew, setAddingNew] = useState(false);

  // Reset page when filters change
  useEffect(() => setPage(1), [search, statusFilter, physFilter, scannedFilter, colFilters]);

  // ── Filtering + sorting ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = rows;

    // Global text search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        Object.values(r).some(v => v && typeof v === "string" && v.toLowerCase().includes(q))
      );
    }

    // Quick-filter bar
    if (statusFilter !== "all")  result = result.filter(r => r.audit_status === statusFilter);
    if (physFilter   !== "all")  result = result.filter(r => r.physical_audit_conducted === physFilter);
    if (scannedFilter !== "all") result = result.filter(r => r.scanned === scannedFilter);

    // Per-column filters
    Object.entries(colFilters).forEach(([id, val]) => {
      if (!val || val === "all") return;
      result = result.filter(r => {
        const rv = (r as any)[id];
        return rv && typeof rv === "string" && rv.toLowerCase().includes(val.toLowerCase());
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
  }, [rows, search, statusFilter, physFilter, scannedFilter, colFilters, sortField, sortDir]);

  // ── Pagination slice ──────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const startIdx = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx   = Math.min(page * PAGE_SIZE, filtered.length);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleAddNew(patch: StatusPatch) {
    await addRow({
      client_id:                     patch.client_id                     ?? null,
      party_name:                    patch.party_name                    ?? null,
      physical_audit_conducted:      patch.physical_audit_conducted      ?? "No",
      accounting_data:               patch.accounting_data               ?? "No",
      audit_employees:               patch.audit_employees               ?? null,
      audit_report_prepared_by:      patch.audit_report_prepared_by      ?? null,
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
      remarks:                       patch.remarks                       ?? null,
      engagement_id:                 null,
    });
    setAddingNew(false);
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
    <div className="space-y-3">

      {/* Offline badge */}
      {useLs && (
        <Badge className="bg-amber-100 text-amber-700 text-xs gap-1">
          Offline mode — data stored locally. Apply Supabase migration to persist to cloud.
        </Badge>
      )}

      {/* Filter toolbar */}
      <AuditStatusFilters
        search={searchRaw}          onSearch={v => { setSearchRaw(v); setPage(1); }}
        statusFilter={statusFilter}  onStatus={v => { setStatusFilter(v); setPage(1); }}
        physFilter={physFilter}      onPhys={v => { setPhysFilter(v); setPage(1); }}
        scannedFilter={scannedFilter} onScanned={v => { setScannedFilter(v); setPage(1); }}
        onRefresh={reload}
        onAddRow={() => { setAddingNew(true); setPage(1); }}
      />

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
          <table className="border-collapse text-xs" style={{ minWidth: 2200, tableLayout: "fixed" }}>

            {/* ── Sticky header row ── */}
            <thead className="sticky top-0 z-30">
              <tr className="bg-indigo-700 text-white text-[10px] uppercase tracking-wide">
                {COLS.map(col => (
                  <th
                    key={col.id}
                    title={col.label}
                    onClick={col.sortable ? () => toggleSort(col.id) : undefined}
                    className={cn(
                      "border border-indigo-600 px-2 py-2.5 text-left whitespace-nowrap select-none",
                      col.id === "_srno"    && "sticky left-0 z-40 bg-indigo-700 w-10",
                      col.id === "party_name" && "sticky left-10 z-40 bg-indigo-700 min-w-[140px]",
                      col.id === "_actions"  && "w-20 text-center",
                      col.sortable && "cursor-pointer hover:bg-indigo-600",
                    )}
                  >
                    <span className="flex items-center">
                      {col.label}
                      {col.sortable && <SortIcon field={col.id} />}
                    </span>
                  </th>
                ))}
              </tr>

              {/* ── Per-column filter row ── */}
              <tr className="bg-muted/40 border-b border-border">
                {COLS.map(col => (
                  <th
                    key={col.id}
                    className={cn(
                      "border border-border/50 px-1 py-1",
                      col.id === "_srno"     && "sticky left-0 z-40 bg-muted/40 w-10",
                      col.id === "party_name"  && "sticky left-10 z-40 bg-muted/40",
                      col.id === "_actions"   && "w-20",
                    )}
                  >
                    {col.filterType === "text" && (
                      <Input
                        value={colFilters[col.id] || ""}
                        onChange={e => setColFilter(col.id, e.target.value)}
                        placeholder="Filter…"
                        className="h-5 text-[10px] px-1.5 border-border/70"
                      />
                    )}
                    {col.filterType === "yesno" && (
                      <Select value={colFilters[col.id] || "all"} onValueChange={v => setColFilter(col.id, v === "all" ? "" : v)}>
                        <SelectTrigger className="h-5 text-[10px] px-1"><SelectValue placeholder="All" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-[10px]">All</SelectItem>
                          {YES_NO_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-[10px]">{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {col.filterType === "status" && (
                      <Select value={colFilters[col.id] || "all"} onValueChange={v => setColFilter(col.id, v === "all" ? "" : v)}>
                        <SelectTrigger className="h-5 text-[10px] px-1"><SelectValue placeholder="All" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-[10px]">All</SelectItem>
                          {AUDIT_STATUS_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-[10px]">{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {col.filterType === "date" && (
                      <Input
                        type="date"
                        value={colFilters[col.id] || ""}
                        onChange={e => setColFilter(col.id, e.target.value)}
                        className="h-5 text-[10px] px-1 border-border/70"
                      />
                    )}
                    {/* none → empty cell */}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* New row (always at top when addingNew) */}
              {addingNew && (
                <AuditStatusRow
                  key="__new__"
                  row={BLANK_ROW}
                  srNo={0}
                  clients={clients}
                  users={users}
                  auditFirms={auditFirms}
                  planEntries={planEntries}
                  onSave={async () => {}}
                  onDelete={async () => {}}
                  isNew
                  onAdd={handleAddNew}
                  onCancelNew={() => setAddingNew(false)}
                />
              )}

              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={COLS.length} className="px-3 py-2 border border-border">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : safePageRows.length === 0 && !addingNew ? (
                <tr>
                  <td colSpan={COLS.length} className="py-16 text-center text-muted-foreground">
                    {rows.length === 0
                      ? "No rows yet — click Add New Audit to begin"
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
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer: count + pagination ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] text-muted-foreground">
          {filtered.length === 0
            ? "No rows"
            : `Showing ${startIdx}–${endIdx} of ${filtered.length} row${filtered.length !== 1 ? "s" : ""}` +
              (rows.length !== filtered.length ? ` (${rows.length} total)` : "")
          }
        </p>

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
    </div>
  );
}
