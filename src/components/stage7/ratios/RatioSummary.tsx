/**
 * RatioSummary — Sub-tab 1 "Ratio"
 *
 * Summary table matching Excel sheet 1 layout:
 *   NO | PARTICULARS | NUMERATOR/DENOMINATOR | Amount(Rs.) | CY | PY | Variance
 *
 * Each ratio: 2 data rows (num/den) + 1 Text commentary row.
 * Variance >±25% highlighted amber (increase) / red (decrease).
 */

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeAllRatios, computeVariance, type RatioResult } from "@/lib/ratioEngine";
import { type Stage7Ratios, type CustomRatio } from "@/lib/ratioAutoPopulate";
import { getNoteNo } from "@/lib/noteNumberRegistry";
import { formatIndian } from "./RatioInput";

// ── FY helpers ──────────────────────────────────────────────────────────────

function fyLabel(fy: string, prefix: "Current Year" | "Previous Year"): string {
  if (!fy) return prefix;
  return `${prefix} ${fy}`;
}

function prevFY(fy: string): string {
  const parts = fy.split("-");
  if (parts.length !== 2) return fy;
  const startY = parseInt(parts[0], 10);
  const endRaw = parts[1];
  const prevStart = startY - 1;
  const prevEnd   = endRaw.length === 2
    ? String(prevStart + 1).slice(-2)
    : String(prevStart + 1);
  return `${prevStart}-${prevEnd}`;
}

// ── Variance utils ───────────────────────────────────────────────────────────

function parseVarPct(cy: number | null, py: number | null): number | null {
  if (cy == null || py == null || py === 0) return null;
  return ((cy - py) / Math.abs(py)) * 100;
}

function varClass(cy: number | null, py: number | null): string {
  const pct = parseVarPct(cy, py);
  if (pct == null) return "";
  if (pct >  25) return "bg-amber-100 text-amber-800 font-semibold";
  if (pct < -25) return "bg-red-100   text-red-800   font-semibold";
  return "";
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  ratios: Stage7Ratios;
  fy:     string;   // e.g. "2025-26"
  onCommentaryChange: (ratioId: number, text: string) => void;
  onCustomRatioChange: (id: string, changes: Partial<CustomRatio>) => void;
  onCustomRatioCommentaryChange: (id: string, text: string) => void;
  onAddCustomRatio: () => void;
  onDeleteCustomRatio: (id: string) => void;
}

const TH = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cn(
    "border border-slate-300 bg-slate-100 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-700 whitespace-nowrap",
    className,
  )}>
    {children}
  </th>
);

const TD = ({ children, className, colSpan, rowSpan }: {
  children?: React.ReactNode;
  className?: string;
  colSpan?:  number;
  rowSpan?:  number;
}) => (
  <td
    colSpan={colSpan}
    rowSpan={rowSpan}
    className={cn(
      "border border-slate-200 px-2 py-1 text-[11px] text-slate-800 align-middle",
      className,
    )}
  >
    {children}
  </td>
);

