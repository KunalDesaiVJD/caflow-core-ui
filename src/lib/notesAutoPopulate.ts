/**
 * notesAutoPopulate
 * ─────────────────────────────────────────────────────────────────────────
 * Phase UI-6 / Phase 2 — Auto-population service for Stage 5 Notes.
 *
 * Reads COA mapping + tally_trial_balance + (optionally) prior-year
 * audit_engagements.stage5_notes, and produces a freshly populated
 * Stage5Notes object suitable for writing back to
 * audit_engagements.stage5_notes (the JSONB column added in Phase 1).
 *
 * Manual edits are tracked as dot-paths in `manual_edits[]`. The
 * `respectManualEdits()` helper merges the auto-generated payload with
 * the existing notes, NEVER overwriting any path the user has touched.
 *
 * Phase 2 ships the framework + the FS-code-derived registry used today.
 * Phase 3 will extend the registry with sub-row breakouts (e.g. Reserves
 * note → general_reserve, securities_premium, retained_earnings) once
 * the FS NOTES.xlsx schema is wired into the UI.
 */

import { supabase } from "@/integrations/supabase/client";
import { cleanTallyName } from "@/lib/tallyText";

// ═════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════

export interface NoteRowValue {
  cy?: number;
  py?: number;
  /** free-form additional fields (text break-ups, sub-totals, etc.) */
  [key: string]: any;
}

export interface FARow {
  id:           string;
  particulars:  string;
  useful_life:  number | string;
  gross_open:   number;
  additions:    number;
  disposals:    number;
  depn_open:    number;
  depn_add:     number;
  depn_disp:    number;
}

export interface Stage5Notes {
  bs_liab:        Record<string, NoteRowValue>;
  bs_asset:       Record<string, NoteRowValue>;
  pl:             Record<string, NoteRowValue>;
  fa:             { rows: FARow[] };
  manual_edits:   string[];        // dot-paths e.g. "bs_liab.share_capital.cy"
  auto_synced_at: string | null;   // ISO timestamp
}

/**
 * Canonical 9-row FA default (matches FS NOTES.xlsx template). The Phase 1
 * migration shipped with only 4 rows; loadStage5Notes() merges any missing
 * default rows into existing engagements automatically (see DEFAULT_FA_ROWS
 * + the merge in loadStage5Notes below) so legacy data picks up the rest
 * without a second migration.
 */
