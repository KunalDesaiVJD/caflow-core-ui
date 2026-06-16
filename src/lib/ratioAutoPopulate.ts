/**
 * ratioAutoPopulate
 * ─────────────────────────────────────────────────────────────────────────
 * Phase UI-8 / Phase 3 — Auto-population service for Stage 7 Ratios.
 *
 * Reads COA mapping + tally_trial_balance for the current engagement (CY),
 * and the prior engagement's fa_financial_statements (PY), and produces
 * a Stage7Ratios object ready for writing back to
 * audit_engagements.stage7_ratios (the JSONB column added in Phase 1).
 *
 * Manual edits are tracked as dot-paths in `manual_overrides[]`.
 * `respectManualOverrides()` merges the auto-generated payload with the
 * existing saved data, NEVER overwriting any path the user has touched —
 * matching the same contract as notesAutoPopulate.respectManualEdits().
 *
 * Auto-derivable fields (12 of 22):
 *   current_assets, current_liabilities, shareholders_equity, lt_borrowings,
 *   total_debt, revenue_ops, interest (finance costs), npbt,
 *   net_worth (= shareholders_equity), working_capital,
 *   avg_inventories (CY), avg_trade_receivables (CY), avg_trade_payables (CY),
 *   avg_shareholders_equity (CY), avg_investment_fund (CY).
 *   Average fields use (CY closing + PY closing) / 2 when PY data is present.
 *
 * Manual-entry only fields (10 of 22):
 *   npat, non_cash_op_exp (depreciation + provisions + write-offs combined),
 *   other_non_cash_adj, interest_lease, principal_repayments,
 *   net_credit_purchases, return_profit, avg_shareholders_equity (PY),
 *   avg_inventories (PY), avg_trade_receivables (PY), avg_trade_payables (PY),
 *   avg_investment_fund (PY).
 */

import { supabase } from "@/integrations/supabase/client";
import {
  RatioInputs,
  blankRatioInputs,
} from "./ratioEngine";
import {
  getTrialBalance,
  getCOAMapping,
  sumLedgersByFsCodes,
  getPreviousYearFsAmounts,
} from "./notesAutoPopulate";

// ═════════════════════════════════════════════════════════════════════════
// FS-code groupings
// ═════════════════════════════════════════════════════════════════════════
//
// Sign convention from the TB (via normalizeTB in notesAutoPopulate):
//   DR ledgers → positive balance
//   CR ledgers → negative balance
//
// We apply ASSET_SIGN (+1) for DR codes and LIAB_SIGN / REV_SIGN (−1)
// for CR codes to get positive, presentation-ready magnitudes.

const ASSET_SIGN = 1 as const;
const CR_SIGN   = -1 as const;      // liabilities, equity, revenue

// Current assets
const FS_CURR_ASSETS: string[] = [
  "BS_CA_CI",   // current investments
  "BS_CA_INV",  // inventories
  "BS_CA_TR",   // trade receivables
  "BS_CA_CCE",  // cash & bank
  "BS_CA_SLA",  // short-term loans & advances
  "BS_CA_OCA",  // other current assets
];

// Current liabilities
const FS_CURR_LIAB: string[] = [
  "BS_CL_STB",  // short-term borrowings
  "BS_CL_TP",   // trade payables (MSME + Others merged)
  "BS_CL_OCL",  // other current liabilities
  "BS_CL_STP",  // short-term provisions
];

// Non-current liabilities
const FS_LT_BORROWINGS:  string[] = ["BS_NCL_LTB"];

// Equity
const FS_SHARE_CAP:  string[] = ["BS_EQ_SC"];
const FS_RESERVES:   string[] = ["BS_EQ_RS"];

// Investments (for avg_investment_fund)
const FS_NC_INV:    string[] = ["BS_NCA_INV"];
const FS_CURR_INV:  string[] = ["BS_CA_CI"];

// Individual current-asset codes (for averages)
const FS_INVENTORIES:  string[] = ["BS_CA_INV"];
const FS_TRADE_REC:    string[] = ["BS_CA_TR"];
const FS_TRADE_PAY:    string[] = ["BS_CL_TP"];

