// ─────────────────────────────────────────────────────────────────────────────
// ratioEngine.ts — Stage 7 Ratios tab (UI-8)
//
// Pure computation layer: no React, no Supabase.
// Accepts raw RatioInputs (22 fields for CY or PY) and returns RatioResult[]
// for all 11 MCA-mandated ratios.
// ─────────────────────────────────────────────────────────────────────────────

export interface RatioInputs {
  current_assets:          number | null;
  current_liabilities:     number | null;
  total_debt:              number | null;
  shareholders_equity:     number | null;
  npat:                    number | null;
  non_cash_op_exp:         number | null;
  interest:                number | null;
  other_non_cash_adj:      number | null;
  interest_lease:          number | null;
  principal_repayments:    number | null;
  avg_shareholders_equity: number | null;
  revenue_ops:             number | null;
  avg_inventories:         number | null;
  avg_trade_receivables:   number | null;
  net_credit_purchases:    number | null;
  avg_trade_payables:      number | null;
  working_capital:         number | null;
  npbt:                    number | null;
  net_worth:               number | null;
  lt_borrowings:           number | null;
  return_profit:           number | null;
  avg_investment_fund:     number | null;
}

export interface RatioResult {
  id:          number;
  name:        string;
  unit:        "times" | "%";
  numerator:   { label: string; value: number | null };
  denominator: { label: string; value: number | null };
  /** null when division by zero or a required input is missing */
  computed:    number | null;
  /** human-readable: "1.45" | "12.50%" | "N.A." */
  display:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core engine
// ─────────────────────────────────────────────────────────────────────────────

export function computeAllRatios(inputs: RatioInputs): RatioResult[] {
  /** null when numerator or denominator is null, or denominator is 0 */
  const safeDiv = (n: number | null, d: number | null): number | null =>
    n == null || d == null || d === 0 ? null : n / d;

  // ── Composite numerators / denominators ──────────────────────────────────

  // Debt Service Coverage: (NPAT + Non-Cash Op Exp + Interest + Other Non-Cash Adj)
  //                      ÷ (Interest on Lease + Principal Repayments)
  const dscNum =
    (inputs.npat             ?? 0) +
    (inputs.non_cash_op_exp  ?? 0) +
    (inputs.interest         ?? 0) +
    (inputs.other_non_cash_adj ?? 0);
  const dscDen =
    (inputs.interest_lease       ?? 0) +
    (inputs.principal_repayments ?? 0);

  // Return on Capital Employed: (NPBT + Interest) ÷ (Net Worth + LT Borrowings)
  const roceNum = (inputs.npbt ?? 0) + (inputs.interest ?? 0);
  const roceDen = (inputs.net_worth ?? 0) + (inputs.lt_borrowings ?? 0);

  // ── Ratio definitions ────────────────────────────────────────────────────

  const ratios: Omit<RatioResult, "display">[] = [
    {
      id:          1,
      name:        "Current Ratio",
      unit:        "times",
      numerator:   { label: "Total Current Assets",      value: inputs.current_assets },
      denominator: { label: "Total Current Liabilities", value: inputs.current_liabilities },
      computed:    safeDiv(inputs.current_assets, inputs.current_liabilities),
    },
    {
      id:          2,
      name:        "Debt-Equity Ratio",
      unit:        "times",
      numerator:   { label: "Total Debt",                value: inputs.total_debt },
      denominator: { label: "Shareholder’s Equity", value: inputs.shareholders_equity },
      computed:    safeDiv(inputs.total_debt, inputs.shareholders_equity),
    },
    {
      id:          3,
      name:        "Debt Service Coverage Ratio",
      unit:        "times",
      numerator:   { label: "Earning Available for Debt Service", value: dscNum },
      denominator: { label: "Debt Service",                       value: dscDen },
      computed:    safeDiv(dscNum, dscDen),
    },
    {
      id:          4,
      name:        "Return On Equity Ratio",
      unit:        "%",
      numerator:   { label: "Net Profit After Tax",        value: inputs.npat },
      denominator: { label: "Average Shareholders Equity", value: inputs.avg_shareholders_equity },
      computed:    safeDiv(inputs.npat, inputs.avg_shareholders_equity),
    },
    {
      id:          5,
      name:        "Inventory Turnover Ratio",
      unit:        "times",
      numerator:   { label: "Cost Of Goods Sold",   value: inputs.revenue_ops },
      denominator: { label: "Average Inventories",  value: inputs.avg_inventories },
      computed:    safeDiv(inputs.revenue_ops, inputs.avg_inventories),
    },
    {
      id:          6,
      name:        "Trade Receivables Turnover Ratio",
      unit:        "times",
      numerator:   { label: "Revenue from Operations",   value: inputs.revenue_ops },
      denominator: { label: "Average Trade Receivables", value: inputs.avg_trade_receivables },
      computed:    safeDiv(inputs.revenue_ops, inputs.avg_trade_receivables),
    },
    {
      id:          7,
      name:        "Trade Payables Turnover Ratio",
      unit:        "times",
      numerator:   { label: "Net Credit Purchases",  value: inputs.net_credit_purchases },
      denominator: { label: "Average Trade Payables", value: inputs.avg_trade_payables },
      computed:    safeDiv(inputs.net_credit_purchases, inputs.avg_trade_payables),
    },
    {
      id:          8,
      name:        "Net Capital Turnover Ratio",
      unit:        "times",
      numerator:   { label: "Revenue from Operations", value: inputs.revenue_ops },
      denominator: { label: "Working Capital",          value: inputs.working_capital },
      computed:    safeDiv(inputs.revenue_ops, inputs.working_capital),
    },
    {
      id:          9,
      name:        "Net Profit Ratio",
      unit:        "%",
      numerator:   { label: "Net Profit After Tax",       value: inputs.npat },
      denominator: { label: "Revenue from Operations",    value: inputs.revenue_ops },
      computed:    safeDiv(inputs.npat, inputs.revenue_ops),
    },
    {
      id:          10,
      name:        "Return On Capital Employed",
      unit:        "%",
      numerator:   { label: "Earnings Before Interest & Taxes", value: roceNum },
      denominator: { label: "Capital Employed",                  value: roceDen },
      computed:    safeDiv(roceNum, roceDen),
    },
    {
      id:          11,
      name:        "Return On Investment",
      unit:        "%",
      numerator:   { label: "Return / Profit / Earnings", value: inputs.return_profit },
      denominator: { label: "Average Investment Fund",    value: inputs.avg_investment_fund },
      computed:    safeDiv(inputs.return_profit, inputs.avg_investment_fund),
    },
  ];

  // ── Attach display string ────────────────────────────────────────────────
  return ratios.map((r) => ({
    ...r,
    display:
      r.computed == null
        ? "N.A."
        : r.unit === "%"
        ? `${(r.computed * 100).toFixed(2)}%`
        : r.computed.toFixed(2),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Variance helper (CY vs PY, expressed as % change)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the year-on-year percentage change from `py` to `cy`.
 * "N.A." when either value is null or py is 0.
 */
export function computeVariance(cy: number | null, py: number | null): string {
  if (cy == null || py == null || py === 0) return "N.A.";
  const v = ((cy - py) / py) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blank inputs factory — used when the DB column is null / uninitialised
// ─────────────────────────────────────────────────────────────────────────────

export function blankRatioInputs(): RatioInputs {
  return {
    current_assets:          null,
    current_liabilities:     null,
    total_debt:              null,
    shareholders_equity:     null,
    npat:                    null,
    non_cash_op_exp:         null,
    interest:                null,
    other_non_cash_adj:      null,
    interest_lease:          null,
    principal_repayments:    null,
    avg_shareholders_equity: null,
    revenue_ops:             null,
    avg_inventories:         null,
    avg_trade_receivables:   null,
    net_credit_purchases:    null,
    avg_trade_payables:      null,
    working_capital:         null,
    npbt:                    null,
    net_worth:               null,
    lt_borrowings:           null,
    return_profit:           null,
    avg_investment_fund:     null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-link map: which BS/PL fields feed which RatioInputs keys
//
// Used by useRatiosData to populate inputs from fsDisplayData without
// overwriting fields the user has manually set (manual_overrides list).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each entry describes one auto-linkable field.
 * `source` is a dot-path into fsDisplayData (e.g. "bs.cashBank.cy").
 * The hook resolves the value and writes it to RatioInputs[key] unless
 * that key is in manual_overrides.
 */
export interface AutoLinkEntry {
  key:    keyof RatioInputs;
  source: string;   // dot-path into fsDisplayData, e.g. "bs.cashBank.cy"
  label:  string;   // human-readable source description for the UI tooltip
}

export const AUTO_LINK_MAP: AutoLinkEntry[] = [
  // ── Balance Sheet — current-year auto-links ──────────────────────────────
  {
    key:    "current_assets",
    source: "bs.__totalCurrentAssets.cy",
    label:  "BS → Total Current Assets (CY)",
  },
  {
    key:    "current_liabilities",
    source: "bs.__totalCurrentLiabilities.cy",
    label:  "BS → Total Current Liabilities (CY)",
  },
  {
    key:    "shareholders_equity",
    source: "bs.__totalEquity.cy",
    label:  "BS → Total Equity (Share Capital + Reserves) (CY)",
  },
  {
    key:    "lt_borrowings",
    source: "bs.ltBorrowings.cy",
    label:  "BS → Long-Term Borrowings (CY)",
  },
  {
    key:    "avg_inventories",
    source: "bs.inventories.cy",
    label:  "BS → Inventories closing balance (CY) — user should average with PY",
  },
  {
    key:    "avg_trade_receivables",
    source: "bs.tradeRec.cy",
    label:  "BS → Trade Receivables closing balance (CY)",
  },
  {
    key:    "avg_trade_payables",
    source: "bs.__totalTradePayables.cy",
    label:  "BS → Trade Payables (MSME + Others) closing balance (CY)",
  },
  // ── P&L — current-year auto-links ────────────────────────────────────────
  {
    key:    "npat",
    source: "pl.__npat.cy",
    label:  "P&L → Net Profit After Tax (CY)",
  },
  {
    key:    "npbt",
    source: "pl.pbt.cy",
    label:  "P&L → Profit Before Tax (CY)",
  },
  {
    key:    "revenue_ops",
    source: "pl.revFromOps.cy",
    label:  "P&L → Revenue from Operations (CY)",
  },
  {
    key:    "interest",
    source: "pl.financeCosts.cy",
    label:  "P&L → Finance Costs / Interest (CY)",
  },
  // NOTE: non_cash_op_exp is intentionally NOT auto-linked.
  // It includes depreciation + provisions + impairments + write-offs.
  // Depreciation alone (PL_EXP_DEP) would be incomplete, so the user
  // must enter the combined figure manually.
];