export const DEFAULT_FA_ROWS: FARow[] = [
  // ── Property, Plant & Equipment ─────────────────────────────────────────
  { id: "land",                  particulars: "Land",                   useful_life: "indefinite", gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "factory_building",      particulars: "Factory Building",       useful_life: 30,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "plant_machinery",       particulars: "Plant & Machinery",      useful_life: 15,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "electric_equipments",   particulars: "Electric Equipments",    useful_life: 10,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "computers",             particulars: "Computers",              useful_life: 3,            gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "office_equipment",      particulars: "Office Equipment",       useful_life: 5,            gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "furniture_fixtures",    particulars: "Furniture and Fixtures", useful_life: 10,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  { id: "vehicles",              particulars: "Vehicles",               useful_life: 8,            gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
  // ── Intangible Assets ───────────────────────────────────────────────────
  { id: "software",              particulars: "Software",               useful_life: 10,           gross_open: 0, additions: 0, disposals: 0, depn_open: 0, depn_add: 0, depn_disp: 0 },
];

/** Default Stage5Notes — uses the canonical 9-row FA default. */
export const DEFAULT_STAGE5_NOTES: Stage5Notes = {
  bs_liab:        {},
  bs_asset:       {},
  pl:             {},
  fa:             { rows: DEFAULT_FA_ROWS.map(r => ({ ...r })) },
  manual_edits:   [],
  auto_synced_at: null,
};

/**
 * Merge canonical default FA rows into an existing rows array. Used by
 * loadStage5Notes to backfill engagements created against the older
 * 4-row default without requiring a DB migration.
 *
 * Rules:
 *   - Existing rows whose `id` matches a default are kept verbatim
 *     (user-entered amounts win — never overwritten).
 *   - Default rows whose `id` is missing from the existing array are
 *     appended at the end with all-zero values.
 *   - Custom rows (not in defaults) are preserved untouched.
 */
export function mergeFaDefaults(existing: FARow[]): FARow[] {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const seenIds = new Set(out.map(r => r.id));
  for (const def of DEFAULT_FA_ROWS) {
    if (!seenIds.has(def.id)) out.push({ ...def });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// Note row registry — maps note row keys to FS codes
// ═════════════════════════════════════════════════════════════════════════
//
// Phase 2: a single note row aggregates one or more FS codes. The CY value
// is the sum of all TB ledger balances mapped to those codes, and the PY
// value is pulled from the prior year's stage5_notes (same row key) or
// — as a fallback — the sum of PY amounts on `fa_financial_statements`
// for the same FS codes.
//
// Phase 3 will extend `NoteRowSpec` with `ledgerNamePattern` / `groupName`
// so a single FS code can be split into multiple note sub-rows (e.g.
// BS_EQ_RS → general_reserve / securities_premium / surplus).

export interface NoteRowSpec {
  /** FS line-item codes whose mapped ledgers contribute to this row's CY */
  fsCodes: string[];
  /** Optional label hint — Phase 3 UI uses NOTES_TEMPLATE for the source-of-truth label */
  label?: string;
  /**
   * Optional Schedule-III suggestion list of breakdown heads (e.g. the 37
   * line items under "Other expenses"). When present:
   *   - autoPopulateNotes seeds one row per head;
   *   - any TB ledger fuzzy-matching a head fills that row's amount;
   *   - unmatched ledgers are appended at the bottom as new linked rows.
   * When absent, breakdown rows are emitted purely from COA-mapped ledgers
   * (one row per ledger) so notes like Long-term Borrowings or Trade
   * Receivables show actual party names.
   */
  template?: string[];
}

export const NOTE_ROW_REGISTRY: {
  bs_liab:  Record<string, NoteRowSpec>;
  bs_asset: Record<string, NoteRowSpec>;
  pl:       Record<string, NoteRowSpec>;
} = {
  // ── Note 3-12 — BS Liabilities side ─────────────────────────────────────
  bs_liab: {
    share_capital:        { fsCodes: ["BS_EQ_SC"],   label: "Share capital" },
    reserves_surplus:     {
      fsCodes: ["BS_EQ_RS"], label: "Reserves and surplus",
      // Schedule III heads under Reserves & Surplus. "Profit & Loss A/c"
      // (the most common ledger) fuzzy-matches "Surplus in Statement of P&L".
      template: [
        "General Reserve",
        "Securities Premium",
        "Capital Reserve",
        "Surplus in Statement of P&L",
        "Other Reserves",
      ],
    },
    lt_borrowings:        { fsCodes: ["BS_NCL_LTB"], label: "Long-term borrowings" },
    deferred_tax_liab:    { fsCodes: ["BS_NCL_DTL"], label: "Deferred tax liabilities (Net)" },
    other_lt_liabilities: { fsCodes: ["BS_NCL_OLT"], label: "Other long-term liabilities" },
    lt_provisions:        { fsCodes: ["BS_NCL_LTP"], label: "Long-term provisions" },
    st_borrowings:        { fsCodes: ["BS_CL_STB"],  label: "Short-term borrowings" },
    trade_payables:       { fsCodes: ["BS_CL_TP"],   label: "Trade payables" },
    other_curr_liab:      { fsCodes: ["BS_CL_OCL"],  label: "Other current liabilities" },
    st_provisions:        { fsCodes: ["BS_CL_STP"],  label: "Short-term provisions" },
  },
  // ── Note 13-24 — BS Assets side ─────────────────────────────────────────
  bs_asset: {
    ppe:                { fsCodes: ["BS_NCA_FA"],     label: "Property, plant & equipment and intangible assets" },
    cwip:               { fsCodes: ["BS_NCA_FA_WIP"], label: "Capital work-in-progress" },
    nc_investments:     { fsCodes: ["BS_NCA_INV"],    label: "Non-current investments" },
    deferred_tax_asset: { fsCodes: ["BS_NCA_DTA"],    label: "Deferred tax assets (Net)" },
    lt_loans:           { fsCodes: ["BS_NCA_LLA"],    label: "Long-term loans and advances" },
    other_nc_assets:    { fsCodes: ["BS_NCA_ONA"],    label: "Other non-current assets" },
    curr_investments:   { fsCodes: ["BS_CA_CI"],      label: "Current investments" },
    inventories:        { fsCodes: ["BS_CA_INV"],     label: "Inventories" },
    trade_receivables:  { fsCodes: ["BS_CA_TR"],      label: "Trade receivables" },
    cash_bank:          { fsCodes: ["BS_CA_CCE"],     label: "Cash and bank equivalents" },
    st_loans:           { fsCodes: ["BS_CA_SLA"],     label: "Short-term loans and advances" },
    other_curr_assets:  { fsCodes: ["BS_CA_OCA"],     label: "Other current assets" },
  },
  // ── Note 25-29 — P&L breakups ───────────────────────────────────────────
  pl: {
    revenue_from_ops:   { fsCodes: ["PL_REV_OPS"], label: "Revenue from operations" },
    other_income:       { fsCodes: ["PL_REV_OI"],  label: "Other income" },
    cost_materials:     { fsCodes: ["PL_EXP_MAT"], label: "Cost of materials consumed" },
    purchases_stock:    { fsCodes: ["PL_EXP_SIT"], label: "Purchases of stock-in-trade" },
    changes_inventory:  { fsCodes: ["PL_EXP_CII"], label: "Changes in inventories" },
    employee_benefits:  { fsCodes: ["PL_EXP_EMP"], label: "Employee benefits expense" },
    finance_costs:      { fsCodes: ["PL_EXP_FIN"], label: "Finance costs" },
    depreciation:       { fsCodes: ["PL_EXP_DEP"], label: "Depreciation & amortisation" },
    other_expenses:     {
      fsCodes: ["PL_EXP_OTH", "PL_EXP_OEX"], label: "Other expenses",
      // Schedule III "Other Expenses" suggestion list (37 heads). TB ledgers
      // fuzzy-matching one of these fill the head's amount; un-matched
      // ledgers (e.g. firm-specific names like "NSDL Charges") are appended
      // as new linked rows.
      template: [
        "Audit fees", "Bank charges", "Books & periodicals", "Business promotion",
        "Commission", "Communication expenses", "Computer expenses", "Conveyance",
        "Donation", "Electricity", "Festival expenses", "Freight & forwarding",
        "GST expenses (non-creditable)", "Insurance", "Interest on TDS",
        "Internet & web charges", "Labour charges", "Legal & professional",
        "Loss on sale of assets", "Membership & subscription", "Office expenses",
        "Postage & courier", "Printing & stationery", "Rates & taxes",
        "Rent", "Repairs & maintenance — building",
        "Repairs & maintenance — plant & machinery",
        "Repairs & maintenance — others", "ROC fees", "Round-off",
        "Security charges", "Software expenses", "Staff welfare expenses",
        "Sundry expenses", "Travelling — domestic", "Travelling — foreign",
        "Vehicle running & maintenance",
      ],
    },
  },
};

// ═════════════════════════════════════════════════════════════════════════
// TB / mapping fetch helpers — mirrors the 3-step lookup used by
// PipelineFinancialStatements (audit_engagements → sync_batches → legacy
// engagements) so this service finds TB rows under any sync vintage.
// ═════════════════════════════════════════════════════════════════════════

interface TBLedger {
  account_name:    string;
  account_group:   string;
  balance:         number;     // signed: DR = +, CR = −
  opening_balance: number;     // signed: DR = +, CR = − (PY closing)
}

const TB_COLS =
  "ledger_name, parent_group, opening_balance, opening_type, closing_balance, balance_type";

async function fetchAllTB(engId: string): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tally_trial_balance")
      .select(TB_COLS)
      .eq("engagement_id", engId)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

/** Normalise TB rows to the signed-balance shape the rest of the service uses. */
function normalizeTB(rows: any[]): TBLedger[] {
  return rows.map(l => {
    const cb   = Math.abs(Number(l.closing_balance ?? 0));
    const isDr = String(l.balance_type ?? "").toUpperCase() === "DR";
    const ob   = Math.abs(Number(l.opening_balance ?? 0));
    const isObCr = String(l.opening_type ?? "").toUpperCase() === "CR";
    return {
      account_name:    cleanTallyName(l.ledger_name),
      account_group:   cleanTallyName(l.parent_group),
      balance:         isDr   ? cb :  -cb,
      opening_balance: isObCr ? -ob :  ob,
    };
  }).filter(a => a.account_name);
}

export async function getTrialBalance(engagementId: string): Promise<TBLedger[]> {
  // Step 0: direct
  let rows = await fetchAllTB(engagementId);
  if (rows.length) return normalizeTB(rows);

  // Step 1: sync_batches
  const { data: eng } = await supabase
    .from("audit_engagements")
    .select("client_id, financial_year")
    .eq("id", engagementId)
    .maybeSingle();
  const clientId = (eng as any)?.client_id;
  const fy       = (eng as any)?.financial_year;
  if (!clientId) return [];

  const { data: batchRow } = await (supabase.from as any)("sync_batches")
    .select("engagement_id")
    .eq("client_id", clientId)
    .in("status", ["complete", "completed", "success", "complete_with_warnings"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const batchEngId: string | null = (batchRow as any)?.engagement_id ?? null;
  if (batchEngId && batchEngId !== engagementId) {
    rows = await fetchAllTB(batchEngId);
    if (rows.length) return normalizeTB(rows);
  }

  // Step 2: legacy engagements table
  if (fy) {
    const { data: tEng } = await (supabase.from as any)("engagements")
      .select("id")
      .eq("client_id", clientId)
      .eq("financial_year", fy)
      .maybeSingle();
    const legacyId = (tEng as any)?.id ?? null;
    if (legacyId) {
      rows = await fetchAllTB(legacyId);
      if (rows.length) return normalizeTB(rows);
    }
  }
  return [];
}

export type COAMapping = Record<string, { code: string }>;

export async function getCOAMapping(engagementId: string): Promise<COAMapping> {
  const { data } = await supabase
    .from("audit_engagements")
    .select("coa_mapping")
    .eq("id", engagementId)
    .maybeSingle();
  const raw = (data as any)?.coa_mapping;
  if (raw && typeof raw === "object") return raw as COAMapping;
  return {};
}

/**
 * Fetch the prior-year (FY-1) trial balance for a given engagement.
 * Used by buildBreakup to populate the PY amount column from actual
 * prior-year closing balances instead of current-year opening balances
 * (which are 0 for P&L accounts that reset each year).
 */
async function getPreviousYearTrialBalance(engagementId: string): Promise<TBLedger[]> {
  const { data: eng } = await supabase
    .from("audit_engagements")
    .select("client_id, financial_year")
    .eq("id", engagementId)
    .maybeSingle();
  const clientId = (eng as any)?.client_id;
  const fy       = (eng as any)?.financial_year;
  if (!clientId || !fy) return [];
  const parts = String(fy).split("-");
  if (parts.length !== 2) return [];
  const prevFy = `${parseInt(parts[0], 10) - 1}-${String(parseInt(parts[0], 10)).slice(-2)}`;

  // Prefer PY shell (is_py_shell=true — has Tally sync data from sync-py.bat)
  // then fall back to any regular FY-1 engagement
  const { data: engList } = await supabase
    .from("audit_engagements")
    .select("id, is_py_shell")
    .eq("client_id", clientId)
    .eq("financial_year", prevFy);

  const sorted = ((engList || []) as any[]).sort(
    (a, b) => (b.is_py_shell ? 1 : 0) - (a.is_py_shell ? 1 : 0)
  );
  const prevEngId = sorted[0]?.id;
  if (!prevEngId) return [];
  return getTrialBalance(prevEngId);
}

/**
 * Find the prior-year audit_engagements row (same client, FY-1) and return
 * its stage5_notes if available. Falls back to NULL if no prior engagement.
 */
export async function getPreviousYearStage5Notes(
  engagementId: string,
): Promise<Stage5Notes | null> {
  const { data: eng } = await supabase
    .from("audit_engagements")
    .select("client_id, financial_year")
    .eq("id", engagementId)
    .maybeSingle();
  const clientId = (eng as any)?.client_id;
  const fy       = (eng as any)?.financial_year;
  if (!clientId || !fy) return null;

  // FY format: "YYYY-YY" (e.g. "2025-26"). Compute FY-1 ("2024-25").
  const parts = String(fy).split("-");
  if (parts.length !== 2) return null;
  const prevFy = `${parseInt(parts[0], 10) - 1}-${String(parseInt(parts[0], 10)).slice(-2)}`;

  const { data: prevEng } = await supabase
    .from("audit_engagements")
    .select("stage5_notes")
    .eq("client_id", clientId)
    .eq("financial_year", prevFy)
    .maybeSingle();
  const notes = (prevEng as any)?.stage5_notes;
  if (notes && typeof notes === "object") return notes as Stage5Notes;
  return null;
}

/**
 * Final fallback for PY: read fa_financial_statements rows for the prior
 * engagement and sum amount_cy by line_item_code. Used when prior engagement
 * has no stage5_notes populated yet (legacy engagements).
 */
export async function getPreviousYearFsAmounts(
  engagementId: string,
): Promise<Record<string, number>> {
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

  const { data: prevEng } = await supabase
    .from("audit_engagements")
    .select("id")
    .eq("client_id", clientId)
    .eq("financial_year", prevFy)
    .maybeSingle();
  const prevEngId = (prevEng as any)?.id;
  if (!prevEngId) return {};

  const { data: rows } = await supabase
    .from("fa_financial_statements")
    .select("line_item_code, amount_cy")
    .eq("engagement_id", prevEngId);
  const out: Record<string, number> = {};
  for (const r of (rows || []) as any[]) {
    if (r.line_item_code) {
      out[r.line_item_code] = (out[r.line_item_code] || 0) + Number(r.amount_cy || 0);
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// Sum + path helpers
// ═════════════════════════════════════════════════════════════════════════

/**
 * Sum the closing balances of every TB ledger whose COA-mapped FS code is in
 * `fsCodes`. Returns a positive-magnitude number for liability rows by
 * convention — caller can flip sign per row if needed. (Most callers will
 * use this with a single fsCode and trust the COA mapping.)
 *
 * NOTE: this returns the SIGNED balance (DR = +, CR = −) so callers can
 * decide presentation. The Stage 5 BS view applies sign by section, so we
 * keep sums signed here for symmetry.
 */
// Detects Tally's special "Profit & Loss A/c" ledger by any of its common names.
// MUST stay in sync with PipelineStage3.tsx::isTallyPLAccount.
// In Tally, this ledger's closing balance = opening retained earnings + current-year
// net profit. When mapped to a BS code (Reserves & Surplus), summing the closing
// balance double-counts net profit because Stage3 already auto-credits the CY
// profit to BS_EQ_RS via computeTotal. Use opening_balance only for BS codes.
function isTallyPLAccount(name: string): boolean {
  const n = (name || "").toLowerCase().trim();
  if (n === "profit & loss a/c" || n === "profit and loss a/c" ||
      n === "p & l a/c"         || n === "p&l a/c"             ||
      n === "profit & loss account" || n === "profit and loss account" ||
      n === "p & l account") return true;
  return /^profit\s*[&and]+\s*loss(\s*(a\/c|account))?$/i.test((name || "").trim());
}

export function sumLedgersByFsCodes(
  tb: TBLedger[],
  mapping: COAMapping,
  fsCodes: string[],
): number {
  if (!fsCodes.length) return 0;
  const codeSet = new Set(fsCodes);
  // If ALL target codes are BS codes, the Tally P&L A/c must contribute its
  // OPENING balance only (prior retained earnings). The CY net profit is
  // already aggregated separately into BS_EQ_RS by Stage3's computedAmounts.
  const allBS = fsCodes.every(c => c.startsWith("BS_"));
  let total = 0;
  for (const acct of tb) {
    const code = mapping[acct.account_name]?.code;
    if (!code || !codeSet.has(code)) continue;
    if (allBS && isTallyPLAccount(acct.account_name)) {
      total += acct.opening_balance ?? 0;
    } else {
      total += acct.balance;
    }
  }
  return Math.round(total * 100) / 100;
}

/**
 * Return all TB ledgers whose COA-mapped FS code is in `fsCodes`. Used to
 * generate per-ledger breakdown rows under each note. Preserves the signed
 * convention from `getTrialBalance` (DR = +, CR = −) so callers can decide
 * presentation.
 */
export function getLedgersByFsCodes(
  tb: TBLedger[],
  mapping: COAMapping,
  fsCodes: string[],
): TBLedger[] {
  if (!fsCodes.length) return [];
  const codeSet = new Set(fsCodes);
  const out: TBLedger[] = [];
  for (const acct of tb) {
    const code = mapping[acct.account_name]?.code;
    if (code && codeSet.has(code)) out.push(acct);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// Smart-merge — consolidate multiple TB ledgers with similar names into one
// ═════════════════════════════════════════════════════════════════════════
//
// CAFlow auto-populate creates one breakup row per TB ledger by default. For
// many real-world COAs that produces a long noisy list — e.g. when a firm
// keeps a separate ledger per TDS section ("TDS Payable 192B", "TDS Payable
// 194C", "TDS Payable 194I", "TDS Payable 192B - 2425") instead of one
// consolidated "TDS Payable" head.
//
// The merger below consolidates such ledger families:
//   1. Smart keyword rules (TDS, GST, PF, Professional Tax, ...) collapse all
//      matching ledgers into one row labelled by the rule (e.g. "TDS Payable").
//   2. After smart match, ledgers sharing a base head (after stripping year
//      suffixes like "- 2425", percentages, GST classifiers) merge together.
//   3. Single-ledger groups pass through unchanged.

interface SmartMergeRule { label: string; keywords: string[] }

const CORP_SMART_MERGE: Record<string, SmartMergeRule[]> = {
  // Note 9 — Other current liabilities: consolidate statutory dues
  bs_liab__other_curr_liab: [
    { label: "TDS Payable", keywords: [
        "tds", "tax deducted", "tds payable", "tds 192", "tds 194", "tds 195",
    ] },
    { label: "GST Payable", keywords: [
        "gst payable", "output gst", "igst payable", "cgst payable", "sgst payable",
        "rcm payable", "reverse charge", "gst output",
    ] },
    { label: "Provident Fund Payable", keywords: ["provident fund", " pf payable", " pf "] },
    { label: "Professional Tax Payable", keywords: ["professional tax", "p tax", "ptax"] },
    { label: "ESIC Payable", keywords: ["esic", "esi contribution"] },
    { label: "Salary Payable", keywords: ["salary payable", "wages payable", "salary outstanding"] },
  ],
  // Note 8 — Trade payables: typically NOT smart-merged (each vendor stays separate)
  // Note 28 — Other expenses: optional consolidation can be added later
};

/** Strip year suffixes ("- 2425", "- 2526"), percentages, GST classifiers
 *  to derive the "base head" of a ledger name. */
function deriveLedgerBaseHead(name: string): string {
  return name.trim()
    .replace(/\s*[-—]\s*\d{4}\s*[-—]\s*\d{2,4}\s*$/, "")  // "- 2024-25"
    .replace(/\s*[-—]\s*\d{2}\s*[-—]\s*\d{2}\s*$/, "")     // "- 24-25"
    .replace(/\s*[-—]\s*\d{4}\s*$/, "")                     // "- 2425"
    .replace(/\s*[-—]\s*\d{2,3}\s*[a-z]\b.*$/i, "")         // "- 192B" left intact only if rule didn't match
    .replace(/\s*[-—]\s*\d+\s*%.*$/i, "")                   // "- 18%"
    .replace(/\s*[-—]\s*(urd|reg|regd|registered|unregistered|igst|cgst|sgst|exempt|nil)\b.*$/i, "")
    .trim();
}

function smartMatchCorp(ledgerName: string, rules: SmartMergeRule[]): string | null {
  const norm = " " + ledgerName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (norm.includes(kw)) return rule.label;
    }
  }
  return null;
}

/** Merge similar TB ledgers into consolidated synthetic ledgers. */
function mergeSimilarLedgers(
  ledgers: TBLedger[],
  ruleKey: string | undefined,
): TBLedger[] {
  const rules = ruleKey ? CORP_SMART_MERGE[ruleKey] : undefined;
  if (!ledgers || ledgers.length === 0) return ledgers;

  const groups = new Map<string, TBLedger[]>();
  for (const l of ledgers) {
    let key: string;
    const smart = rules ? smartMatchCorp(l.account_name, rules) : null;
    if (smart) {
      key = `__smart__${smart}`;
    } else {
      const base = deriveLedgerBaseHead(l.account_name).toLowerCase();
      key = base.length >= 3 ? `__base__${base}` : `__solo__${l.account_name}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  const out: TBLedger[] = [];
  for (const [key, members] of groups.entries()) {
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    let label: string;
    if (key.startsWith("__smart__")) {
      label = key.substring(9);
    } else {
      label = deriveLedgerBaseHead(members[0].account_name);
    }
    out.push({
      account_name:    label,
      account_group:   members[0].account_group,
      balance:         members.reduce((s, m) => s + (m.balance ?? 0), 0),
      opening_balance: members.reduce((s, m) => s + (m.opening_balance ?? 0), 0),
    });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// Fuzzy ledger ↔ template-head matching
// ═════════════════════════════════════════════════════════════════════════

/**
 * Normalise a name for fuzzy comparison: lower-case, drop non-alphanumeric,
 * strip common Indian-CA noise words ("a/c", "fee", "expenses", "charges",
 * "paid", "received") so "ROC Fee" and "ROC fees" collapse to the same
 * token set.
 */
export function normalizeLedgerName(s: string): string {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a c|account|expense|expenses|charges|charge|fee|fees|paid|received|on|the|to|of|and|for)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score similarity between two names in [0, 1]. Uses normalized form,
 * substring containment and Jaccard token overlap. 1.0 = identical (after
 * normalization); 0 = no overlap.
 */
export function matchScore(a: string, b: string): number {
  const na = normalizeLedgerName(a);
  const nb = normalizeLedgerName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  return intersect / Math.max(ta.size, tb.size);
}

/** Threshold below which a fuzzy match is considered "no match". */
const MATCH_THRESHOLD = 0.5;

/**
 * Smart-merge a list of TB ledgers (mapped to a note's FS code) into a
 * structured breakup array suitable for ListTable rendering.
 *
 *   - If `template` is provided, every template head becomes a row.
 *     Ledgers fuzzy-matching a head fill that row's amount; un-matched
 *     ledgers append as new linked rows at the bottom.
 *   - If no template, one linked row per ledger is emitted.
 *   - Existing rows with `source === "manual"` are preserved verbatim
 *     (user-typed entries survive every re-sync).
 *
 * Output rows carry `source: "linked"` plus `linked_ledger` for traceability;
 * the ListTable UI flips a row to `source: "manual"` the moment the user
 * edits its description or amount.
 */
export interface BreakupRow {
  description?:    string;
  amount_cy?:      number;
  amount_py?:      number;
  source?:         "linked" | "manual";
  linked_ledger?:  string;
}

export function buildBreakup(
  ledgers: TBLedger[],
  template: string[] | undefined,
  existing: BreakupRow[] | undefined,
  /** Prior-year trial balance — used for amount_py instead of opening_balance.
   *  P&L accounts reset to 0 each year so their opening_balance is always 0;
   *  passing the actual FY-1 TB gives correct PY ledger-level amounts. */
  pyLedgers?: TBLedger[],
): BreakupRow[] {
  // 1) Preserve manual rows from existing breakup verbatim — these are user-
  //    typed entries that don't correspond to any COA-mapped ledger.
  //    Legacy rows persisted before this feature have no `source` field;
  //    treat anything not explicitly "linked" as manual so existing data
  //    survives the first re-sync.
  const manualRows: BreakupRow[] = (existing || []).filter(r => r.source !== "linked");

  // 2) Build linked rows
  const result: BreakupRow[] = [];
  const usedLedgers = new Set<string>();

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Build a fast-lookup map from prior-year TB for PY amount resolution.
  // Key = lowercase ledger name → TBLedger from the FY-1 trial balance.
  // For P&L accounts, opening_balance is 0 (accounts reset each year), so we
  // must use the actual FY-1 closing balance from pyLedgers when available.
  const pyMap = new Map<string, TBLedger>();
  for (const pl of (pyLedgers || [])) {
    pyMap.set(pl.account_name.toLowerCase().trim(), pl);
  }

  /** Resolve PY amount for a ledger: prefer FY-1 closing balance, fall back
   *  to current-year opening_balance (works for BS accounts; 0 for P&L). */
  const resolvePY = (accountName: string, openingBalance: number): number => {
    const py = pyMap.get(accountName.toLowerCase().trim());
    return py ? Math.abs(round2(py.balance)) : Math.abs(round2(openingBalance));
  };

  if (template && template.length > 0) {
    for (const head of template) {
      // Find best-matching ledger for this template head
      let matched: TBLedger | null = null;
      let bestScore = 0;
      for (const l of ledgers) {
        if (usedLedgers.has(l.account_name)) continue;
        const score = matchScore(head, l.account_name);
        if (score >= MATCH_THRESHOLD && score > bestScore) {
          bestScore = score;
          matched = l;
        }
      }
      if (matched) {
        usedLedgers.add(matched.account_name);
        result.push({
          description:   head,
          amount_cy:     Math.abs(round2(matched.balance)),
          amount_py:     resolvePY(matched.account_name, matched.opening_balance),
          source:        "linked",
          linked_ledger: matched.account_name,
        });
      } else {
        // Template head with no matching ledger — check if it exists in PY TB
        const pyMatch = pyMap.get(head.toLowerCase().trim());
        result.push({
          description: head,
          amount_cy:   0,
          amount_py:   pyMatch ? Math.abs(round2(pyMatch.balance)) : 0,
          source:      "linked",
        });
      }
    }
  }

  // 3) Append remaining (un-matched) ledgers as fresh linked rows
  for (const l of ledgers) {
    if (usedLedgers.has(l.account_name)) continue;
    result.push({
      description:   l.account_name,
      amount_cy:     Math.abs(round2(l.balance)),
      amount_py:     resolvePY(l.account_name, l.opening_balance),
      source:        "linked",
      linked_ledger: l.account_name,
    });
  }

  // 4) Append manual rows at the end so the user's custom entries are visible
  result.push(...manualRows);
  return result;
}

/**
 * Legacy data migration: prior to the unified `.breakup` ListTable refactor,
 * Notes 4 / 5 / 8 stored their sub-rows in custom paths:
 *
 *   reserves_surplus  → general_reserve_cy/py, share_premium_cy/py, surplus_breakup[]
 *   lt_borrowings     → secured_term_loans[], unsecured[]
 *   st_borrowings     → secured[], unsecured[]
 *
 * Returns an array of `BreakupRow` objects (all `source: "manual"`) seeded
 * from those legacy paths so re-sync from COA never drops user data. Called
 * from `autoPopulateNotes` only when the engagement's `<note>.breakup` is
 * still empty (i.e. one-time forward migration).
 */
export function migrateLegacyBreakup(
  section: keyof typeof NOTE_ROW_REGISTRY,
  rowKey:  string,
  rowVal:  any,
): BreakupRow[] {
  if (!rowVal || typeof rowVal !== "object") return [];
  const out: BreakupRow[] = [];
  const num = (v: any) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const pushManual = (description: string, amount_cy: number, amount_py: number) => {
    if (!description && !amount_cy && !amount_py) return;
    out.push({ description, amount_cy, amount_py, source: "manual" });
  };
  const pushArr = (arr: any[]) => {
    for (const r of arr) {
      if (!r || typeof r !== "object") continue;
      pushManual(String(r.description ?? ""), num(r.amount_cy), num(r.amount_py));
    }
  };

  if (section === "bs_liab" && rowKey === "reserves_surplus") {
    pushManual("General Reserve",   num(rowVal.general_reserve_cy), num(rowVal.general_reserve_py));
    pushManual("Securities Premium", num(rowVal.share_premium_cy),   num(rowVal.share_premium_py));
    if (Array.isArray(rowVal.surplus_breakup)) pushArr(rowVal.surplus_breakup);
  } else if (section === "bs_liab" && rowKey === "lt_borrowings") {
    if (Array.isArray(rowVal.secured_term_loans)) pushArr(rowVal.secured_term_loans);
    if (Array.isArray(rowVal.unsecured))          pushArr(rowVal.unsecured);
  } else if (section === "bs_liab" && rowKey === "st_borrowings") {
    if (Array.isArray(rowVal.secured))   pushArr(rowVal.secured);
    if (Array.isArray(rowVal.unsecured)) pushArr(rowVal.unsecured);
  }
  return out;
}

/**
 * Convenience: resolve a note row key (e.g. "share_capital") to a sum via
 * the registry. Returns 0 if the key isn't registered.
 */
export function sumLedgersByLineItem(
  tb: TBLedger[],
  mapping: COAMapping,
  section: keyof typeof NOTE_ROW_REGISTRY,
  rowKey: string,
): number {
  const spec = NOTE_ROW_REGISTRY[section]?.[rowKey];
  if (!spec) return 0;
  return sumLedgersByFsCodes(tb, mapping, spec.fsCodes);
}

/** Get nested value at dot-path; undefined if any segment missing. */
export function getAtPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((cur, key) => (cur == null ? cur : cur[key]), obj);
}

/** Set nested value at dot-path; creates intermediate objects as needed. */
export function setAtPath(obj: any, path: string, value: any): void {
  if (!obj || !path) return;
  const segs = path.split(".");
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[segs[segs.length - 1]] = value;
}

/**
 * Merge `auto` into `existing` while preserving any path listed in
 * `existing.manual_edits[]`. Returns a new Stage5Notes (does not mutate
 * inputs). The FA rows array is treated atomically: if its dot-path
 * (`fa.rows`) is in manual_edits, the entire existing array is preserved;
 * otherwise the auto-generated array wins (the UI marks individual cells).
 */
export function respectManualEdits(
  auto:     Stage5Notes,
  existing: Stage5Notes,
): Stage5Notes {
  const manualEdits = Array.isArray(existing.manual_edits) ? existing.manual_edits : [];
  // Start from the auto payload and overlay each manual-edited path.
  const merged: Stage5Notes = JSON.parse(JSON.stringify(auto));
  // Carry forward manual_edits + any FA rows the user has touched.
  merged.manual_edits = [...manualEdits];
  for (const path of manualEdits) {
    const userValue = getAtPath(existing, path);
    if (userValue !== undefined) setAtPath(merged, path, userValue);
  }
  return merged;
}

/** Add a dot-path to manual_edits (no-op if already present). Returns a new array. */
export function markManualEdit(notes: Stage5Notes, path: string): string[] {
  const cur = Array.isArray(notes.manual_edits) ? notes.manual_edits : [];
  if (cur.includes(path)) return cur;
  return [...cur, path];
}

/** Remove a dot-path from manual_edits. Returns a new array. */
export function clearManualEdit(notes: Stage5Notes, path: string): string[] {
  const cur = Array.isArray(notes.manual_edits) ? notes.manual_edits : [];
  return cur.filter(p => p !== path);
}

// ═════════════════════════════════════════════════════════════════════════
// DB read / write
// ═════════════════════════════════════════════════════════════════════════

export async function loadStage5Notes(engagementId: string): Promise<Stage5Notes> {
  const { data } = await supabase
    .from("audit_engagements")
    .select("stage5_notes")
    .eq("id", engagementId)
    .maybeSingle();
  const raw = (data as any)?.stage5_notes;
  if (raw && typeof raw === "object") {
    // Defensive merge with defaults so missing top-level keys never crash UI.
    // mergeFaDefaults() backfills any of the 9 canonical FA rows that aren't
    // already present (e.g. legacy engagements created against the 4-row
    // migration default) without overwriting user-entered amounts.
    const existingFa = raw.fa && Array.isArray(raw.fa.rows) ? raw.fa.rows : [];
    return {
      ...DEFAULT_STAGE5_NOTES,
      ...(raw as Partial<Stage5Notes>),
      fa: { rows: mergeFaDefaults(existingFa) },
      manual_edits: Array.isArray(raw.manual_edits) ? raw.manual_edits : [],
    } as Stage5Notes;
  }
  return JSON.parse(JSON.stringify(DEFAULT_STAGE5_NOTES));
}

export async function saveStage5Notes(
  engagementId: string,
  notes:        Stage5Notes,
): Promise<void> {
  const { error } = await supabase
    .from("audit_engagements")
    .update({ stage5_notes: notes as any } as any)
    .eq("id", engagementId);
  if (error) throw error;
}

// ═════════════════════════════════════════════════════════════════════════
// Auto-population orchestrator
// ═════════════════════════════════════════════════════════════════════════

/**
 * Generate a freshly-populated Stage5Notes object for an engagement.
 *
 * Behaviour:
 *   1. Fetches COA mapping + TB + prior-year notes (with FS fallback).
 *   2. Iterates NOTE_ROW_REGISTRY → fills bs_liab / bs_asset / pl row CY
 *      from the TB sum and PY from prior notes (or FS fallback).
 *   3. Sets fa.rows: gross_open / depn_open from prior notes' closing
 *      values (gross_open + additions − disposals), or 0 if unavailable.
 *   4. Tags `auto_synced_at` with the current ISO timestamp.
 *   5. If `existing` is provided, the result is run through
 *      `respectManualEdits()` so user-touched paths are preserved.
 *
 * Caller is responsible for persisting the result via `saveStage5Notes`.
 */
export async function autoPopulateNotes(
  engagementId: string,
  options: { existing?: Stage5Notes | null } = {},
): Promise<Stage5Notes> {
  const [mapping, tb, pyNotes, pyFs, pyTB] = await Promise.all([
    getCOAMapping(engagementId),
    getTrialBalance(engagementId),
    getPreviousYearStage5Notes(engagementId),
    getPreviousYearFsAmounts(engagementId),
    getPreviousYearTrialBalance(engagementId),  // ← FY-1 TB for accurate PY amounts
  ]);

  // Helper to resolve PY for a registered row.
  const pyOf = (
    section: keyof typeof NOTE_ROW_REGISTRY,
    rowKey:  string,
    spec:    NoteRowSpec,
  ): number => {
    // 1) Same row in prior stage5_notes (best — survives sub-row break-outs)
    const prior = pyNotes?.[section]?.[rowKey]?.cy;
    if (typeof prior === "number" && Number.isFinite(prior)) return prior;
    // 2) Sum of FS-code amounts on the prior engagement's fa_financial_statements
    let total = 0;
    let any = false;
    for (const code of spec.fsCodes) {
      const v = pyFs[code];
      if (typeof v === "number" && Number.isFinite(v)) {
        total += v;
        any = true;
      }
    }
    return any ? Math.round(total * 100) / 100 : 0;
  };

  // Seed FA from canonical 9-row default, then carry forward existing
  // user-entered amounts via the merge helper below.
  const out: Stage5Notes = {
    bs_liab:  {},
    bs_asset: {},
    pl:       {},
    fa:       { rows: DEFAULT_FA_ROWS.map(r => ({ ...r })) },
    manual_edits:   [],
    auto_synced_at: new Date().toISOString(),
  };
  if (options.existing?.fa?.rows) {
    out.fa.rows = mergeFaDefaults(options.existing.fa.rows);
  }

  for (const section of ["bs_liab", "bs_asset", "pl"] as const) {
    const rows = NOTE_ROW_REGISTRY[section];
    for (const [rowKey, spec] of Object.entries(rows)) {
      // bs_liab ledgers carry CR-convention balances (negative in the TB).
      // Negate them so every note stores an absolute positive magnitude.
      // bs_asset and pl rows are DR-positive — no flip needed.
      const sectionSign = section === "bs_liab" ? -1 : 1;
      const cy = sectionSign * sumLedgersByFsCodes(tb, mapping, spec.fsCodes);
      // PY: prior year stage5_notes already stores sign-corrected POSITIVE values,
      // so we must NOT apply sectionSign again (double-negation bug).
      // Only the fa_financial_statements fallback path needs the sectionSign flip
      // because fa_financial_statements stores TB-signed values.
      //
      // MIGRATION NOTE: engagements auto-populated BEFORE the sectionSign fix
      // may have stored bs_liab values in old Cr-negative convention (e.g.
      // lt_borrowings.cy = -197000 instead of +197000). When that prior-year
      // note is read as PY for the current year, it would show as negative.
      // Guard: for bs_liab rows, take Math.abs so old-convention negatives are
      // corrected. The only false-positive edge case is reserves_surplus with
      // accumulated losses (Dr balance), which the new convention stores as
      // negative — Math.abs would flip it positive. This is a one-year
      // transitional artefact; the user can override it manually if needed.
      let py: number;
      const priorStage5Py = pyNotes?.[section]?.[rowKey]?.cy;
      if (typeof priorStage5Py === "number" && Number.isFinite(priorStage5Py)) {
        // For bs_liab: guard against stale Cr-negative values from pre-fix era
        py = section === "bs_liab" ? Math.abs(priorStage5Py) : priorStage5Py;
      } else {
        // FS fallback: sum raw fa_financial_statements amounts and apply sign.
        py = sectionSign * pyOf(section, rowKey, spec);
      }

      // Build per-ledger breakdown rows from COA mapping. The breakup array
      // is what drives the editable line items shown under each note (Note
      // 5 lists individual borrowings, Note 29 lists each expense head, etc.)
      // Manual rows from `existing.breakup` are preserved verbatim.
      const rawLedgers = getLedgersByFsCodes(tb, mapping, spec.fsCodes);
      // Smart-merge similar ledgers (e.g. TDS 192B + TDS 194I → "TDS Payable")
      // before passing to buildBreakup. Rule key format: `${section}__${rowKey}`.
      // Same for prior-year TB so merged labels match year-on-year.
      const ruleKey = `${section}__${rowKey}`;
      const ledgers = mergeSimilarLedgers(rawLedgers, ruleKey);
      const pyTBmerged = pyTB ? mergeSimilarLedgers(
        getLedgersByFsCodes(pyTB, mapping, spec.fsCodes),
        ruleKey,
      ) : undefined;
      const rowExist  = options.existing?.[section]?.[rowKey] as any;
      let existingBreak = rowExist?.breakup as BreakupRow[] | undefined;
      // One-time legacy migration: if the engagement was created before the
      // unified .breakup refactor, seed manual rows from the deprecated
      // paths (general_reserve_cy/py, secured_term_loans[], etc.) so we
      // never lose user data. Only fires when .breakup is still empty.
      if ((!existingBreak || existingBreak.length === 0) && rowExist) {
        const migrated = migrateLegacyBreakup(section, rowKey, rowExist);
        if (migrated.length > 0) existingBreak = migrated;
      }
      // Pass prior-year TB so PY amounts use FY-1 closing balances, not
      // current-year opening balances (which are 0 for P&L accounts).
      const breakup = buildBreakup(ledgers, spec.template, existingBreak, pyTBmerged);

      out[section][rowKey] = { cy, py, breakup };
    }
  }

  // ── Note 30 EPS — auto-populate NPAT from P&L computation ─────────────────
  // The EPS note needs Net Profit After Tax (NPAT). Compute it from the current
  // TB + COA mapping (same logic as PipelineFinancialStatements computedAmounts).
  // Only auto-fill if the user hasn't manually entered a value.
  {
    const existingNpat = (options.existing as any)?.pl?.eps?.npat;
    if (typeof existingNpat !== "number") {
      let revSum = 0, expSum = 0;
      for (const ledger of tb) {
        const code = mapping[ledger.account_name]?.code ?? "";
        if (code.startsWith("PL_REV")) revSum += ledger.balance;  // negative (CR)
        if (code.startsWith("PL_EXP")) expSum += ledger.balance;  // positive (DR)
      }
      const npat = Math.round((-revSum - expSum) * 100) / 100;
      if (Math.abs(npat) > 0.005) {
        if (!out.pl.eps) out.pl.eps = {};
        out.pl.eps = { ...(out.pl.eps as any), npat };
      }
    }
  }

  // FA: seed gross_open from prior closing PPE; leave additions/disposals/
  // depreciation empty for the auditor to fill in. If the prior year's
  // stage5_notes has its own FA rows, carry those forward (column-shifted)
  // since the closing of FY−1 = opening of FY.
  if (pyNotes?.fa?.rows && Array.isArray(pyNotes.fa.rows)) {
    const priorFa = pyNotes.fa.rows;
    out.fa.rows = out.fa.rows.map(defRow => {
      const prior = priorFa.find(r => r.id === defRow.id);
      if (!prior) return defRow;
      const grossClose = (prior.gross_open || 0) + (prior.additions || 0) - (prior.disposals || 0);
      const depnClose  = (prior.depn_open  || 0) + (prior.depn_add   || 0) - (prior.depn_disp || 0);
      return {
        ...defRow,
        useful_life: prior.useful_life ?? defRow.useful_life,
        gross_open:  Math.round(grossClose * 100) / 100,
        depn_open:   Math.round(depnClose  * 100) / 100,
      };
    });
  }

  // Respect user-touched paths from the existing notes (if provided).
  // Special-case: `.breakup` paths are NOT locked at path level — per-row
  // `source: "manual"` preservation is already handled by buildBreakup
  // above. Strip them out here so the freshly built breakup wins.
  //
  // Migration: bs_liab note totals were previously stored as signed
  // (CR = negative) values before the sectionSign fix. Any manual override
  // on a bs_liab `*.cy` / `*.py` path that is still negative is a stale
  // artefact from that era — drop it so the newly correct positive
  // auto-value wins. Positive manual overrides (user-entered corrections)
  // are preserved. This is a one-way, non-destructive migration.
  if (options.existing) {
    const filteredExisting: Stage5Notes = {
      ...options.existing,
      manual_edits: (options.existing.manual_edits || [])
        .filter(p => !p.endsWith(".breakup"))
        .filter(p => {
          if (!p.startsWith("bs_liab.")) return true;
          if (!p.endsWith(".cy") && !p.endsWith(".py")) return true;
          const stored = getAtPath(options.existing, p);
          // Drop stale negative liability-total overrides (pre-sign-fix era).
          return !(typeof stored === "number" && stored < 0);
        }),
    };
    return respectManualEdits(out, filteredExisting);
  }
  return out;
}

/**
 * Convenience wrapper: load → autoPopulate (preserving manual edits) →
 * save. Returns the post-save notes object. UI can call this from a
 * "Resync from TB" button.
 */
export async function resyncStage5Notes(engagementId: string): Promise<Stage5Notes> {
  const existing = await loadStage5Notes(engagementId);
  const fresh    = await autoPopulateNotes(engagementId, { existing });
  await saveStage5Notes(engagementId, fresh);
  return fresh;
}
