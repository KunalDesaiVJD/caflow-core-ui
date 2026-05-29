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
  Loader2, BarChart3, TrendingUp, TrendingDown, Search, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getTrialBalance,
  getCOAMapping,
  getPreviousYearFsAmounts,
  getPreviousYearFsAmountsFromTB,
  getEngagementIsNonCorporate,
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

// ─── NCE (Non-Corporate Entity) FS Layout ──────────────────────────────────────
// Non-corporate engagements store NCE_* codes in coa_mapping (NCE_CAP, NCE_LTB,
// NCE_REV_OPS, …) — NOT the corporate BS_/PL_ codes. Using the corporate layout
// for an NCE client therefore sums nothing (every line → 0 → "—") even though
// 100% of ledgers are mapped. This layout mirrors src/config/nceLineItems.ts so
// the Ledger Explorer reflects the same figures as Stage 7.
const NCE_BS_PL_LAYOUT: LayoutRow[] = [
  // ═══ EQUITY & LIABILITIES ════════════════════════════════════════════════
  L("sec_eq_liab", "EQUITY & LIABILITIES", "section"),

  L("grp_own",   "Owners' Funds",                 "group"),
  L("own_cap",   "Owners' Capital Account",       "line", { fsCodes: ["NCE_CAP"], sign: -1 }),
  L("tot_own",   "Total Owners' Funds",           "subtotal", { sumKeys: ["own_cap"] }),

  L("grp_ncl",   "Non-Current Liabilities",       "group"),
  L("lt_borr",   "Long-term Borrowings",          "line", { fsCodes: ["NCE_LTB"],  sign: -1 }),
  L("oth_lt_liab","Other Long-term Liabilities",  "line", { fsCodes: ["NCE_OLTL"], sign: -1 }),
  L("lt_prov",   "Long-term Provisions",          "line", { fsCodes: ["NCE_LTP"],  sign: -1 }),
  L("tot_ncl",   "Total Non-Current Liabilities", "subtotal", { sumKeys: ["lt_borr", "oth_lt_liab", "lt_prov"] }),

  L("grp_cl",    "Current Liabilities",           "group"),
  L("st_borr",   "Short-term Borrowings",         "line", { fsCodes: ["NCE_STB"], sign: -1 }),
  L("trade_pay", "Trade Payables",                "line", { fsCodes: ["NCE_TP"],  sign: -1 }),
  L("oth_cl",    "Other Current Liabilities",     "line", { fsCodes: ["NCE_OCL"], sign: -1 }),
  L("st_prov",   "Short-term Provisions",         "line", { fsCodes: ["NCE_STP"], sign: -1 }),
  L("tot_cl",    "Total Current Liabilities",     "subtotal", { sumKeys: ["st_borr", "trade_pay", "oth_cl", "st_prov"] }),

  L("tot_eq_liab", "TOTAL EQUITY & LIABILITIES",  "total", { sumKeys: ["tot_own", "tot_ncl", "tot_cl"] }),

  // ═══ ASSETS ══════════════════════════════════════════════════════════════
  L("sec_assets", "ASSETS", "section"),

  L("grp_nca",   "Non-Current Assets",            "group"),
  L("ppe",       "Property, Plant & Equipment",   "line", { fsCodes: ["NCE_PPE"],   sign: 1 }),
  L("cwip",      "Capital Work-in-Progress",      "line", { fsCodes: ["NCE_CWIP"],  sign: 1 }),
  L("intg",      "Intangible Assets",             "line", { fsCodes: ["NCE_INTG"],  sign: 1 }),
  L("nc_inv",    "Non-current Investments",       "line", { fsCodes: ["NCE_NCINV"], sign: 1 }),
  L("lt_loans",  "Long-term Loans & Advances",    "line", { fsCodes: ["NCE_LTLA"],  sign: 1 }),
  L("oth_nca",   "Other Non-current Assets",      "line", { fsCodes: ["NCE_ONCA"],  sign: 1 }),
  L("tot_nca",   "Total Non-Current Assets",      "subtotal", { sumKeys: ["ppe", "cwip", "intg", "nc_inv", "lt_loans", "oth_nca"] }),

  L("grp_ca",    "Current Assets",                "group"),
  L("curr_inv",  "Current Investments",           "line", { fsCodes: ["NCE_CINV"], sign: 1 }),
  L("inventories","Inventories",                  "line", { fsCodes: ["NCE_STCK"], sign: 1 }),
  L("trade_rec", "Trade Receivables",             "line", { fsCodes: ["NCE_TR"],   sign: 1 }),
  L("cash_bank", "Cash & Bank Balances",          "line", { fsCodes: ["NCE_CASH"], sign: 1 }),
  L("st_loans",  "Short-term Loans & Advances",   "line", { fsCodes: ["NCE_STLA"], sign: 1 }),
  L("oth_ca",    "Other Current Assets",          "line", { fsCodes: ["NCE_OCA"],  sign: 1 }),
  L("tot_ca",    "Total Current Assets",          "subtotal", { sumKeys: ["curr_inv", "inventories", "trade_rec", "cash_bank", "st_loans", "oth_ca"] }),

  L("tot_assets", "TOTAL ASSETS", "total", { sumKeys: ["tot_nca", "tot_ca"] }),

  // ═══ PROFIT & LOSS ════════════════════════════════════════════════════════
  L("sec_pl", "PROFIT & LOSS STATEMENT", "section"),

  L("grp_rev",   "Income",                        "group"),
  L("rev_ops",   "I.  Revenue from Operations",   "line", { fsCodes: ["NCE_REV_OPS"], sign: -1 }),
  L("oth_inc",   "II. Other Income",              "line", { fsCodes: ["NCE_REV_OTH"], sign: -1 }),
  L("tot_rev",   "III. Total Income",             "subtotal", { sumKeys: ["rev_ops", "oth_inc"] }),

  L("grp_exp",   "Expenses",                      "group"),
  L("cogs",      "(a) Cost of Goods Sold",        "line", { fsCodes: ["NCE_COGS"],     sign: 1 }),
  L("emp_exp",   "(b) Employee Benefits Expense", "line", { fsCodes: ["NCE_EMP_EXP"],  sign: 1 }),
  L("fin_cost",  "(c) Finance Costs",             "line", { fsCodes: ["NCE_FIN_COST"], sign: 1 }),
  L("dep",       "(d) Depreciation & Amortisation","line", { fsCodes: ["NCE_DEPR"],    sign: 1 }),
  L("oth_exp",   "(e) Other Expenses",            "line", { fsCodes: ["NCE_OTH_EXP"],  sign: 1 }),
  L("tot_exp",   "IV. Total Expenses",            "subtotal", { sumKeys: ["cogs", "emp_exp", "fin_cost", "dep", "oth_exp"] }),

  // Profit chain (mirrors nceLineItems.ts V→XIII)
  L("prof_v",    "V. Profit/(Loss) before exceptional items, partners' remuneration & tax", "result", { sumKeys: ["tot_rev"], subKeys: ["tot_exp"] }),
  L("excep",     "VI. Exceptional Items",         "line", { fsCodes: ["NCE_EXCEP"], sign: 1 }),
  L("prof_vii",  "VII. Profit before extraordinary items & tax", "result", { sumKeys: ["prof_v"], subKeys: ["excep"] }),
  L("extord",    "VIII. Extraordinary Items",     "line", { fsCodes: ["NCE_EXTORD"], sign: 1 }),
  L("prof_ix",   "IX. Profit before partners' remuneration & tax", "result", { sumKeys: ["prof_vii"], subKeys: ["extord"] }),
  L("part_rem",  "X. Partners' Remuneration",     "line", { fsCodes: ["NCE_PART_REM"], sign: 1 }),
  L("prof_xi",   "XI. Profit before tax",         "result", { sumKeys: ["prof_ix"], subKeys: ["part_rem"] }),
  L("tax",       "XII. Tax Expense",              "line", { fsCodes: ["NCE_CUR_TAX", "NCE_PRIOR_TAX"], sign: 1 }),
  L("net_prof",  "XIII. PROFIT / (LOSS) FOR THE YEAR", "result", { sumKeys: ["prof_xi"], subKeys: ["tax"] }),
];

