/**
 * Form3cdReconcile — the "Audit / Reconcile" side panel.
 *
 * Cross-checks the figures the engine derives from the Financial Statements
 * against what is currently entered in the 3CD clauses, flags mismatches and
 * unmapped ledgers, and offers a one-click "Auto-fill all" (which skips any
 * clause the CA has locked via manual override).
 */

import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertTriangle, Circle, Sparkles, Loader2 } from "lucide-react";
import type { Form3cdContext } from "@/lib/form3cd/context";
import { deriveAll, hasApplyableSuggestion } from "@/lib/form3cd/derive";
import { isLocked, getMeta } from "@/lib/form3cd/apply";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01); // within 1% or ₹1

/** Pull the comparable applied figure for the clauses we can numerically reconcile. */
function appliedFigure(clauseNo: string, value: any): number | null {
  if (!value) return null;
  if (clauseNo === "40") {
    const v = Number(value.r1_prev);
    return isNaN(v) ? null : v;
  }
  if (clauseNo === "44") {
    const v = Number(value?._rows?.[0]?.total_expenditure);
    return isNaN(v) ? null : v;
  }
  return null;
}

export default function Form3cdReconcile({
  open, onClose, context, contextLoading, getValue, onApplyAll, applying,
}: {
  open: boolean;
  onClose: () => void;
  context: Form3cdContext | null;
  contextLoading: boolean;
  getValue: (clauseNo: string) => any;
  onApplyAll: () => void;
  applying: boolean;
}) {
  const suggestions = useMemo(() => (context ? deriveAll(context) : []), [context]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Audit & Reconcile 3CD</SheetTitle>
          <SheetDescription>
            Figures derived from the Trial Balance + COA mapping, checked against the 3CD clauses.
          </SheetDescription>
        </SheetHeader>

        {contextLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading financial data…
          </div>
        )}

        {context && !contextLoading && (
          <div className="space-y-4 mt-4">
            {/* Data health */}
            <div className="rounded-md border p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Data health</p>
              {context.empty ? (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> No trial balance found for this engagement.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span>Mapped ledgers</span><span className="font-mono">{context.mappedCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className={context.unmappedCount > 0 ? "text-amber-700" : ""}>Unmapped ledgers</span>
                    <span className="font-mono">{context.unmappedCount}</span>
                  </div>
                  {context.unmappedCount > 0 && (
                    <p className="text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {context.unmappedCount} ledger(s) are not mapped in COA — derived totals may be incomplete. Map them in Stage 3 (COA Mapping).
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Apply all */}
            <Button className="w-full" disabled={applying || context.empty} onClick={onApplyAll}>
              {applying ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Applying…</> : <><Sparkles className="h-4 w-4 mr-2" /> Auto-fill all derivable clauses</>}
            </Button>
            <p className="text-[11px] text-muted-foreground -mt-2">Locked (manually overridden) clauses are never touched.</p>

            {/* Reconciliation rows */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Derived figures</p>
              {suggestions.length === 0 && <p className="text-sm text-muted-foreground">Nothing derivable from current data.</p>}
              {suggestions.map((s) => {
                const value = getValue(s.clauseNo);
                const locked = isLocked(value);
                const meta = getMeta(value);
                const derived = typeof s.fields[0]?.value === "number" ? (s.fields[0].value as number) : null;
                const applied = appliedFigure(s.clauseNo, value);
                const reconcilable = derived != null && applied != null;
                const matched = reconcilable && near(applied!, derived!);

                return (
                  <div key={s.clauseNo} className="rounded-md border p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">Clause {s.clauseNo}</span>
                      <div className="flex items-center gap-1.5">
                        {locked && <Badge variant="outline" className="text-[10px]">locked</Badge>}
                        {!hasApplyableSuggestion(s) ? (
                          <Badge variant="outline" className="text-[10px]">reference</Badge>
                        ) : matched ? (
                          <Badge className="bg-green-100 text-green-800 text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" /> reflected</Badge>
                        ) : reconcilable ? (
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> mismatch</Badge>
                        ) : meta.autofill ? (
                          <Badge className="bg-green-100 text-green-800 text-[10px]">auto-filled</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-1"><Circle className="h-3 w-3" /> not applied</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.summary}</p>
                    {derived != null && (
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground">derived</span><span>₹{inr(derived)}</span>
                      </div>
                    )}
                    {reconcilable && (
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground">in 3CD</span>
                        <span className={matched ? "" : "text-amber-700"}>₹{inr(applied!)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
