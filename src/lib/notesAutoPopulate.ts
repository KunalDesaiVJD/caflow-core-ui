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
}

export const NOTE_ROW_REGISTRY: {
  bs_liab:  Record<string, NoteRowSpec>;
  bs_asset: Record<string, NoteRowSpec>;
  pl:       Record<string, NoteRowSpec>;
} = {
  // ── Note 3-12 — BS Liabilities side ─────────────────────────────────────
  bs_liab: {
    share_capital:        { fsCodes: ["BS_EQ_SC"],   label: "Share capital" },
    reserves_surplus:     { fsCodes: ["BS_EQ_RS"],   label: "Reserves and surplus" },
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
    other_expenses:     { fsCodes: ["PL_EXP_OTH"], label: "Other expenses" },
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
      account_name:    String(l.ledger_name || "").trim(),
      account_group:   l.parent_group || "",
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
export function sumLedgersByFsCodes(
  tb: TBLedger[],
  mapping: COAMapping,
  fsCodes: string[],
): number {
  if (!fsCodes.length) return 0;
  const codeSet = new Set(fsCodes);
  let total = 0;
  for (const acct of tb) {
    const code = mapping[acct.account_name]?.code;
    if (code && codeSet.has(code)) total += acct.balance;
  }
  return Math.round(total * 100) / 100;
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
  const [mapping, tb, pyNotes, pyFs] = await Promise.all([
    getCOAMapping(engagementId),
    getTrialBalance(engagementId),
    getPreviousYearStage5Notes(engagementId),
    getPreviousYearFsAmounts(engagementId),
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
      const cy = sumLedgersByFsCodes(tb, mapping, spec.fsCodes);
      const py = pyOf(section, rowKey, spec);
      out[section][rowKey] = { cy, py };
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
  if (options.existing) {
    return respectManualEdits(out, options.existing);
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
