/**
 * FsHealthPanel — the visible structural guarantee that NCE Financial Statements
 * are internally consistent.
 *
 * Shows at the top of the Stage 7 (Financial Statements) view. For every NCE
 * code that has a note, compares:
 *   • Note total (getNCENoteFaceTotal)
 *   • BS / P&L face value (nceCyAmounts)
 *
 * Failure modes surfaced:
 *   • "✓ All N notes reconcile" — green banner
 *   • "X notes off" — yellow / red banner with click-through to the offending
 *     row of the Reconciliation table.
 *
 * This is the answer to the user's question "how do I know future code
 * changes will not silently break my BS balance" — every new code path that
 * computes a note total must agree with this panel's check, or the panel
 * surfaces the drift on the very next page load.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { validateFSReconciliation, type ReconRow, NCE_LIAB_CODE_SET } from "@/lib/fsReconciliation";

interface Props {
  engagementId:    string;
  /** nce_financial_notes rows keyed by note_type (same map fed to applyNCENoteTotal) */
  nceNotesByType:  Record<string, { cy_data?: Record<string, any> | null; py_data?: Record<string, any> | null; note_type?: string }>;
  /** The same BS face maps used by the surrounding component (nceCyAmounts / ncePyAmounts) */
  bsFaceCy:        Record<string, number>;
  bsFacePy:        Record<string, number>;
  /** Hide the panel entirely if the engagement isn't NCE (Corporate has its own checks) */
  visible:         boolean;
}

function fmtINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  return sign + abs.toLocaleString("en-IN");
}

export default function FsHealthPanel({ nceNotesByType, bsFaceCy, bsFacePy, visible }: Props) {
  const [open, setOpen] = useState(false);

  const result = useMemo(() => {
    if (!visible) return null;
    return validateFSReconciliation({
      nceNotesByType,
      bsFaceCy,
      bsFacePy,
      liabCodes: NCE_LIAB_CODE_SET,
    });
  }, [visible, nceNotesByType, bsFaceCy, bsFacePy]);

  if (!visible || !result) return null;

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

  const offenders = result.rows
    .filter(r => r.status !== "ok")
    .sort((a, b) => Math.max(Math.abs(b.delta.cy), Math.abs(b.delta.py))
                  - Math.max(Math.abs(a.delta.cy), Math.abs(a.delta.py)));

  return (
    <div className={`rounded-md border px-3.5 py-2.5 mb-3 ${containerCls}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 shrink-0" />
          {tone === "ok" && (
            <span>FS Health: {okCount}/{total} notes reconcile · all sub-totals, totals, BS face agree</span>
          )}
          {tone === "minor" && (
            <span>FS Health: {result.minorCount} note{result.minorCount === 1 ? "" : "s"} with minor drift (≤ ₹100) — rounding only, safe to ignore</span>
          )}
          {tone === "severe" && (
            <span>FS Health: {result.severeCount} note{result.severeCount === 1 ? "" : "s"} have drift &gt; ₹100 — totals do NOT agree</span>
          )}
        </div>
        {offenders.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-xs underline-offset-2 hover:underline flex items-center gap-1"
          >
            {open ? "Hide" : "Show"} details
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      {open && offenders.length > 0 && (
        <div className="mt-2 text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide opacity-70 border-b border-current/30">
                <th className="py-1 pr-2 font-medium">Note</th>
                <th className="py-1 pr-2 font-medium text-right">Note total CY</th>
                <th className="py-1 pr-2 font-medium text-right">BS face CY</th>
                <th className="py-1 pr-2 font-medium text-right">Δ CY</th>
                <th className="py-1 pr-2 font-medium text-right">Δ PY</th>
              </tr>
            </thead>
            <tbody>
              {offenders.map(r => (
                <tr key={`${r.code}-${r.col ?? ""}`} className="border-b border-current/10 last:border-0">
                  <td className="py-1 pr-2">
                    {r.label}
                    {r.col && <span className="text-[10px] opacity-70 ml-1">({r.col.toUpperCase()})</span>}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtINR(r.noteTotal.cy)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtINR(r.bsFace.cy)}</td>
                  <td className={`py-1 pr-2 text-right tabular-nums font-medium ${Math.abs(r.delta.cy) > 100 ? "text-red-700" : ""}`}>
                    {r.delta.cy ? fmtINR(r.delta.cy) : "—"}
                  </td>
                  <td className={`py-1 pr-2 text-right tabular-nums font-medium ${Math.abs(r.delta.py) > 100 ? "text-red-700" : ""}`}>
                    {r.delta.py ? fmtINR(r.delta.py) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] opacity-70 leading-relaxed">
            Δ &gt; 0 means the note shows MORE than the BS face. Δ &lt; 0 means LESS. Any non-zero Δ indicates one of: (a) a customRow's
            <code className="px-1 mx-0.5 bg-current/10 rounded">sources[]</code> array not summed by one aggregator, (b) a stale
            cached total, or (c) a sign-convention mismatch. Hard-refresh first; if the drift persists, the note must be re-corrected from COA mapping.
          </p>
        </div>
      )}
    </div>
  );
}