// P&L
const FS_REV_OPS:     string[] = ["PL_REV_OPS"];
const FS_FINANCE:     string[] = ["PL_EXP_FIN"];
// FS_DEPRECIATION deliberately omitted: non_cash_op_exp requires manual entry
// because it encompasses depreciation + provisions + impairments + write-offs.

const FS_ALL_REVENUE: string[] = ["PL_REV_OPS", "PL_REV_OI"];
const FS_ALL_EXPENSES: string[] = [
  "PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII",
  "PL_EXP_EMP", "PL_EXP_FIN", "PL_EXP_DEP",
  "PL_EXP_OTH", "PL_EXP_OEX",
];

// ═════════════════════════════════════════════════════════════════════════
// Stage7Ratios — the shape persisted in audit_engagements.stage7_ratios
// ═════════════════════════════════════════════════════════════════════════

/**
 * A single user-defined custom ratio added beyond the 11 standard ones.
 * Stored inline with its CY and PY numerator/denominator values.
 */
export interface CustomRatio {
  id: string;                          // unique key (Date.now string)
  name: string;                        // "MY CUSTOM RATIO"
  unit: "times" | "%";
  numeratorLabel: string;
  denominatorLabel: string;
  cy: { numerator: number | null; denominator: number | null };
  py: { numerator: number | null; denominator: number | null };
  commentary: string;
}

export interface Stage7Ratios {
  /** Raw input fields for Current Year */
  cy: RatioInputs;
  /** Raw input fields for Prior Year */
  py: RatioInputs;
  /** Per-ratio analyst commentary — one entry per ratio (ratioId 1-11) */
  commentary: { ratioId: number; text: string }[];
  /**
   * Dot-paths (e.g. "cy.npat", "py.working_capital") that the user has
   * manually set. autoPopulateRatios will NOT overwrite these paths.
   */
  manual_overrides: string[];
  /** User-defined ratios beyond the standard 11 (persisted in JSONB). */
  custom_ratios: CustomRatio[];
}

const DEFAULT_COMMENTARY: Stage7Ratios["commentary"] = Array.from(
  { length: 11 },
  (_, i) => ({ ratioId: i + 1, text: "" }),
);

export const DEFAULT_STAGE7_RATIOS: Stage7Ratios = {
  cy:                blankRatioInputs(),
  py:                blankRatioInputs(),
  commentary:        DEFAULT_COMMENTARY,
  manual_overrides:  [],
  custom_ratios:     [],
};

// ═════════════════════════════════════════════════════════════════════════
// DB helpers
// ═════════════════════════════════════════════════════════════════════════

export async function loadStage7Ratios(engagementId: string): Promise<Stage7Ratios> {
  const { data } = await supabase
    .from("audit_engagements")
    .select("stage7_ratios")
    .eq("id", engagementId)
    .maybeSingle();

  const raw = (data as any)?.stage7_ratios;
  if (raw && typeof raw === "object") {
    return {
      ...DEFAULT_STAGE7_RATIOS,
      ...raw,
      cy:               { ...blankRatioInputs(), ...(raw.cy  ?? {}) },
      py:               { ...blankRatioInputs(), ...(raw.py  ?? {}) },
      commentary:       Array.isArray(raw.commentary)       ? raw.commentary       : DEFAULT_COMMENTARY,
      manual_overrides: Array.isArray(raw.manual_overrides) ? raw.manual_overrides : [],
      custom_ratios:    Array.isArray(raw.custom_ratios)    ? raw.custom_ratios    : [],
    };
  }
  return JSON.parse(JSON.stringify(DEFAULT_STAGE7_RATIOS));
}

export async function saveStage7Ratios(
  engagementId: string,
  ratios: Stage7Ratios,
): Promise<void> {
  const { error } = await supabase
    .from("audit_engagements")
    .update({ stage7_ratios: ratios as any } as any)
    .eq("id", engagementId);
  if (error) throw error;
}

// ═════════════════════════════════════════════════════════════════════════
// Manual-override helpers  (same contract as notesAutoPopulate)
// ═════════════════════════════════════════════════════════════════════════

