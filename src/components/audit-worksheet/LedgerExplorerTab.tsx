/**
 * LedgerExplorerTab  (Phase 2A update)
 *
 * Two view modes toggled from the toolbar:
 *   [Group Tree]  — original Tally group → ledger accordion
 *   [BS / P&L]   — FS-mapped financial statement with CY | PY | Variance
 *
 * Phase 2A additions:
 *   • View toggle (Group Tree / BS P&L)
 *   • engagementId prop (required for COA mapping + PY lookup in BS/PL view)
 */
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import {
  ChevronRight, ChevronDown, BookOpen, MessageSquareWarning,
  Search, X, Loader2, DatabaseZap, List, BarChart3, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTallyEngagementId } from "./hooks/useTallyEngagementId";
import { LedgerSidePanel } from "./LedgerSidePanel";
import { BsPlView } from "./BsPlView";
import { AnomalyFeedView } from "./AnomalyFeedView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TBLedger {
  ledger_name:      string;
  parent_group:     string;
  opening_balance:  number;
  opening_type:     string;
  closing_balance:  number;
  balance_type:     string;
}

interface GroupData {
  groupName:  string;
  ledgers:    TBLedger[];
  totalClose: number; // net signed closing (Dr positive, Cr negative)
}

type ViewMode = "tree" | "bspl" | "anomaly";

