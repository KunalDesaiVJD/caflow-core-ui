/**
 * Templates-first Scrutiny view (v2, behind the VITE_SCRUTINY_V2 flag).
 *
 * Flips the primary axis from individual findings to the 119-rule CATALOGUE: every rule
 * (template) that ran is shown grouped by its real `category`, tagged as
 *   • hits     — produced findings (expand to drill in)
 *   • clean    — auto-checked, ran, found nothing (evidence of work performed)
 *   • advisory — no deterministic handler; needs manual review
 * so the auditor sees coverage, not just exceptions. Coverage is ADVISORY only
 * (canonical decision #8) — it never blocks sign-off / UDIN.
 *
 * Presentational only: findings, rules and the shared badge renderers + action callbacks
 * are passed in from `AuditScrutiny` so the resolve/waive/link/detail logic is reused, not
 * duplicated.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, ShieldQuestion, Info, X, CheckCircle2, Clock,
} from "lucide-react";
import { SEVERITIES, STATUSES, type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { groupByTemplate, groupByCategory, computeCoverage, type TemplateGroup } from "@/lib/scrutiny/coverage";
import { findingQueryState } from "@/lib/scrutiny/makerChecker";
import { type NarrationClass } from "@/lib/scrutiny/aiNarration";
import ScrutinyFindingsTable from "./ScrutinyFindingsTable";

interface Props {
  rules: RuleTemplate[];
  findings: Finding[];
  loading: boolean;
  /** finding_id -> its linked query { id, status } (maker-checker) */
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

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export default function ScrutinyTemplatesView({
  rules, findings, loading, queryByFinding, currentUserId,
  onDetails, onResolve, onWaive, onLink, onRaiseQuery, onApproveQuery, onRejectQuery,
  narrationClasses, onApplyClause, priorExclusions,
  severityBadge, statusBadge,
}: Props) {
  const [catFilter, setCatFilter] = useState("All");
  const [sevFilter, setSevFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [mcFilter, setMcFilter] = useState(false); // "awaiting approval only"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showClean, setShowClean] = useState<Set<string>>(new Set());

  const qState = (f: Finding) => findingQueryState(queryByFinding[f.id]?.status);

  const groups = useMemo(() => groupByTemplate(rules, findings), [rules, findings]);
  const coverage = useMemo(() => computeCoverage(groups), [groups]);
  const cats = useMemo(() => groupByCategory(groups), [groups]);
  const categoryOptions = useMemo(() => ["All", ...cats.map((c) => c.category)], [cats]);

  const awaitingApproval = useMemo(
    () => findings.filter((f) => qState(f) === "draft").length,
    [findings, queryByFinding],
  );

  const activeFindingFilter = sevFilter !== "All" || statusFilter !== "All" || mcFilter;
  const matchFinding = (f: Finding) =>
    (sevFilter === "All" || (f.severity ?? "").toUpperCase() === sevFilter) &&
    (statusFilter === "All" || (f.status ?? "").toLowerCase() === statusFilter.toLowerCase()) &&
    (!mcFilter || qState(f) === "draft");

  const clearFilters = () => { setCatFilter("All"); setSevFilter("All"); setStatusFilter("All"); setMcFilter(false); };

  const visibleCats = cats.filter((c) => catFilter === "All" || c.category === catFilter);

  const statusChip = (g: TemplateGroup, count: number) => {
    if (g.status === "hits")
      return <Badge variant="destructive" className="gap-1"><ShieldAlert size={12} />{count} finding{count !== 1 ? "s" : ""}</Badge>;
    if (g.status === "clean")
      return <Badge className="gap-1 bg-green-500/15 text-green-700 border-green-300"><ShieldCheck size={12} />Clean</Badge>;
    return <Badge variant="outline" className="gap-1 text-muted-foreground"><ShieldQuestion size={12} />Advisory</Badge>;
  };

  const renderTemplateRow = (g: TemplateGroup) => {
    const rid = g.rule.rule_id;
    const shown = g.findings.filter(matchFinding);
    const count = activeFindingFilter ? shown.length : g.hitCount;
    const isOpen = expanded.has(rid);
    const canExpand = g.status === "hits";
    const threshold = g.rule.threshold_value != null && g.rule.threshold_value !== ""
      ? `${g.rule.threshold_type ? `${g.rule.threshold_type}: ` : ""}${g.rule.threshold_value}`
      : null;

    return (
      <div key={rid} className="border-t first:border-t-0">
        <button
          type="button"
          disabled={!canExpand}
          onClick={() => canExpand && setExpanded((s) => toggle(s, rid))}
          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${canExpand ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}`}
        >
          <span className="w-4 shrink-0 text-muted-foreground">
            {canExpand ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
          </span>
          <span className="shrink-0">{statusChip(g, count)}</span>
          <span className="font-mono text-xs text-muted-foreground shrink-0">{rid}</span>
          <span className="flex-1 text-sm truncate">{g.rule.rule_name || rid}</span>
          {threshold && <span className="hidden md:inline text-xs text-muted-foreground shrink-0">{threshold}</span>}
          {g.rule.legal_reference && (
            <span className="hidden lg:inline text-xs text-muted-foreground shrink-0 max-w-[180px] truncate">{g.rule.legal_reference}</span>
          )}
          <span className="shrink-0">{severityBadge(g.rule.severity)}</span>
        </button>
        {isOpen && canExpand && (
          <div className="px-3 pb-3">
            <ScrutinyFindingsTable
              findings={shown}
              queryByFinding={queryByFinding}
              currentUserId={currentUserId}
              onDetails={onDetails}
              onResolve={onResolve}
              onWaive={onWaive}
              onLink={onLink}
              onRaiseQuery={onRaiseQuery}
              onApproveQuery={onApproveQuery}
              onRejectQuery={onRejectQuery}
              narrationClasses={narrationClasses}
              onApplyClause={onApplyClause}
              priorExclusions={priorExclusions}
              severityBadge={severityBadge}
              statusBadge={statusBadge}
            />
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }

  if (rules.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Info className="h-10 w-10 mx-auto mb-3" />
        <p>Rule catalogue not loaded. Run scrutiny to populate templates.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Advisory coverage strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Auto-checked</p><p className="text-2xl font-bold text-foreground">{coverage.auto}<span className="text-sm text-muted-foreground">/{coverage.total}</span></p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground">Advisory (manual)</p><p className="text-2xl font-bold text-muted-foreground">{coverage.advisory}</p></CardContent></Card>
        <Card className="border-amber-400/30"><CardContent className="p-4 text-center"><p className="text-xs text-amber-600">Templates w/ findings</p><p className="text-2xl font-bold text-amber-600">{coverage.withHits}</p></CardContent></Card>
        <Card className="border-destructive/30"><CardContent className="p-4 text-center"><p className="text-xs text-destructive">Total findings</p><p className="text-2xl font-bold text-destructive">{coverage.totalHits}</p></CardContent></Card>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground -mt-2">
        <Info size={12} /> Coverage is advisory — it never blocks sign-off / UDIN. "Clean" = the check ran and found nothing; "Advisory" = review manually.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Category</label>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{categoryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Severity</label>
          <Select value={sevFilter} onValueChange={setSevFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant={mcFilter ? "default" : "outline"}
          size="sm"
          onClick={() => setMcFilter((v) => !v)}
          className="gap-1"
          title="Show only findings whose draft query is awaiting a second reviewer"
        >
          <Clock className="h-3 w-3" /> Awaiting approval{awaitingApproval ? ` (${awaitingApproval})` : ""}
        </Button>
        <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-3 w-3 mr-1" />Clear</Button>
      </div>

      {/* Category sections */}
      {visibleCats.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShieldQuestion className="h-12 w-12 mx-auto mb-3" />
          <p>No templates match the current filters.</p>
        </div>
      ) : (
        visibleCats.map((c) => {
          // Under an active finding-filter, only hit templates with matching findings are relevant.
          const attention = c.templates.filter((t) =>
            activeFindingFilter ? t.status === "hits" && t.findings.some(matchFinding) : t.status !== "clean",
          );
          const clean = activeFindingFilter ? [] : c.templates.filter((t) => t.status === "clean");
          const cleanOpen = showClean.has(c.category);
          if (attention.length === 0 && clean.length === 0) return null;

          return (
            <div key={c.category} className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{c.category}</h3>
                <Badge variant="secondary" className="text-xs">{c.templates.length} template{c.templates.length !== 1 ? "s" : ""}</Badge>
                {c.hitCount > 0 && <Badge variant="destructive" className="text-xs">{c.hitCount} finding{c.hitCount !== 1 ? "s" : ""}</Badge>}
                {c.cleanCount > 0 && !activeFindingFilter && (
                  <Badge className="text-xs gap-1 bg-green-500/15 text-green-700 border-green-300"><CheckCircle2 size={11} />{c.cleanCount} clean</Badge>
                )}
              </div>
              <div className="rounded-md border">
                {attention.map(renderTemplateRow)}
                {clean.length > 0 && (
                  <div className="border-t">
                    <button
                      type="button"
                      onClick={() => setShowClean((s) => toggle(s, c.category))}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50"
                    >
                      {cleanOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {cleanOpen ? "Hide" : "Show"} {clean.length} clean check{clean.length !== 1 ? "s" : ""} (ran, nothing found)
                    </button>
                    {cleanOpen && clean.map(renderTemplateRow)}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
