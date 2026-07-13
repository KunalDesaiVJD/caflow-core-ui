/**
 * AuditStatusFilters
 * Toolbar: global search + quick-filter dropdowns + refresh + add-row.
 * The parent AuditStatusGrid owns all state; this component is pure-presentational.
 */
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RefreshCw, X, CheckCircle2, Clock, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Exported constant ────────────────────────────────────────────────────────

export const AUDIT_STATUS_OPTIONS = [
  "DATA PENDING",
  "QUERIES GIVEN TO CLIENT",
  "PREPARE PENDING",
  "VERIFICATION PENDING",
  "REPORT WITH VJD",
  "REPORT WITH KVD",
  "REPORT SENT TO CLIENT",
  "REPORT SIGNED",
  "OTHERS (SPECIFY)",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  search:         string;
  onSearch:       (v: string) => void;
  statusFilter:   string;
  onStatus:       (v: string) => void;
  /** All | Completed (scanned=Yes) | Pending (scanned=No/blank) */
  scanFilter?:    "all" | "completed" | "pending";
  onScanFilter?:  (v: "all" | "completed" | "pending") => void;
  completedCount?: number;
  pendingCount?:   number;
  onRefresh:      () => void;
  /** 2026-06-25 (V J Desai) — autosave status pill replaces the "Save All
   *  Changes" button. Grid aggregates row-level save states and passes
   *  the totals here so the auditor sees a single, live indicator. */
  savingCount?:   number;
  errorCount?:    number;
  savedRecently?: boolean;
  /** When true, shows 'Clear Column Filters' button */
  hasColFilters?: boolean;
  onClearFilters?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditStatusFilters({
  search, onSearch,
  statusFilter, onStatus,
  scanFilter = "all", onScanFilter,
  completedCount = 0, pendingCount = 0,
  onRefresh,
  savingCount = 0, errorCount = 0, savedRecently = false,
  hasColFilters, onClearFilters,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">

      {/* Global search */}
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-7 h-8 text-xs"
          placeholder="Search all columns…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>

      {/* Audit Status quick-filter */}
      <Select value={statusFilter} onValueChange={onStatus}>
        <SelectTrigger className="h-8 text-xs w-40">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
          {AUDIT_STATUS_OPTIONS.map(s => (
            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 2026-06-25 (V J Desai request): Completed / Pending scan chips.
          Completed = SCANNED "Yes" (audit fully closed). Pending = "No"
          or blank (still open). Segmented control keeps All visible so
          the auditor can flip back to the full grid in one click. */}
      {onScanFilter && (
        <div className="inline-flex rounded-md border border-border overflow-hidden h-8">
          <button
            type="button"
            className={cn(
              "px-2.5 text-xs font-medium transition-colors border-r border-border",
              scanFilter === "all" ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted",
            )}
            onClick={() => onScanFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={cn(
              "px-2.5 text-xs font-medium gap-1 inline-flex items-center transition-colors border-r border-border",
              scanFilter === "completed"
                ? "bg-green-500 text-white"
                : "bg-background text-green-700 hover:bg-green-50",
            )}
            onClick={() => onScanFilter("completed")}
            title="Rows where SCANNED is Yes"
          >
            <CheckCircle2 size={12} /> Completed
            <span className={cn(
              "ml-1 px-1 rounded text-[10px]",
              scanFilter === "completed" ? "bg-white/25" : "bg-green-100 text-green-800",
            )}>{completedCount}</span>
          </button>
          <button
            type="button"
            className={cn(
              "px-2.5 text-xs font-medium gap-1 inline-flex items-center transition-colors",
              scanFilter === "pending"
                ? "bg-amber-500 text-white"
                : "bg-background text-amber-700 hover:bg-amber-50",
            )}
            onClick={() => onScanFilter("pending")}
            title="Rows where SCANNED is No or blank"
          >
            <Clock size={12} /> Pending
            <span className={cn(
              "ml-1 px-1 rounded text-[10px]",
              scanFilter === "pending" ? "bg-white/25" : "bg-amber-100 text-amber-800",
            )}>{pendingCount}</span>
          </button>
        </div>
      )}

      {/* Refresh */}
      <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={onRefresh} title="Refresh">
        <RefreshCw size={13} />
      </Button>

      {/* Clear column filters — only when active */}
      {hasColFilters && (
        <Button
          size="sm" variant="outline"
          className="h-8 text-xs gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
          onClick={onClearFilters}
        >
          <X size={12} /> Clear Filters
        </Button>
      )}

      {/* Autosave status pill — replaces the old Save All button. Three
          steady states + a rolling "All saved" chip:
            • saving ≥ 1 → blue spinner + "Saving N change(s)…"
            • error ≥ 1  → red icon + "N failed" (click to retry via row)
            • savedRecently → green tick + "All changes saved"
            • otherwise → nothing (quiet gutter)
          Nothing to click — retries happen per-row via the red icon in the
          Actions column, so the pill is purely informational.
      */}
      <div className="ml-auto flex items-center h-8">
        {savingCount > 0 && (
          <span
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200"
            title="Autosave in flight"
          >
            <Loader2 size={13} className="animate-spin" />
            Saving {savingCount} change{savingCount === 1 ? "" : "s"}…
          </span>
        )}
        {savingCount === 0 && errorCount > 0 && (
          <span
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-full bg-red-50 text-red-700 border border-red-200"
            title="Click the red icon on the affected row to retry"
          >
            <AlertCircle size={13} />
            {errorCount} save{errorCount === 1 ? "" : "s"} failed
          </span>
        )}
        {savingCount === 0 && errorCount === 0 && savedRecently && (
          <span
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
            title="Every edit has been persisted"
          >
            <CheckCircle2 size={13} />
            All changes saved
          </span>
        )}
      </div>
    </div>
  );
}
