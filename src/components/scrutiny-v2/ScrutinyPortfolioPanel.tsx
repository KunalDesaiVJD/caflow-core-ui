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
import { TrendingUp, TrendingDown, Minus, Info, Building2, ListChecks, Gauge } from "lucide-react";
import { type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { rulePrecision, precisionSummary, type PrecisionVerdict } from "@/lib/scrutiny/precision";
import { portfolioSummary, portfolioTotals, type EngagementSummary } from "@/lib/scrutiny/portfolio";
import { benchmark, type BenchLevel } from "@/lib/scrutiny/benchmark";
import { reviewQueue, LANE_LABEL, type QueueInputFinding, type QueueLane } from "@/lib/scrutiny/reviewQueue";
import { partnerMis } from "@/lib/scrutiny/partnerMis";
import { SCRUTINY_QUERY_SOURCE } from "@/lib/scrutiny/makerChecker";

interface Props {
  rules: RuleTemplate[];
  clientId: string;
}

const LEVEL: Record<BenchLevel, { label: string; cls: string }> = {
  above: { label: "Above norm", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  typical: { label: "Typical", cls: "bg-muted text-muted-foreground border-muted-foreground/30" },
  below: { label: "Below norm", cls: "bg-green-500/15 text-green-700 border-green-300" },
};

const LANE_CLS: Record<QueueLane, string> = {
  to_review: "bg-amber-500/15 text-amber-700 border-amber-300",
  to_raise: "bg-destructive/15 text-destructive border-destructive/40",
  awaiting_client: "bg-blue-500/15 text-blue-700 border-blue-300",
  to_dispose: "bg-muted text-muted-foreground border-muted-foreground/30",
};

const VERDICT: Record<PrecisionVerdict, { label: string; cls: string; icon: ReactNode }> = {
  promote: { label: "Promote", cls: "bg-green-500/15 text-green-700 border-green-300", icon: <TrendingUp size={11} /> },
  demote: { label: "Demote", cls: "bg-destructive/15 text-destructive border-destructive/40", icon: <TrendingDown size={11} /> },
  monitor: { label: "Monitor", cls: "bg-amber-500/15 text-amber-700 border-amber-300", icon: <Minus size={11} /> },
  insufficient: { label: "Low data", cls: "bg-muted text-muted-foreground border-muted-foreground/30", icon: <Minus size={11} /> },
};

export default function ScrutinyPortfolioPanel({ rules, clientId }: Props) {
  const { user } = useAuth();
  const rulesById = useMemo(() => Object.fromEntries(rules.map((r) => [r.rule_id, r])), [rules]);

  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [pFindings, setPFindings] = useState<Finding[]>([]);
  const [queueRows, setQueueRows] = useState<QueueInputFinding[]>([]);
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
        let rows: { id?: string; client_id: string | null; rule_id: string | null; severity: string | null; status: string | null; actioned_by?: string | null; linked_query_id?: string | null }[] = [];
        let qStatus = new Map<string, string>();
        if (ids.length) {
          const { data } = await (supabase.from as any)("scrutiny_findings").select("id, client_id, rule_id, severity, status, actioned_by, linked_query_id").in("client_id", ids).limit(1000);
          rows = data ?? [];
          if (rows.length === 1000) setCapped(true);
          const { data: qData } = await (supabase.from as any)("audit_client_queries").select("id, status").in("client_id", ids).eq("source", SCRUTINY_QUERY_SOURCE).limit(2000);
          qStatus = new Map(((qData ?? []) as { id: string; status: string }[]).map((q) => [q.id, q.status]));
        }
        if (cancelled) return;
        setEngagements(portfolioSummary(clients as { id: string; name: string }[], rows));
        setPFindings(rows as Finding[]);
        setQueueRows(rows.map((r) => ({
          id: r.id ?? "",
          client_id: r.client_id,
          rule_id: r.rule_id,
          severity: r.severity,
          status: r.status,
          actioned_by: r.actioned_by ?? null,
          queryStatus: r.linked_query_id ? qStatus.get(r.linked_query_id) ?? null : null,
        })));
        setReachable(true);
      } catch { if (!cancelled) setReachable(false); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.firm_id]);

  const totals = useMemo(() => portfolioTotals(engagements), [engagements]);
  const precisionRows = useMemo(() => rulePrecision(pFindings), [pFindings]);
  const pSummary = useMemo(() => precisionSummary(precisionRows), [precisionRows]);
  const currentName = useMemo(() => engagements.find((e) => e.clientId === clientId)?.clientName ?? "This client", [engagements, clientId]);
  const bench = useMemo(() => benchmark({ findings: pFindings, clientId, peerEngagements: totals.withFindings }), [pFindings, clientId, totals]);
  const nameById = useMemo(() => Object.fromEntries(engagements.map((e) => [e.clientId, e.clientName])), [engagements]);
  const queue = useMemo(() => reviewQueue(queueRows), [queueRows]);
  const mis = useMemo(() => partnerMis(queueRows, totals.clients), [queueRows, totals.clients]);

  return (
    <div className="space-y-6">
      {/* Partner MIS (Ticket 8.5) */}
      {!loading && reachable && user?.firm_id && (
        <div>
          <div className="flex items-center gap-2 mb-2"><Gauge size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Partner MIS — firm scrutiny book</h3></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-md border p-3 text-center"><p className="text-xs text-muted-foreground">Engagements</p><p className="text-xl font-bold">{mis.engagements.total}</p><p className="text-[10px] text-muted-foreground">{mis.engagements.withFindings} active · {mis.engagements.clean} clean</p></div>
            <div className="rounded-md border border-destructive/30 p-3 text-center"><p className="text-xs text-destructive">Open high</p><p className="text-xl font-bold text-destructive">{mis.engagements.withOpenHigh}</p><p className="text-[10px] text-muted-foreground">engagements</p></div>
            <div className="rounded-md border p-3 text-center"><p className="text-xs text-muted-foreground">Disposed</p><p className="text-xl font-bold">{Math.round(mis.disposition.rate * 100)}%</p><p className="text-[10px] text-muted-foreground">{mis.disposition.open} still open</p></div>
            <div className="rounded-md border p-3 text-center"><p className="text-xs text-muted-foreground">Findings</p><p className="text-xl font-bold">{mis.findings.total}</p><p className="text-[10px] text-muted-foreground">{mis.avgFindingsPerEngagement.toFixed(1)}/engagement</p></div>
            <div className="rounded-md border border-amber-400/30 p-3 text-center"><p className="text-xs text-amber-700">Awaiting checker</p><p className="text-xl font-bold text-amber-700">{mis.queries.drafts}</p><p className="text-[10px] text-muted-foreground">draft queries</p></div>
            <div className="rounded-md border border-blue-400/30 p-3 text-center"><p className="text-xs text-blue-700">Awaiting client</p><p className="text-xl font-bold text-blue-700">{mis.queries.awaitingClient}</p><p className="text-[10px] text-muted-foreground">queries sent</p></div>
          </div>
          {mis.topCategories.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">Risk concentration: {mis.topCategories.map((c) => `${c.category} (${c.total})`).join(" · ")}</p>
          )}
        </div>
      )}

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

      {/* Review & assignment queue (Ticket 8.4) */}
      {!loading && reachable && user?.firm_id && (
        <div>
          <div className="flex items-center gap-2 mb-2"><ListChecks size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Review &amp; assignment queue</h3><Badge variant="secondary" className="text-xs">{queue.total} open</Badge></div>
          <div className="flex flex-wrap gap-2 mb-3">
            {queue.lanes.map((l) => (
              <Badge key={l.lane} className={LANE_CLS[l.lane] + " text-xs"}>{l.label}: {l.count}</Badge>
            ))}
          </div>
          {queue.makers.length > 0 && (
            <p className="text-xs text-muted-foreground mb-2">Awaiting a checker — by maker: {queue.makers.map((m) => `${m.maker.slice(0, 8)}… (${m.awaitingReview})`).join(" · ")}</p>
          )}
          {queue.total === 0 ? (
            <p className="text-xs text-muted-foreground">Queue is clear — no open findings need action across the portfolio.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Lane</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-28">Rule</TableHead>
                    <TableHead className="w-20">Severity</TableHead>
                    <TableHead className="w-28">Blocked on</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.items.slice(0, 100).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell><Badge className={LANE_CLS[i.lane] + " text-xs"}>{LANE_LABEL[i.lane]}</Badge></TableCell>
                      <TableCell className="text-sm truncate max-w-[200px]">{nameById[i.clientId ?? ""] ?? i.clientId ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{i.ruleId ?? "—"}</TableCell>
                      <TableCell className="text-xs">{i.severity ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.blockedOn ?? "auditor"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {queue.items.length > 100 && <p className="text-[11px] text-muted-foreground px-3 py-1.5">Showing the first 100 of {queue.items.length} open items.</p>}
            </div>
          )}
        </div>
      )}

      {/* Benchmarking (Ticket 7.3) */}
      {!loading && reachable && user?.firm_id && (
        <div>
          <div className="flex items-center gap-2 mb-2"><TrendingUp size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Benchmarking — {currentName} vs portfolio</h3></div>
          {totals.withFindings < 2 ? (
            <p className="text-xs text-muted-foreground">Not enough engagements with findings to benchmark against yet.</p>
          ) : bench.length === 0 ? (
            <p className="text-xs text-muted-foreground">No findings to benchmark.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-24 text-right">This client</TableHead>
                    <TableHead className="w-28 text-right">Portfolio avg</TableHead>
                    <TableHead className="w-16 text-right">×</TableHead>
                    <TableHead className="w-28">vs norm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bench.map((r) => (
                    <TableRow key={r.category}>
                      <TableCell className="font-mono text-xs">{r.category}</TableCell>
                      <TableCell className="text-right text-sm">{r.clientCount}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{r.portfolioAvg.toFixed(1)}</TableCell>
                      <TableCell className="text-right text-xs">{r.ratio == null ? "—" : `${r.ratio.toFixed(1)}×`}</TableCell>
                      <TableCell><Badge className={LEVEL[r.level].cls + " text-xs"}>{LEVEL[r.level].label}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

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
