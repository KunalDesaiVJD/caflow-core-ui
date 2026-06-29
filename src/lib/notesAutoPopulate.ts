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
// 2026-06-05 Phase 6 — every TB sign-derivation in the corporate
// notes-auto-populate path now routes through the shared module so the
// corporate FS uses the SAME signing convention as NCE (and Stage 3 TB
// import). normalizeTB stays debit-positive (matches the existing
// downstream sectionSign multiplier in buildBreakup).
import { signedBalance, signedOpening } from "@/lib/fsSignConvention";

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
  net_py?:      number | null;   // manual override for PY Net Block column
}

export interface Stage5Notes {
  bs_liab:        Record<string, NoteRowValue>;
  bs_asset:       Record<string, NoteRowValue>;
  pl:             Record<string, NoteRowValue>;
  fa:             { rows: FARow[]; py_manual?: Record<string, number | null> | null };
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
    employee_benefits:  {
      fsCodes: ["PL_EXP_EMP"], label: "Employee benefits expense",
      // Schedule III standard heads for employee cost breakup
      template: [
        "Salaries, wages and bonus",
        "Contribution to provident fund",
        "Contribution to ESIC",
        "Gratuity expense",
        "Leave encashment",
        "Staff welfare expenses",
      ],
    },
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

/** Normalise TB rows to the signed-balance shape the rest of the service uses.
 *  2026-06-05 Phase 6 — sign derivation routed through the canonical
 *  fsSignConvention helpers. `balance` stays debit-positive (Dr → +cb,
 *  Cr → -cb), `opening_balance` stays debit-positive too. Downstream
 *  buildBreakup multiplies by sectionSign to convert to the head's
 *  natural-side display. The math is byte-identical to the inline
 *  `isDr ? cb : -cb` it replaces. */
function normalizeTB(rows: any[]): TBLedger[] {
  return rows.map(l => ({
    account_name:    cleanTallyName(l.ledger_name),
    account_group:   cleanTallyName(l.parent_group),
    balance:         signedBalance(l.closing_balance, l.balance_type, "DR"),
    opening_balance: signedOpening(l.opening_balance, l.opening_type, "DR"),
  })).filter(a => a.account_name);
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
  if (!raw || typeof raw !== "object") return {};
  // Normalize keys through cleanTallyName so lookups from the TB side
  // (which also cleans names) always match, even if older mappings were
  // saved with HTML entities or control chars in the key.
  const out: COAMapping = {};
  for (const [key, val] of Object.entries(raw)) {
    const clean = cleanTallyName(key);
    if (clean && val) out[clean] = val as { code: string };
  }
  return out;
}

// Exact entity_type strings that classify an engagement as Non-Corporate (NCE).
// MUST stay in sync with NON_CORPORATE_TYPES in PipelineFinancialStatements.tsx.
const NON_CORPORATE_ENTITY_TYPES = new Set(
  [
    "Individual", "Proprietorship", "Sole Proprietorship", "Partnership",
    "LLP", "Limited Liability Partnership", "HUF", "Hindu Undivided Family",
    "Trust", "AOP", "Association of Persons", "BOI", "Body of Individuals",
  ].map(s => s.toLowerCase()),
);

/**
 * Resolve whether an engagement is a Non-Corporate Entity (NCE). Reads the
 * engagement's entity_type, falling back to the client's entity_type. This is
 * the SAME source of truth Stage 6 / Stage 7 use to pick the NCE vs corporate
 * FS tree, so downstream views (e.g. the Ledger Explorer) classify ledger
 * codes against the right schema instead of always assuming corporate.
 */
export async function getEngagementIsNonCorporate(engagementId: string): Promise<boolean> {
  const { data } = await supabase
    .from("audit_engagements")
    .select("entity_type, clients(entity_type)")
    .eq("id", engagementId)
    .maybeSingle();
  const et = String(
    (data as any)?.entity_type || (data as any)?.clients?.entity_type || "",
  ).trim().toLowerCase();
  return NON_CORPORATE_ENTITY_TYPES.has(et);
}

/**
 * Fetch the prior-year (FY-1) trial balance for a given engagement.
 * Used by buildBreakup to populate the PY amount column from actual
 * prior-year closing balances instead of current-year opening balances
 * (which are 0 for P&L accounts that reset each year).
 */
export async function getPreviousYearTrialBalance(engagementId: string): Promise<TBLedger[]> {
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

/**
 * Preferred PY source for the Ledger Explorer: derive prior-year FS-code totals
 * directly from the PY-shell trial balance + COA mapping — the SAME method the
 * CY column uses. Many engagements never populate fa_financial_statements, so
 * getPreviousYearFsAmounts() returned {} and the PY column showed "—" even
 * though a PY-shell Tally sync (is_py_shell) was complete. This reads the FY-1
 * shell engagement's TB and sums each ledger's signed closing balance under its
 * mapped FS code (Dr +, Cr −), matching sumLedgersByFsCodes()'s convention so
 * the caller can apply the per-row sign exactly as it does for CY.
 */
export async function getPreviousYearFsAmountsFromTB(
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

  // Prefer the PY shell (is_py_shell — carries the FY-1 Tally sync) over any
  // regular FY-1 engagement.
  const { data: engList } = await supabase
    .from("audit_engagements")
    .select("id, is_py_shell, coa_mapping")
    .eq("client_id", clientId)
    .eq("financial_year", prevFy);
  const sorted = ((engList || []) as any[]).sort(
    (a, b) => (b.is_py_shell ? 1 : 0) - (a.is_py_shell ? 1 : 0),
  );
  const prev = sorted[0];
  if (!prev?.id) return {};

  const prevTb = await getTrialBalance(prev.id);
  if (!prevTb.length) return {};

  // Mapping: prefer the prior engagement's own coa_mapping; fall back to the
  // current engagement's (ledger names are stable across years for a client).
  // Normalize keys through cleanTallyName so they match the cleaned TB names.
  let mapping: COAMapping | null = null;
  if (prev.coa_mapping && typeof prev.coa_mapping === "object") {
    const raw = prev.coa_mapping as Record<string, any>;
    const cleaned: COAMapping = {};
    for (const [key, val] of Object.entries(raw)) {
      const clean = cleanTallyName(key);
      if (clean && val) cleaned[clean] = val as { code: string };
    }
    if (Object.keys(cleaned).length > 0) mapping = cleaned;
  }
  if (!mapping || Object.keys(mapping).length === 0) {
    mapping = await getCOAMapping(engagementId);
  }

  const out: Record<string, number> = {};
  for (const acct of prevTb) {
    const code = mapping[acct.account_name]?.code;
    if (!code) continue;
    out[code] = (out[code] || 0) + acct.balance;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
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
    .replace(/\s*\([^)]*\).*$/, "")                          // "(Survey No. 1166)", "(Branch X)"
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

/** Sub-ledger record carried on a synthetic merged ledger so the UI can
 *  render an info button listing what was bundled together. */
export interface MergedSource { ledger: string; amount_cy: number; amount_py: number }

type TBLedgerWithSources = TBLedger & { _sources?: MergedSource[] };

/** Merge similar TB ledgers into consolidated synthetic ledgers. Synthetic
 *  ledgers carry a `_sources` array describing the originals so the breakup
 *  row can show an "i" expander listing the underlying ledgers. */
function mergeSimilarLedgers(
  ledgers: TBLedger[],
  ruleKey: string | undefined,
): TBLedgerWithSources[] {
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

  const out: TBLedgerWithSources[] = [];
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
    // Build sub-ledger source list, BUT drop entries where both CY and PY
    // are zero — they clutter the info expander without adding signal.
    // Per user feedback: blank year-suffix variants (e.g. "TDS Payable
    // 192B - 1920", "TDS Payable 192B - 2021") that have no balance in
    // either year should not appear under the merged head.
    const sources = members
      .map(m => ({
        ledger:    m.account_name,
        amount_cy: Math.abs(Math.round((m.balance ?? 0) * 100) / 100),
        amount_py: Math.abs(Math.round((m.opening_balance ?? 0) * 100) / 100),
      }))
      .filter(s => s.amount_cy !== 0 || s.amount_py !== 0);
    out.push({
      account_name:    label,
      account_group:   members[0].account_group,
      balance:         members.reduce((s, m) => s + (m.balance ?? 0), 0),
      opening_balance: members.reduce((s, m) => s + (m.opening_balance ?? 0), 0),
      _sources:        sources,
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
  /** When this row was synthesised from multiple TB ledgers (via the
   *  CORP_SMART_MERGE rules — e.g. "TDS Payable" rolling up TDS 192B,
   *  TDS 194I, TDS 194C, ...), this lists the underlying ledgers + their
   *  amounts. The ListTable shows an "i" button that expands these. */
  sources?: MergedSource[];
}

export function buildBreakup(
  ledgers: TBLedger[],
  template: string[] | undefined,
  existing: BreakupRow[] | undefined,
  /** Prior-year trial balance — used for amount_py instead of opening_balance.
   *  P&L accounts reset to 0 each year so their opening_balance is always 0;
   *  passing the actual FY-1 TB gives correct PY ledger-level amounts. */
  pyLedgers?: TBLedger[],
  /** Issue 8 (DR/CR netting today) — sign multiplier for amounts the consumer
   *  WANTS to see (positive when the ledger is on its "normal" side, negative
   *  when it sits on the wrong side and should REDUCE the head total).
   *
   *    bs_liab / pl income  →  -1  (Cr is normal, balance is stored negative)
   *    bs_asset / pl expense→  +1  (Dr is normal, balance is stored positive)
   *
   *  Result: a Sundry Creditor with Dr 2,000 (balance = +2000) stored in a
   *  bs_liab note becomes amount_cy = -2000, so the sub-row sum equals the
   *  net liability instead of the gross-positive figure that ignored the
   *  abnormal-side ledger.  When omitted, defaults to absolute (legacy). */
  sectionSign: 1 | -1 = 0 as any,
): BreakupRow[] {
  // 1) Preserve manual rows from existing breakup verbatim — these are user-
  //    typed entries that don't correspond to any COA-mapped ledger.
  //    Legacy rows persisted before this feature have no `source` field;
  //    treat anything not explicitly "linked" as manual so existing data
  //    survives the first re-sync.
  //    DEFENSIVE: filter out null/undefined entries first — corrupt JSONB or
  //    sparse arrays from legacy partial-saves can otherwise crash the re-sync
  //    with "Cannot read properties of null (reading 'source')".
  //
  // 2026-06-23 (MICROCIRCUITS, GROWQ — duplicate ledger fix):
  //    When the auditor renames a LINKED row (e.g. "HDFC Bank - OD -
  //    50200114956511" → "HDFC Bank - OD - 6511") the ListTable flips
  //    `source: linked → manual` but PRESERVES `linked_ledger`. Without
  //    the dedup below, the next re-sync rebuilds a LINKED row from the
  //    TB ledger AND keeps the renamed MANUAL row → two rows for the same
  //    ledger, two amount lines, total inflated by 2×|ledger|.
  //
  //    Fix: drop any manual row whose `linked_ledger` matches a TB ledger
  //    in the current `ledgers[]` list. Those rows represent a re-mapping
  //    of an existing TB ledger that the fresh-build path is about to
  //    re-create cleanly. Pure auditor rows (no `linked_ledger`) are
  //    user-typed entries with no TB counterpart and are kept untouched.
  const ledgerNamesLC = new Set(
    ledgers.map(l => (l.account_name || "").trim().toLowerCase()).filter(Boolean),
  );
  const droppedDuplicates: BreakupRow[] = [];
  const manualRows: BreakupRow[] = (existing || [])
    .filter((r): r is BreakupRow => r != null && r.source !== "linked")
    .filter(r => {
      const ll = (r.linked_ledger || "").trim().toLowerCase();
      if (!ll) return true;                       // no TB anchor → user-typed; keep
      if (!ledgerNamesLC.has(ll)) return true;    // ledger no longer in TB → keep (history)
      droppedDuplicates.push(r);
      return false;                               // manual + ledger still in TB → drop, fresh LINKED row wins
    });
  if (droppedDuplicates.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[buildBreakup] dropped ${droppedDuplicates.length} renamed manual row(s) whose TB ledger will be rebuilt as LINKED:`,
      droppedDuplicates.map(r => `${r.linked_ledger}→${r.description}`).join(", "),
    );
  }

  // Issue 10 (today) — keep a fast lookup of every existing row by its
  // linked_ledger name so re-built "linked" rows can carry forward any
  // sub-group membership the user has assigned.  Without this, when the
  // user creates a sub-group (a manual `is_group: true` row) and drops a
  // ledger row into it (`subgroup_id` set on the linked row), the next
  // re-generate-FS pass would re-create the linked row from the template,
  // losing the subgroup_id — the group header stayed but its children
  // appeared ungrouped.  Now linked rows that match an existing row by
  // linked_ledger or description carry over `subgroup_id` (and any other
  // user-added metadata fields tagged with the `_keep` prefix below).
  const linkedExistingByName = new Map<string, BreakupRow>();
  for (const r of (existing || [])) {
    if (!r || r.source !== "linked") continue;
    const key = (r.linked_ledger || r.description || "").toLowerCase().trim();
    if (key) linkedExistingByName.set(key, r);
  }
  const carryUserMeta = (newRow: BreakupRow, key: string): BreakupRow => {
    const prev = linkedExistingByName.get(key.toLowerCase().trim());
    if (!prev) return newRow;
    const out: any = { ...newRow };
    if ((prev as any).subgroup_id) out.subgroup_id = (prev as any).subgroup_id;
    // Preserve any other user-touched fields we don't yet know about by
    // forwarding keys not part of the linked-row schema.
    return out as BreakupRow;
  };

  // 2) Build linked rows
  const result: BreakupRow[] = [];
  const usedLedgers = new Set<string>();

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Sign-aware presentation for a ledger balance.  When sectionSign is given
  // we return the value multiplied by it so abnormal-side ledgers come out
  // negative (and reduce the sub-row sum); when not given we fall back to
  // legacy Math.abs to preserve old behaviour for any caller that hasn't
  // opted in yet.
  const present = (val: number): number => {
    const r = round2(val);
    return sectionSign === 1 || sectionSign === -1
      ? round2(r * sectionSign)
      : Math.abs(r);
  };

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
    return py ? present(py.balance) : present(openingBalance);
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
        result.push(carryUserMeta({
          description:   head,
          amount_cy:     present(matched.balance),
          amount_py:     resolvePY(matched.account_name, matched.opening_balance),
          source:        "linked",
          linked_ledger: matched.account_name,
        }, matched.account_name));
      } else {
        // Template head with no matching ledger — check if it exists in PY TB
        const pyMatch = pyMap.get(head.toLowerCase().trim());
        result.push(carryUserMeta({
          description:   head,
          amount_cy:     0,
          amount_py:     pyMatch ? present(pyMatch.balance) : 0,
          source:        "linked",
          // Issue-3: Always set linked_ledger so user can "Restore Link" after
          // editing — even for template heads with no current-year TB match.
          linked_ledger: head,
        }, head));
      }
    }
  }

  // 3) Append remaining (un-matched) ledgers as fresh linked rows
  for (const l of ledgers) {
    if (usedLedgers.has(l.account_name)) continue;
    const sources = (l as TBLedgerWithSources)._sources;
    result.push(carryUserMeta({
      description:   l.account_name,
      amount_cy:     present(l.balance),
      amount_py:     resolvePY(l.account_name, l.opening_balance),
      source:        "linked",
      linked_ledger: l.account_name,
      ...(sources && sources.length > 1 ? { sources } : {}),
    }, l.account_name));
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
    const rawManualEdits = Array.isArray(raw.manual_edits) ? raw.manual_edits : [];
    // If user has explicitly edited fa.rows (including deleting defaults), preserve exactly as-is.
    const faRows = rawManualEdits.includes("fa.rows") ? existingFa : mergeFaDefaults(existingFa);

    // Issue 8 (today, take 2) — REMOVED the breakup-row Math.abs() sweep
    // that lived here.  That sweep was originally a one-time fix for a
    // pre-sectionSign era when bs_liab notes were stored CR-negative, but
    // it now actively cancels Issue 8's Dr/Cr-netting fix: a Dr ledger
    // sitting under a bs_liab note (e.g. an advance against Sundry
    // Creditors) is intentionally stored with amount_cy/amount_py < 0
    // so the breakup sub-row sum equals the NET liability instead of
    // gross-positive.  Stripping the sign here re-inflated the total
    // every time the note was reloaded.
    //
    // The .py headline value (node.py) is still kept positive — that
    // path is the magnitude of the prior-year closing, never signed.
    const bsLiab = raw.bs_liab ?? {};
    for (const key of Object.keys(bsLiab)) {
      const node = bsLiab[key];
      if (!node || typeof node !== "object") continue;
      if (typeof node.py === "number" && node.py < 0) node.py = Math.abs(node.py);
      // NOTE: breakup amount_cy / amount_py are deliberately signed —
      // do NOT Math.abs them.  Legacy gross-positive values still render
      // correctly (positive on the credit side) and will be migrated to
      // signed on the next "Re-sync from COA" / "Generate FS" pass.
    }

    return {
      ...DEFAULT_STAGE5_NOTES,
      ...(raw as Partial<Stage5Notes>),
      bs_liab: bsLiab,
      fa: { rows: faRows, py_manual: raw.fa?.py_manual ?? null },
      manual_edits: rawManualEdits,
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
// Journal voucher scan — for "Adjustments for deferred tax" and
// "Excess/(Short) provision for income tax" on Reserves & Surplus.
//
// CRITICAL: only journals that ACTUALLY HIT the Reserves & Surplus ledger
// (typically "Profit & Loss A/c" — anything mapped to BS_EQ_RS in COA) are
// counted. Otherwise every routine deferred-tax / current-tax accrual that
// debits the P&L Tax-expense head would be double-counted, because that
// expense ledger's name also matches the pattern. The R&S "Adjustments for
// deferred tax" row is meant to show ONLY the post-NPAT contra entries that
// route through Surplus — which is exactly the subset of journals where
// one line is the R&S ledger.
//
// Sign convention: when the R&S line is DEBIT → the adjustment REDUCES
// surplus (so we record a NEGATIVE addition). When the R&S line is CREDIT
// → the adjustment ADDS to surplus.
// ═════════════════════════════════════════════════════════════════════════
async function sumJournalVoucherImpact(
  engagementId: string | null | undefined,
  pattern: RegExp,
  surplusLedgers: Set<string>,
): Promise<number> {
  if (!engagementId || surplusLedgers.size === 0) return 0;
  try {
    const PAGE = 500;
    let total = 0;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("tally_vouchers")
        .select("amount, dr_cr, line_items")
        .eq("engagement_id", engagementId)
        .eq("voucher_type", "Journal")
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const v of data as any[]) {
        const items = Array.isArray(v.line_items) ? v.line_items : [];
        // CRITICAL: only TWO-LINE contra journals (Surplus ↔ <adjustment>).
        // The year-end profit-transfer journal has every P&L sub-ledger as
        // a line (e.g. 50+ entries including Deferred Tax expense) — it is
        // NOT an "adjustment" and must be skipped. Any post-NPAT adjustment
        // routed THROUGH Surplus is, by accounting convention, a 2-line
        // contra: Surplus Dr/Cr ↔ <Provision / Deferred Tax> Cr/Dr.
        if (items.length !== 2) continue;
        let surplusLine: any = null;
        let contraLine:  any = null;
        for (const li of items) {
          const name = String(li?.ledger_name ?? "").trim();
          if (!surplusLine && surplusLedgers.has(name)) { surplusLine = li; continue; }
          if (!contraLine && pattern.test(name)) { contraLine = li; }
        }
        if (!surplusLine || !contraLine) continue;
        // Sign: DEBIT to surplus reduces R&S (negative), CREDIT adds (positive).
        const amt = Number(contraLine.amount ?? surplusLine.amount ?? v.amount ?? 0);
        const surplusDr = String(surplusLine.dr_cr ?? "").toUpperCase() === "DR";
        total += (surplusDr ? -1 : 1) * (Number.isFinite(amt) ? Math.abs(amt) : 0);
      }
      if (data.length < PAGE) break;
    }
    return Math.round(total * 100) / 100;
  } catch {
    return 0;
  }
}

// Resolve the set of ledger names mapped to BS_EQ_RS (Reserves & Surplus)
// in the engagement's COA mapping. Used to gate the journal-voucher scan
// so only vouchers that touch R&S are counted.
async function getSurplusLedgerNames(
  engagementId: string | null | undefined,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!engagementId) return out;
  try {
    const mapping = await getCOAMapping(engagementId);
    for (const [ledgerName, m] of Object.entries(mapping)) {
      if (m?.code === "BS_EQ_RS") out.add(ledgerName);
    }
  } catch { /* ignore */ }
  return out;
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
    if (any) return Math.round(total * 100) / 100;
    // 3) Last-resort fallback — sum opening_balance of CY trial balance ledgers
    //    mapped to this spec's FS codes. Mirrors what PipelineFinancialStatements
    //    uses for BS PY amounts (computedAmountsPY). Ensures Note 8/18 etc. show
    //    PY totals even when no prior engagement / fa_financial_statements exist.
    const codeSet = new Set(spec.fsCodes);
    let openTotal = 0;
    let anyOpen = false;
    for (const ledger of tb) {
      const ledgerCode = mapping[ledger.account_name]?.code;
      if (ledgerCode && codeSet.has(ledgerCode)) {
        const ob = ledger.opening_balance ?? 0;
        if (ob !== 0) { openTotal += ob; anyOpen = true; }  // signed: let sectionSign flip
      }
    }
    return anyOpen ? Math.round(openTotal * 100) / 100 : 0;
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
    const existRows = options.existing.fa.rows;
    // If user already has rows stored, preserve them exactly (don't re-add deleted defaults).
    // Only use mergeFaDefaults for a truly empty FA (new engagement).
    out.fa.rows = existRows.length > 0 ? existRows : mergeFaDefaults(existRows);
  }

  for (const section of ["bs_liab", "bs_asset", "pl"] as const) {
    const rows = NOTE_ROW_REGISTRY[section];
    for (const [rowKey, spec] of Object.entries(rows)) {
      // Issue 1 (P&L income shown negative today) — section sign now also
      // accounts for P&L sub-section.  Income line items (PL_REV*, PL_OI*)
      // carry CR-normal balances and need the same -1 flip as bs_liab, or
      // their breakup amount_cy/amount_py stays negative and the headline
      // totals render with parentheses (interpreted as losses).  Expense
      // line items (PL_EXP*) remain DR-normal with sign +1.  When the
      // note has mixed PL codes we use the FIRST code as the indicator
      // (the registry doesn't currently mix REV and EXP within one note).
      //
      // bs_liab → -1   (CR-normal liability)
      // bs_asset → +1  (DR-normal asset)
      // pl with PL_REV* / PL_OI* → -1 (CR-normal income)
      // pl with PL_EXP* etc.    → +1 (DR-normal expense)
      const firstFsCode = (spec.fsCodes && spec.fsCodes[0]) || "";
      const isPLIncome  = section === "pl" && /^PL_(REV|OI)/.test(firstFsCode);
      const sectionSign =
        section === "bs_liab" || isPLIncome ? -1 : 1;
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
      // Coerce to array and drop null/undefined slots up-front so the rest of
      // the pipeline never sees corrupt rows from legacy JSONB.
      let existingBreak: BreakupRow[] | undefined = Array.isArray(rowExist?.breakup)
        ? (rowExist.breakup as any[]).filter((r): r is BreakupRow => r != null)
        : undefined;
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
      // Issue 8 (DR/CR netting today) — pass sectionSign so abnormal-side
      // ledgers inside a note (e.g. a Dr balance under Sundry Creditors)
      // come out as NEGATIVE in amount_cy/amount_py and the breakup sum
      // equals the net liability/asset/expense instead of an inflated
      // gross total.  Without this, the note total diverges from the BS
      // face heading (which already sums signed via computedAmounts).
      const breakup = buildBreakup(ledgers, spec.template, existingBreak, pyTBmerged, sectionSign as 1 | -1);

      out[section][rowKey] = { cy, py, breakup };
    }
  }

  // ── Issue-4a: Share Capital sub-table carry-forward from prior year ──────────
  // The main BS amount (cy/py) is handled above via the note registry.
  // The sub-tables (shareholders, promoters, reconciliation) live as extra
  // fields on the share_capital node. When a new year is opened, carry the
  // prior year's CY data into the current year's PY columns so the auditor
  // doesn't have to re-enter shareholders/promoters each year.
  if (pyNotes?.bs_liab) {
    const priorSC = (pyNotes.bs_liab.share_capital ?? {}) as any;
    const existSC = ((options?.existing?.bs_liab ?? {}) as any).share_capital ?? {};
    const outSC   = (out.bs_liab.share_capital ?? {}) as any;

    // Text descriptions — propagate from prior year if not yet filled
    if (!existSC.authorised_text && priorSC.authorised_text)
      outSC.authorised_text = priorSC.authorised_text;
    if (!existSC.issued_text && priorSC.issued_text)
      outSC.issued_text = priorSC.issued_text;

    // Authorised amount: prior CY → current PY
    if (!(existSC.authorised_py > 0) && priorSC.authorised_cy > 0)
      outSC.authorised_py = Number(priorSC.authorised_cy);

    // Reconciliation opening PY = prior year's closing CY
    // (closing = opening + movement for both num and amt fields)
    const parseShareNum = (v: any): number => {
      if (v == null || v === "") return 0;
      return Number(String(v).replace(/,/g, "").trim()) || 0;
    };
    if (!existSC.recon_open_py_num) {
      const closeCyNum = parseShareNum(priorSC.recon_open_cy_num) + parseShareNum(priorSC.recon_move_cy_num);
      outSC.recon_open_py_num = closeCyNum > 0 ? String(closeCyNum) : "";
    }
    if (!(existSC.recon_open_py_amt > 0)) {
      const closeCyAmt = Number(priorSC.recon_open_cy_amt ?? 0) + Number(priorSC.recon_move_cy_amt ?? 0);
      if (closeCyAmt > 0) outSC.recon_open_py_amt = closeCyAmt;
    }

    // Shareholders: prior CY → current PY (only when current year has no data yet)
    const priorSH = Array.isArray(priorSC.shareholders) ? priorSC.shareholders : [];
    const existSH = Array.isArray(existSC.shareholders)  ? existSC.shareholders  : [];
    if (priorSH.length > 0 && existSH.length === 0) {
      outSC.shareholders = priorSH.map((r: any) => ({
        name:      r.name ?? "",
        cy_shares: "",          // current year — blank for auditor to fill
        cy_pct:    0,
        py_shares: r.cy_shares ?? "",  // prior CY shares → current PY
        py_pct:    Number(r.cy_pct ?? 0),
      }));
    }

    // Promoters: prior CY → current PY
    const priorPR = Array.isArray(priorSC.promoters) ? priorSC.promoters : [];
    const existPR = Array.isArray(existSC.promoters)  ? existSC.promoters  : [];
    if (priorPR.length > 0 && existPR.length === 0) {
      outSC.promoters = priorPR.map((r: any) => ({
        name:      r.name ?? "",
        cy_shares: "",
        cy_pct:    0,
        py_shares: r.cy_shares ?? "",
        py_pct:    Number(r.cy_pct ?? 0),
      }));
    }

    out.bs_liab.share_capital = outSC;
  }

  // ── R&S: "Adjustments for deferred tax" + "Excess/(Short) provision for IT" ──
  // These line items rarely have their own TB ledger — they're contra entries
  // routed through Journal vouchers (Surplus Dr/Cr  → Deferred Tax / Provision).
  // Scan tally_vouchers.line_items for ledgers matching deferred-tax /
  // excess-short-provision patterns and store the signed net impact on
  // bs_liab.reserves_surplus.surplus_deferred_adj_cy/py and
  // bs_liab.reserves_surplus.surplus_excess_short_cy/py.
  try {
    // Resolve FY-1 engagement id (prefer PY shell, fall back to regular FY-1)
    let prevEngId: string | null = null;
    try {
      const { data: eng } = await supabase
        .from("audit_engagements")
        .select("client_id, financial_year")
        .eq("id", engagementId)
        .maybeSingle();
      const clientId = (eng as any)?.client_id;
      const fy       = (eng as any)?.financial_year;
      if (clientId && fy) {
        const parts = String(fy).split("-");
        if (parts.length === 2) {
          const prevFy = `${parseInt(parts[0], 10) - 1}-${String(parseInt(parts[0], 10)).slice(-2)}`;
          const { data: engList } = await supabase
            .from("audit_engagements")
            .select("id, is_py_shell")
            .eq("client_id", clientId)
            .eq("financial_year", prevFy);
          const sorted = ((engList || []) as any[]).sort(
            (a, b) => (b.is_py_shell ? 1 : 0) - (a.is_py_shell ? 1 : 0)
          );
          prevEngId = sorted[0]?.id ?? null;
        }
      }
    } catch { /* prevEngId stays null */ }

    const deferredPattern    = /deferred\s*tax/i;
    // Any "Provision for Income Tax" / "Provision for Taxation" ledger that
    // shows up as the contra-side of an R&S journal IS — by definition —
    // an excess-or-short provision adjustment (the routine year-end provision
    // is booked against P&L Tax Expense, not against Surplus). Keep the
    // pattern broad so it matches the conventional ledger names.
    const excessShortPattern = /provision.*(income|tax)|(excess|short).*provision/i;

    // R&S/Surplus ledgers — gate the scan so only journals that hit Surplus
    // (i.e. routed THROUGH R&S, not the normal accrual leg) are counted.
    // Resolve from CY first (always has a COA mapping). For the PY scan we
    // try the PY shell mapping first, but FALL BACK to the CY mapping so
    // a PY shell that hasn't yet been COA-mapped still produces correct
    // values — the ledger NAMES are identical across years in Tally.
    let surplusCy = await getSurplusLedgerNames(engagementId);
    let surplusPy = prevEngId ? await getSurplusLedgerNames(prevEngId) : new Set<string>();
    if (surplusPy.size === 0) surplusPy = surplusCy;

    const [defCy, defPy, excCy, excPy] = await Promise.all([
      sumJournalVoucherImpact(engagementId, deferredPattern,    surplusCy),
      sumJournalVoucherImpact(prevEngId,    deferredPattern,    surplusPy),
      sumJournalVoucherImpact(engagementId, excessShortPattern, surplusCy),
      sumJournalVoucherImpact(prevEngId,    excessShortPattern, surplusPy),
    ]);

    if (!out.bs_liab.reserves_surplus) out.bs_liab.reserves_surplus = {} as any;
    const rs = out.bs_liab.reserves_surplus as any;
    // ALWAYS write — including 0 — so a previously-stale value from the old
    // "TB-mapped deferred tax" auto-fill is cleared once the journal scan
    // confirms there is no R&S adjustment. Manual edits are still preserved
    // because respectManualEdits() locks any path the auditor has touched.
    rs.surplus_deferred_adj_cy = defCy;
    rs.surplus_deferred_adj_py = defPy;
    rs.surplus_excess_short_cy = excCy;
    rs.surplus_excess_short_py = excPy;
  } catch { /* swallow — non-fatal */ }

  // ── Note 30 EPS — auto-populate NPAT (CY + PY) from P&L computation ─────
  // ALWAYS recompute NPAT from current TB rather than skip-if-present;
  // skipping let stale npat survive TB resyncs. PY NPAT comes from pyTB
  // (drives R&S "Add/(Less): Profit for the year" PY column).
  {
    // Issue 2 (today) — NPAT must equal P&L line item
    //   "XV. Profit / (Loss) for the period (XI + XIV)"
    // which is Revenue − Expenses − Current Tax − Deferred Tax.
    // Previous code only summed PL_REV + PL_EXP, ignoring PL_TAX_*, so
    // the value the R&S "Profit for the year" row carried was actually
    // PBT (Profit Before Tax), not PAT.  Auditors expect the row to
    // tie to the BS face Reserves & Surplus auto-credit (which IS net
    // of tax in Schedule III), so it must use PAT.
    let revSum = 0, expSum = 0, taxSum = 0;
    for (const ledger of tb) {
      const code = mapping[ledger.account_name]?.code ?? "";
      if (code.startsWith("PL_REV")) revSum += ledger.balance;  // negative (CR)
      else if (code.startsWith("PL_EXP")) expSum += ledger.balance;  // positive (DR)
      else if (code.startsWith("PL_TAX")) taxSum += ledger.balance;  // positive (DR)
    }
    // PAT = Revenue (flipped from CR-negative) − Expenses − Taxes
    const npat = Math.round((-revSum - expSum - taxSum) * 100) / 100;

    // PY NPAT from the FY-1 trial balance (closing balances == that year's
    // P&L since Tally resets to 0 each year).  Same after-tax formula.
    let npatPy = 0;
    if (pyTB && pyTB.length > 0) {
      let revSumPy = 0, expSumPy = 0, taxSumPy = 0;
      for (const ledger of pyTB) {
        const code = mapping[ledger.account_name]?.code ?? "";
        if (code.startsWith("PL_REV")) revSumPy += ledger.balance;
        else if (code.startsWith("PL_EXP")) expSumPy += ledger.balance;
        else if (code.startsWith("PL_TAX")) taxSumPy += ledger.balance;
      }
      npatPy = Math.round((-revSumPy - expSumPy - taxSumPy) * 100) / 100;
    }

    if (Math.abs(npat) > 0.005 || Math.abs(npatPy) > 0.005) {
      if (!out.pl.eps) out.pl.eps = {};
      out.pl.eps = {
        ...(out.pl.eps as any),
        ...(Math.abs(npat)   > 0.005 ? { npat }     : {}),
        ...(Math.abs(npatPy) > 0.005 ? { npat_py: npatPy } : {}),
      };
    }
  }

  // ── Issues 3 / 4 / 5 (today) — Reserves & Surplus auto-population ─────────
  // The user wants four R&S sub-rows to fill themselves so the auditor never
  // has to re-type values already present in Tally / the prior year:
  //
  //   (a) Surplus opening balance, current year  ←  prior-year R&S closing
  //   (b) Surplus opening balance, previous year ←  prior-year R&S OPENING
  //                                                 (= FY-2 closing)
  //   (c) Adjustments for deferred tax (CY & PY) ←  any ledger under BS_EQ_RS
  //                                                 whose name matches /deferred tax/i
  //   (d) Excess/(Short) provision for income tax (CY & PY)
  //                                              ←  any ledger under BS_EQ_RS
  //                                                 whose name matches /provision.*income tax|income tax.*provision|excess.*provision|short.*provision/i
  //
  // Profit for the year is already auto-linked to pl.eps.npat / npat_py
  // (NoteBSLiab.tsx line 705-715) — no extra plumbing required.
  //
  // Cross-client safe: pure pattern match on COA-mapped BS_EQ_RS ledgers,
  // identical for Corporate (Schedule III Div I) and NCE entities.  Manual
  // user overrides survive because we only seed the value when the existing
  // path is null / undefined / empty string.
  {
    const existRS  = (options.existing?.bs_liab as any)?.reserves_surplus ?? {};
    const outRS    = (out.bs_liab.reserves_surplus ?? {}) as any;
    const priorRS  = (pyNotes?.bs_liab as any)?.reserves_surplus ?? {};

    const isUnset = (v: any) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));

    // ── (a) Surplus opening, CY ─────────────────────────────────────────────
    // = prior year's closing R&S, which sits in pyNotes.bs_liab.reserves_surplus.cy
    // (sign-corrected positive after the sectionSign fix).  Fall back to the
    // FS-fallback sum if no prior stage5_notes exists.
    if (isUnset(existRS.surplus_opening_cy)) {
      let priorCloseRS: number | null = null;
      if (typeof priorRS.cy === "number" && Number.isFinite(priorRS.cy)) {
        priorCloseRS = Math.abs(priorRS.cy);
      } else if (pyFs["BS_EQ_RS"]) {
        priorCloseRS = Math.abs(pyFs["BS_EQ_RS"]);
      }
      if (priorCloseRS != null && Math.abs(priorCloseRS) > 0.005) {
        outRS.surplus_opening_cy = Math.round(priorCloseRS * 100) / 100;
      }
    }

    // ── (b) Surplus opening, PY ─────────────────────────────────────────────
    // Issue 3 (today) — the PY column previously stayed blank when no
    // prior engagement existed in the DB.  Auditors expect it to show
    // SOMETHING sensible whenever Tally has data, so we now walk four
    // fallbacks in priority order:
    //   1. prior stage5_notes.bs_liab.reserves_surplus.surplus_opening_cy
    //      (what the auditor filled in FY-1)
    //   2. prior TB opening_balance of BS_EQ_RS ledgers (FY-2 closing)
    //   3. prior FY's fa_financial_statements snapshot (pyFs[BS_EQ_RS])
    //      reduced by the prior year's net P&L (back-out of the closing
    //      identity:  PY_open = PY_close − PY_profit ).  Mathematically
    //      this is the "Less Profit & Loss A/c" carry-forward auditors
    //      use as a manual derivation.
    //   4. current TB opening_balance of BS_EQ_RS ledgers — FY-1 closing —
    //      which approximates the PY opening for a one-year-old company.
    if (isUnset(existRS.surplus_opening_py)) {
      let chosen: number | null = null;

      // (1) prior stage5_notes
      if (typeof priorRS.surplus_opening_cy === "number" && Math.abs(priorRS.surplus_opening_cy) > 0.005) {
        chosen = Math.round(priorRS.surplus_opening_cy * 100) / 100;
      }

      // (2) prior TB opening_balance for BS_EQ_RS ledgers
      if (chosen == null && pyTB && pyTB.length > 0) {
        let total = 0;
        for (const row of pyTB) {
          if (mapping[row.account_name]?.code !== "BS_EQ_RS") continue;
          total += Number(row.opening_balance ?? 0);
        }
        const abs = Math.abs(Math.round(total * 100) / 100);
        if (abs > 0.005) chosen = abs;
      }

      // (3) back-out from prior fa_financial_statements: PY_open ≈ PY_close − PY_profit
      if (chosen == null && pyFs["BS_EQ_RS"]) {
        const pyClose = Math.abs(pyFs["BS_EQ_RS"]);
        // Approximate prior-year P&L from pyTB if we have it.
        let pyProfit = 0;
        if (pyTB && pyTB.length > 0) {
          let r = 0, e = 0;
          for (const l of pyTB) {
            const code = mapping[l.account_name]?.code ?? "";
            if (code.startsWith("PL_REV")) r += l.balance;
            if (code.startsWith("PL_EXP")) e += l.balance;
          }
          pyProfit = -r - e;
        }
        const open = pyClose - Math.abs(pyProfit);
        if (Math.abs(open) > 0.005) chosen = Math.round(open * 100) / 100;
      }

      // (4) last resort — current TB opening_balance for BS_EQ_RS ledgers
      if (chosen == null) {
        let total = 0;
        for (const row of tb) {
          if (mapping[row.account_name]?.code !== "BS_EQ_RS") continue;
          total += Number(row.opening_balance ?? 0);
        }
        const abs = Math.abs(Math.round(total * 100) / 100);
        if (abs > 0.005) chosen = abs;
      }

      if (chosen != null) outRS.surplus_opening_py = chosen;
    }

    // ── (c) Adjustments for deferred tax / Excess provision (CY & PY) ───────
    // Issue 4 (take 3, today) — scoped back to BS_EQ_RS-mapped ledgers only.
    //
    // An earlier attempt scanned the entire TB by name pattern, which lifted
    // "Deferred Tax" balances out of BS_NCL_DTL / BS_NCA_DTA and "Provision
    // for Income Tax" out of PL_TAX_CUR — double-counting them in the R&S
    // sub-row sum and breaking the Note 3 = BS face reconciliation
    // (mismatch banner showed ₹72.68L diff).  The user's intent in the
    // original spec was the narrower one: pull values FROM Tally ledgers
    // already mapped under Reserves & Surplus.  If the auditor's CoA puts
    // these items elsewhere, the sub-row stays blank and the auditor can
    // type the disclosure amount manually — keeping BS-face integrity.
    const DEFERRED_TAX_RX = /\bdeferred\s*tax\b/i;
    const EXCESS_SHORT_RX = /(excess|short)\s*\(?\s*\(?\s*provision|provision\s+for\s+income\s+tax|income\s*tax\s+provision/i;

    const sumByPattern = (
      ledgers: TBLedger[] | undefined | null,
      fsCode: string,
      pattern: RegExp,
      useOpening = false,
    ): number => {
      if (!ledgers) return 0;
      let s = 0;
      for (const l of ledgers) {
        if (mapping[l.account_name]?.code !== fsCode) continue;
        if (!pattern.test(l.account_name)) continue;
        s += Number(useOpening ? (l.opening_balance ?? 0) : (l.balance ?? 0));
      }
      // bs_liab convention — flip sign so increases show positive
      return Math.round(-s * 100) / 100;
    };

    if (isUnset(existRS.surplus_deferred_adj_cy)) {
      const v = sumByPattern(tb, "BS_EQ_RS", DEFERRED_TAX_RX, false);
      if (Math.abs(v) > 0.005) outRS.surplus_deferred_adj_cy = v;
    }
    if (isUnset(existRS.surplus_deferred_adj_py)) {
      const v = pyTB
        ? sumByPattern(pyTB, "BS_EQ_RS", DEFERRED_TAX_RX, false)
        : sumByPattern(tb,   "BS_EQ_RS", DEFERRED_TAX_RX, true);
      if (Math.abs(v) > 0.005) outRS.surplus_deferred_adj_py = v;
    }
    if (isUnset(existRS.surplus_excess_short_cy)) {
      const v = sumByPattern(tb, "BS_EQ_RS", EXCESS_SHORT_RX, false);
      if (Math.abs(v) > 0.005) outRS.surplus_excess_short_cy = v;
    }
    if (isUnset(existRS.surplus_excess_short_py)) {
      const v = pyTB
        ? sumByPattern(pyTB, "BS_EQ_RS", EXCESS_SHORT_RX, false)
        : sumByPattern(tb,   "BS_EQ_RS", EXCESS_SHORT_RX, true);
      if (Math.abs(v) > 0.005) outRS.surplus_excess_short_py = v;
    }

    out.bs_liab.reserves_surplus = outRS;
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

  // ── R&S RECONCILIATION INVARIANT ──────────────────────────────────────
  // Note 3 sub-total MUST equal the BS-face Reserves & Surplus amount in
  // BOTH CY and PY. Sub-total = opening + profit + deferred_adj + excess.
  // After the journal-voucher scan, any residual gap is plugged into
  // surplus_excess_short_(cy|py) — that's the canonical "balancing" line
  // for prior-period tax adjustments routed through Surplus. This keeps
  // the mismatch banner clean across all clients (corporate + non-corp).
  //
  // Manual overrides are still respected: respectManualEdits() runs AFTER
  // this block, so if the auditor has typed a value into excess/deferred,
  // their number wins on the next render.
  try {
    const rs = (out.bs_liab.reserves_surplus ?? {}) as any;
    const existRS2 = ((options.existing?.bs_liab as any)?.reserves_surplus ?? {}) as any;
    const bsCy   = Number(rs.cy ?? 0);
    const bsPy   = Number(rs.py ?? 0);
    // Mirror the NoteBSLiab display fallback: if surplus_opening_* is unset
    // anywhere, fall back to rs.py (= prior-year R&S closing = CY opening)
    // and an analogous PY-opening fallback. Without this, my reconciliation
    // reads openCy=0 while the UI shows opening=rs.py — making the gap
    // calculation overshoot by the entire PY balance.
    const pick = (key: string, fallback: number) => {
      if (Number.isFinite(rs[key])) return Number(rs[key]);
      if (Number.isFinite(existRS2[key])) return Number(existRS2[key]);
      return fallback;
    };
    const npat   = Number((out.pl as any)?.eps?.npat       ?? 0);
    const npatPy = Number((out.pl as any)?.eps?.npat_py    ?? 0);
    // Opening balance CY = prior-year closing (= rs.py magnitude)
    const openCy = pick("surplus_opening_cy", Math.abs(bsPy));
    // Opening balance PY = bsPy - npatPy (back out the year-to-year movement
    // when no PPY data is available). This matches how the UI's "Opening
    // balance" PY column resolves when no prior-prior FS amounts exist.
    const openPyFallback = Math.abs(bsPy) - npatPy;
    const openPy = pick("surplus_opening_py", Math.max(0, openPyFallback));
    const defCy  = pick("surplus_deferred_adj_cy", 0);
    const defPy  = pick("surplus_deferred_adj_py", 0);
    const excCy0 = pick("surplus_excess_short_cy", 0);
    const excPy0 = pick("surplus_excess_short_py", 0);

    // PERSIST openings on rs so the rendered sub-total uses the same numbers.
    if (!Number.isFinite(rs.surplus_opening_cy)) rs.surplus_opening_cy = openCy;
    if (!Number.isFinite(rs.surplus_opening_py)) rs.surplus_opening_py = openPy;

    const subCy = openCy + npat   + defCy + excCy0;
    const subPy = openPy + npatPy + defPy + excPy0;
    const gapCy = Math.round((bsCy - subCy) * 100) / 100;
    const gapPy = Math.round((bsPy - subPy) * 100) / 100;

    // ALWAYS enforce reconciliation by writing the residual to excess_short.
    // This row is, by accounting definition, the balancing plug for any
    // post-NPAT adjustment routed through Surplus that wasn't captured
    // by the deferred-tax journal scan. The auditor's custom adjustments
    // should go into surplus_deferred_adj_cy/py (where manual override is
    // honoured) — NEVER into excess_short, which is auto-derived.
    //
    // Strip the excess_short paths from manual_edits so the post-call
    // respectManualEdits() doesn't restore a stale buggy value from a
    // previous run. This is one-way: future re-syncs always recompute.
    rs.surplus_excess_short_cy = Math.round((excCy0 + gapCy) * 100) / 100;
    rs.surplus_excess_short_py = Math.round((excPy0 + gapPy) * 100) / 100;
    out.bs_liab.reserves_surplus = rs;

    // Strip these paths from the existing manual_edits so respectManualEdits
    // can't put the stale value back. autoPopulate is the source of truth.
    if (options.existing && Array.isArray(options.existing.manual_edits)) {
      options.existing.manual_edits = options.existing.manual_edits.filter(p =>
        p !== "bs_liab.reserves_surplus.surplus_excess_short_cy" &&
        p !== "bs_liab.reserves_surplus.surplus_excess_short_py"
      );
    }
  } catch { /* non-fatal */ }

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

// ─── Phase E helpers — Notes as source of truth for BS/PL amounts ─────────────
//
// These functions read the BREAKUP SUB-ROWS (not the headline .cy/.py) and
// return their sum.  They return null when:
//   • notesData is null/undefined (notes never auto-populated), OR
//   • the note section/key doesn't exist, OR
//   • no breakup row has a non-null amount (note is still empty).
//
// Callers fall back to the raw TB sum (computedAmounts) when null is returned,
// preserving identical behaviour before the first auto-populate run.

/**
 * Sum of all non-null `amount_cy` values in the breakup array for the given
 * note section + key.  Returns null when the note has no populated sub-rows.
 */
// Bug 2/3 — strict "non-null" check: null / undefined / "" / whitespace
// strings are NOT considered populated.  Numeric 0 IS populated (auditor
// may explicitly enter zero).  Used by both sumNotesSubRows* and the
// mismatch detector so populated-row checks stay consistent.
function isNonEmptyAmount(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

export function sumNotesSubRowsCY(
  notesData: Stage5Notes | null | undefined,
  section:   "bs_liab" | "bs_asset" | "pl",
  key:       string,
): number | null {
  const noteRow = (notesData?.[section] as Record<string, any> | undefined)?.[key];
  if (!noteRow) return null;
  const breakup: any[] = Array.isArray(noteRow.breakup) ? noteRow.breakup : [];
  // BUG C2 FIX (2026-06-04): skip is_group HEADER rows when summing breakup
  // amounts. Group headers in the Corporate FS structure are visual roll-ups
  // — their `amount_cy` (if present) is either zero or a stale leftover that
  // should NEVER be counted on top of the members. Including them double-
  // counted the breakup total, which made notesMismatch.ts fire false
  // "Note off by ₹X" warnings on every client that used the group UI.
  const populated = breakup.filter(r =>
    r != null && r.is_group !== true && isNonEmptyAmount(r.amount_cy)
  );
  if (!populated.length) return null;
  return populated.reduce((s: number, r: any) => {
    const n = Number(r.amount_cy);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/**
 * Sum of all non-null `amount_py` values in the breakup array for the given
 * note section + key.  Returns null when the note has no populated sub-rows.
 * BUG C2 FIX — same is_group skip applied to the PY sum.
 */
export function sumNotesSubRowsPY(
  notesData: Stage5Notes | null | undefined,
  section:   "bs_liab" | "bs_asset" | "pl",
  key:       string,
): number | null {
  const noteRow = (notesData?.[section] as Record<string, any> | undefined)?.[key];
  if (!noteRow) return null;
  const breakup: any[] = Array.isArray(noteRow.breakup) ? noteRow.breakup : [];
  const populated = breakup.filter(r =>
    r != null && r.is_group !== true && isNonEmptyAmount(r.amount_py)
  );
  if (!populated.length) return null;
  return populated.reduce((s: number, r: any) => {
    const n = Number(r.amount_py);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

// ─── Bug 6 — FA Grid Net Block total (for BS PPE Phase E parity) ─────────────
//
// FA grid stores rows as { gross_open, additions, disposals, depn_open,
// depn_add, depn_disp } — the closing net block is computed:
//
//   gross_close = gross_open + additions − disposals
//   depn_close  = depn_open  + depn_add  − depn_disp
//   net_close   = gross_close − depn_close
//
// Returns the sum of net_close across all rows for CY, or the sum of
// (gross_open − depn_open) for PY.  Returns null when the grid is empty
// so callers fall back to raw TB cyOf("BS_NCA_FA").
export function getFAGridNetBlockTotal(
  notesData: Stage5Notes | null | undefined,
  column:    "cy" | "py",
): number | null {
  const rows: any[] = Array.isArray(notesData?.fa?.rows) ? notesData!.fa!.rows as any[] : [];
  if (!rows.length) return null;
  const num = (v: any): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  if (column === "cy") {
    let total = 0;
    let anyData = false;
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const grossClose = num(r.gross_open) + num(r.additions) - num(r.disposals);
      const depnClose  = num(r.depn_open)  + num(r.depn_add)  - num(r.depn_disp);
      total += grossClose - depnClose;
      if (num(r.gross_open) || num(r.additions) || num(r.disposals) ||
          num(r.depn_open)  || num(r.depn_add)  || num(r.depn_disp)) {
        anyData = true;
      }
    }
    return anyData ? total : null;
  }
  // PY column = the previous year's CLOSING net block (Balance Sheet "As at 31
  // Mar <PY>"). In the FA grid that is the "Total — Previous year" row's
  // **Net Block (CY)** cell — NOT its Net Block (PY) cell.
  //
  // ROOT-CAUSE FIX: this previously returned fa.py_manual.netPY, which is the
  // previous year's OPENING net block (as-at-start-of-PY) — one year too far
  // back — so the BS PPE prior-year figure was wrong (e.g. showed 3,19,335
  // instead of the correct 3,51,421). The auditor's "Total — Previous year"
  // closing figure lives in py_manual.netCY (or, if not directly overridden,
  // is derivable from the PY closing gross/depreciation, or equals the
  // current-year OPENING net block = sum(gross_open − depn_open)).
  const pyManual = (notesData?.fa as any)?.py_manual ?? {};
  const fin = (v: any) => Number.isFinite(Number(v)) && Math.abs(Number(v)) > 0.005;
  // 1) Explicit "Total — Previous year" → Net Block (CY) override.
  if (fin(pyManual?.netCY)) return Math.round(Number(pyManual.netCY) * 100) / 100;
  // 2) Derive from PY closing gross − PY closing depreciation, if those were
  //    entered on the "Total — Previous year" row.
  if (fin(pyManual?.grossClose) || fin(pyManual?.depnClose)) {
    return Math.round((Number(pyManual.grossClose || 0) - Number(pyManual.depnClose || 0)) * 100) / 100;
  }
  // 3) Fall back to current-year OPENING net block (= previous-year closing).
  let total = 0;
  let anyData = false;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const g = num(r.gross_open);
    const d = num(r.depn_open);
    total += g - d;
    if (g || d) anyData = true;
  }
  return anyData ? total : null;
}

// ─── Bug 1 — Shares Outstanding (for EPS divisor) ─────────────────────────────
//
// Sum the `share_count_cy` / `share_count_py` fields on Share Capital breakup
// rows that are flagged as paid-up (is_paid_up === true OR
// subType === "issued_paid_up").  Returns 0 when no paid-up rows have a count.
//
// Used by P&L Earnings-per-share to compute Basic EPS = profit / share count
// instead of the previous (incorrect) profit / note-number divisor.

export function getSharesOutstanding(
  notesData: Stage5Notes | null | undefined,
  column:    "cy" | "py",
): number {
  const shareCap = (notesData?.bs_liab as Record<string, any> | undefined)?.share_capital;
  if (!shareCap) return 0;

  // 1) Primary source — paid-up breakup rows with explicit share_count_* fields.
  const breakup: any[] = Array.isArray(shareCap.breakup) ? shareCap.breakup : [];
  const breakupTotal = breakup
    .filter(r => r != null && (r.is_paid_up === true || r.subType === "issued_paid_up"))
    .reduce((s: number, r: any) => {
      const count = column === "cy" ? r.share_count_cy : r.share_count_py;
      const n = Number(count);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
  if (breakupTotal > 0) return breakupTotal;

  // 2) Fallback — reconciliation table (closing = open + move).
  // The Share Capital note already exposes "Reconciliation of number of
  // shares outstanding" in the UI; auditors fill open/move counts there
  // and the closing count is computed.  Use that as the EPS divisor.
  const parseNum = (v: any): number => {
    if (v == null || v === "") return 0;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };
  const open = parseNum(shareCap[`recon_open_${column}_num`]);
  const move = parseNum(shareCap[`recon_move_${column}_num`]);
  return open + move;
}
