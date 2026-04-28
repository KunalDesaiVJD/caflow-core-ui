/**
 * BsPlView — Balance Sheet / P&L structured view  (Phase 2A)
 *
 * Renders all Schedule III / Div I FS line items mapped from the Tally TB,
 * showing CY closing | PY closing | Variance ₹ | Variance %.
 *
 * Each line item expands to show the contributing Tally ledgers with their
 * closing balances. Every line and every ledger has a "Raise Query" button
 * and a "View Entries" button (opens LedgerSidePanel).
 *
 * Data flow:
 *   1. getTrialBalance(engagementId)      → normalized TB (account_name, balance)
 *   2. getCOAMapping(engagementId)        → ledger → FS code map
 *   3. getPreviousYearFsAmounts(engId)    → PY FS code amounts
 *   4. sumLedgersByFsCodes()              → CY line amounts
 */
import { useState, useEffect, useMemo } from "react";
import {
  ChevronRight, ChevronDown, BookOpen, MessageSquareWarning,
  Loader2, BarChart3, TrendingUp, TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getTrialBalance,
  getCOAMapping,
  getPreviousYearFsAmounts,
  sumLedgersByFsCodes,
  type COAMapping,
} from "@/lib/notesAutoPopulate";
import { LedgerSidePanel } from "./LedgerSidePanel";

// ─── FS Layout definition ─────────────────────────────────────────────────────

type RowType = "section" | "group" | "line" | "subtotal" | "total" | "result";

