/**
 * RatioPreviousYear — Sub-tab 3 "Previous Year"
 *
 * Identical table structure to RatioCurrentYear but bound to ratios.py.
 * All cells are manually editable — no auto-link badges (PY data is never
 * auto-populated from the current engagement's trial balance).
 *
 * Pre-populates from the prior engagement's stage7_ratios.cy when available
 * (handled upstream in autoPopulateRatios → py inputs).
 */

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeAllRatios, type RatioInputs } from "@/lib/ratioEngine";
import { AUTO_LINK_MAP } from "@/lib/ratioEngine";
import { type Stage7Ratios, type CustomRatio } from "@/lib/ratioAutoPopulate";
import { RatioInput, formatIndian } from "./RatioInput";

// PY values come from the prior engagement's fa_financial_statements (or its
// PY-shell TB) via autoPopulateRatios → buildPYInputsFromFs. The same set of
// keys that auto-link on the CY side also auto-link on PY — only the year
// origin differs. Surface that origin in the click-to-trace popover so the
// auditor can verify any PY auto value against last year's FS.
const AUTO_KEYS = new Set(AUTO_LINK_MAP.map(e => e.key));
const AUTO_SOURCE_LABEL_PY: Record<string, string> = Object.fromEntries(
  AUTO_LINK_MAP.map(e => [
    e.key,
    e.label.replace(/\(CY\)/, "(PY — prior engagement FS)"),
  ]),
);

// ── Types ────────────────────────────────────────────────────────────────────

type Field = keyof RatioInputs;

interface InputLine {
  label:  string;
  field:  Field | null;
  sumOf?: Field[];
  bold?:  boolean;
}

interface RatioRowDef {
  id:        number;
  name:      string;
  numLines:  InputLine[];
  denLines:  InputLine[];
  footnote?: string;
}

// ── Ratio definitions — identical to RatioCurrentYear ────────────────────────

const RATIO_DEFS: RatioRowDef[] = [
  {
    id: 1, name: "CURRENT RATIO",
    numLines: [{ label: "Total Current Assets",      field: "current_assets" }],
    denLines: [{ label: "Total Current Liabilities", field: "current_liabilities" }],
  },
  {
    id: 2, name: "DEBT-EQUITY RATIO",
    numLines: [{ label: "Total Debt",                field: "total_debt" }],
    denLines: [{ label: "Shareholder's Equity",      field: "shareholders_equity" }],
  },
  {
    id: 3, name: "DEBT SERVICE COVERAGE RATIO",
    numLines: [
      // Mirrors CY definition (2026-06-18): NPBT-based numerator so CY/PY use
      // the same formula and the ratio comparison is meaningful.
      { label: "Net Profit Before Taxes",   field: "npbt" },
      { label: "Non Cash Operating Exp",    field: "non_cash_op_exp" },
      { label: "Interest",                  field: "interest" },
      { label: "Other Non Cash Adjustment", field: "other_non_cash_adj" },
      { label: "TOTAL", field: null, bold: true,
        sumOf: ["npbt", "non_cash_op_exp", "interest", "other_non_cash_adj"] },
    ],
    denLines: [
      { label: "Interest & Lease Payment",  field: "interest_lease" },
      { label: "Principal Repayments",      field: "principal_repayments" },
      { label: "TOTAL", field: null, bold: true,
        sumOf: ["interest_lease", "principal_repayments"] },
    ],
  },
  {
    id: 4, name: "RETURN ON EQUITY RATIO",
    numLines: [{ label: "Net Profit After Tax",        field: "npat" }],
    denLines: [{ label: "Average Shareholders Equity", field: "avg_shareholders_equity" }],
  },
  {
    id: 5, name: "INVENTORY TURNOVER RATIO",
    numLines: [{ label: "Cost Of Goods Sold (Revenue from Ops)", field: "revenue_ops" }],
    denLines: [{ label: "Average Inventories",                   field: "avg_inventories" }],
  },
  {
    id: 6, name: "TRADE RECEIVABLES TURNOVER RATIO",
    numLines: [{ label: "Revenue from Operations",   field: "revenue_ops" }],
    denLines: [{ label: "Average Trade Receivables", field: "avg_trade_receivables" }],
  },
  {
    id: 7, name: "TRADE PAYABLE TURNOVER RATIO",
    numLines: [{ label: "Net Credit Purchases",   field: "net_credit_purchases" }],
    denLines: [{ label: "Average Trade Payables", field: "avg_trade_payables" }],
    footnote: ">> Net Credit Purchase will include both RM Purchase and Stock-in trade purchase",
  },
  {
    id: 8, name: "NET CAPITAL TURNOVER RATIO",
    numLines: [{ label: "Revenue from Operations", field: "revenue_ops" }],
    denLines: [{ label: "Working Capital",         field: "working_capital" }],
  },
  {
    id: 9, name: "NET PROFIT RATIO",
    numLines: [{ label: "Net Profit After Tax",    field: "npat" }],
    denLines: [{ label: "Revenue from Operations", field: "revenue_ops" }],
  },
  {
    id: 10, name: "RETURN ON CAPITAL EMPLOYED",
    numLines: [
      { label: "Net Profit Before Tax", field: "npbt" },
      { label: "Interest",              field: "interest" },
      { label: "TOTAL", field: null, bold: true, sumOf: ["npbt", "interest"] },
    ],
    denLines: [
      // Mirrors CY definition (2026-06-18): Capital Employed includes Deferred
      // Tax Liabilities on the PY side too so CY/PY comparison is consistent.
      { label: "Net Worth",                field: "net_worth" },
      { label: "Long-Term Borrowings",     field: "lt_borrowings" },
      { label: "Deferred Tax Liabilities", field: "deferred_tax_liabilities" },
      { label: "TOTAL", field: null, bold: true,
        sumOf: ["net_worth", "lt_borrowings", "deferred_tax_liabilities"] },
    ],
  },
  {
    id: 11, name: "RETURN ON INVESTMENT",
    numLines: [{ label: "Return / Profit / Earning", field: "return_profit" }],
    denLines: [{ label: "Average Investment Fund",   field: "avg_investment_fund" }],
    footnote: "Opening + Closing Investments / 2",
  },
];