interface Props {
  engagementId:  string;
  clientId:      string | null | undefined;
  financialYear: string | null | undefined;
  /** Called when user clicks "Raise Query" for a ledger / voucher entry */
  onRaiseQuery:  (group: string, ledger: string, entryNote?: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LedgerExplorerTab({ engagementId, clientId, financialYear, onRaiseQuery }: Props) {
  const { tallyEngId, loading: resolving } = useTallyEngagementId(clientId, financialYear);

  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [ledgers,  setLedgers]  = useState<TBLedger[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Side panel state
  const [panelLedger, setPanelLedger] = useState<{ name: string; group: string } | null>(null);

  // Fetch all TB rows for this engagement
  useEffect(() => {
    if (!tallyEngId) return;
    setLoading(true);
    (supabase as any)
      .from("tally_trial_balance")
      .select("ledger_name,parent_group,opening_balance,opening_type,closing_balance,balance_type")
      .eq("engagement_id", tallyEngId)
      .order("parent_group")
      .order("ledger_name")
      .then(({ data, error }: { data: TBLedger[] | null; error: any }) => {
        if (!error && data) setLedgers(data);
        setLoading(false);
      });
  }, [tallyEngId]);

  // Group TB rows by parent_group, apply search
  const groups: GroupData[] = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? ledgers.filter(
          l =>
            l.ledger_name.toLowerCase().includes(q) ||
            l.parent_group.toLowerCase().includes(q)
        )
      : ledgers;

    const map = new Map<string, TBLedger[]>();
    for (const l of filtered) {
      const g = l.parent_group || "Ungrouped";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(l);
    }

    return Array.from(map.entries()).map(([groupName, grpLedgers]) => ({
      groupName,
      ledgers: grpLedgers,
      totalClose: grpLedgers.reduce(
        (sum, l) => sum + l.closing_balance * (l.balance_type === "Dr" ? 1 : -1),
        0
      ),
    }));
  }, [ledgers, search]);

  const toggleGroup = (name: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const expandAll = () => setExpanded(new Set(groups.map(g => g.groupName)));
  const collapseAll = () => setExpanded(new Set());

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

  if (ledgers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-3 text-center text-muted-foreground">
        <BookOpen size={36} className="text-muted-foreground/30" />
        <p className="text-sm">No ledgers found in Tally data for this engagement.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">

          {/* View mode toggle */}
          <div className="inline-flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("tree")}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors border-r",
                viewMode === "tree"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <List size={11} /> Group Tree
            </button>
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

          {viewMode === "tree" && (
            <>
              {/* Search (tree only) */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search group or ledger…"
                  className="h-8 pl-8 pr-7 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                {ledgers.length} ledgers · {groups.length} groups
              </Badge>
            </>
          )}
        </div>

        {viewMode === "tree" && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={expandAll}>
              Expand All
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={collapseAll}>
              Collapse All
            </Button>
          </div>
        )}
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
          onRaiseQuery={onRaiseQuery}
        />
      )}

      {/* ── Group Tree view ── */}
      {viewMode === "tree" && (
      <>
      {/* ── Group accordion ── */}
      <div className="rounded-lg border overflow-hidden divide-y">
        {groups.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No ledgers match "<span className="font-medium">{search}</span>"
          </div>
        ) : (
          groups.map(g => {
            const isOpen = expanded.has(g.groupName);
            const netType = g.totalClose >= 0 ? "Dr" : "Cr";
            return (
              <div key={g.groupName}>
                {/* Group header row */}
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                  onClick={() => toggleGroup(g.groupName)}
                >
                  {isOpen
                    ? <ChevronDown  size={14} className="text-muted-foreground flex-shrink-0" />
                    : <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />}
                  <span className="font-semibold text-sm flex-1 truncate">{g.groupName}</span>
                  <span className="text-[11px] text-muted-foreground mr-3">
                    {g.ledgers.length} ledger{g.ledgers.length !== 1 ? "s" : ""}
                  </span>
                  <span className={cn(
                    "text-xs font-semibold tabular-nums",
                    netType === "Dr" ? "text-blue-700" : "text-rose-600"
                  )}>
                    ₹{fmtAmt(g.totalClose)} {netType}
                  </span>
                </button>

                {/* Ledger rows */}
                {isOpen && (
                  <div className="divide-y bg-background">
                    {/* Sub-header */}
                    <div className="grid grid-cols-[1fr_120px_120px_auto] gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b">
                      <span>Ledger</span>
                      <span className="text-right">Opening</span>
                      <span className="text-right">Closing</span>
                      <span className="w-[148px]" />
                    </div>
                    {g.ledgers.map(l => (
                      <div
                        key={l.ledger_name}
                        className="grid grid-cols-[1fr_120px_120px_auto] gap-2 items-center px-4 py-2 hover:bg-muted/10 transition-colors"
                      >
                        {/* Name */}
                        <span className="text-sm truncate" title={l.ledger_name}>
                          {l.ledger_name}
                        </span>

                        {/* Opening */}
                        <span className={cn(
                          "text-xs text-right tabular-nums",
                          l.opening_type === "Dr" ? "text-blue-700" : "text-rose-600"
                        )}>
                          ₹{fmtAmt(l.opening_balance)} <span className="text-[10px]">{l.opening_type}</span>
                        </span>

                        {/* Closing */}
                        <span className={cn(
                          "text-xs text-right tabular-nums font-semibold",
                          l.balance_type === "Dr" ? "text-blue-700" : "text-rose-600"
                        )}>
                          ₹{fmtAmt(l.closing_balance)} <span className="text-[10px]">{l.balance_type}</span>
                        </span>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0 w-[148px]">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={() => setPanelLedger({ name: l.ledger_name, group: g.groupName })}
                          >
                            <BookOpen size={10} /> View Entries
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                            onClick={() => onRaiseQuery(g.groupName, l.ledger_name)}
                          >
                            <MessageSquareWarning size={10} /> Query
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Ledger side panel ── */}
      <LedgerSidePanel
        open={!!panelLedger}
        ledgerName={panelLedger?.name ?? ""}
        parentGroup={panelLedger?.group ?? ""}
        clientId={clientId}
        financialYear={financialYear}
        onClose={() => setPanelLedger(null)}
        onRaiseQuery={(group, ledger, note) => {
          setPanelLedger(null);
          onRaiseQuery(group, ledger, note);
        }}
      />
      </>
      )}
    </div>
  );
}