interface LayoutRow {
  key:       string;
  label:     string;
  type:      RowType;
  fsCodes?:  string[];       // FS codes to sum from TB (line rows only)
  sign?:     1 | -1;         // 1 = assets/expenses (Dr+), -1 = liab/revenue (Cr-)
  sumKeys?:  string[];       // keys to add (subtotal/total)
  subKeys?:  string[];       // keys to subtract (result rows)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = (key: string, label: string, type: RowType, rest: Partial<LayoutRow> = {}): LayoutRow =>
  ({ key, label, type, ...rest });

const BS_PL_LAYOUT: LayoutRow[] = [
  // ═══ EQUITY & LIABILITIES ════════════════════════════════════════════════
  L("sec_eq_liab",   "EQUITY & LIABILITIES",           "section"),

  L("grp_equity",    "Shareholders' Funds",              "group"),
  L("share_cap",     "Share Capital",                    "line", { fsCodes: ["BS_EQ_SC"], sign: -1 }),
  L("reserves",      "Reserves & Surplus",               "line", { fsCodes: ["BS_EQ_RS"], sign: -1 }),
  L("tot_equity",    "Total Shareholders' Funds",        "subtotal", { sumKeys: ["share_cap", "reserves"] }),

  L("grp_ncl",       "Non-Current Liabilities",          "group"),
  L("lt_borr",       "Long-term Borrowings",             "line", { fsCodes: ["BS_NCL_LTB"], sign: -1 }),
  L("def_tax_liab",  "Deferred Tax Liabilities (Net)",   "line", { fsCodes: ["BS_NCL_DTL"], sign: -1 }),
  L("oth_lt_liab",   "Other Long-term Liabilities",      "line", { fsCodes: ["BS_NCL_OLT"], sign: -1 }),
  L("lt_prov",       "Long-term Provisions",             "line", { fsCodes: ["BS_NCL_LTP"], sign: -1 }),
  L("tot_ncl",       "Total Non-Current Liabilities",    "subtotal", { sumKeys: ["lt_borr", "def_tax_liab", "oth_lt_liab", "lt_prov"] }),

  L("grp_cl",        "Current Liabilities",              "group"),
  L("st_borr",       "Short-term Borrowings",            "line", { fsCodes: ["BS_CL_STB"], sign: -1 }),
  L("trade_pay",     "Trade Payables",                   "line", { fsCodes: ["BS_CL_TP"],  sign: -1 }),
  L("oth_cl",        "Other Current Liabilities",        "line", { fsCodes: ["BS_CL_OCL"], sign: -1 }),
  L("st_prov",       "Short-term Provisions",            "line", { fsCodes: ["BS_CL_STP"], sign: -1 }),
  L("tot_cl",        "Total Current Liabilities",        "subtotal", { sumKeys: ["st_borr", "trade_pay", "oth_cl", "st_prov"] }),

  L("tot_eq_liab",   "TOTAL EQUITY & LIABILITIES",       "total", { sumKeys: ["tot_equity", "tot_ncl", "tot_cl"] }),

  // ═══ ASSETS ══════════════════════════════════════════════════════════════
  L("sec_assets",    "ASSETS",                           "section"),

  L("grp_nca",       "Non-Current Assets",               "group"),
  L("ppe",           "Property, Plant & Equipment",      "line", { fsCodes: ["BS_NCA_FA", "BS_NCA_FA_TAN", "BS_NCA_FA_INT"], sign: 1 }),
  L("cwip",          "Capital Work-in-Progress",         "line", { fsCodes: ["BS_NCA_FA_WIP"], sign: 1 }),
  L("nc_inv",        "Non-current Investments",          "line", { fsCodes: ["BS_NCA_INV"], sign: 1 }),
  L("dta",           "Deferred Tax Assets (Net)",        "line", { fsCodes: ["BS_NCA_DTA"], sign: 1 }),
  L("lt_loans",      "Long-term Loans & Advances",       "line", { fsCodes: ["BS_NCA_LLA"], sign: 1 }),
  L("oth_nca",       "Other Non-current Assets",         "line", { fsCodes: ["BS_NCA_ONA"], sign: 1 }),
  L("tot_nca",       "Total Non-Current Assets",         "subtotal", { sumKeys: ["ppe", "cwip", "nc_inv", "dta", "lt_loans", "oth_nca"] }),

  L("grp_ca",        "Current Assets",                   "group"),
  L("curr_inv",      "Current Investments",              "line", { fsCodes: ["BS_CA_CI"],  sign: 1 }),
  L("inventories",   "Inventories",                      "line", { fsCodes: ["BS_CA_INV"], sign: 1 }),
  L("trade_rec",     "Trade Receivables",                "line", { fsCodes: ["BS_CA_TR"],  sign: 1 }),
  L("cash_bank",     "Cash & Bank Equivalents",          "line", { fsCodes: ["BS_CA_CCE"], sign: 1 }),
  L("st_loans",      "Short-term Loans & Advances",      "line", { fsCodes: ["BS_CA_SLA"], sign: 1 }),
  L("oth_ca",        "Other Current Assets",             "line", { fsCodes: ["BS_CA_OCA"], sign: 1 }),
  L("tot_ca",        "Total Current Assets",             "subtotal", { sumKeys: ["curr_inv", "inventories", "trade_rec", "cash_bank", "st_loans", "oth_ca"] }),

  L("tot_assets",    "TOTAL ASSETS",                     "total", { sumKeys: ["tot_nca", "tot_ca"] }),

  // ═══ PROFIT & LOSS ════════════════════════════════════════════════════════
  L("sec_pl",        "PROFIT & LOSS STATEMENT",          "section"),

  L("grp_rev",       "Revenue",                          "group"),
  L("rev_ops",       "Revenue from Operations",          "line", { fsCodes: ["PL_REV_OPS"], sign: -1 }),
  L("oth_inc",       "Other Income",                     "line", { fsCodes: ["PL_REV_OI"],  sign: -1 }),
  L("tot_rev",       "Total Revenue",                    "subtotal", { sumKeys: ["rev_ops", "oth_inc"] }),

  L("grp_exp",       "Expenses",                         "group"),
  L("mat_cost",      "Cost of Materials Consumed",       "line", { fsCodes: ["PL_EXP_MAT"], sign: 1 }),
  L("sit_purch",     "Purchases of Stock-in-Trade",      "line", { fsCodes: ["PL_EXP_SIT"], sign: 1 }),
  L("inv_chg",       "Changes in Inventories",           "line", { fsCodes: ["PL_EXP_CII"], sign: 1 }),
  L("emp_exp",       "Employee Benefits Expense",        "line", { fsCodes: ["PL_EXP_EMP"], sign: 1 }),
  L("fin_cost",      "Finance Costs",                    "line", { fsCodes: ["PL_EXP_FIN"], sign: 1 }),
  L("dep",           "Depreciation & Amortisation",      "line", { fsCodes: ["PL_EXP_DEP"], sign: 1 }),
  L("oth_exp",       "Other Expenses",                   "line", { fsCodes: ["PL_EXP_OTH", "PL_EXP_OEX"], sign: 1 }),
  L("tot_exp",       "Total Expenses",                   "subtotal", { sumKeys: ["mat_cost", "sit_purch", "inv_chg", "emp_exp", "fin_cost", "dep", "oth_exp"] }),

  // PBT = Revenue − Expenses  (sumKeys added, subKeys subtracted)
  L("pbt", "PROFIT / (LOSS) BEFORE TAX", "result", { sumKeys: ["tot_rev"], subKeys: ["tot_exp"] }),
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TBLedger {
  account_name: string;
  account_group: string;
  balance: number;
  opening_balance: number;
}

interface LineAmounts {
  cy: number;
  py: number;
}

type AmountMap = Map<string, LineAmounts>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function varPct(cy: number, py: number): number | null {
  if (!py) return null;
  return Math.round(((cy - py) / Math.abs(py)) * 10000) / 100;
}

/** Compute all line-item amounts from TB + mapping + pyFs */
function computeAmounts(
  tb:       TBLedger[],
  mapping:  COAMapping,
  pyFs:     Record<string, number>,
): AmountMap {
  const map: AmountMap = new Map();

  // Pass 1: line rows
  for (const row of BS_PL_LAYOUT) {
    if (row.type === "line" && row.fsCodes && row.sign != null) {
      const rawCy = sumLedgersByFsCodes(tb as any, mapping, row.fsCodes);
      const rawPy = row.fsCodes.reduce((s, c) => s + (pyFs[c] ?? 0), 0);
      map.set(row.key, { cy: row.sign * rawCy, py: row.sign * rawPy });
    }
  }

  // Pass 2: subtotal / total / result rows
  for (const row of BS_PL_LAYOUT) {
    if (!["subtotal", "total", "result"].includes(row.type)) continue;
    const addSum  = (row.sumKeys  ?? []).reduce((s, k) => s + (map.get(k)?.cy  ?? 0), 0);
    const subSum  = (row.subKeys  ?? []).reduce((s, k) => s + (map.get(k)?.cy  ?? 0), 0);
    const addSumPy = (row.sumKeys ?? []).reduce((s, k) => s + (map.get(k)?.py  ?? 0), 0);
    const subSumPy = (row.subKeys ?? []).reduce((s, k) => s + (map.get(k)?.py  ?? 0), 0);
    map.set(row.key, { cy: addSum - subSum, py: addSumPy - subSumPy });
  }

  return map;
}

/** Get TB ledgers contributing to a set of FS codes */
function getLedgersForCodes(
  tb:      TBLedger[],
  mapping: COAMapping,
  fsCodes: string[],
): TBLedger[] {
  const codeSet = new Set(fsCodes);
  return tb.filter(l => codeSet.has(mapping[l.account_name]?.code ?? ""));
}

// ─── Data hook ────────────────────────────────────────────────────────────────

function useBsPlData(engagementId: string) {
  const [tb,      setTb]      = useState<TBLedger[]>([]);
  const [mapping, setMapping] = useState<COAMapping>({});
  const [pyFs,    setPyFs]    = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!engagementId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getTrialBalance(engagementId),
      getCOAMapping(engagementId),
      getPreviousYearFsAmounts(engagementId),
    ])
      .then(([tbData, mapData, pyData]) => {
        setTb(tbData as TBLedger[]);
        setMapping(mapData);
        setPyFs(pyData);
      })
      .catch(e => setError(e?.message || "Failed to load BS/PL data"))
      .finally(() => setLoading(false));
  }, [engagementId]);

  return { tb, mapping, pyFs, loading, error };
}

