/**
 * Per-ledger workpaper view (Ticket 1.4, v2 behind the flag).
 *
 * Re-organises findings by the LEDGER/account they were raised against — the classic
 * working-paper axis (account-by-account) that complements the rule-first templates view.
 * Each ledger card shows a severity rollup, an auto-generated (read-only) conclusion, how many
 * exceptions have been raised as queries, and the shared findings table (with maker-checker).
 *
 * Presentational only — findings, query state, badges and action callbacks are passed in from
 * `AuditScrutiny`; the findings table itself is the shared `ScrutinyFindingsTable`.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, BookOpen, ShieldQuestion } from "lucide-react";
import { type Finding } from "@/lib/scrutiny/scrutinyUi";
import { groupByLedger, ledgerConclusion } from "@/lib/scrutiny/workpaper";
import { findingQueryState } from "@/lib/scrutiny/makerChecker";
import { type NarrationClass } from "@/lib/scrutiny/aiNarration";
import ScrutinyFindingsTable from "./ScrutinyFindingsTable";

interface Props {
  findings: Finding[];
  loading: boolean;
  queryByFinding: Record<string, { id: string; status: string }>;
  currentUserId: string | null;
  onDetails: (f: Finding) => void;
  onResolve: (id: string) => void;
  onWaive: (id: string) => void;
  onLink: (id: string) => void;
  onRaiseQuery: (f: Finding) => void;
  onApproveQuery: (f: Finding, queryId: string) => void;
  onRejectQuery: (f: Finding, queryId: string) => void;
  narrationClasses?: Record<string, NarrationClass>;
  onApplyClause?: (id: string, clause: string) => void;
  priorExclusions?: Record<string, boolean>;
  severityBadge: (s: string | null) => ReactNode;
  statusBadge: (s: string | null) => ReactNode;
}

export default function ScrutinyWorkpaperView(props: Props) {
  const { findings, loading, queryByFinding } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ledgers = useMemo(() => groupByLedger(findings), [findings]);

  const toggle = (key: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const queryCounts = (fs: Finding[]) => {
    let draft = 0, raised = 0;
    for (const f of fs) {
      const st = findingQueryState(queryByFinding[f.id]?.status);
      if (st === "draft") draft++;
      else if (st === "approved") raised++;
    }
    return { draft, raised };
  };

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  if (ledgers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <ShieldQuestion className="h-12 w-12 mx-auto mb-3" />
        <p>No findings for this year — no ledgers to work through.</p>
      </div>
    );
  }

  const totalFindings = ledgers.reduce((s, g) => s + g.total, 0);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <BookOpen size={14} />
        {ledgers.length} ledger{ledgers.length !== 1 ? "s" : ""} with exceptions · {totalFindings} finding{totalFindings !== 1 ? "s" : ""} — reviewed account-by-account.
      </p>

      {ledgers.map((g) => {
        const isOpen = expanded.has(g.ledger);
        const { draft, raised } = queryCounts(g.findings);
        return (
          <div key={g.ledger} className="rounded-md border">
            <button
              type="button"
              onClick={() => toggle(g.ledger)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
            >
              <span className="w-4 shrink-0 text-muted-foreground">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
              <span className="flex-1 min-w-0">
                <span className="font-medium text-sm text-foreground">{g.ledger}</span>
                <span className="block text-xs text-muted-foreground">{ledgerConclusion(g)}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                {g.high > 0 && <Badge variant="destructive" className="text-xs">{g.high} H</Badge>}
                {g.medium > 0 && <Badge className="text-xs bg-amber-500/15 text-amber-700 border-amber-300">{g.medium} M</Badge>}
                {g.low > 0 && <Badge variant="secondary" className="text-xs">{g.low} L</Badge>}
                {draft > 0 && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">{draft} draft</Badge>}
                {raised > 0 && <Badge className="text-xs bg-green-500/15 text-green-700 border-green-300">{raised} raised</Badge>}
              </span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4">
                <ScrutinyFindingsTable
                  findings={g.findings}
                  queryByFinding={props.queryByFinding}
                  currentUserId={props.currentUserId}
                  onDetails={props.onDetails}
                  onResolve={props.onResolve}
                  onWaive={props.onWaive}
                  onLink={props.onLink}
                  onRaiseQuery={props.onRaiseQuery}
                  onApproveQuery={props.onApproveQuery}
                  onRejectQuery={props.onRejectQuery}
                  narrationClasses={props.narrationClasses}
                  onApplyClause={props.onApplyClause}
                  priorExclusions={props.priorExclusions}
                  severityBadge={props.severityBadge}
                  statusBadge={props.statusBadge}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
