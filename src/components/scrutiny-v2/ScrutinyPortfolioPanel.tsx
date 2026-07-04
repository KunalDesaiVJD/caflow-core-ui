/**
 * Portfolio & learning panel (Phase 7, v2 behind the flag).
 *
 * Ticket 7.1: rule precision & learning — how each rule's findings were dispositioned, with
 * promote/demote SUGGESTIONS. Advisory only: actually demoting/promoting a rule is a partner
 * action that is logged (canonical decision #11) and is not applied here.
 * (Tickets 7.2/7.3 will add cross-engagement + benchmarking here.)
 */

import { useMemo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { rulePrecision, precisionSummary, type PrecisionVerdict } from "@/lib/scrutiny/precision";

interface Props {
  findings: Finding[];
  rules: RuleTemplate[];
}

const VERDICT: Record<PrecisionVerdict, { label: string; cls: string; icon: ReactNode }> = {
  promote: { label: "Promote", cls: "bg-green-500/15 text-green-700 border-green-300", icon: <TrendingUp size={11} /> },
  demote: { label: "Demote", cls: "bg-destructive/15 text-destructive border-destructive/40", icon: <TrendingDown size={11} /> },
  monitor: { label: "Monitor", cls: "bg-amber-500/15 text-amber-700 border-amber-300", icon: <Minus size={11} /> },
  insufficient: { label: "Low data", cls: "bg-muted text-muted-foreground border-muted-foreground/30", icon: <Minus size={11} /> },
};

export default function ScrutinyPortfolioPanel({ findings, rules }: Props) {
  const rulesById = useMemo(() => Object.fromEntries(rules.map((r) => [r.rule_id, r])), [rules]);
  const rows = useMemo(() => rulePrecision(findings), [findings]);
  const summary = useMemo(() => precisionSummary(rows), [rows]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Rule precision &amp; learning</h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge className={VERDICT.demote.cls + " gap-1"}>{VERDICT.demote.icon}{summary.demote} demote</Badge>
          <Badge className={VERDICT.promote.cls + " gap-1"}>{VERDICT.promote.icon}{summary.promote} promote</Badge>
          <Badge className={VERDICT.monitor.cls + " gap-1"}>{summary.monitor} monitor</Badge>
          <Badge className="bg-muted text-muted-foreground border-muted-foreground/30">{summary.insufficient} low data</Badge>
          <span className="text-xs text-muted-foreground">of {summary.rules} rules with findings</span>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 flex items-start gap-2 mb-3">
          <Info size={14} className="mt-0.5 shrink-0" /><span>Precision = (queried + resolved) ÷ actioned findings; a mostly-waived rule is a <strong>demote</strong> candidate. These are advisory — demoting/promoting a rule is a partner action that is logged (decision #11), not applied here.</span>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No findings yet — dispose of findings (query / resolve / waive) to build precision.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="w-16 text-right">Total</TableHead>
                  <TableHead className="w-16 text-right">Queried</TableHead>
                  <TableHead className="w-16 text-right">Resolved</TableHead>
                  <TableHead className="w-16 text-right">Waived</TableHead>
                  <TableHead className="w-20 text-right">Precision</TableHead>
                  <TableHead className="w-24">Suggestion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const v = VERDICT[r.verdict];
                  return (
                    <TableRow key={r.rule_id}>
                      <TableCell className="text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{r.rule_id}</span>
                        <span className="block truncate max-w-[280px]">{rulesById[r.rule_id]?.rule_name ?? ""}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.total}</TableCell>
                      <TableCell className="text-right text-xs text-green-700">{r.queried}</TableCell>
                      <TableCell className="text-right text-xs">{r.resolved}</TableCell>
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