// ── Helper ───────────────────────────────────────────────────────────────────

function sumFields(inputs: RatioInputs, fields?: Field[]): number | null {
  if (!fields || fields.length === 0) return null;
  let total = 0;
  let hasValue = false;
  for (const f of fields) {
    const v = inputs[f];
    if (v != null) { total += v as number; hasValue = true; }
  }
  return hasValue ? Math.round(total * 100) / 100 : null;
}

// ── Cell wrappers ─────────────────────────────────────────────────────────────

const TH = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cn(
    "border border-slate-300 bg-slate-100 px-2 py-1 text-center text-[10px] font-bold",
    "uppercase tracking-wide text-slate-700 whitespace-nowrap",
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
      "border border-slate-200 px-2 py-0.5 text-[11px] text-slate-800 align-middle",
      className,
    )}
  >
    {children}
  </td>
);

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  ratios:               Stage7Ratios;
  fy:                   string;   // CY FY string, e.g. "2025-26" — PY derived from it
  onFieldChange:        (field: Field, value: number | null) => void;
  onCustomRatioChange:  (id: string, changes: Partial<CustomRatio>) => void;
  onAddCustomRatio:     () => void;
  onDeleteCustomRatio:  (id: string) => void;
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

export function RatioPreviousYear({
  ratios, fy, onFieldChange,
  onCustomRatioChange, onAddCustomRatio, onDeleteCustomRatio,
}: Props) {
  const inputs  = ratios.py;
  const results = useMemo(() => computeAllRatios(inputs), [inputs]);
  const pyFY    = prevFY(fy);
  const yearLabel = pyFY ? `PY ${pyFY}` : "Previous Year";

  // PY-side manual overrides: prefixed "py." in the saved override list. Same
  // contract as the CY tab so reset / source-label behaviour stays consistent.
  const overrides = new Set(
    ratios.manual_overrides
      .filter(p => p.startsWith("py."))
      .map(p => p.slice(3)),
  );

  return (
    <div className="overflow-auto rounded-md border border-slate-300 shadow-sm">
      {/* Title */}
      <div className="bg-slate-50 px-4 py-2 text-center">
        <p className="text-sm font-bold tracking-widest text-slate-700 uppercase">
          ANNEXURE : A ({yearLabel})
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <TH className="w-6">NO</TH>
            <TH className="w-44">PARTICULARS</TH>
            <TH className="w-48">NUMERATOR</TH>
            <TH className="w-28 text-right">Amount (Rs.)</TH>
            <TH className="w-48">DENOMINATOR</TH>
            <TH className="w-28 text-right">Amount (Rs.)</TH>
            <TH className="w-20">Ratio</TH>
          </tr>
        </thead>

        <tbody>
          {RATIO_DEFS.map((def) => {
            const result   = results.find(r => r.id === def.id);
            const bodyRows = Math.max(def.numLines.length, def.denLines.length);
            const rows     = Array.from({ length: bodyRows }, (_, i) => i);

            return (
              <>
                {rows.map((ri) => {
                  const numLine = def.numLines[ri];
                  const denLine = def.denLines[ri];

                  return (
                    <tr key={`${def.id}-row-${ri}`} className="align-middle">
                      {ri === 0 && (
                        <TD rowSpan={bodyRows} className="text-center font-semibold align-middle">
                          {def.id}
                        </TD>
                      )}

                      {ri === 0 && (
                        <TD rowSpan={bodyRows} className="font-medium text-[11px] align-middle">
                          {def.name}
                          {def.footnote && (
                            <p className="mt-1 text-[10px] text-slate-500 italic leading-snug">
                              {def.footnote}
                            </p>
                          )}
                        </TD>
                      )}

                      {/* Numerator */}
                      {numLine ? (
                        numLine.field === null ? (
                          <>
                            <TD className="pl-4 font-bold text-slate-700">{numLine.label}</TD>
                            <TD className="text-right font-mono font-bold tabular-nums text-slate-700">
                              {formatIndian(sumFields(inputs, numLine.sumOf))}
                            </TD>
                          </>
                        ) : (() => {
                          const isAutoKey  = AUTO_KEYS.has(numLine.field);
                          const isOverride = overrides.has(numLine.field);
                          return (
                            <>
                              <TD className={cn("pl-3", numLine.bold && "font-semibold")}>
                                {numLine.label}
                              </TD>
                              <TD className="py-0.5 pr-1">
                                <RatioInput
                                  value={inputs[numLine.field] as number | null}
                                  isAuto={isAutoKey}
                                  isOverridden={isOverride}
                                  sourceLabel={isAutoKey && !isOverride ? AUTO_SOURCE_LABEL_PY[numLine.field as string] : undefined}
                                  onChange={(v) => onFieldChange(numLine.field as Field, v)}
                                />
                              </TD>
                            </>
                          );
                        })()
                      ) : (
                        <><TD /><TD /></>
                      )}

                      {/* Denominator */}
                      {denLine ? (
                        denLine.field === null ? (
                          <>
                            <TD className="pl-4 font-bold text-slate-700">{denLine.label}</TD>
                            <TD className="text-right font-mono font-bold tabular-nums text-slate-700">
                              {formatIndian(sumFields(inputs, denLine.sumOf))}
                            </TD>
                          </>
                        ) : (() => {
                          const isAutoKey  = AUTO_KEYS.has(denLine.field);
                          const isOverride = overrides.has(denLine.field);
                          return (
                            <>
                              <TD className={cn("pl-3", denLine.bold && "font-semibold")}>
                                {denLine.label}
                              </TD>
                              <TD className="py-0.5 pr-1">
                                <RatioInput
                                  value={inputs[denLine.field] as number | null}
                                  isAuto={isAutoKey}
                                  isOverridden={isOverride}
                                  sourceLabel={isAutoKey && !isOverride ? AUTO_SOURCE_LABEL_PY[denLine.field as string] : undefined}
                                  onChange={(v) => onFieldChange(denLine.field as Field, v)}
                                />
                              </TD>
                            </>
                          );
                        })()
                      ) : (
                        <><TD /><TD /></>
                      )}

                      {/* Ratio result */}
                      {ri === 0 && result && (
                        <TD
                          rowSpan={bodyRows}
                          className={cn(
                            "text-center font-semibold align-middle",
                            result.computed == null && "text-slate-400",
                          )}
                        >
                          {result.display}
                        </TD>
                      )}
                    </tr>
                  );
                })}

                <tr key={`${def.id}-sep`} className="h-0">
                  <td colSpan={7} className="border-t-2 border-slate-300 p-0" />
                </tr>
              </>
            );
          })}
          {/* ── Custom ratios (PY values) ──────────────────────────────────── */}
          {(ratios.custom_ratios ?? []).map((cr, idx) => {
            const no = 11 + idx + 1;
            const pyNum = cr.py.numerator;
            const pyDen = cr.py.denominator;
            const computed =
              pyNum != null && pyDen != null && pyDen !== 0
                ? cr.unit === "%" ? (pyNum / pyDen) * 100 : pyNum / pyDen
                : null;
            const display =
              computed == null ? "N.A."
              : cr.unit === "%" ? `${computed.toFixed(2)}%`
              : `${computed.toFixed(2)} Times`;
            return (
              <>
                <tr key={`cr-${cr.id}`}>
                  <td colSpan={7} className="border-t-2 border-slate-300 p-0 h-0" />
                </tr>
                <tr key={`cr-${cr.id}-data`} className="align-middle">
                  <TD className="text-center font-semibold">{no}</TD>
                  {/* Name (read-only in PY sub-tab — edit from CY tab) + delete */}
                  <TD>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium">{cr.name}</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[9px] text-slate-400">
                          {cr.unit === "%" ? "%" : "Times"}
                        </span>
                        <button
                          onClick={() => onDeleteCustomRatio(cr.id)}
                          className="ml-auto text-[9px] text-red-400 hover:text-red-600"
                          title="Delete ratio"
                        >✕ Delete</button>
                      </div>
                    </div>
                  </TD>
                  <TD className="text-slate-600">{cr.numeratorLabel}</TD>
                  <TD className="py-0.5 pr-1">
                    <RatioInput
                      value={pyNum}
                      onChange={(v) => onCustomRatioChange(cr.id, { py: { ...cr.py, numerator: v } })}
                    />
                  </TD>
                  <TD className="text-slate-600">{cr.denominatorLabel}</TD>
                  <TD className="py-0.5 pr-1">
                    <RatioInput
                      value={pyDen}
                      onChange={(v) => onCustomRatioChange(cr.id, { py: { ...cr.py, denominator: v } })}
                    />
                  </TD>
                  <TD className={cn("text-center font-semibold", computed == null && "text-slate-400")}>
                    {display}
                  </TD>
                </tr>
              </>
            );
          })}
          {/* Add custom ratio (same button — keeps CY/PY in sync) */}
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
