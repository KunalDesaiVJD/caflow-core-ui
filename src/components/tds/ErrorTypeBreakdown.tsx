import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface ErrorTypeBreakdownProps<T> {
  /** The issue rows currently being shown (already scoped to "this is the issue
   *  list", e.g. unresolved exceptions) — NOT the whole dataset. This component
   *  has no notion of "matched"/"verified"/"overridden"; the caller decides what
   *  counts as an issue for its own stage. */
  rows: T[];
  /** The row's error-type label, e.g. `(r) => r.result` or `(r) => r.validation_result`.
   *  Whatever distinct strings this returns become the chips — a new value the
   *  underlying engine starts emitting shows up here automatically, no UI change. */
  getType: (row: T) => string;
  activeType: string | null;
  onSelectType: (type: string | null) => void;
}

/**
 * Generic "which SPECIFIC error is this?" breakdown, shared by every TDS stage so
 * the summary+filter mechanism exists ONCE rather than being hand-copied per stage
 * (each stage previously reinvented its own fixed Total/Matched/Issues/Overridden
 * cards, which can only ever report "N issues" as one undifferentiated bucket —
 * exactly the complaint this component answers: a Stage-3 screen with 5 "Date
 * Mismatch" + 3 "Ledger Entry Not Found" + 2 "Credit Amount Mismatch" records only
 * ever showed "10 Mismatched").
 *
 * Auto-discovers types by grouping `rows` on `getType` — no per-stage type list to
 * maintain, and no code change needed when a stage's underlying engine starts
 * returning a result/status value nobody had seen before.
 *
 * Renders nothing when fewer than 2 distinct types are present: a single-type (or
 * empty) list is already fully described by the summary card above it, and a
 * one-chip "breakdown" would just be noise.
 */
export function ErrorTypeBreakdown<T>({ rows, getType, activeType, onSelectType }: ErrorTypeBreakdownProps<T>) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = getType(r); m.set(k, (m.get(k) ?? 0) + 1); }
    // Most frequent first (the types most worth a CA's attention float to the top),
    // alphabetical tie-break so the chip order is stable across re-renders.
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows, getType]);

  if (counts.length < 2) return null;

  const chipCls = (active: boolean) => cn(
    "rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/50",
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
      <span className="text-[11px] text-muted-foreground mr-0.5 shrink-0">Error type:</span>
      <button type="button" className={chipCls(activeType === null)} aria-pressed={activeType === null} onClick={() => onSelectType(null)}>
        All Records ({rows.length})
      </button>
      {counts.map(([type, n]) => (
        <button key={type} type="button" className={chipCls(activeType === type)} aria-pressed={activeType === type}
          onClick={() => onSelectType(activeType === type ? null : type)}>
          {type} ({n})
        </button>
      ))}
    </div>
  );
}

/** Filters `rows` to `activeType` via `getType`, or returns `rows` unchanged when
 *  `activeType` is null ("All Records"). The one piece of filtering LOGIC every
 *  caller needs alongside the chip bar — kept here so the two can never drift. */
export function filterByErrorType<T>(rows: T[], getType: (row: T) => string, activeType: string | null): T[] {
  return activeType === null ? rows : rows.filter((r) => getType(r) === activeType);
}
