/**
 * QueryAnalyticsSidebar — Phase 3F
 *
 * Slide-over analytics panel for the Query Sheet.
 * Shows:
 *   • SVG progress ring — % resolved
 *   • Status distribution — horizontal bars per status, click to filter
 *   • Priority breakdown — H/M/L cards
 *   • Deadline summary — overdue / due-today / due-soon counts
 *   • Overdue query list — top 6 with days-overdue badges
 */
import { useMemo } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn }     from "@/lib/utils";
import { AlertTriangle, CheckCircle2, TrendingUp, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import type { QueryRow, QueryStatus }  from "./hooks/useQuerySheetStorage";
import { STATUS_META, PRIORITY_META }  from "./hooks/useQuerySheetStorage";
import { generateQueryProgressReport } from "./QueryProgressReport";
import type { AuditWorksheetData }     from "./hooks/useAuditWorksheetData";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(due: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d     = new Date(due); d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
}

// ─── SVG Progress Ring ───────────────────────────────────────────────────────

function ProgressRing({
  pct, label, sublabel,
}: {
  pct:      number;
  label:    string;
  sublabel: string;
}) {
  const R      = 38;
  const C      = 2 * Math.PI * R;           // ≈ 238.76
  const offset = C * (1 - Math.min(1, Math.max(0, pct)));
  const color  = pct >= 0.8 ? "#16a34a" : pct >= 0.5 ? "#d97706" : "#ef4444";

  return (
    <div className="relative flex flex-col items-center">
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        {/* Track */}
        <circle cx="48" cy="48" r={R} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        {/* Progress arc */}
        <circle
          cx="48" cy="48" r={R}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={C}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      {/* Center text overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xl font-bold leading-none">{label}</span>
        <span className="text-[10px] text-muted-foreground">{sublabel}</span>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open:         boolean;
  onClose:      () => void;
  queries:      QueryRow[];
  onJumpStatus: (s: QueryStatus | "all") => void;
  data?:        AuditWorksheetData;
}

// ─── Component ────────────────────────────────────────────────────────────────

const STATUS_ORDER: QueryStatus[] = [
  "draft", "raised", "dispatched", "response_received", "resolved", "escalated",
];

export function QueryAnalyticsSidebar({
  open, onClose, queries, onJumpStatus, data,
}: Props) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const total    = queries.length;
  const resolved = queries.filter(q => q.query_status === "resolved").length;
  const escalated = queries.filter(q => q.query_status === "escalated").length;
  const pct      = total ? resolved / total : 0;

  // Status counts
  const statusCounts = useMemo(() => {
    const c: Record<QueryStatus, number> = {
      draft: 0, raised: 0, dispatched: 0,
      response_received: 0, resolved: 0, escalated: 0,
    };
    for (const q of queries) c[q.query_status] = (c[q.query_status] ?? 0) + 1;
    return c;
  }, [queries]);

  // Priority counts
  const pCounts = useMemo(() => ({
    High:   queries.filter(q => q.priority === "High").length,
    Medium: queries.filter(q => q.priority === "Medium").length,
    Low:    queries.filter(q => q.priority === "Low").length,
  }), [queries]);

  // Deadline buckets (active queries only)
  const overdueRows = useMemo(
    () => queries
      .filter(q =>
        q.due_date &&
        !["resolved", "escalated"].includes(q.query_status) &&
        daysUntil(q.due_date) < 0,
      )
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [queries],
  );

  const dueTodayCount = useMemo(
    () => queries.filter(q =>
      q.due_date &&
      !["resolved", "escalated"].includes(q.query_status) &&
      daysUntil(q.due_date) === 0,
    ).length,
    [queries],
  );

  const dueSoonCount = useMemo(
    () => queries.filter(q => {
      if (!q.due_date || ["resolved", "escalated"].includes(q.query_status)) return false;
      const d = daysUntil(q.due_date);
      return d > 0 && d <= 3;
    }).length,
    [queries],
  );

  const hasDeadlineData = overdueRows.length > 0 || dueTodayCount > 0 || dueSoonCount > 0;
  const allDone = total > 0 && resolved === total && overdueRows.length === 0;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[340px] p-0 overflow-y-auto">

        <SheetHeader className="px-5 py-4 border-b sticky top-0 bg-background z-10">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <TrendingUp size={15} className="text-orange-600" />
            Query Analytics
          </SheetTitle>
        </SheetHeader>

        {total === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            No queries yet
          </div>
        ) : (
          <div className="p-5 space-y-6">

            {/* ── Progress ring ─────────────────────────────────── */}
            <div className="flex flex-col items-center gap-1.5">
              <ProgressRing
                pct={pct}
                label={`${Math.round(pct * 100)}%`}
                sublabel="resolved"
              />
              <p className="text-xs text-muted-foreground">
                {resolved} of {total} {total === 1 ? "query" : "queries"} resolved
              </p>
              {escalated > 0 && (
                <p className="text-[11px] text-red-600 flex items-center gap-1">
                  <AlertTriangle size={10} /> {escalated} escalated
                </p>
              )}
            </div>

            {/* ── Status distribution ───────────────────────────── */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Status Breakdown
              </p>
              <div className="space-y-1.5">
                {STATUS_ORDER.map(s => {
                  const cnt    = statusCounts[s];
                  const m      = STATUS_META[s];
                  const barPct = total ? (cnt / total) * 100 : 0;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { onJumpStatus(s); onClose(); }}
                      className="w-full flex items-center gap-2 text-left hover:bg-muted/40 rounded px-1 py-0.5 transition-colors group"
                    >
                      <span className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        m.bg, "border", m.border,
                      )} />
                      <span className="text-xs text-foreground w-[108px] flex-shrink-0 group-hover:text-primary transition-colors">
                        {m.label}
                      </span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", m.bg)}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-5 text-right flex-shrink-0">
                        {cnt}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Priority breakdown ────────────────────────────── */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Priority
              </p>
              <div className="flex gap-2">
                {(["High", "Medium", "Low"] as const).map(p => {
                  const m   = PRIORITY_META[p];
                  const cnt = pCounts[p];
                  return (
                    <div key={p}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2.5 text-center",
                        m.bg, "border-current/20",
                      )}>
                      <p className={cn("text-lg font-bold leading-none mb-0.5", m.color)}>{cnt}</p>
                      <p className={cn("text-[10px] font-medium", m.color)}>{p}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Deadline summary ──────────────────────────────── */}
            {hasDeadlineData && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Deadlines
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {/* Overdue */}
                  <div className={cn("rounded-lg border px-2 py-2.5 text-center",
                    overdueRows.length > 0 ? "bg-red-50 border-red-200" : "bg-muted/50 border-muted-foreground/10",
                  )}>
                    <p className={cn("text-lg font-bold leading-none mb-0.5",
                      overdueRows.length > 0 ? "text-red-600" : "text-muted-foreground",
                    )}>
                      {overdueRows.length}
                    </p>
                    <p className="text-[9px] text-muted-foreground">Overdue</p>
                  </div>

                  {/* Due today */}
                  <div className={cn("rounded-lg border px-2 py-2.5 text-center",
                    dueTodayCount > 0 ? "bg-orange-50 border-orange-200" : "bg-muted/50 border-muted-foreground/10",
                  )}>
                    <p className={cn("text-lg font-bold leading-none mb-0.5",
                      dueTodayCount > 0 ? "text-orange-600" : "text-muted-foreground",
                    )}>
                      {dueTodayCount}
                    </p>
                    <p className="text-[9px] text-muted-foreground">Due Today</p>
                  </div>

                  {/* Due soon */}
                  <div className={cn("rounded-lg border px-2 py-2.5 text-center",
                    dueSoonCount > 0 ? "bg-amber-50 border-amber-200" : "bg-muted/50 border-muted-foreground/10",
                  )}>
                    <p className={cn("text-lg font-bold leading-none mb-0.5",
                      dueSoonCount > 0 ? "text-amber-600" : "text-muted-foreground",
                    )}>
                      {dueSoonCount}
                    </p>
                    <p className="text-[9px] text-muted-foreground">Due Soon</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Overdue query list ────────────────────────────── */}
            {overdueRows.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertTriangle size={10} className="text-red-500" /> Overdue Queries
                </p>
                <div className="space-y-1.5">
                  {overdueRows.slice(0, 6).map(q => {
                    const days = Math.abs(daysUntil(q.due_date!));
                    return (
                      <div key={q.id}
                        className="flex items-start gap-2 rounded-md bg-red-50 border border-red-100 px-2.5 py-2">
                        <AlertTriangle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {q.head || q.particulars || "Untitled query"}
                          </p>
                          {q.head && q.particulars && (
                            <p className="text-[10px] text-muted-foreground truncate">{q.particulars}</p>
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-red-600 flex-shrink-0 whitespace-nowrap">
                          {days}d ago
                        </span>
                      </div>
                    );
                  })}
                  {overdueRows.length > 6 && (
                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                      +{overdueRows.length - 6} more overdue
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── All-clear state ───────────────────────────────── */}
            {allDone && (
              <div className="flex flex-col items-center gap-2 py-4 text-green-700">
                <CheckCircle2 size={28} />
                <p className="text-sm font-medium">All queries resolved!</p>
                <p className="text-xs text-muted-foreground">No overdue or pending items.</p>
              </div>
            )}

            {/* ── Phase 4E: Export PDF Report ────────────────────── */}
            <div className="pt-2 border-t">
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 text-xs border-purple-400 text-purple-700 hover:bg-purple-50"
                disabled={exportingPdf || queries.length === 0}
                onClick={async () => {
                  setExportingPdf(true);
                  try {
                    await generateQueryProgressReport(queries, data ?? {} as AuditWorksheetData);
                  } finally {
                    setExportingPdf(false);
                  }
                }}
              >
                {exportingPdf
                  ? <Loader2 size={12} className="animate-spin" />
                  : <FileText size={12} />}
                Export PDF Report
              </Button>
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
