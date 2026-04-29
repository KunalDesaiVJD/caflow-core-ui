/**
 * LedgerExplorerTab  (Phase 2B)
 *
 * Two view modes toggled from the toolbar:
 *   [BS / P&L]   — FS-mapped financial statement with CY | PY | Variance
 *   [Anomalies]  — anomaly feed
 *
 * Phase 2B changes:
 *   • "Group Tree" view removed (per user request — redundant with BS/PL).
 *   • All Tally-sourced group / ledger names sanitised through
 *     cleanTallyName() so the bogus "&#4; Primary" label never reaches
 *     the screen.
 */
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, DatabaseZap, BarChart3, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTallyEngagementId } from "./hooks/useTallyEngagementId";
import { BsPlView } from "./BsPlView";
import { AnomalyFeedView } from "./AnomalyFeedView";

type ViewMode = "bspl" | "anomaly";

interface Props {
  engagementId:    string;
  clientId:        string | null | undefined;
  financialYear:   string | null | undefined;
  /** Called when user clicks "Raise Query" for a ledger / voucher entry */
  onRaiseQuery:    (group: string, ledger: string, entryNote?: string) => void;
  /** Phase 5: Called when user clicks "Raise Finding" from the anomaly feed */
  onRaiseFinding?: (group: string, ledger: string, note?: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LedgerExplorerTab({ engagementId, clientId, financialYear, onRaiseQuery, onRaiseFinding }: Props) {
  const { tallyEngId, loading: resolving } = useTallyEngagementId(clientId, financialYear);

  const [viewMode, setViewMode] = useState<ViewMode>("bspl");
  const [hasRows,  setHasRows]  = useState<boolean>(true);
  const [loading,  setLoading]  = useState(false);

  // Cheap probe to know whether any TB rows exist for this engagement.
  // (Group Tree view is gone, so we no longer need the full ledger array
  // here — child views fetch their own data.)
  useEffect(() => {
    if (!tallyEngId) return;
    setLoading(true);
    (supabase as any)
      .from("tally_trial_balance")
      .select("ledger_name")
      .eq("engagement_id", tallyEngId)
      .limit(1)
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        if (!error) setHasRows(!!data && data.length > 0);
        setLoading(false);
      });
  }, [tallyEngId]);

  const isLoading = resolving || loading;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading Tally data…
      </div>
    );
  }

  if (!tallyEngId) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-3 text-center text-muted-foreground">
        <DatabaseZap size={36} className="text-muted-foreground/30" />
        <div>
          <p className="font-medium text-sm text-foreground">No Tally data synced yet</p>
          <p className="text-xs mt-1">Run a Tally sync for this engagement to see ledgers here.</p>
        </div>
      </div>
    );
  }

  if (!hasRows) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-3 text-center text-muted-foreground">
        <DatabaseZap size={36} className="text-muted-foreground/30" />
        <p className="text-sm">No ledgers found in Tally data for this engagement.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="inline-flex rounded-md border overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("bspl")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors border-r",
              viewMode === "bspl"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            <BarChart3 size={11} /> BS / P&amp;L
          </button>
          <button
            type="button"
            onClick={() => setViewMode("anomaly")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors",
              viewMode === "anomaly"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            <Zap size={11} /> Anomalies
          </button>
        </div>
      </div>

      {/* ── BS / P&L view ── */}
      {viewMode === "bspl" && (
        <BsPlView
          engagementId={engagementId}
          clientId={clientId}
          financialYear={financialYear}
          onRaiseQuery={onRaiseQuery}
        />
      )}

      {/* ── Anomaly Feed view ── */}
      {viewMode === "anomaly" && (
        <AnomalyFeedView
          tallyEngId={tallyEngId}
          financialYear={financialYear}
          clientId={clientId}
          onRaiseQuery={onRaiseQuery}
          onRaiseFinding={onRaiseFinding}
        />
      )}
    </div>
  );
}
