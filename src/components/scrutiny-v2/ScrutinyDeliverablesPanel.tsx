/**
 * Deliverables panel (Phase 6, v2 behind the flag).
 *
 * Ticket 6.2: read-only 3CD clause-fill — findings mapped to the §8 clause set, with a copy
 * export. Per §8 this is ADVISORY ONLY and does NOT write into the live Form 3CD module.
 * (Ticket 6.3 will add working-paper + query-letter drafts here.)
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Copy, Check, Info, Download } from "lucide-react";
import { type Finding, type RuleTemplate } from "@/lib/scrutiny/scrutinyUi";
import { clauseFill, clause3cdExportText, type ClauseContext } from "@/lib/scrutiny/clause3cd";
import { workpaperText, queryLetterText } from "@/lib/scrutiny/deliverables";
import { evidencePackText } from "@/lib/scrutiny/evidencePack";
import { computeCoverage, groupByTemplate } from "@/lib/scrutiny/coverage";
import { type FactGate } from "@/lib/scrutiny/facts";

interface Props {
  findings: Finding[];
  rules: RuleTemplate[];
  financialYear: string;
  factGate: FactGate;
}

export default function ScrutinyDeliverablesPanel({ findings, rules, financialYear, factGate }: Props) {
  const [copied, setCopied] = useState(false);

  const rulesById = useMemo(() => Object.fromEntries(rules.map((r) => [r.rule_id, r])), [rules]);
  const result = useMemo(() => {
    const contextFor = (f: Finding): ClauseContext => ({
      clause_3cd: f.clause_3cd,
      rule_id: f.rule_id,
      ruleName: rulesById[f.rule_id ?? ""]?.rule_name ?? null,
      legalReference: rulesById[f.rule_id ?? ""]?.legal_reference ?? null,
      flagMessage: f.flag_message,
    });
    return clauseFill(findings, contextFor);
  }, [findings, rulesById]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(clause3cdExportText(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — silently ignore */ }
  };

  // Ticket 6.3 — auto-drafted deliverables
  const coverage = useMemo(() => computeCoverage(groupByTemplate(rules, findings)), [rules, findings]);
  const raised = useMemo(() => findings.filter((f) => f.linked_query_id), [findings]);
  const workpaper = useMemo(() => workpaperText({
    financialYear, totalRules: coverage.total, autoChecked: coverage.auto, findings,
    requiredCaptured: factGate.requiredCaptured, requiredTotal: factGate.requiredTotal,
    missingFacts: factGate.missing.map((m) => m.label), raisedCount: raised.length,
  }), [financialYear, coverage, findings, factGate, raised]);
  const letter = useMemo(
    () => queryLetterText(raised.map((f) => ({ label: f.rule_id ?? "", text: f.flag_message ?? "" })), financialYear),
    [raised, financialYear],
  );

  // Ticket 8.1 — evidence pack / NFRA export (one comprehensive document)
  const evidence = useMemo(() => evidencePackText({
    financialYear, findings,
    coverageAuto: coverage.auto, coverageTotal: coverage.total,
    requiredCaptured: factGate.requiredCaptured, requiredTotal: factGate.requiredTotal,
    missingFacts: factGate.missing.map((m) => m.label),
    relatedParties: [], // RP names are captured in the Facts & Judgment tab
    raisedCount: raised.length,
    clauseGroups: result.groups.map((g) => ({ code: g.code, label: g.label, count: g.count })),
  }), [financialYear, findings, coverage, factGate, raised, result]);

  const download = (name: string, text: string) => {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch { /* download unavailable */ }
  };

  return (
    <div className="space-y-5">
      {/* Evidence pack / NFRA export (Ticket 8.1) */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <FileText size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Evidence pack (peer review / NFRA)</h3>
          <Badge variant="secondary" className="text-xs">{coverage.auto}/{coverage.total} covered · {findings.length} finding{findings.length !== 1 ? "s" : ""}</Badge>
          <Button size="sm" variant="outline" onClick={() => download(`scrutiny-evidence-pack-${financialYear}.txt`, evidence)} className="ml-auto"><Download className="h-4 w-4 mr-1" />Download</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">One document combining coverage, findings, judgment facts, the 3CD mapping, queries raised and the conclusion — for the review file. Advisory evidence; never blocks sign-off.</p>
        <pre className="rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap max-h-72 overflow-auto">{evidence}</pre>
      </div>

      {/* 3CD clause-fill (Ticket 6.2) */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <FileText size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Form 3CD — clause mapping</h3>
          <Badge variant="secondary" className="text-xs">{result.mapped} mapped · {result.unmapped} unmapped</Badge>
          <Button size="sm" variant="outline" onClick={copy} disabled={result.groups.length === 0} className="ml-auto">
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}{copied ? "Copied" : "Copy export"}
          </Button>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 flex items-start gap-2 mb-3">
          <Info size={14} className="mt-0.5 shrink-0" /><span>Read-only, advisory. This maps scrutiny findings to 3CD clauses for review — it does <strong>not</strong> write into the live Form 3CD module.</span>
        </div>

        {result.groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No findings map to the 3CD clause set (21(a)/(b)/(d), 22, 31(a)/(b)/(ba), 34).</p>
        ) : (
          <div className="space-y-3">
            {result.groups.map((g) => (
              <Card key={g.code}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge className="bg-primary/10 text-primary border-primary/30 font-mono text-xs">Clause {g.code}</Badge>
                    <span className="text-sm text-foreground">{g.label}</span>
                    <Badge variant="secondary" className="text-xs ml-auto">{g.count}</Badge>
                  </div>
                  <ul className="space-y-0.5">
                    {g.findings.slice(0, 20).map((f) => (
                      <li key={f.id} className="text-xs text-muted-foreground truncate">• {f.flag_message || f.rule_id}</li>
                    ))}
                    {g.findings.length > 20 && <li className="text-xs text-muted-foreground">…and {g.findings.length - 20} more</li>}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Working-paper summary (Ticket 6.3) */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileText size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Working-paper summary</h3>
          <Button size="sm" variant="outline" onClick={() => download(`scrutiny-workpaper-${financialYear}.txt`, workpaper)} className="ml-auto"><Download className="h-4 w-4 mr-1" />Download</Button>
        </div>
        <pre className="rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap max-h-72 overflow-auto">{workpaper}</pre>
      </div>

      {/* Client query letter (Ticket 6.3) */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileText size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Client query letter</h3>
          <Badge variant="secondary" className="text-xs">{raised.length} quer{raised.length !== 1 ? "ies" : "y"}</Badge>
          <Button size="sm" variant="outline" onClick={() => download(`client-queries-${financialYear}.txt`, letter)} className="ml-auto"><Download className="h-4 w-4 mr-1" />Download</Button>
        </div>
        <pre className="rounded-md border bg-muted/20 p-3 text-xs whitespace-pre-wrap max-h-72 overflow-auto">{letter}</pre>
      </div>
    </div>
  );
}
