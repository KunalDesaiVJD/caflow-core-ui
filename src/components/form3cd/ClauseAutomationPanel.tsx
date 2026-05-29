/**
 * ClauseAutomationPanel — the per-clause control strip shown above each clause
 * in Form 3CD. Surfaces (1) the auto-fill suggestion from the engine, (2) a
 * manual-override lock, (3) the manual ledger-mapping fallback, and (4) the
 * Excel export/import round-trip. It writes through the same onChange the
 * renderer uses, so the existing save/load path is untouched.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Sparkles, Lock, Link2, FileDown, FileUp, Check, Info, Loader2, X,
} from "lucide-react";
import type { ClauseDefinition } from "@/data/form3cd-master";
import type { Form3cdContext } from "@/lib/form3cd/context";
import { deriveClause, hasApplyableSuggestion } from "@/lib/form3cd/derive";
import {
  applySuggestion, setLocked, isLocked, getLinks, removeLink, getMeta,
  type Confidence,
} from "@/lib/form3cd/apply";
import { collectClauseTables } from "@/lib/form3cd/clauseTables";
import { exportClauseToXlsx } from "@/lib/form3cd/excel";
import LedgerMapDialog from "./LedgerMapDialog";
import ClauseExcelDialog from "./ClauseExcelDialog";

const inr = (n: number | string) =>
  typeof n === "number" ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(n);

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-muted text-muted-foreground",
};

export default function ClauseAutomationPanel({
  definition, value, onChange, context, contextLoading, formLocked,
}: {
  definition: ClauseDefinition;
  value: any;
  onChange: (next: any) => void;
  context: Form3cdContext | null;
  contextLoading: boolean;
  formLocked: boolean;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const suggestion = useMemo(() => (context ? deriveClause(definition.clauseNo, context) : null), [context, definition.clauseNo]);
  const canApply = hasApplyableSuggestion(suggestion);
  const tables = useMemo(() => collectClauseTables(definition, value), [definition, value]);
  const hasTables = tables.length > 0;
  const meta = getMeta(value);
  const locked = isLocked(value);
  const links = getLinks(value);

  const canMap = !!context && !context.empty && (hasTables ||
    definition.control === "amount_remarks" ||
    (definition.control === "single_field" && (definition as any).fieldType === "number"));

  function applyAuto() {
    if (!suggestion || !canApply) return;
    onChange(applySuggestion(value, suggestion));
  }

  function doExport() {
    const specs = tables.map((t) => ({ sheetName: `Cl ${definition.clauseNo} ${t.label}`.slice(0, 28), columns: t.columns, rows: t.rows }));
    if (specs.length === 0) return;
    exportClauseToXlsx({
      fileName: `Form3CD_Clause_${definition.clauseNo}`,
      clauseNo: definition.clauseNo,
      engagementId: context?.engagementId || "",
      tables: specs,
    });
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium">Automation</span>

          {contextLoading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> loading figures…
            </span>
          )}

          {context?.empty && !contextLoading && (
            <span className="text-xs text-muted-foreground">No trial balance found — sync Tally & map COA to enable auto-fill.</span>
          )}

          {/* Auto-fill suggestion */}
          {suggestion && (
            <Badge className={`text-[10px] ${CONFIDENCE_STYLE[suggestion.confidence]}`}>{suggestion.confidence} confidence</Badge>
          )}
          {suggestion && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-help">
                  {suggestion.summary} <Info className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <div className="space-y-1 text-xs">
                  {suggestion.fields.map((f, i) => (
                    <div key={i}>
                      <span className="font-medium">{f.label}:</span> {typeof f.value === "number" ? `₹${inr(f.value)}` : f.value}
                      <div className="text-[10px] opacity-70">{f.provenance}</div>
                    </div>
                  ))}
                  {suggestion.notes && <div className="text-[10px] italic pt-1 border-t border-border/40">{suggestion.notes}</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          )}

          <div className="flex-1" />

          {/* Actions */}
          {suggestion && canApply && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={formLocked || locked} onClick={applyAuto}>
              <Sparkles className="h-3 w-3 mr-1" /> {meta.autofill ? "Re-apply" : "Apply auto-fill"}
            </Button>
          )}
          {suggestion && !canApply && (
            <Badge variant="outline" className="text-[10px]">reference only</Badge>
          )}

          {canMap && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={formLocked} onClick={() => setMapOpen(true)}>
              <Link2 className="h-3 w-3 mr-1" /> Map ledgers
            </Button>
          )}

          {hasTables && (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={doExport} title="Export this clause's table(s) to Excel">
                <FileDown className="h-3 w-3 mr-1" /> Export
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={formLocked} onClick={() => setImportOpen(true)} title="Import an edited Excel file">
                <FileUp className="h-3 w-3 mr-1" /> Import
              </Button>
            </>
          )}

          {/* Manual override lock */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 pl-2 border-l">
                <Lock className={`h-3 w-3 ${locked ? "text-amber-600" : "text-muted-foreground"}`} />
                <Switch checked={locked} disabled={formLocked} onCheckedChange={(v) => onChange(setLocked(value, v))} className="scale-75" />
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Manual override — when on, "Auto-fill all" skips this clause so your manual entry is never overwritten.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Applied / linked provenance */}
        {(meta.autofill || links.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {meta.autofill && (
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3 text-green-600" /> auto-filled ({meta.autofill.confidence})
              </span>
            )}
            {links.map((l) => (
              <Badge key={l.field} variant="outline" className="text-[10px] gap-1">
                <Link2 className="h-2.5 w-2.5" /> {l.ledgers.length} ledger(s) → ₹{inr(l.sum)}
                {!formLocked && (
                  <button className="ml-1 hover:text-destructive" onClick={() => onChange(removeLink(value, l.field))} title="Remove link">
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {mapOpen && context && (
        <LedgerMapDialog
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          definition={definition}
          value={value}
          onChange={onChange}
          context={context}
        />
      )}
      {importOpen && (
        <ClauseExcelDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          definition={definition}
          value={value}
          onChange={onChange}
        />
      )}
    </TooltipProvider>
  );
}
