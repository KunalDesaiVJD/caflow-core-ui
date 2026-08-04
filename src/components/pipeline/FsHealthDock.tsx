/**
 * FsHealthDock — a single collapsible "FS Health" region that consolidates
 * every diagnostic / error surface on the Stage 7 Financial Statements page
 * (opening-balance mismatch, notes staleness, per-note reconciliation drift,
 * Balance-Sheet imbalance, and notes-vs-face mismatch) into one dock.
 *
 * Why: previously each surface rendered as its own inline banner stacked above
 * the statements, pushing the actual BS / P&L / Notes down and competing for
 * vertical space in the working area. This dock shows a one-line, colour-coded
 * summary header (green / amber / red) and, collapsed by default, hands the
 * full viewport back to the statements. Expanding reveals the detailed panels
 * unchanged.
 *
 * The details container is kept MOUNTED (hidden via CSS) rather than unmounted,
 * so children with side effects — notably NotesMismatchPanel, which reports its
 * count upward — keep working while collapsed.
 */
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type FsHealthSeverity = "ok" | "warn" | "error";

interface Props {
  severity: FsHealthSeverity;
  /** One-line summary of the outstanding issues (e.g. "BS out by ₹37,200 · 19 notes drift"). */
  summary: ReactNode;
  /** Number of issues; when 0 the dock shows the all-clear header and no toggle. */
  issueCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export default function FsHealthDock({ severity, summary, issueCount, open, onOpenChange, children }: Props) {
  const tone = {
    ok:    { cls: "border-emerald-300 bg-emerald-50/60 text-emerald-900", Icon: CheckCircle2 },
    warn:  { cls: "border-amber-300 bg-amber-50/60 text-amber-900",       Icon: AlertTriangle },
    error: { cls: "border-red-300 bg-red-50/60 text-red-900",             Icon: AlertCircle },
  }[severity];
  const Icon = tone.Icon;
  const hasDetails = issueCount > 0;

  return (
    <div className={cn("rounded-md border", tone.cls)}>
      {/* Summary header — always a single line */}
      <button
        type="button"
        onClick={() => hasDetails && onOpenChange(!open)}
        aria-expanded={hasDetails ? open : undefined}
        className={cn(
          "w-full flex items-center gap-2 px-3.5 py-2.5 text-left",
          hasDetails ? "cursor-pointer" : "cursor-default",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0 text-sm font-semibold flex items-baseline gap-2 flex-wrap">
          {severity === "ok" ? (
            <span>FS Health — all checks pass</span>
          ) : (
            <>
              <span className="shrink-0">
                FS Health — {issueCount} issue{issueCount === 1 ? "" : "s"}
              </span>
              {summary && (
                <span className="font-normal opacity-80 text-xs">{summary}</span>
              )}
            </>
          )}
        </div>
        {hasDetails && (
          <span className="text-xs underline-offset-2 hover:underline flex items-center gap-1 shrink-0">
            {open ? "Hide" : "Show"} details
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </button>

      {/* Details — kept mounted (hidden) so count-reporting children keep working */}
      <div
        className={cn(
          "px-3 pb-3 pt-3 space-y-3 border-t border-current/15",
          (!open || !hasDetails) && "hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