/** Add a dot-path (e.g. "cy.npat") to manual_overrides. Returns new array. */
export function markOverride(ratios: Stage7Ratios, path: string): string[] {
  if (ratios.manual_overrides.includes(path)) return ratios.manual_overrides;
  return [...ratios.manual_overrides, path];
}

/** Remove a dot-path from manual_overrides. Returns new array. */
export function clearOverride(ratios: Stage7Ratios, path: string): string[] {
  return ratios.manual_overrides.filter((p) => p !== path);
}

// ─── Dot-path accessors ──────────────────────────────────────────────────────

function getAtPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  return path
    .split(".")
    .reduce<unknown>((cur, key) => (cur == null ? cur : (cur as Record<string, unknown>)[key]), obj);
}

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!obj || !path) return;
  const segs = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

/**
 * Merge `auto` into `existing`, preserving every path listed in
 * `existing.manual_overrides`. Returns a new Stage7Ratios (inputs are
 * not mutated).  Commentary is merged field-by-field: auto-generated text
 * is used unless the user has edited that ratioId's entry (tracked via
 * "commentary.<ratioId>" override paths).
 */
export function respectManualOverrides(
  auto:     Stage7Ratios,
  existing: Stage7Ratios,
): Stage7Ratios {
  const overrides = Array.isArray(existing.manual_overrides)
    ? existing.manual_overrides
    : [];

  const merged: Stage7Ratios = JSON.parse(JSON.stringify(auto));
  merged.manual_overrides = [...overrides];

  for (const path of overrides) {
    const userValue = getAtPath(existing, path);
    if (userValue !== undefined) {
      setAtPath(merged as unknown as Record<string, unknown>, path, userValue);
    }
  }

  return merged;
}

// ═════════════════════════════════════════════════════════════════════════
// Core derivation helpers
// ═════════════════════════════════════════════════════════════════════════

/** null when value is exactly 0 (unset) — avoids spurious 0 entries. */
function nullIfZero(v: number): number | null {
  return v === 0 ? null : v;
}

/** Average of two values; null if either is null. */
function avg(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : Math.round(((a + b) / 2) * 100) / 100;
}

// ─── CY inputs from the live Trial Balance ───────────────────────────────────

