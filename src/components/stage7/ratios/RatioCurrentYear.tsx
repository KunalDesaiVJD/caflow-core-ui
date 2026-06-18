/**
 * RatioCurrentYear — Sub-tab 2 "Current Year"
 *
 * Detailed input table for all 11 ratios (CY data).
 * Each ratio renders its numerator and denominator input lines side-by-side.
 * Auto-linked fields show blue "(auto)" badge; manually overridden show amber
 * "× Reset" button. TOTAL rows are computed automatically.
 */

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeAllRatios, type RatioInputs } from "@/lib/ratioEngine";
import { AUTO_LINK_MAP }                       from "@/lib/ratioEngine";
import { type Stage7Ratios, type CustomRatio, markOverride, clearOverride } from "@/lib/ratioAutoPopulate";
import { RatioInput, formatIndian }            from "./RatioInput";

// ── Types ────────────────────────────────────────────────────────────────────

type Field = keyof RatioInputs;

interface InputLine {
  label:   string;
  field:   Field | null;    // null = computed TOTAL row
  sumOf?:  Field[];         // when field===null, sum these
  bold?:   boolean;
}

interface RatioRowDef {
  id:        number;
  name:      string;
  numLines:  InputLine[];
  denLines:  InputLine[];
  footnote?: string;
}

// ── Ratio definitions ────────────────────────────────────────────────────────

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
      // 2026-06-18: Net Profit BEFORE Taxes (npbt). Pulls from P&L "IX. Profit
      // before tax". Previously used `npat` which is never auto-populated.
      { label: "Net Profit Before Taxes",    field: "npbt" },
      { label: "Non Cash Operating Exp",     field: "non_cash_op_exp" },
      { label: "Interest",                   field: "interest" },
      { label: "Other Non Cash Adjustment",  field: "other_non_cash_adj" },
      {
        label: "TOTAL", field: null, bold: true,
        sumOf: ["npbt", "non_cash_op_exp", "interest", "other_non_cash_adj"],
      },
    ],
    denLines: [
      { label: "Interest & Lease Payment",   field: "interest_lease" },
      { label: "Principal Repayments",       field: "principal_repayments" },
      {
        label: "TOTAL", field: null, bold: true,
        sumOf: ["interest_lease", "principal_repayments"],
      },
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
    numLines: [{ label: "Revenue from Operations",    field: "revenue_ops" }],
    denLines: [{ label: "Average Trade Receivables",  field: "avg_trade_receivables" }],
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
    numLines: [{ label: "Net Profit After Tax",      field: "npat" }],
    denLines: [{ label: "Revenue from Operations",   field: "revenue_ops" }],
  },
  {
    id: 10, name: "RETURN ON CAPITAL EMPLOYED",
    numLines: [
      { label: "Net Profit Before Tax", field: "npbt" },
      { label: "Interest",              field: "interest" },
      { label: "TOTAL",                 field: null, bold: true, sumOf: ["npbt", "interest"] },
    ],
    denLines: [
      // 2026-06-18 — Capital Employed must include Deferred Tax Liabilities
      // alongside Net Worth and Long-Term Borrowings. All three are stable
      // long-term sources of funds employed by the business.
      { label: "Net Worth",                field: "net_worth" },
      { label: "Long-Term Borrowings",     field: "lt_borrowings" },
      { label: "Deferred Tax Liabilities", field: "deferred_tax_liabilities" },
      {
        label: "TOTAL", field: null, bold: true,
        sumOf: ["net_worth", "lt_borrowings", "deferred_tax_liabilities"],
      },
    ],
  },
  {
    id: 11, name: "RETURN ON INVESTMENT",
    numLines: [{ label: "Return / Profit / Earning", field: "return_profit" }],
    denLines: [{ label: "Average Investment Fund",   field: "avg_investment_fund" }],
    footnote: "Opening + Closing Investments / 2",
  },
];

// Set of auto-linkable keys for quick lookup
const AUTO_KEYS = new Set(AUTO_LINK_MAP.map(e => e.key));

// Map from RatioInputs key → human-readable source description, surfaced in
// the popover that opens when the auditor clicks the "auto" badge.
const AUTO_SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  AUTO_LINK_MAP.map(e => [e.key, e.label]),
);

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

// ── Cell components ──────────────────────────────────────────────────────────

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

// ── Main Component ───────────────────────────────────────────────────────────

interface Props {
  ratios:               Stage7Ratios;
  fy:                   string;
  onFieldChange:        (field: Field, value: number | null) => void;
  onOverrideReset:      (field: Field) => void;
  onCustomRatioChange:  (id: string, changes: Partial<CustomRatio>) => void;
  onAddCustomRatio:     () => void;
  onDeleteCustomRatio:  (id: string) => void;
}

