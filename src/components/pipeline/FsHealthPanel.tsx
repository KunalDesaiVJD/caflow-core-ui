/**
 * FsHealthPanel — the visible structural guarantee that NCE Financial Statements
 * are internally consistent.
 *
 * Shows at the top of the Stage 7 (Financial Statements) view. For every NCE
 * code that has a note, compares the three independent paths:
 *   • COA Total      — fresh from TB × coa_mapping × signedBalance (the truth)
 *   • Note Total     — getNCENoteFaceTotal (Phase 3 canonical aggregator)
 *   • BS / P&L Face  — nceCyAmounts / ncePyAmounts (what the stat card displays)
 *
 *   plus the Phase 4 Manual Delta = Note Total - COA Total, which makes
 *   legitimate auditor adjustments (manual rows like "Provision for SCN
 *   demand") VISIBLE rather than confused with a reconciliation bug.
 *
 * Failure modes surfaced (worst-of-CY-PY):
 *   • "✓ All N notes reconcile"  — green banner, no manual adjustments
 *   • "N reconcile + M with manual adjustments"  — green banner, amber pill
 *   • "X notes off"              — yellow / red banner with details table
 *
 * This is the answer to the user's question "how do I know future code
 * changes will not silently break my BS balance" — every new code path that
 * computes a note total must agree with this panel's check, or the panel
 * surfaces the drift on the very next page load.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { validateFSReconciliation, validateCorporateFSReconciliation, type ReconRow, NCE_LIAB_CODE_SET } from "@/lib/fsReconciliation";
import type { Stage5Notes } from "@/lib/notesAutoPopulate";

interface Props {
  engagementId:    string;
  /** nce_financial_notes rows keyed by note_type — NCE path. */
  nceNotesByType?: Record<string, { cy_data?: Record<string, any> | null; py_data?: Record<string, any> | null; note_type?: string }>;
  /** 2026-06-05 Phase 6 — stage5_notes JSON for Corporate engagements. When
   *  supplied (and nceNotesByType empty), the panel runs the corporate
   *  validator instead of the NCE one. Same three-way breakdown rendered. */
  corporateNotes?: Stage5Notes | null;
  /** The same BS face maps used by the surrounding component
   *  (nceCyAmounts/ncePyAmounts for NCE; computedAmounts/computedAmountsPY
   *  for Corporate). */
  bsFaceCy:        Record<string, number>;
  bsFacePy:        Record<string, number>;
  /** Phase 4 — COA Mapping line-item totals computed fresh from TB × signed
   *  mapping. When supplied the panel renders the three-way breakdown and
   *  separates "manual adjustment" from "drift". */
  coaTotals?:      Record<string, { cy: number; py: number }>;
  /** Hide the panel entirely (the parent already gates on entity-type +
   *  whether notes data is loaded). */
  visible:         boolean;
  /** PERF: when the parent has already computed the reconciliation result
   *  (e.g. for the export-block gate), pass it here to avoid running the
   *  validator a second time inside the panel. */
  precomputedResult?: import("@/lib/fsReconciliation").ReconResult | null;
}

function fmtINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  return sign + abs.toLocaleString("en-IN");
}