async function buildCYInputs(
  engagementId: string,
  pyFs: Record<string, number>,
): Promise<RatioInputs> {
  const [tb, mapping] = await Promise.all([
    getTrialBalance(engagementId),
    getCOAMapping(engagementId),
  ]);

  /**
   * Sum TB ledgers for a list of FS codes and apply a sign multiplier.
   *   ASSET_SIGN (+1) for DR-positive accounts (assets, expenses).
   *   CR_SIGN    (-1) for CR-negative accounts (liabilities, equity, revenue).
   */
  const tbSum = (codes: string[], sign: typeof ASSET_SIGN | typeof CR_SIGN): number =>
    sign * sumLedgersByFsCodes(tb, mapping, codes);

  /**
   * Fetch prior year's closing balance for a set of FS codes from
   * fa_financial_statements (amount_cy carries the same sign convention).
   */
  const pySum = (codes: string[], sign: typeof ASSET_SIGN | typeof CR_SIGN): number =>
    sign * codes.reduce((acc, code) => acc + (pyFs[code] ?? 0), 0);

  // ── Balance Sheet: Current Assets ──────────────────────────────────────
  const currentAssets   = tbSum(FS_CURR_ASSETS, ASSET_SIGN);

  // ── Balance Sheet: Current Liabilities ─────────────────────────────────
  const currentLiab     = tbSum(FS_CURR_LIAB, CR_SIGN);

  // ── Balance Sheet: Equity ──────────────────────────────────────────────
  const shareCap        = tbSum(FS_SHARE_CAP, CR_SIGN);
  const reserves        = tbSum(FS_RESERVES,  CR_SIGN);
  const equity          = shareCap + reserves;

  // ── Balance Sheet: Debt ────────────────────────────────────────────────
  const ltBorr          = tbSum(FS_LT_BORROWINGS, CR_SIGN);
  const stBorr          = tbSum(["BS_CL_STB"],     CR_SIGN);
  const totalDebt       = ltBorr + stBorr;

  // ── Balance Sheet: individual CA lines (for averages) ──────────────────
  const cyInventories   = tbSum(FS_INVENTORIES, ASSET_SIGN);
  const cyTradeRec      = tbSum(FS_TRADE_REC,   ASSET_SIGN);
  const cyTradePay      = tbSum(FS_TRADE_PAY,   CR_SIGN);
  const cyNcInv         = tbSum(FS_NC_INV,       ASSET_SIGN);
  const cyCurrInv       = tbSum(FS_CURR_INV,     ASSET_SIGN);

  // ── Prior-year closing balances (for CY averages) ──────────────────────
  const pyInventories   = pySum(FS_INVENTORIES, ASSET_SIGN);
  const pyTradeRec      = pySum(FS_TRADE_REC,   ASSET_SIGN);
  const pyTradePay      = pySum(FS_TRADE_PAY,   CR_SIGN);
  const pyEquity        = pySum(FS_SHARE_CAP,   CR_SIGN) + pySum(FS_RESERVES, CR_SIGN);
  const pyNcInv         = pySum(FS_NC_INV,       ASSET_SIGN);
  const pyCurrInv       = pySum(FS_CURR_INV,     ASSET_SIGN);

  // CY averages = (CY closing + PY closing) / 2
  // When PY data is missing (pyFs is empty), avg() returns null → stays null
  const hasPY = Object.keys(pyFs).length > 0;
  const avgInventories  = hasPY ? avg(cyInventories, pyInventories)  : null;
  const avgTradeRec     = hasPY ? avg(cyTradeRec,   pyTradeRec)     : null;
  const avgTradePay     = hasPY ? avg(cyTradePay,   pyTradePay)     : null;
  const avgEquity       = hasPY ? avg(equity,        pyEquity)       : null;
  const avgInvFund      = hasPY
    ? avg(cyNcInv + cyCurrInv, pyNcInv + pyCurrInv)
    : null;

  // ── P&L ────────────────────────────────────────────────────────────────
  // Revenue: CR-convention in TB → apply CR_SIGN to get positive magnitude
  const revOps          = tbSum(FS_REV_OPS,   CR_SIGN);
  const financeCosts    = tbSum(FS_FINANCE,    ASSET_SIGN);
  // (depreciation is NOT derived separately — non_cash_op_exp is manual)

  // NPBT = total revenue − total expenses (before tax)
  const totalRevenue    = tbSum(FS_ALL_REVENUE,  CR_SIGN);
  const totalExpenses   = tbSum(FS_ALL_EXPENSES, ASSET_SIGN);
  const npbt            = totalRevenue - totalExpenses;

  // Working capital
  const workingCapital  = currentAssets - currentLiab;

  return {
    current_assets:          nullIfZero(currentAssets),
    current_liabilities:     nullIfZero(currentLiab),
    total_debt:              nullIfZero(totalDebt),
    shareholders_equity:     nullIfZero(equity),
    /** NPAT cannot be derived without tax FS codes — leave for manual entry */
    npat:                    null,
    /** Non-cash op exp (depreciation + provisions + write-offs): manual entry */
    non_cash_op_exp:         null,
    interest:                nullIfZero(financeCosts),
    /** Other non-cash adjustments: manual entry */
    other_non_cash_adj:      null,
    /** Lease interest: manual entry (not separated in standard FS codes) */
    interest_lease:          null,
    /** Principal repayments: manual entry */
    principal_repayments:    null,
    avg_shareholders_equity: avgEquity,
    revenue_ops:             nullIfZero(revOps),
    avg_inventories:         avgInventories,
    avg_trade_receivables:   avgTradeRec,
    /** Net credit purchases: manual entry */
    net_credit_purchases:    null,
    avg_trade_payables:      avgTradePay,
    working_capital:         nullIfZero(workingCapital),
    npbt:                    nullIfZero(npbt),
    /** Net worth = shareholders' equity for standard ratio computation */
    net_worth:               nullIfZero(equity),
    lt_borrowings:           nullIfZero(ltBorr),
    /** Return / Profit / Earnings: manual entry (ratio 11 measure varies by firm) */
    return_profit:           null,
    avg_investment_fund:     avgInvFund,
  };
}

