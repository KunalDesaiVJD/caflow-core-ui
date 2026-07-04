/**
 * Command-centre Overview (Phase 6, Ticket 6.1 — v2 behind the flag, default landing tab).
 *
 * Assembles the scrutiny state into one dashboard: headline KPIs, a risk radar by category, and
 * an attention feed of what needs action. Presentational — all inputs come from AuditScrutiny.
 */

import { useMemo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldAlert, Clock, RotateCcw, ClipboardCheck, Activity, Timer } from "lucide-react";
import { type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { computeCoverage, groupByTemplate } from "@/lib/scrutiny/coverage";
import { findingQueryState } from "@/lib/scrutiny/makerChecker";
import { type FactGate } from "@/lib/scrutiny/facts";
import { riskByCategory, radarGeometry, attentionFeed, type AttentionKind } from "@/lib/scrutiny/commandCenter";
import { slaNudges, type SlaItem, type SlaLevel } from "@/lib/scrutiny/slaNudges";

interface Props {
  findings: Finding[];
  rules: RuleTemplate[];
  queryByFinding: Record<string, { id: string; status: string; created_at?: string | null }>;
  factGate: FactGate;
  priorExclusionCount: number;
}

const SLA_BADGE: Record<SlaLevel, string> = {
  escalate: "bg-destructive/10 text-destructive border-destructive/30",
  overdue: "bg-amber-100 text-amber-800 border-amber-300",
};

const FEED_ICON: Record<AttentionKind, ReactNode> = {
  high_finding: <ShieldAlert size={14} className="text-destructive" />,
  draft: <Clock size={14} className="text-amber-600" />,
  recurring: <RotateCcw size={14} className="text-muted-foreground" />,
  missing_fact: <ClipboardCheck size={14} className="text-amber-600" />,
};

export default function ScrutinyOverviewPanel({ findings, rules, queryByFinding, factGate, priorExclusionCount }: Props) {
  const coverage = useMemo(() => computeCoverage(groupByTemplate(rules, findings)), [rules, findings]);
  const { draftCount, approvedCount } = useMemo(() => {
    let draftCount = 0, approvedCount = 0;
    for (const q of Object.values(queryByFinding)) {
      const st = findingQueryState(q.status);
      if (st === "draft") draftCount++;
      else if (st === "approved") approvedCount++;
    }
    return { draftCount, approvedCount };
  }, [queryByFinding]);

  const risk = useMemo(() => riskByCategory(findings), [findings]);
  const topRisk = risk.slice(0, 6);
  const radar = useMemo(() => radarGeometry(topRisk.map((c) => ({ label: c.category, value: c.score })), 240, 4), [topRisk]);
  const feed = useMemo(
    () => attentionFeed({ findings, draftCount, recurringCount: priorExclusionCount, missingFacts: factGate.missing.map((m) => m.label) }),
    [findings, draftCount, priorExclusionCount, factGate],
  );

  // Ticket 8.2 — SLA nudges: age draft reviews, client follow-ups and unraised high findings
  const nudges = useMemo(() => {
    const items: SlaItem[] = [];
    for (const f of findings) {
      const label = f.rule_id ?? f.id;
      const q = queryByFinding[f.id];
      if (q) {
        const st = findingQueryState(q.status);
        if (st === "draft") items.push({ id: q.id, kind: "draft_review", label, clientId: f.client_id, since: q.created_at ?? null });
        else if (st === "approved") items.push({ id: q.id, kind: "client_response", label, clientId: f.client_id, since: q.created_at ?? null });
      } else if ((f.severity ?? "").toUpperCase() === "HIGH") {
        items.push({ id: f.id, kind: "high_unraised", label, clientId: f.client_id, since: (f as { created_at?: string | null }).created_at ?? null });
      }
    }
    return slaNudges(items, Date.now());
  }, [findings, queryByFinding]);

  const high = findings.filter((f) => (f.severity ?? "").toUpperCase() === "HIGH").length;

  const kpi = (label: string, value: ReactNode, cls = "text-foreground") => (
    <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">{label}</p><p className={`text-2xl font-bold ${cls}`}>{value}</p></CardContent></Card>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpi("Findings", findings.length)}
        {kpi("High risk", high, "text-destructive")}
        {kpi("Auto-checked", <>{coverage.auto}<span className="text-sm text-muted-foreground">/{coverage.total}</span></>)}
        {kpi("Drafts awaiting", draftCount, draftCount ? "text-amber-600" : "text-foreground")}
        {kpi("Queries raised", approvedCount, "text-green-700")}
        {kpi("Required facts", <>{factGate.requiredCaptured}<span className="text-sm text-muted-foreground">/{factGate.requiredTotal}</span></>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risk radar */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2"><Activity size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Risk radar by category</h3></div>
            {topRisk.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No findings to chart.</p>
            ) : topRisk.length < 3 ? (
              <div className="space-y-2 py-2">
                {topRisk.map((c) => (
                  <div key={c.category} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate">{c.category}</span>
                    <div className="flex-1 h-3 bg-muted/40 rounded"><div className="h-3 rounded bg-primary/70" style={{ width: `${Math.min(100, (c.score / (topRisk[0].score || 1)) * 100)}%` }} /></div>
                    <span className="w-8 text-right text-muted-foreground">{c.score}</span>
                  </div>
                ))}
              </div>
            ) : (
              <svg viewBox={`0 0 ${radar.size} ${radar.size}`} className="w-full max-w-[260px] mx-auto">
                {radar.rings.map((r, i) => <circle key={i} cx={radar.center} cy={radar.center} r={r} fill="none" stroke="currentColor" className="text-muted-foreground/20" />)}
                {radar.axes.map((a, i) => <line key={i} x1={radar.center} y1={radar.center} x2={a.ax} y2={a.ay} stroke="currentColor" className="text-muted-foreground/30" />)}
                <polygon points={radar.polygon} className="fill-primary/25 stroke-primary" strokeWidth={1.5} />
                {radar.axes.map((a, i) => (
                  <g key={i}>
                    <circle cx={a.x} cy={a.y} r={2.5} className="fill-primary" />
                    <text x={a.ax} y={a.ay} fontSize="9" className="fill-muted-foreground" textAnchor={a.ax > radar.center + 2 ? "start" : a.ax < radar.center - 2 ? "end" : "middle"} dominantBaseline="middle">{a.label}</text>
                  </g>
                ))}
              </svg>
            )}
            <p className="text-[10px] text-muted-foreground text-center mt-1">score = high×5 + medium×2 + low×1</p>
          </CardContent>
        </Card>

        {/* Attention feed */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">Attention feed</h3></div>
            {feed.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">Nothing needs attention — no high-risk findings, drafts, recurrences or missing required facts.</p>
            ) : (
              <ul className="space-y-2">
                {feed.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 shrink-0">{FEED_ICON[item.kind]}</span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SLA & follow-ups (Ticket 8.2) */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Timer size={16} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">SLA &amp; follow-ups</h3>
            {nudges.length > 0 && <Badge variant="secondary" className="text-xs">{nudges.length} overdue</Badge>}
          </div>
          {nudges.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Nothing overdue — drafts, client queries and high findings are all within SLA.</p>
          ) : (
            <ul className="space-y-1.5">
              {nudges.map((n) => (
                <li key={`${n.kind}-${n.id}`} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${SLA_BADGE[n.level]}`}>{n.level === "escalate" ? "Escalate" : "Overdue"} · {n.ageDays}d</Badge>
                  <span className="text-foreground">{n.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">Advisory — nudges never block sign-off / UDIN. Defaults: review drafts in 2d, chase clients at 7d, raise high findings within 3d.</p>
        </CardContent>
      </Card>
    </div>
  );
}
