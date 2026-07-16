/**
 * AuditStatusFilters
 * Toolbar: global search + quick-filter dropdowns + refresh + add-row.
 * The parent AuditStatusGrid owns all state; this component is pure-presentational.
 */
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, RefreshCw, X, CheckCircle2, Clock, Loader2, AlertCircle, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Exported constant ────────────────────────────────────────────────────────

// 2026-06-25 (V J Desai) — workflow order: Report Printed → Report Sent
// to Client → Report Signed (final stage). Correcting the option order
// so the dropdown reads top-to-bottom in the actual sequence auditors
// walk the file through.
export const AUDIT_STATUS_OPTIONS = [
  "DATA PENDING",
  "QUERIES GIVEN TO CLIENT",
  "PREPARE PENDING",
  "VERIFICATION PENDING",
  "REPORT WITH VJD",
  "REPORT WITH KVD",
  "REPORT PRINTED",
  "REPORT SENT TO CLIENT",
  "REPORT SIGNED",
  "OTHERS (SPECIFY)",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  search:         string;
  onSearch:       (v: string) => void;
  /** 2026-06-25 (V J Desai) — the Audit Status quick-filter is now a
   *  multi-select. An empty array means "All Statuses" (no filter applied);
   *  a non-empty array is the OR-list of statuses to keep. Grid's filter
   *  pass matches when the row's audit_status is in this set. */
  statusFilter:   string[];
  onStatus:       (v: string[]) => void;
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

      {/* 2026-06-25 (V J Desai) — Audit Status multi-select. Popover with
          checkboxes so the auditor can pick two or more statuses at once
          (e.g. "REPORT SIGNED" + "REPORT PRINTED" for the closing sweep).
          Trigger label reflects the selection count. */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-8 text-xs w-48 justify-between font-normal"
          >
            <span className="truncate">
              {statusFilter.length === 0
                ? "All Statuses"
                : statusFilter.length === 1
                  ? statusFilter[0]
                  : `${statusFilter.length} statuses`}
            </span>
            <ChevronDown size={13} className="ml-2 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <button
            type="button"
            onClick={() => onStatus([])}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
          >
            <Check
              size={12}
              className={cn(
                "shrink-0",
                statusFilter.length === 0 ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="font-medium">All Statuses</span>
          </button>
          <div className="my-1 h-px bg-border" />
          {AUDIT_STATUS_OPTIONS.map(s => {
            const checked = statusFilter.includes(s);
            const toggle = () => {
              onStatus(checked ? statusFilter.filter(x => x !== s) : [...statusFilter, s]);
            };
            return (
              <button
                key={s}
                type="button"
                onClick={toggle}
                className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left"
              >
                <Check
                  size={12}
                  className={cn("shrink-0", checked ? "opacity-100 text-primary" : "opacity-0")}
                />
                <span className="truncate">{s}</span>
              </button>
            );
          })}
          {statusFilter.length > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => onStatus([])}
                className="w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={12} />
                Clear ({statusFilter.length})
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

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
