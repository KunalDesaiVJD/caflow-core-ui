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
import { cn } from "@/lib/utils";
import { computeAllRatios, computeVariance, type RatioResult } from "@/lib/ratioEngine";
import { type Stage7Ratios } from "@/lib/ratioAutoPopulate";
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
    ? String(prevStart).slice(-2)
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

export function RatioSummary({ ratios, fy, onCommentaryChange }: Props) {
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
        </tbody>
      </table>
    </div>
  );
}