/** Split a layout into its Balance-Sheet portion and its P&L portion at the
 *  "sec_pl" divider, so each can render under its own tab. */
function splitLayout(layout: LayoutRow[]): { bs: LayoutRow[]; pl: LayoutRow[] } {
  const i = layout.findIndex(r => r.key === "sec_pl");
  if (i < 0) return { bs: layout, pl: [] };
  return { bs: layout.slice(0, i), pl: layout.slice(i) };
}

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

/** Format a closing amount for financial display: negatives shown in
 *  parentheses, e.g. -25,000 → "(25,000.00)". */
function fmtClosing(n: number): string {
  const abs = fmtAmt(n);
  return n < 0 ? `(${abs})` : abs;
}

function varPct(cy: number, py: number): number | null {
  if (!py) return null;
  return Math.round(((cy - py) / Math.abs(py)) * 10000) / 100;
}

/** Compute all line-item amounts from TB + mapping + pyFs for a given layout */
function computeAmounts(
  tb:       TBLedger[],
  mapping:  COAMapping,
  pyFs:     Record<string, number>,
  layout:   LayoutRow[],
): AmountMap {
  const map: AmountMap = new Map();

  // Pass 1: line rows
  for (const row of layout) {
    if (row.type === "line" && row.fsCodes && row.sign != null) {
      const rawCy = sumLedgersByFsCodes(tb as any, mapping, row.fsCodes);
      const rawPy = row.fsCodes.reduce((s, c) => s + (pyFs[c] ?? 0), 0);
      map.set(row.key, { cy: row.sign * rawCy, py: row.sign * rawPy });
    }
  }

  // Pass 2: subtotal / total / result rows
  for (const row of layout) {
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
  const [isNce,   setIsNce]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!engagementId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getTrialBalance(engagementId),
      getCOAMapping(engagementId),
      // Primary PY source: PY-shell trial balance (same method as CY). Falls
      // back to fa_financial_statements when no PY-shell sync exists.
      getPreviousYearFsAmountsFromTB(engagementId),
      getPreviousYearFsAmounts(engagementId),
      getEngagementIsNonCorporate(engagementId),
    ])
      .then(([tbData, mapData, pyFromTb, pyFromFs, nce]) => {
        setTb(tbData as TBLedger[]);
        setMapping(mapData);
        setPyFs(Object.keys(pyFromTb).length > 0 ? pyFromTb : pyFromFs);
        setIsNce(!!nce);
      })
      .catch(e => setError(e?.message || "Failed to load BS/PL data"))
      .finally(() => setLoading(false));
  }, [engagementId]);

  return { tb, mapping, pyFs, isNce, loading, error };
}