export function RatioCurrentYear({
  ratios, fy, onFieldChange, onOverrideReset,
  onCustomRatioChange, onAddCustomRatio, onDeleteCustomRatio,
}: Props) {
  const inputs    = ratios.cy;
  const overrides = new Set(
    ratios.manual_overrides
      .filter(p => p.startsWith("cy."))
      .map(p => p.slice(3)),
  );

  const results = useMemo(() => computeAllRatios(inputs), [inputs]);

  // Derive display year range from FY
  const yearLabel = fy ? `CY ${fy}` : "Current Year";

  // Render a single input line
  const renderLine = (line: InputLine, idx: number) => {
    if (line.field === null) {
      // TOTAL (computed) row
      const total = sumFields(inputs, line.sumOf);
      return (
        <tr key={`sum-${idx}`} className="bg-slate-100">
          <TD className="pl-4 font-bold text-slate-700">{line.label}</TD>
          <TD className="text-right font-mono font-bold tabular-nums text-slate-700">
            {formatIndian(total)}
          </TD>
        </tr>
      );
    }

    const val        = inputs[line.field] as number | null;
    const isAutoKey  = AUTO_KEYS.has(line.field);
    const isOverride = overrides.has(line.field);
    const isAuto     = isAutoKey && !isOverride;

    return (
      <tr key={`line-${line.field}-${idx}`} className="even:bg-slate-50/30">
        <TD className={cn("pl-3", line.bold && "font-semibold")}>{line.label}</TD>
        <TD className="w-32 py-0.5 pr-1">
          <RatioInput
            value={val}
            isAuto={isAutoKey}
            isOverridden={isOverride}
            sourceLabel={isAuto ? AUTO_SOURCE_LABEL[line.field as string] : undefined}
            onChange={(v) => {
              onFieldChange(line.field as Field, v);
            }}
            onReset={isAutoKey ? () => onOverrideReset(line.field as Field) : undefined}
          />
        </TD>
      </tr>
    );
  };

  return (
    <div className="overflow-auto rounded-md border border-slate-300 shadow-sm">
      {/* Title */}
      <div className="bg-slate-50 px-4 py-2 text-center">
        <p className="text-sm font-bold tracking-widest text-slate-700 uppercase">
          ANNEXURE : A ({yearLabel})
        </p>
      </div>

      {/* Legend */}
      <div className="flex gap-4 px-4 py-1.5 text-[10px] border-b border-slate-200 bg-white">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-blue-100 ring-1 ring-blue-300" />
          Auto-linked from BS/P&amp;L
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-300" />
          Manually overridden
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-slate-100 ring-1 ring-slate-300" />
          Manual entry required
        </span>
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
            const result     = results.find(r => r.id === def.id);
            const numRows    = def.numLines.length;
            const denRows    = def.denLines.length;
            const bodyRows   = Math.max(numRows, denRows);
            const rows       = Array.from({ length: bodyRows }, (_, i) => i);

            return (
              <>
                {rows.map((ri) => {
                  const numLine = def.numLines[ri];
                  const denLine = def.denLines[ri];

                  return (
                    <tr key={`${def.id}-row-${ri}`} className="align-middle">
                      {/* NO column – only on first row */}
                      {ri === 0 && (
                        <TD
                          rowSpan={bodyRows}
                          className="text-center font-semibold align-middle"
                        >
                          {def.id}
                        </TD>
                      )}

                      {/* PARTICULARS – only on first row */}
                      {ri === 0 && (
                        <TD
                          rowSpan={bodyRows}
                          className="font-medium text-[11px] align-middle"
                        >
                          {def.name}
                          {def.footnote && (
                            <p className="mt-1 text-[10px] text-slate-500 italic leading-snug">
                              {def.footnote}
                            </p>
                          )}
                        </TD>
                      )}

                      {/* Numerator line */}
                      {numLine ? (
                        numLine.field === null ? (
                          // TOTAL row for numerator
                          <>
                            <TD className="pl-4 font-bold text-slate-700">{numLine.label}</TD>
                            <TD className="text-right font-mono font-bold tabular-nums text-slate-700">
                              {formatIndian(sumFields(inputs, numLine.sumOf))}
                            </TD>
                          </>
                        ) : (() => {
                          const val        = inputs[numLine.field] as number | null;
                          const isAutoKey  = AUTO_KEYS.has(numLine.field);
                          const isOverride = overrides.has(numLine.field);
                          return (
                            <>
                              <TD className={cn("pl-3", numLine.bold && "font-semibold")}>
                                {numLine.label}
                              </TD>
                              <TD className="py-0.5 pr-1">
                                <RatioInput
                                  value={val}
                                  isAuto={isAutoKey}
                                  isOverridden={isOverride}
                                  sourceLabel={isAutoKey && !isOverride ? AUTO_SOURCE_LABEL[numLine.field as string] : undefined}
                                  onChange={(v) => onFieldChange(numLine.field as Field, v)}
                                  onReset={isAutoKey ? () => onOverrideReset(numLine.field as Field) : undefined}
                                />
                              </TD>
                            </>
                          );
                        })()
                      ) : (
                        <><TD /><TD /></>
                      )}

                      {/* Denominator line */}
                      {denLine ? (
                        denLine.field === null ? (
                          <>
                            <TD className="pl-4 font-bold text-slate-700">{denLine.label}</TD>
                            <TD className="text-right font-mono font-bold tabular-nums text-slate-700">
                              {formatIndian(sumFields(inputs, denLine.sumOf))}
                            </TD>
                          </>
                        ) : (() => {
                          const val        = inputs[denLine.field] as number | null;
                          const isAutoKey  = AUTO_KEYS.has(denLine.field);
                          const isOverride = overrides.has(denLine.field);
                          return (
                            <>
                              <TD className={cn("pl-3", denLine.bold && "font-semibold")}>
                                {denLine.label}
                              </TD>
                              <TD className="py-0.5 pr-1">
                                <RatioInput
                                  value={val}
                                  isAuto={isAutoKey}
                                  isOverridden={isOverride}
                                  sourceLabel={isAutoKey && !isOverride ? AUTO_SOURCE_LABEL[denLine.field as string] : undefined}
                                  onChange={(v) => onFieldChange(denLine.field as Field, v)}
                                  onReset={isAutoKey ? () => onOverrideReset(denLine.field as Field) : undefined}
                                />
                              </TD>
                            </>
                          );
                        })()
                      ) : (
                        <><TD /><TD /></>
                      )}

                      {/* Ratio result — only on first row */}
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

                {/* Row separator between ratios */}
                <tr key={`${def.id}-sep`} className="h-0">
                  <td colSpan={7} className="border-t-2 border-slate-300 p-0" />
                </tr>
              </>
            );
          })}
          {/* ── Custom ratios ─────────────────────────────────────────────── */}
          {(ratios.custom_ratios ?? []).map((cr, idx) => {
            const no = 11 + idx + 1;
            const cyNum = cr.cy.numerator;
            const cyDen = cr.cy.denominator;
            const computed =
              cyNum != null && cyDen != null && cyDen !== 0
                ? cr.unit === "%" ? (cyNum / cyDen) * 100 : cyNum / cyDen
                : null;
            const display =
              computed == null ? "N.A."
              : cr.unit === "%" ? `${computed.toFixed(2)}%`
              : `${computed.toFixed(2)} Times`;
            return (
              <>
                <tr key={`cr-${cr.id}`} className="align-middle">
                  {/* Row separator */}
                  <td colSpan={7} className="border-t-2 border-slate-300 p-0 h-0" />
                </tr>
                <tr key={`cr-${cr.id}-data`} className="align-middle">
                  <TD className="text-center font-semibold">{no}</TD>
                  {/* Name + unit + delete */}
                  <TD>
                    <div className="flex flex-col gap-0.5">
                      <input
                        value={cr.name}
                        onChange={(e) => onCustomRatioChange(cr.id, { name: e.target.value })}
                        className="w-full text-[11px] font-medium bg-transparent border-0 border-b border-slate-200 focus:outline-none focus:border-primary px-0"
                        placeholder="Ratio name…"
                      />
                      <div className="flex items-center gap-1 mt-0.5">
                        <select
                          value={cr.unit}
                          onChange={(e) => onCustomRatioChange(cr.id, { unit: e.target.value as "times" | "%" })}
                          className="text-[9px] border border-slate-200 rounded px-1 bg-white text-slate-600"
                        >
                          <option value="times">Times</option>
                          <option value="%">%</option>
                        </select>
                        <button
                          onClick={() => onDeleteCustomRatio(cr.id)}
                          className="ml-auto text-[9px] text-red-400 hover:text-red-600"
                          title="Delete ratio"
                        >✕ Delete</button>
                      </div>
                    </div>
                  </TD>
                  {/* Numerator label + amount */}
                  <TD>
                    <input
                      value={cr.numeratorLabel}
                      onChange={(e) => onCustomRatioChange(cr.id, { numeratorLabel: e.target.value })}
                      className="w-full text-[11px] text-slate-600 bg-transparent border-0 border-b border-slate-200 focus:outline-none focus:border-primary px-0"
                      placeholder="Numerator label…"
                    />
                  </TD>
                  <TD className="py-0.5 pr-1">
                    <RatioInput
                      value={cyNum}
                      isAuto={false}
                      isOverridden={false}
                      onChange={(v) => onCustomRatioChange(cr.id, { cy: { ...cr.cy, numerator: v } })}
                    />
                  </TD>
                  {/* Denominator label + amount */}
                  <TD>
                    <input
                      value={cr.denominatorLabel}
                      onChange={(e) => onCustomRatioChange(cr.id, { denominatorLabel: e.target.value })}
                      className="w-full text-[11px] text-slate-600 bg-transparent border-0 border-b border-slate-200 focus:outline-none focus:border-primary px-0"
                      placeholder="Denominator label…"
                    />
                  </TD>
                  <TD className="py-0.5 pr-1">
                    <RatioInput
                      value={cyDen}
                      isAuto={false}
                      isOverridden={false}
                      onChange={(v) => onCustomRatioChange(cr.id, { cy: { ...cr.cy, denominator: v } })}
                    />
                  </TD>
                  {/* Computed ratio */}
                  <TD className={cn("text-center font-semibold", computed == null && "text-slate-400")}>
                    {display}
                  </TD>
                </tr>
              </>
            );
          })}
          {/* Add custom ratio */}
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
