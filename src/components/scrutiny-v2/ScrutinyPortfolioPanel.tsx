/**
 * Portfolio & learning panel (Phase 7, v2 behind the flag).
 *
 * Ticket 7.2: cross-engagement view — scrutiny findings rolled up across the FIRM's clients
 * (firm-scoped by RLS), highest-risk engagement first.
 * Ticket 7.1: rule precision & learning — now computed portfolio-wide (across all engagements),
 * with promote/demote SUGGESTIONS. Advisory only: demoting/promoting a rule is a logged partner
 * action (canonical decision #11) and is not applied here.
 *
 * Reads gracefully: shows a notice if the data isn't reachable, never crashes.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, Info, Building2 } from "lucide-react";
import { type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { rulePrecision, precisionSummary, type PrecisionVerdict } from "@/lib/scrutiny/precision";
import { portfolioSummary, portfolioTotals, type EngagementSummary } from "@/lib/scrutiny/portfolio";

interface Props {
  rules: RuleTemplate[];
}

const VERDICT: Record<PrecisionVerdict, { label: string; cls: string; icon: ReactNode }> = {
  promote: { label: "Promote", cls: "bg-green-500/15 text-green-700 border-green-300", icon: <TrendingUp size={11} /> },
  demote: { label: "Demote", cls: "bg-destructive/15 text-destructive border-destructive/40", icon: <TrendingDown size={11} /> },
  monitor: { label: "Monitor", cls: "bg-amber-500/15 text-amber-700 border-amber-300", icon: <Minus size={11} /> },
  insufficient: { label: "Low data", cls: "bg-muted text-muted-foreground border-muted-foreground/30", icon: <Minus size={11} /> },
};

export default function ScrutinyPortfolioPanel({ rules }: Props) {
  const { user } = useAuth();
  const rulesById = useMemo(() => Object.fromEntries(rules.map((r) => [r.rule_id, r])), [rules]);

  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [pFindings, setPFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.firm_id) { setLoading(false); return; }
      setLoading(true); setCapped(false);
      try {
        const { data: clients, error } = await (supabase.from as any)("clients").select("id, name").eq("firm_id", user.firm_id);
        if (error || !clients) { if (!cancelled) { setReachable(false); setLoading(false); } return; }
        const ids = (clients as { id: string }[]).map((c) => c.id);
        let rows: { client_id: string | null; rule_id: string | null; severity: string | null; status: string | null }[] = [];
        if (ids.length) {
          const { data } = await (supabase.from as any)("scrutiny_findings").select("client_id, rule_id, severity, status").in("client_id", ids).limit(1000);
          rows = data ?? [];
          if (rows.length === 1000) setCapped(true);
        }
        if (cancelled) return;
        setEngagements(portfolioSummary(clients as { id: string; name: string }[], rows));
        setPFindings(rows as Finding[]);
        setReachable(true);
      } catch { if (!cancelled) setReachable(false); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.firm_id]);

  const totals = useMemo(() => portfolioTotals(engagements), [engagements]);
  const precisionRows = useMemo(() => rulePrecision(pFindings), [pFindings]);
  const pSummary = useMemo(() => precisionSummary(precisionRows), [precisionRows]);

  return (
    <div className="space-y-6">
      {/* Cross-engagement (Ticket 7.2) */}
      <div>
        <div className="flex items-center gap-2 mb-2"><Building2 size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Portfolio — all engagements</h3></div>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !user?.firm_id ? (
          <p className="text-xs text-muted-foreground">No firm context for the current user.</p>
        ) : !reachable ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" /><span>Portfolio data isn't reachable in this database.</span></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
              <div className="rounded-md border p-3 text-center"><p className="text-xs text-muted-foreground">Clients</p><p className="text-xl font-bold">{totals.clients}</p></div>
              <div className="rounded-md border p-3 text-center"><p className="text-xs text-muted-foreground">With findings</p><p className="text-xl font-bold">{totals.withFindings}</p></div>
              <div className="rounded-md border p-3 text-center"><p className="text-xs text-muted-foreground">Findings</p><p className="text-xl font-bold">{totals.findings}</p></div>
              <div className="rounded-md border border-destructive/30 p-3 text-center"><p className="text-xs text-destructive">High risk</p><p className="text-xl font-bold text-destructive">{totals.high}</p></div>
              <div className="rounded-md border border-green-400/30 p-3 text-center"><p className="text-xs text-green-600">Queries raised</p><p className="text-xl font-bold text-green-600">{totals.queriesRaised}</p></div>
            </div>
            {capped && <p className="text-[11px] text-amber-700 mb-2">Showing the first 1,000 findings across the portfolio — totals may be partial for very large portfolios.</p>}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-16 text-right">Findings</TableHead>
                    <TableHead className="w-12 text-right">H</TableHead>
                    <TableHead className="w-12 text-right">M</TableHead>
                    <TableHead className="w-12 text-right">L</TableHead>
                    <TableHead className="w-16 text-right">Queried</TableHead>
                    <TableHead className="w-16 text-right">Waived</TableHead>
                    <TableHead className="w-16 text-right">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {engagements.slice(0, 100).map((e) => (
                    <TableRow key={e.clientId}>
                      <TableCell className="text-sm truncate max-w-[240px]">{e.clientName}</TableCell>
                      <TableCell className="text-right text-xs">{e.findings}</TableCell>
                      <TableCell className="text-right text-xs text-destructive">{e.high || ""}</TableCell>
                      <TableCell className="text-right text-xs text-amber-600">{e.medium || ""}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{e.low || ""}</TableCell>
                      <TableCell className="text-right text-xs text-green-700">{e.queried || ""}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{e.waived || ""}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{e.riskScore}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>

      {/* Rule precision & learning — portfolio-wide (Ticket 7.1) */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Rule precision &amp; learning <span className="text-xs font-normal text-muted-foreground">(across all engagements)</span></h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge className={VERDICT.demote.cls + " gap-1"}>{VERDICT.demote.icon}{pSummary.demote} demote</Badge>
          <Badge className={VERDICT.promote.cls + " gap-1"}>{VERDICT.promote.icon}{pSummary.promote} promote</Badge>
          <Badge className={VERDICT.monitor.cls + " gap-1"}>{pSummary.monitor} monitor</Badge>
          <Badge className="bg-muted text-muted-foreground border-muted-foreground/30">{pSummary.insufficient} low data</Badge>
          <span className="text-xs text-muted-foreground">of {pSummary.rules} rules with findings</span>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 flex items-start gap-2 mb-3">
          <Info size={14} className="mt-0.5 shrink-0" /><span>Precision = (queried + resolved) ÷ actioned findings; a mostly-waived rule is a <strong>demote</strong> candidate. Advisory — demoting/promoting a rule is a partner action that is logged (decision #11), not applied here.</span>
        </div>
        {precisionRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No findings yet — dispose of findings (query / resolve / waive) to build precision.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="w-16 text-right">Total</TableHead>
                  <TableHead className="w-16 text-right">Queried</TableHead>
                  <TableHead className="w-16 text-right">Waived</TableHead>
                  <TableHead className="w-20 text-right">Precision</TableHead>
                  <TableHead className="w-24">Suggestion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {precisionRows.map((r) => {
                  const v = VERDICT[r.verdict];
                  return (
                    <TableRow key={r.rule_id}>
                      <TableCell className="text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{r.rule_id}</span>
                        <span className="block truncate max-w-[280px]">{rulesById[r.rule_id]?.rule_name ?? ""}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.total}</TableCell>
                      <TableCell className="text-right text-xs text-green-700">{r.queried}</TableCell>
                      <TableCell className="text-right text-xs text-destructive">{r.waived}</TableCell>
                      <TableCell className="text-right text-sm">{r.precision == null ? "—" : `${Math.round(r.precision * 100)}%`}</TableCell>
                      <TableCell><Badge className={v.cls + " gap-1 text-xs"}>{v.icon}{v.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