export function RatioSummary({
  ratios, fy, onCommentaryChange,
  onCustomRatioCommentaryChange, onAddCustomRatio, onDeleteCustomRatio,
}: Props) {
  const noteNo = getNoteNo("ratios") ?? 31;
  const cyResults: RatioResult[] = useMemo(() => computeAllRatios(ratios.cy), [ratios.cy]);
  const pyResults: RatioResult[] = useMemo(() => computeAllRatios(ratios.py), [ratios.py]);

  const cyLabel = fyLabel(fy,       "Current Year");
  const pyLabel = fyLabel(prevFY(fy), "Previous Year");

  return (
    <div className="overflow-auto rounded-md border border-slate-300 shadow-sm">
      {/* Title */}
      <div className="bg-slate-50 px-4 py-2 text-center">
        <p className="text-sm font-bold tracking-widest text-slate-700 uppercase">
          NOTE - {noteNo} : RATIO
        </p>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <TH className="w-8">NO</TH>
            <TH className="w-40">PARTICULARS</TH>
            <TH className="w-48">NUMERATOR / DENOMINATOR</TH>
            <TH className="w-28 text-right">Amount (Rs.)</TH>
            <TH className="w-24">{cyLabel}</TH>
            <TH className="w-24">{pyLabel}</TH>
            <TH className="w-24">Variance</TH>
          </tr>
        </thead>

        <tbody>
          {cyResults.map((cyR, idx) => {
            const pyR      = pyResults[idx];
            const varStr   = computeVariance(cyR.computed, pyR.computed);
            const varCls   = varClass(cyR.computed, pyR.computed);
            const cmt      = ratios.commentary.find(c => c.ratioId === cyR.id)?.text ?? "";

            return (
              <>
                {/* Numerator row */}
                <tr key={`${cyR.id}-num`} className="even:bg-slate-50/40">
                  <TD rowSpan={2} className="text-center font-semibold">{cyR.id}</TD>
                  <TD rowSpan={2} className="font-medium">{cyR.name}</TD>
                  <TD className="text-slate-600">{cyR.numerator.label}</TD>
                  <TD className="text-right font-mono tabular-nums">
                    {formatIndian(cyR.numerator.value)}
                  </TD>
                  <TD rowSpan={2} className={cn("text-center font-semibold", cyR.computed == null && "text-slate-400")}>
                    {cyR.display}
                  </TD>
                  <TD rowSpan={2} className={cn("text-center font-semibold", pyR.computed == null && "text-slate-400")}>
                    {pyR.display}
                  </TD>
                  <TD rowSpan={2} className={cn("text-center", varCls)}>
                    {varStr}
                  </TD>
                </tr>

                {/* Denominator row */}
                <tr key={`${cyR.id}-den`} className="even:bg-slate-50/40">
                  <TD className="text-slate-600 border-t border-slate-200">{cyR.denominator.label}</TD>
                  <TD className="text-right font-mono tabular-nums border-t border-slate-200">
                    {formatIndian(cyR.denominator.value)}
                  </TD>
                </tr>

                {/* Commentary / Text row */}
                <tr key={`${cyR.id}-text`} className="bg-slate-50/60">
                  <TD colSpan={7} className="py-1.5">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-500 mt-1">
                        Text:
                      </span>
                      <textarea
                        value={cmt}
                        onChange={(e) => onCommentaryChange(cyR.id, e.target.value)}
                        placeholder="Add commentary on movement…"
                        rows={2}
                        className={cn(
                          "flex-1 resize-none rounded border border-slate-200 bg-white px-2 py-1",
                          "text-xs text-slate-700 placeholder-slate-400",
                          "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30",
                        )}
                      />
                    </div>
                  </TD>
                </tr>
              </>
            );
          })}
          {/* ── Custom ratios ─────────────────────────────────────────────── */}
          {(ratios.custom_ratios ?? []).map((cr, idx) => {
            const no = 11 + idx + 1;
            const cyNum = cr.cy.numerator;
            const cyDen = cr.cy.denominator;
            const pyNum = cr.py.numerator;
            const pyDen = cr.py.denominator;
            const calcRatio = (n: number | null, d: number | null) =>
              n != null && d != null && d !== 0
                ? cr.unit === "%" ? (n / d) * 100 : n / d
                : null;
            const cyComp = calcRatio(cyNum, cyDen);
            const pyComp = calcRatio(pyNum, pyDen);
            const cyDisp = cyComp == null ? "N.A." : cr.unit === "%" ? `${cyComp.toFixed(2)}%` : `${cyComp.toFixed(2)} Times`;
            const pyDisp = pyComp == null ? "N.A." : cr.unit === "%" ? `${pyComp.toFixed(2)}%` : `${pyComp.toFixed(2)} Times`;
            const varStr = computeVariance(cyComp, pyComp);
            const varCls = varClass(cyComp, pyComp);
            return (
              <>
                {/* Numerator row */}
                <tr key={`cr-${cr.id}-num`} className="even:bg-slate-50/40">
                  <TD rowSpan={2} className="text-center font-semibold">
                    <div className="flex flex-col items-center gap-1">
                      <span>{no}</span>
                      <button
                        onClick={() => onDeleteCustomRatio(cr.id)}
                        title="Delete ratio"
                        className="text-[9px] text-red-400 hover:text-red-600 leading-none"
                      >✕</button>
                    </div>
                  </TD>
                  <TD rowSpan={2} className="font-medium">{cr.name}</TD>
                  <TD className="text-slate-600">{cr.numeratorLabel}</TD>
                  <TD className="text-right font-mono tabular-nums">{formatIndian(cyNum)}</TD>
                  <TD rowSpan={2} className={cn("text-center font-semibold", cyComp == null && "text-slate-400")}>{cyDisp}</TD>
                  <TD rowSpan={2} className={cn("text-center font-semibold", pyComp == null && "text-slate-400")}>{pyDisp}</TD>
                  <TD rowSpan={2} className={cn("text-center", varCls)}>{varStr}</TD>
                </tr>
                {/* Denominator row */}
                <tr key={`cr-${cr.id}-den`} className="even:bg-slate-50/40">
                  <TD className="text-slate-600">{cr.denominatorLabel}</TD>
                  <TD className="text-right font-mono tabular-nums">{formatIndian(cyDen)}</TD>
                </tr>
                {/* Commentary row */}
                <tr key={`cr-${cr.id}-cmt`} className="bg-slate-50/60">
                  <TD colSpan={7} className="py-1.5">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-500 mt-1">Text:</span>
                      <textarea
                        value={cr.commentary}
                        onChange={(e) => onCustomRatioCommentaryChange(cr.id, e.target.value)}
                        placeholder="Add commentary on movement…"
                        rows={2}
                        className={cn(
                          "flex-1 resize-none rounded border border-slate-200 bg-white px-2 py-1",
                          "text-xs text-slate-700 placeholder-slate-400",
                          "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30",
                        )}
                      />
                    </div>
                  </TD>
                </tr>
              </>
            );
          })}
          {/* Add custom ratio button */}
          <tr>
            <td colSpan={7} className="py-2 px-4 border-t-2 border-slate-300">
              <button
                onClick={onAddCustomRatio}
                className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/70 font-medium"
              >
                <Plus className="h-3 w-3" /> Add Custom Ratio
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
