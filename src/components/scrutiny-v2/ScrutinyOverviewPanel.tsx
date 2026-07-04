/**
 * Command-centre Overview (Phase 6, Ticket 6.1 — v2 behind the flag, default landing tab).
 *
 * Assembles the scrutiny state into one dashboard: headline KPIs, a risk radar by category, and
 * an attention feed of what needs action. Presentational — all inputs come from AuditScrutiny.
 */

import { useMemo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldAlert, Clock, RotateCcw, ClipboardCheck, Activity } from "lucide-react";
import { type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { computeCoverage, groupByTemplate } from "@/lib/scrutiny/coverage";
import { findingQueryState } from "@/lib/scrutiny/makerChecker";
import { type FactGate } from "@/lib/scrutiny/facts";
import { riskByCategory, radarGeometry, attentionFeed, type AttentionKind } from "@/lib/scrutiny/commandCenter";

interface Props {
  findings: Finding[];
  rules: RuleTemplate[];
  queryByFinding: Record<string, { id: string; status: string }>;
  factGate: FactGate;
  priorExclusionCount: number;
}

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
    </div>
  );
}