// ─── Ledger sub-row (inside accordion) ───────────────────────────────────────

function LedgerSubRow({
  ledger, clientId, financialYear, group, onRaiseQuery, onViewEntry,
}: {
  ledger:        TBLedger;
  clientId?:     string | null;
  financialYear?: string | null;
  group:         string;
  onRaiseQuery:  (group: string, ledger: string, note?: string) => void;
  onViewEntry:   (name: string, group: string) => void;
}) {
  const isDr = ledger.balance >= 0;
  return (
    <div className="flex items-center gap-2 px-6 py-1.5 hover:bg-muted/10 transition-colors
                    border-b border-border/30 last:border-b-0">
      {/* Ledger name */}
      <span className="flex-1 text-xs text-foreground truncate" title={ledger.account_name}>
        {ledger.account_name}
      </span>
      {/* Balance */}
      <span className={cn(
        "text-xs font-mono tabular-nums font-medium w-36 text-right",
        isDr ? "text-blue-700" : "text-rose-600",
      )}>
        ₹{fmtAmt(ledger.balance)}
        <span className="ml-1 text-[10px] font-normal">{isDr ? "Dr" : "Cr"}</span>
      </span>
      {/* Actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          title="View journal entries"
          onClick={() => onViewEntry(ledger.account_name, group)}
          className="h-6 w-6 flex items-center justify-center rounded
                     text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <BookOpen size={11} />
        </button>
        <button
          type="button"
          title="Raise query for this ledger"
          onClick={() => onRaiseQuery(group, ledger.account_name,
            `[BS/PL] ${ledger.account_name} — ₹${fmtAmt(ledger.balance)} ${isDr ? "Dr" : "Cr"}`)}
          className="h-6 w-6 flex items-center justify-center rounded
                     text-amber-600 hover:bg-amber-50 transition-colors"
        >
          <MessageSquareWarning size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── Single FS line row ───────────────────────────────────────────────────────

function FsRow({
  row, amounts, tb, mapping, clientId, financialYear,
  expanded, onToggle, onRaiseQuery, onViewEntry,
}: {
  row:           LayoutRow;
  amounts:       AmountMap;
  tb:            TBLedger[];
  mapping:       COAMapping;
  clientId?:     string | null;
  financialYear?: string | null;
  expanded:      boolean;
  onToggle:      () => void;
  onRaiseQuery:  (group: string, ledger: string, note?: string) => void;
  onViewEntry:   (name: string, group: string) => void;
}) {
  const amt = amounts.get(row.key);
  const cy  = amt?.cy ?? 0;
  const py  = amt?.py ?? 0;
  const delta  = cy - py;
  const deltaPct = varPct(cy, py);

  const hasCy          = cy !== 0;
  const contributors   = row.fsCodes
    ? getLedgersForCodes(tb, mapping, row.fsCodes)
    : [];
  const canExpand      = contributors.length > 0;

  const isSection  = row.type === "section";
  const isGroup    = row.type === "group";
  const isTotal    = row.type === "total";
  const isResult   = row.type === "result";
  const isSubtotal = row.type === "subtotal";

  // ── Section header ───────────────────────────────────────────────────────
  if (isSection) {
    return (
      <div className="px-4 py-2 bg-slate-700 text-white">
        <span className="text-xs font-bold uppercase tracking-widest">
          {row.label}
        </span>
      </div>
    );
  }

  // ── Group header ─────────────────────────────────────────────────────────
  if (isGroup) {
    return (
      <div className="px-4 py-1.5 bg-slate-100 border-b border-slate-200">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          {row.label}
        </span>
      </div>
    );
  }

  // ── Total / Subtotal / Result ─────────────────────────────────────────────
  if (isTotal || isSubtotal || isResult) {
    const posVariant = delta > 0;
    return (
      <div className={cn(
        "flex items-center gap-2 px-4 py-2 border-b",
        isTotal || isResult
          ? "bg-slate-100 border-slate-300 font-bold"
          : "bg-muted/30 border-border/60 font-semibold",
      )}>
        <span className={cn(
          "flex-1 text-xs uppercase tracking-wide",
          isResult ? "text-slate-800" : "text-slate-700",
        )}>
          {row.label}
        </span>
        {/* CY */}
        <span className={cn(
          "text-xs font-mono tabular-nums w-32 text-right",
          isResult && cy >= 0 ? "text-green-700" : isResult ? "text-red-600" : "text-foreground",
        )}>
          {hasCy || isTotal || isSubtotal || isResult
            ? `₹${fmtAmt(cy)}`
            : "—"}
        </span>
        {/* PY */}
        <span className="text-xs font-mono tabular-nums w-32 text-right text-muted-foreground">
          {py ? `₹${fmtAmt(py)}` : "—"}
        </span>
        {/* Variance */}
        <span className={cn(
          "text-xs tabular-nums w-24 text-right",
          posVariant ? "text-teal-700" : delta < 0 ? "text-rose-600" : "text-muted-foreground",
        )}>
          {delta !== 0 ? `${delta > 0 ? "+" : ""}₹${fmtAmt(delta)}` : "—"}
        </span>
        {/* Var % */}
        <span className={cn(
          "text-[10px] tabular-nums w-14 text-right",
          posVariant ? "text-teal-600" : delta < 0 ? "text-rose-500" : "text-muted-foreground",
        )}>
          {deltaPct != null ? `${deltaPct > 0 ? "+" : ""}${deltaPct}%` : "—"}
        </span>
        {/* Spacer for raise-query col */}
        <div className="w-6" />
      </div>
    );
  }

  // ── Line item ─────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 border-b border-border/40",
          "hover:bg-muted/10 transition-colors",
          !hasCy && "opacity-50",
        )}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={canExpand ? onToggle : undefined}
          disabled={!canExpand}
          className={cn(
            "h-5 w-5 flex items-center justify-center rounded text-muted-foreground",
            canExpand ? "hover:bg-muted cursor-pointer" : "opacity-0 cursor-default",
          )}
          title={canExpand ? `${contributors.length} ledger(s)` : undefined}
        >
          {expanded
            ? <ChevronDown size={12} />
            : <ChevronRight size={12} />}
        </button>

        {/* Label */}
        <span className="flex-1 text-xs text-foreground">
          {row.label}
          {canExpand && (
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              ({contributors.length})
            </span>
          )}
        </span>

        {/* CY */}
        <span className="text-xs font-mono tabular-nums w-32 text-right font-medium text-foreground">
          {hasCy ? `₹${fmtAmt(cy)}` : "—"}
        </span>

        {/* PY */}
        <span className="text-xs font-mono tabular-nums w-32 text-right text-muted-foreground">
          {py ? `₹${fmtAmt(py)}` : "—"}
        </span>

        {/* Variance ₹ */}
        <span className={cn(
          "text-xs tabular-nums w-24 text-right",
          delta > 0 ? "text-teal-700" : delta < 0 ? "text-rose-600" : "text-muted-foreground",
        )}>
          {hasCy && delta !== 0
            ? `${delta > 0 ? "+" : ""}₹${fmtAmt(delta)}`
            : "—"}
        </span>

        {/* Variance % */}
        <span className={cn(
          "text-[10px] tabular-nums w-14 text-right",
          delta > 0 ? "text-teal-600" : delta < 0 ? "text-rose-500" : "text-muted-foreground",
        )}>
          {hasCy && deltaPct != null
            ? `${deltaPct > 0 ? "+" : ""}${deltaPct}%`
            : "—"}
        </span>

        {/* Raise query */}
        <button
          type="button"
          title="Raise query for this line item"
          onClick={() => onRaiseQuery(
            row.label, "",
            `[BS/PL] ${row.label} — CY ₹${fmtAmt(cy)}${py ? ` vs PY ₹${fmtAmt(py)}` : ""}`,
          )}
          className="h-6 w-6 flex items-center justify-center rounded
                     text-amber-500 hover:bg-amber-50 hover:text-amber-700 transition-colors
                     flex-shrink-0"
        >
          <MessageSquareWarning size={12} />
        </button>
      </div>

      {/* Ledger sub-rows (expanded) */}
      {expanded && contributors.length > 0 && (
        <div className="bg-slate-50/60 border-b border-border/40">
          {/* Sub-header */}
          <div className="flex items-center gap-2 px-6 py-1 bg-slate-100/80 border-b border-slate-200">
            <span className="flex-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Ledger
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-36 text-right">
              Closing Balance
            </span>
            <div className="w-14 flex-shrink-0" />
          </div>
          {contributors.map(l => (
            <LedgerSubRow
              key={l.account_name}
              ledger={l}
              clientId={clientId}
              financialYear={financialYear}
              group={row.label}
              onRaiseQuery={onRaiseQuery}
              onViewEntry={onViewEntry}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  engagementId:  string;
  clientId?:     string | null;
  financialYear?: string | null;
  onRaiseQuery:  (group: string, ledger: string, note?: string) => void;
}

export function BsPlView({ engagementId, clientId, financialYear, onRaiseQuery }: Props) {
  const { tb, mapping, pyFs, loading, error } = useBsPlData(engagementId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelLedger, setPanelLedger] = useState<{ name: string; group: string } | null>(null);

  const amounts = useMemo(
    () => computeAmounts(tb, mapping, pyFs),
    [tb, mapping, pyFs],
  );

  const toggleKey = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Mapped ledger count (how many TB ledgers have a FS code assigned)
  const mappedCount = useMemo(
    () => tb.filter(l => !!mapping[l.account_name]?.code).length,
    [tb, mapping],
  );
  const hasPY = Object.keys(pyFs).length > 0;

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Building BS / P&L view…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-rose-600">
        ⚠ {error}
      </div>
    );
  }

  if (tb.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center text-muted-foreground">
        <BarChart3 size={32} className="opacity-25" />
        <p className="text-sm">No Tally data available. Run a sync first.</p>
      </div>
    );
  }

  if (mappedCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center text-muted-foreground">
        <BarChart3 size={32} className="opacity-25" />
        <div>
          <p className="text-sm font-medium text-foreground">COA mapping not configured</p>
          <p className="text-xs mt-1">
            Go to <strong>COA Mapping</strong> and map your ledgers to FS codes
            to see the BS / P&L view.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Info bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
          {mappedCount} / {tb.length} ledgers mapped
        </Badge>
        {hasPY ? (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-green-700 border-green-300">
            ✓ PY data available
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-amber-600 border-amber-300">
            PY data not available
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          Click any line to expand contributing ledgers &nbsp;·&nbsp;
          <MessageSquareWarning size={10} className="inline" /> = Raise Query
        </span>
      </div>

      {/* Column header bar */}
      <div className="rounded-t-lg overflow-hidden border">
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-[10px]
                        uppercase tracking-wide border-b">
          <div className="w-5 flex-shrink-0" /> {/* expand toggle spacer */}
          <span className="flex-1">Line Item</span>
          <span className="w-32 text-right">CY Closing (₹)</span>
          <span className="w-32 text-right">PY Closing (₹)</span>
          <span className="w-24 text-right">Variance ₹</span>
          <span className="w-14 text-right">Var %</span>
          <div className="w-6 flex-shrink-0" />
        </div>

        {/* All rows */}
        <div className="divide-y divide-border/30 bg-background">
          {BS_PL_LAYOUT.map(row => (
            <FsRow
              key={row.key}
              row={row}
              amounts={amounts}
              tb={tb}
              mapping={mapping}
              clientId={clientId}
              financialYear={financialYear}
              expanded={expanded.has(row.key)}
              onToggle={() => toggleKey(row.key)}
              onRaiseQuery={onRaiseQuery}
              onViewEntry={(name, group) => setPanelLedger({ name, group })}
            />
          ))}
        </div>
      </div>

      {/* Tally-to-BS check */}
      {(() => {
        const totAssets   = amounts.get("tot_assets")?.cy   ?? 0;
        const totEqLiab   = amounts.get("tot_eq_liab")?.cy  ?? 0;
        const diff        = Math.abs(totAssets - totEqLiab);
        if (totAssets === 0 && totEqLiab === 0) return null;
        return (
          <div className={cn(
            "flex items-center gap-2 text-xs px-3 py-2 rounded-lg border",
            diff < 1
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-amber-50 border-amber-200 text-amber-700",
          )}>
            {diff < 1
              ? <TrendingUp size={13} />
              : <TrendingDown size={13} />}
            {diff < 1
              ? "Balance Sheet tallies — Assets = Equity & Liabilities"
              : `Balance Sheet difference: ₹${fmtAmt(diff)} — check COA mapping for unmapped ledgers`
            }
          </div>
        );
      })()}

      {/* Ledger side panel */}
      <LedgerSidePanel
        open={!!panelLedger}
        ledgerName={panelLedger?.name ?? ""}
        parentGroup={panelLedger?.group ?? ""}
        clientId={clientId}
        financialYear={financialYear}
        onClose={() => setPanelLedger(null)}
        onRaiseQuery={(group, ledger, note) => {
          setPanelLedger(null);
          onRaiseQuery(group, ledger, note);
        }}
      />
    </div>
  );
}