export default function FsHealthPanel({ nceNotesByType, corporateNotes, bsFaceCy, bsFacePy, coaTotals, visible, precomputedResult }: Props) {
  const [open, setOpen] = useState(false);

  // PERF: reuse the parent's pre-computed result when available. This
  // eliminates the biggest performance bottleneck — running the full
  // validator twice per render cycle (once in the parent for the export-
  // block gate, once here for display).
  const computed = useMemo(() => {
    if (!visible) return null;
    if (precomputedResult) return precomputedResult;
    // Fallback: compute locally when no pre-computed result is available
    // (e.g. Corporate path or standalone usage).
    if (corporateNotes !== undefined && corporateNotes !== null) {
      return validateCorporateFSReconciliation({
        corporateNotes,
        bsFaceCy,
        bsFacePy,
        coaTotals,
      });
    }
    return validateFSReconciliation({
      nceNotesByType: nceNotesByType ?? {},
      bsFaceCy,
      bsFacePy,
      liabCodes: NCE_LIAB_CODE_SET,
      coaTotals,
    });
  }, [visible, precomputedResult, nceNotesByType, corporateNotes, bsFaceCy, bsFacePy, coaTotals]);
  const result = computed;

  if (!visible || !result) return null;

  const manualCount = result.rows.filter(r => r.status === "manual").length;
  const tone =
    result.severeCount > 0 ? "severe"
  : result.minorCount  > 0 ? "minor"
                           : "ok";

  const total = result.rows.length;
  const okCount = total - result.severeCount - result.minorCount;

  const containerCls =
    tone === "severe"
      ? "border-red-300 bg-red-50/60 text-red-900"
  : tone === "minor"
      ? "border-amber-300 bg-amber-50/60 text-amber-900"
      : "border-emerald-300 bg-emerald-50/60 text-emerald-900";

  const Icon =
    tone === "severe" ? AlertCircle
  : tone === "minor"  ? AlertTriangle
                      : CheckCircle2;

  // Rows worth showing in the expanded table: every drift row + every
  // manual-adjustment row (so auditors can see WHICH heads carry their
  // overrides). Sorted by absolute drift first, then manual size.
  const headlineRows = result.rows
    .filter(r => r.status !== "ok")
    .sort((a, b) => {
      const aWorst = Math.max(Math.abs(a.delta.cy), Math.abs(a.delta.py));
      const bWorst = Math.max(Math.abs(b.delta.cy), Math.abs(b.delta.py));
      if (aWorst !== bWorst) return bWorst - aWorst;
      const aMan = Math.max(Math.abs(a.manualDelta.cy), Math.abs(a.manualDelta.py));
      const bMan = Math.max(Math.abs(b.manualDelta.cy), Math.abs(b.manualDelta.py));
      return bMan - aMan;
    });

  const rowTone = (r: ReconRow): string => {
    switch (r.status) {
      case "drift_severe": return "text-red-700 font-medium";
      case "drift_minor":  return "text-amber-700";
      case "manual":       return "text-amber-700";
      default:             return "";
    }
  };

  return (
    <div className={`rounded-md border px-3.5 py-2.5 mb-3 ${containerCls}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 shrink-0" />
          {tone === "ok" && manualCount === 0 && (
            <span>FS Health: {okCount}/{total} notes reconcile · COA, Notes and BS face all agree</span>
          )}
          {tone === "ok" && manualCount > 0 && (
            <span>
              FS Health: {okCount - manualCount}/{total} reconcile cleanly ·{" "}
              <span className="text-amber-700">
                {manualCount} with manual adjustment{manualCount === 1 ? "" : "s"}
              </span>{" "}
              (legitimate audit additions)
            </span>
          )}
          {tone === "minor" && (
            <span>FS Health: {result.minorCount} note{result.minorCount === 1 ? "" : "s"} with minor drift (≤ ₹100) — rounding only, safe to ignore</span>
          )}
          {tone === "severe" && (
            <span>FS Health: {result.severeCount} note{result.severeCount === 1 ? "" : "s"} have drift &gt; ₹100 — totals do NOT agree</span>
          )}
        </div>
        {headlineRows.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-xs underline-offset-2 hover:underline flex items-center gap-1"
          >
            {open ? "Hide" : "Show"} breakdown
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      {open && headlineRows.length > 0 && (
        <div className="mt-2 text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide opacity-70 border-b border-current/30">
                <th rowSpan={2} className="py-1 pr-2 font-medium align-bottom">Note</th>
                <th colSpan={4} className="py-1 px-2 font-medium text-center border-b border-current/20">CY</th>
                <th colSpan={4} className="py-1 px-2 font-medium text-center border-b border-current/20">PY</th>
                <th rowSpan={2} className="py-1 pr-2 font-medium align-bottom text-center">Status</th>
              </tr>
              <tr className="text-left text-[10px] uppercase tracking-wide opacity-70 border-b border-current/30">
                <th className="py-1 pr-2 font-medium text-right">COA</th>
                <th className="py-1 pr-2 font-medium text-right">Manual</th>
                <th className="py-1 pr-2 font-medium text-right">Note</th>
                <th className="py-1 pr-2 font-medium text-right">Face</th>
                <th className="py-1 pr-2 font-medium text-right">COA</th>
                <th className="py-1 pr-2 font-medium text-right">Manual</th>
                <th className="py-1 pr-2 font-medium text-right">Note</th>
                <th className="py-1 pr-2 font-medium text-right">Face</th>
              </tr>
            </thead>
            <tbody>
              {headlineRows.map(r => (
                <tr key={`${r.code}-${r.col ?? ""}`} className="border-b border-current/10 last:border-0">
                  <td className="py-1 pr-2">
                    {r.label}
                    {r.col && <span className="text-[10px] opacity-70 ml-1">({r.col.toUpperCase()})</span>}
                  </td>
                  {/* CY columns */}
                  <td className="py-1 pr-2 text-right tabular-nums opacity-80">{fmtINR(r.coaTotal.cy)}</td>
                  <td className={`py-1 pr-2 text-right tabular-nums ${Math.abs(r.manualDelta.cy) > 1 ? "text-amber-700 font-medium" : "opacity-50"}`}>
                    {Math.abs(r.manualDelta.cy) > 1 ? (r.manualDelta.cy > 0 ? "+" : "") + fmtINR(r.manualDelta.cy) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtINR(r.noteTotal.cy)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums opacity-80">{fmtINR(r.bsFace.cy)}</td>
                  {/* PY columns */}
                  <td className="py-1 pr-2 text-right tabular-nums opacity-80">{fmtINR(r.coaTotal.py)}</td>
                  <td className={`py-1 pr-2 text-right tabular-nums ${Math.abs(r.manualDelta.py) > 1 ? "text-amber-700 font-medium" : "opacity-50"}`}>
                    {Math.abs(r.manualDelta.py) > 1 ? (r.manualDelta.py > 0 ? "+" : "") + fmtINR(r.manualDelta.py) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtINR(r.noteTotal.py)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums opacity-80">{fmtINR(r.bsFace.py)}</td>
                  <td className={`py-1 pr-2 text-center text-[10px] ${rowTone(r)}`}>
                    {r.status === "drift_severe" && <span>drift</span>}
                    {r.status === "drift_minor"  && <span>minor</span>}
                    {r.status === "manual"       && (
                      <span title="Auditor added manual rows on top of COA total — kept as legitimate audit adjustment.">
                        manual adj.
                      </span>
                    )}
                    {r.status === "ok"           && <span>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-start gap-1.5 text-[10px] opacity-80 leading-relaxed">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              <strong>COA</strong> = signed TB × current COA mapping (the source of truth).{" "}
              <strong>Manual</strong> = Note − COA. Positive Manual values are
              legitimate audit adjustments (e.g. provisions, SCN demand) the auditor
              has added inside the Note; they should NOT be removed.{" "}
              <strong>Note</strong> = the underlying note's grand total.{" "}
              <strong>Face</strong> = what the BS / P&amp;L stat card displays.{" "}
              Any drift between Note and Face is a code-path bug — Re-correct from
              COA mapping to clear it.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