// ─── Fallback: build a pyFs amount-map from the prior-year TB ────────────────
//
// When no fa_financial_statements row exists for the prior engagement (most
// commonly because the auditor opened a PY-shell engagement with Tally data
// but never saved Stage 7 FS), we synthesize the same shape here by summing
// the prior TB ledgers per FS code using the CURRENT engagement's COA
// mapping. The ledger names are stable across years in Tally, so the CY
// mapping is a safe stand-in. Returns the same { "BS_*"|"PL_*": amount }
// shape that buildCYInputs / buildPYInputsFromFs expect.
async function buildPyFsFromPriorTb(
  engagementId: string,
): Promise<Record<string, number>> {
  // Find the prior-year engagement (prefer PY shell)
  const { data: eng } = await supabase
    .from("audit_engagements")
    .select("client_id, financial_year")
    .eq("id", engagementId)
    .maybeSingle();
  const clientId = (eng as any)?.client_id;
  const fy       = (eng as any)?.financial_year;
  if (!clientId || !fy) return {};
  const parts = String(fy).split("-");
  if (parts.length !== 2) return {};
  const prevFy = `${parseInt(parts[0], 10) - 1}-${String(parseInt(parts[0], 10)).slice(-2)}`;
  const { data: engList } = await supabase
    .from("audit_engagements")
    .select("id, is_py_shell")
    .eq("client_id", clientId)
    .eq("financial_year", prevFy);
  const sorted = ((engList || []) as any[]).sort(
    (a, b) => (b.is_py_shell ? 1 : 0) - (a.is_py_shell ? 1 : 0)
  );
  const prevEngId = sorted[0]?.id;
  if (!prevEngId) return {};

  // Fetch prior TB + use CY mapping
  const [pyTb, mapping] = await Promise.all([
    getTrialBalance(prevEngId),
    getCOAMapping(engagementId),
  ]);

  // Group by FS code, summing TB balances (signed)
  const out: Record<string, number> = {};
  for (const ledger of pyTb) {
    const code = mapping[ledger.account_name]?.code;
    if (!code) continue;
    out[code] = (out[code] ?? 0) + Number(ledger.balance ?? 0);
  }
  return out;
}

// ─── PY inputs from prior-year fa_financial_statements ───────────────────────
//
// The prior engagement's CY data becomes the current engagement's PY data.
// Average fields are left null because we don't have the prior-prior year's
// closing balances (that would require a second level of recursion).