// ─── Ledger sub-row (inside accordion) ───────────────────────────────────────

function LedgerSubRow({
  ledger, clientId, financialYear, group, onRaiseQuery, onViewEntry, highlight,
}: {
  ledger:        TBLedger;
  clientId?:     string | null;
  financialYear?: string | null;
  group:         string;
  onRaiseQuery:  (group: string, ledger: string, note?: string) => void;
  onViewEntry:   (name: string, group: string) => void;
  highlight?:    boolean;
}) {
  const isDr = ledger.balance >= 0;
  return (
    <div className={cn(
      "flex items-center gap-2 px-6 py-1.5 hover:bg-muted/10 transition-colors",
      "border-b border-border/30 last:border-b-0",
      highlight && "bg-amber-100/70 hover:bg-amber-100",
    )}>
      {/* Ledger name */}
      <span className={cn("flex-1 text-xs truncate", highlight ? "text-amber-900 font-semibold" : "text-foreground")} title={ledger.account_name}>
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
  expanded, onToggle, onRaiseQuery, onViewEntry, search = "",
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
  search?:       string;
}) {
  const amt = amounts.get(row.key);
  const cy  = amt?.cy ?? 0;
  const py  = amt?.py ?? 0;
  const delta  = cy - py;
  const deltaPct = varPct(cy, py);

  const hasCy          = cy !== 0;
  const allContributors = row.fsCodes
    ? getLedgersForCodes(tb, mapping, row.fsCodes)
    : [];
  const isSearching    = search.length > 0;
  const matching       = isSearching
    ? allContributors.filter(l => l.account_name.toLowerCase().includes(search))
    : allContributors;
  const contributors   = allContributors;
  const canExpand      = allContributors.length > 0;

  const isSection  = row.type === "section";
  const isGroup    = row.type === "group";
  const isTotal    = row.type === "total";
  const isResult   = row.type === "result";
  const isSubtotal = row.type === "subtotal";

  // While searching, hide everything except line items that actually contain a
  // matching ledger — so the user sees exactly which head(s) the ledger sits in.
  if (isSearching && (isSection || isGroup || isTotal || isResult || isSubtotal)) return null;
  if (isSearching && !isSection && !isGroup && !isTotal && !isResult && !isSubtotal && matching.length === 0) return null;

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
            ? `₹${fmtClosing(cy)}`
            : "—"}
        </span>
        {/* PY */}
        <span className="text-xs font-mono tabular-nums w-32 text-right text-muted-foreground">
          {py ? `₹${fmtClosing(py)}` : "—"}
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
          {(isSearching || expanded)
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
          {hasCy ? `₹${fmtClosing(cy)}` : "—"}
        </span>

        {/* PY */}
        <span className="text-xs font-mono tabular-nums w-32 text-right text-muted-foreground">
          {py ? `₹${fmtClosing(py)}` : "—"}
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
            `[BS/PL] ${row.label} — CY ₹${fmtClosing(cy)}${py ? ` vs PY ₹${fmtClosing(py)}` : ""}`,
          )}
          className="h-6 w-6 flex items-center justify-center rounded
                     text-amber-500 hover:bg-amber-50 hover:text-amber-700 transition-colors
                     flex-shrink-0"
        >
          <MessageSquareWarning size={12} />
        </button>
      </div>

      {/* Ledger sub-rows (expanded, or auto-expanded while searching) */}
      {(isSearching || expanded) && contributors.length > 0 && (
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
          {(isSearching ? matching : contributors).map(l => (
            <LedgerSubRow
              key={l.account_name}
              ledger={l}
              clientId={clientId}
              financialYear={financialYear}
              group={row.label}
              onRaiseQuery={onRaiseQuery}
              onViewEntry={onViewEntry}
              highlight={isSearching}
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
  /** Which sheet to render. "bs" = Balance Sheet only, "pl" = P&L only.
   *  Defaults to "bs" so each Ledger Explorer tab shows one statement. */
  section?:      "bs" | "pl";
}

export function BsPlView({ engagementId, clientId, financialYear, onRaiseQuery, section = "bs" }: Props) {
  const { tb, mapping, pyFs, isNce, loading, error } = useBsPlData(engagementId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelLedger, setPanelLedger] = useState<{ name: string; group: string } | null>(null);
  const [search, setSearch] = useState("");
  const searchLower = search.trim().toLowerCase();

  // Pick the layout that matches the engagement's entity type, then show only
  // the requested statement (BS or P&L). Amounts are always computed over the
  // FULL layout so subtotal/result rows that reference cross-section keys stay
  // correct, then we render just the active section's rows.
  const fullLayout = isNce ? NCE_BS_PL_LAYOUT : BS_PL_LAYOUT;
  const { bs: bsRows, pl: plRows } = useMemo(() => splitLayout(fullLayout), [fullLayout]);
  const visibleRows = section === "pl" ? plRows : bsRows;

  const amounts = useMemo(
    () => computeAmounts(tb, mapping, pyFs, fullLayout),
    [tb, mapping, pyFs, fullLayout],
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

  // Whether any mapped ledger in the visible statement matches the search.
  const anyMatchInView = useMemo(() => {
    if (!searchLower) return true;
    return visibleRows.some(r =>
      r.fsCodes && getLedgersForCodes(tb, mapping, r.fsCodes)
        .some(l => l.account_name.toLowerCase().includes(searchLower)));
  }, [searchLower, visibleRows, tb, mapping]);

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
        {/* Ledger search — jump straight to the head a ledger is mapped under */}
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search ledger name…"
            className="h-7 w-56 pl-7 pr-7 text-xs rounded-md border border-input bg-background
                       focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!search && (
          <span className="text-[10px] text-muted-foreground w-full sm:w-auto">
            Click any line to expand contributing ledgers &nbsp;·&nbsp;
            <MessageSquareWarning size={10} className="inline" /> = Raise Query
          </span>
        )}
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
          {visibleRows.map(row => (
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
              search={searchLower}
            />
          ))}
          {searchLower && !anyMatchInView && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No mapped ledger matches “{search.trim()}” in this {section === "pl" ? "P&L" : "Balance Sheet"}.
            </div>
          )}
        </div>
      </div>

      {/* Tally-to-BS check — only on the Balance Sheet tab */}
      {section === "bs" && (() => {
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

      {/* Ledger side panel — pass engagementId so useTallyEngagementId can
          take its STEP 0 path (probe tally_groups / tally_trial_balance
          for a row under the audit engagement_id directly).  Without it,
          the hook falls back to client_id-based lookups which can return
          null for clients whose tally rows are written under the audit
          engagement_id (current sync agent behaviour) but whose
          tally_groups don't carry a populated client_id.  Symptom:
          panel showed "No Tally sync data found" even though the BS/PL
          face above clearly displayed the same ledger. */}
      <LedgerSidePanel
        open={!!panelLedger}
        ledgerName={panelLedger?.name ?? ""}
        parentGroup={panelLedger?.group ?? ""}
        clientId={clientId}
        financialYear={financialYear}
        engagementId={engagementId}
        onClose={() => setPanelLedger(null)}
        onRaiseQuery={(group, ledger, note) => {
          setPanelLedger(null);
          onRaiseQuery(group, ledger, note);
        }}
      />
    </div>
  );
}
