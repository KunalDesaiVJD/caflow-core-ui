/**
 * AuditStatusFilters
 * Toolbar: global search + quick-filter dropdowns + refresh + add-row.
 * The parent AuditStatusGrid owns all state; this component is pure-presentational.
 */
import { useState } from "react";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, RefreshCw, X, CheckCircle2, Clock, Loader2, AlertCircle, ChevronDown } from "lucide-react";
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
  // 2026-07-24 — new interim stage between internal verification and
  // partner review: the draft has been shared with the client for their
  // own verification round before it goes up to VJD / KVD for sign-off.
  "REPORT SENT TO CLIENT FOR VERIFICATION",
  "REPORT WITH VJD",
  "REPORT WITH KVD",
  "REPORT PRINTED",
  "REPORT SENT TO CLIENT",
  "REPORT SIGNED",
  "OTHERS (SPECIFY)",
];

// Remarks column — fixed vocabulary + free-text "Others" (see
// audit_status.remarks_other). Shared between the Remarks cell editor
// (AuditStatusRow) and its column filter (AuditStatusGrid).
export const REMARKS_OPTIONS = ["Prepared", "Checked", "Uploaded", "Upload but Pending for approval", "Not Applicable", "Others"];

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

      {/* 2026-06-25 (V J Desai) — Audit Status multi-select filter.
          Same UI as the per-column header filter: search box, Select All
          (toggles the visible subset), individual checkbox per status,
          Clear (N) footer. Trigger label reflects selection count. */}
      <StatusMultiSelectFilter
        selection={statusFilter}
        onChange={onStatus}
      />

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

// ─── Top-bar Audit Status multi-select filter ────────────────────────────────
// V J Desai (2026-06-25) — mirrors the per-column StatusMultiFilter in
// AuditStatusGrid.tsx so the two entry points share the exact same UX:
// search box → Select All → checkboxes → Clear (N). Kept as a distinct
// component (not shared) because the top-bar wraps the list in its own
// trigger button and hosts a wider popover; the per-column filter is
// rendered inside a smaller header popover with different chrome.
function StatusMultiSelectFilter({
  selection,
  onChange,
}: {
  selection: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q
    ? AUDIT_STATUS_OPTIONS.filter(s => s.toLowerCase().includes(q))
    : AUDIT_STATUS_OPTIONS;

  const set = new Set(selection);
  const allVisibleChecked = visible.length > 0 && visible.every(s => set.has(s));

  const toggle = (s: string) => {
    const next = new Set(set);
    if (next.has(s)) next.delete(s); else next.add(s);
    onChange([...next]);
  };
  const toggleAll = () => {
    const next = new Set(set);
    if (allVisibleChecked) visible.forEach(s => next.delete(s));
    else                   visible.forEach(s => next.add(s));
    onChange([...next]);
  };

  const label =
    selection.length === 0 ? "All Statuses"
    : selection.length === 1 ? selection[0]
    : `${selection.length} statuses`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-8 text-xs w-48 justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={13} className="ml-2 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="relative">
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search status…"
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
          className="mt-2 flex items-center gap-2 px-1.5 py-1 rounded text-[11px] font-medium hover:bg-muted w-full text-left"
        >
          <span
            className={cn(
              "inline-flex items-center justify-center h-3.5 w-3.5 rounded border shrink-0",
              allVisibleChecked
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "border-input",
            )}
          >
            {allVisibleChecked && <span className="text-[9px] leading-none">✓</span>}
          </span>
          Select All {q && `(${visible.length})`}
        </button>

        <div className="max-h-56 overflow-y-auto pr-0.5 mt-1">
          {visible.map(s => {
            const checked = set.has(s);
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
              No status matches “{query}”.
            </div>
          )}
        </div>

        {selection.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1.5 pt-1.5 flex items-center justify-center gap-1 w-full px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border-t border-border"
          >
            <X size={11} /> Clear ({selection.length})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