function buildPYInputsFromFs(pyFs: Record<string, number>): RatioInputs {
  if (Object.keys(pyFs).length === 0) return blankRatioInputs();

  const get = (codes: string[], sign: typeof ASSET_SIGN | typeof CR_SIGN): number =>
    sign * codes.reduce((acc, code) => acc + (pyFs[code] ?? 0), 0);

  const currentAssets   = get(FS_CURR_ASSETS,     ASSET_SIGN);
  const currentLiab     = get(FS_CURR_LIAB,       CR_SIGN);
  const shareCap        = get(FS_SHARE_CAP,        CR_SIGN);
  const reserves        = get(FS_RESERVES,         CR_SIGN);
  const equity          = shareCap + reserves;
  const ltBorr          = get(FS_LT_BORROWINGS,   CR_SIGN);
  const stBorr          = get(["BS_CL_STB"],       CR_SIGN);
  const totalDebt       = ltBorr + stBorr;
  const revOps          = get(FS_REV_OPS,     CR_SIGN);
  const financeCosts    = get(FS_FINANCE,      ASSET_SIGN);
  const totalRevenue    = get(FS_ALL_REVENUE,  CR_SIGN);
  const totalExpenses   = get(FS_ALL_EXPENSES,      ASSET_SIGN);
  const npbt            = totalRevenue - totalExpenses;
  const inventories     = get(FS_INVENTORIES,       ASSET_SIGN);
  const tradeRec        = get(FS_TRADE_REC,         ASSET_SIGN);
  const tradePay        = get(FS_TRADE_PAY,         CR_SIGN);
  const ncInv           = get(FS_NC_INV,            ASSET_SIGN);
  const currInv         = get(FS_CURR_INV,          ASSET_SIGN);
  const workingCapital  = currentAssets - currentLiab;

  return {
    current_assets:          nullIfZero(currentAssets),
    current_liabilities:     nullIfZero(currentLiab),
    total_debt:              nullIfZero(totalDebt),
    shareholders_equity:     nullIfZero(equity),
    npat:                    null,
    /** Non-cash op exp: manual entry (depreciation alone is incomplete) */
    non_cash_op_exp:         null,
    interest:                nullIfZero(financeCosts),
    other_non_cash_adj:      null,
    interest_lease:          null,
    principal_repayments:    null,
    /** PY averages need prior-prior year data — leave for manual entry */
    avg_shareholders_equity: null,
    revenue_ops:             nullIfZero(revOps),
    /** PY avg = (PY closing + PPY closing) / 2 — PPY not available; use closing */
    avg_inventories:         nullIfZero(inventories),
    avg_trade_receivables:   nullIfZero(tradeRec),
    net_credit_purchases:    null,
    avg_trade_payables:      nullIfZero(tradePay),
    working_capital:         nullIfZero(workingCapital),
    npbt:                    nullIfZero(npbt),
    net_worth:               nullIfZero(equity),
    lt_borrowings:           nullIfZero(ltBorr),
    return_profit:           null,
    avg_investment_fund:     nullIfZero(ncInv + currInv),
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Public orchestrator
// ═════════════════════════════════════════════════════════════════════════

/**
 * Generate a freshly-populated Stage7Ratios object for an engagement.
 *
 * Behaviour:
 *   1. Fetches CY trial balance + COA mapping.
 *   2. Fetches prior-year fa_financial_statements amounts (PY fallback).
 *   3. Derives all auto-linkable CY fields; computes averages where PY data
 *      is available.
 *   4. Derives PY inputs from the prior engagement's FS amounts.
 *   5. Carries forward commentary and manual_overrides from `existing`.
 *   6. If `existing` is supplied, runs respectManualOverrides() so
 *      user-touched fields are never overwritten.
 *
 * Caller is responsible for persisting the result via saveStage7Ratios().
 */
export async function autoPopulateRatios(
  engagementId: string,
  options: { existing?: Stage7Ratios | null } = {},
): Promise<Stage7Ratios> {
  // Fetch prior-year FS amounts first so buildCYInputs can compute averages.
  // If the prior engagement has NO fa_financial_statements rows (typical for
  // a freshly-created PY shell), pyFs is empty and the PY ratio annexure
  // stays blank. Fall back to deriving a pyFs map from the prior-year TB,
  // mirroring the same FS-code aggregation used for the CY column.
  let pyFs = await getPreviousYearFsAmounts(engagementId);
  if (Object.keys(pyFs).length === 0) {
    try {
      pyFs = await buildPyFsFromPriorTb(engagementId);
    } catch { /* leave as empty */ }
  }

  const [cyInputs, pyInputs] = await Promise.all([
    buildCYInputs(engagementId, pyFs),
    Promise.resolve(buildPYInputsFromFs(pyFs)),
  ]);

  const auto: Stage7Ratios = {
    cy:               cyInputs,
    py:               pyInputs,
    // Carry forward existing commentary; blank if no prior data
    commentary:       options.existing?.commentary ?? JSON.parse(JSON.stringify(DEFAULT_COMMENTARY)),
    manual_overrides: options.existing?.manual_overrides ?? [],
    // Preserve user-defined custom ratios — never overwrite on re-sync
    custom_ratios:    options.existing?.custom_ratios ?? [],
  };

  // Merge with existing, honouring every manually-overridden path
  if (options.existing) {
    return respectManualOverrides(auto, options.existing);
  }

  return auto;
}
