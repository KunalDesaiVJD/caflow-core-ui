/**
 * noteNumberRegistry — Smart Note Number System v2
 *
 * Single source of truth for note numbers used across:
 *   • Stage 5  — Notes tab (NoteBSLiab, NoteBSAsset, NotePL, FAGrid)
 *   • Stage 7  — Financial Statements BS/PL columns
 *   • Export   — fsNotesWriter, fsRatiosWriter, fsExcelExport
 *
 * v2 additions (PHASE 1):
 *   NOTE_KEYS           — typed string constants (no magic strings anywhere)
 *   CORPORATE_NOTE_ORDER / NCE_NOTE_ORDER — canonical scan order
 *   KEY_TO_FS_CODES     — registry key → FS item code(s) for both entity types
 *   hasData()           — pure function: returns true when a note has any data
 *   buildDynamicRegistry() — pure function: assigns sequential note numbers
 *   useDynamicNoteRegistry() — React hook: fetches engagement + COA, returns registry
 *
 * Backward compatibility: ALL v1 exports (NoteEntry, NOTE_REGISTRY, getNoteNo,
 * getNotesByCategory, getNoteLabel, NOTE_MAP) are preserved unchanged.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signedBalance as fsSignedBalance, signedOpening as fsSignedOpening } from "@/lib/fsSignConvention";

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 1 — v1 (backward-compatible) static registry ────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export interface NoteEntry {
  /** Unique key matching the key used in notesAutoPopulate registry and
   *  Stage5Notes paths (e.g. "share_capital", "lt_borrowings"). */
  key:      string;
  /** Assigned Schedule III note number. */
  noteNo:   number;
  /** Sub-tab / section this note belongs to. */
  category: "BS-Liab" | "BS-Asset" | "PL" | "FA";
  /** Human-readable label shown in the NoteCard header. */
  label:    string;
}

// DO NOT reorder without updating NoteBSLiab, NoteBSAsset, NotePL, FAGrid,
// and the SCHEDULE_III_DIV_I noteRef values in PipelineFinancialStatements.
export const NOTE_REGISTRY: NoteEntry[] = [
  // ── BS — Liabilities side ───────────────────────────────────────────────
  { key: "share_capital",        noteNo:  1, category: "BS-Liab", label: "Share capital" },
  { key: "reserves_surplus",     noteNo:  2, category: "BS-Liab", label: "Reserves and surplus" },
  { key: "lt_borrowings",        noteNo:  3, category: "BS-Liab", label: "Long-term borrowings" },
  { key: "deferred_tax_liab",    noteNo:  4, category: "BS-Liab", label: "Deferred tax liabilities (Net)" },
  { key: "other_lt_liab",        noteNo:  5, category: "BS-Liab", label: "Other Long term liabilities" },
  { key: "lt_provisions",        noteNo:  6, category: "BS-Liab", label: "Long-term provisions" },
  { key: "st_borrowings",        noteNo:  7, category: "BS-Liab", label: "Short-term borrowings" },
  { key: "trade_payables",       noteNo:  8, category: "BS-Liab", label: "Trade payables" },
  { key: "other_current_liab",   noteNo:  9, category: "BS-Liab", label: "Other current liabilities" },
  { key: "st_provisions",        noteNo: 10, category: "BS-Liab", label: "Short-term provisions" },

  // ── BS — Assets side ────────────────────────────────────────────────────
  { key: "ppe",                  noteNo: 11, category: "FA",       label: "Property, Plant and Equipment and Intangible Assets" },
  { key: "nc_investments",       noteNo: 12, category: "BS-Asset", label: "Non-current investments" },
  { key: "deferred_tax_assets",  noteNo: 13, category: "BS-Asset", label: "Deferred tax assets (Net)" },
  { key: "lt_loans_advances",    noteNo: 14, category: "BS-Asset", label: "Long-term loans and advances" },
  { key: "other_nc_assets",      noteNo: 15, category: "BS-Asset", label: "Other non-current assets" },
  { key: "current_investments",  noteNo: 16, category: "BS-Asset", label: "Current investments" },
  { key: "inventories",          noteNo: 17, category: "BS-Asset", label: "Inventories" },
  { key: "trade_receivables",    noteNo: 18, category: "BS-Asset", label: "Trade receivables" },
  { key: "cash_bank",            noteNo: 19, category: "BS-Asset", label: "Cash and bank equivalents" },
  { key: "st_loans_advances",    noteNo: 20, category: "BS-Asset", label: "Short-term loans and advances" },
  { key: "other_current_assets", noteNo: 21, category: "BS-Asset", label: "Other current assets" },

  // ── P&L ─────────────────────────────────────────────────────────────────
  { key: "revenue_from_ops",     noteNo: 22, category: "PL",       label: "Revenue from operations" },
  { key: "other_income",         noteNo: 23, category: "PL",       label: "Other income" },
  { key: "cost_materials",       noteNo: 24, category: "PL",       label: "Cost of materials consumed" },
  { key: "purchases_stock",      noteNo: 25, category: "PL",       label: "Purchases of Stock-in-Trade" },
  { key: "changes_inventories",  noteNo: 26, category: "PL",       label: "Changes in inventories" },
  { key: "employee_benefits",    noteNo: 27, category: "PL",       label: "Employee benefits expense" },
  { key: "finance_costs",        noteNo: 28, category: "PL",       label: "Finance Costs" },
  { key: "other_expenses",       noteNo: 29, category: "PL",       label: "Other expenses" },
  { key: "eps",                  noteNo: 30, category: "PL",       label: "Earnings per equity share" },
  { key: "ratios",               noteNo: 31, category: "PL",       label: "Ratios" },
];

/** Return the static note number for a given key, or undefined if not registered. */
export function getNoteNo(key: string): number | undefined {
  return NOTE_REGISTRY.find(n => n.key === key)?.noteNo;
}

/** Return all entries for a given category. */
export function getNotesByCategory(cat: NoteEntry["category"]): NoteEntry[] {
  return NOTE_REGISTRY.filter(n => n.category === cat);
}

/** Return the label for a given key, or undefined. */
export function getNoteLabel(key: string): string | undefined {
  return NOTE_REGISTRY.find(n => n.key === key)?.label;
}

/** O(1) lookup map from key → NoteEntry. */
export const NOTE_MAP: ReadonlyMap<string, NoteEntry> = new Map(
  NOTE_REGISTRY.map(n => [n.key, n]),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 2 — v2: NOTE_KEYS typed constants ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export const NOTE_KEYS = {
  // Note 1 is always hardcoded to accounting policies
  ACCOUNTING_POLICIES:     "accounting_policies",
  NCE_ACCOUNTING_POLICIES: "nce_accounting_policies",

  // Corporate BS — Liabilities
  SHARE_CAPITAL:           "share_capital",
  RESERVES_SURPLUS:        "reserves_surplus",
  LT_BORROWINGS:           "lt_borrowings",
  DEFERRED_TAX_LIAB:       "deferred_tax_liab",
  OTHER_LT_LIAB:           "other_lt_liab",
  LT_PROVISIONS:           "lt_provisions",
  ST_BORROWINGS:           "st_borrowings",
  TRADE_PAYABLES:          "trade_payables",
  OTHER_CURRENT_LIAB:      "other_current_liab",
  ST_PROVISIONS:           "st_provisions",

  // Corporate BS — Assets
  PPE:                     "ppe",
  NC_INVESTMENTS:          "nc_investments",
  DEFERRED_TAX_ASSETS:     "deferred_tax_assets",
  LT_LOANS_ADVANCES:       "lt_loans_advances",
  OTHER_NC_ASSETS:         "other_nc_assets",
  CURRENT_INVESTMENTS:     "current_investments",
  INVENTORIES:             "inventories",
  TRADE_RECEIVABLES:       "trade_receivables",
  CASH_BANK:               "cash_bank",
  ST_LOANS_ADVANCES:       "st_loans_advances",
  OTHER_CURRENT_ASSETS:    "other_current_assets",

  // Corporate P&L
  REVENUE_FROM_OPS:        "revenue_from_ops",
  OTHER_INCOME:            "other_income",
  COST_MATERIALS:          "cost_materials",
  PURCHASES_STOCK:         "purchases_stock",
  CHANGES_INVENTORIES:     "changes_inventories",
  EMPLOYEE_BENEFITS:       "employee_benefits",
  FINANCE_COSTS:           "finance_costs",
  DEPRECIATION:            "depreciation",
  OTHER_EXPENSES:          "other_expenses",
  EPS:                     "eps",
  RATIOS:                  "ratios",

  // NCE-specific
  OWNERS_CAPITAL:          "owners_capital",
  NCE_COST_GOODS:          "nce_cost_goods",
  NCE_EMPLOYEE_BENEFITS:   "nce_employee_benefits",
  NCE_FINANCE_COSTS:       "nce_finance_costs",
  NCE_DEPRECIATION:        "nce_depreciation",
  NCE_OTHER_EXPENSES:      "nce_other_expenses",
  NCE_OTHER_INCOME:        "nce_other_income",
  NCE_REVENUE_FROM_OPS:    "nce_revenue_from_ops",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 3 — v2: Canonical note order arrays ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Corporate note scan order.  Note 1 (accounting_policies) is always assigned
 * first by buildDynamicRegistry; this array covers Notes 2 onwards.
 */
export const CORPORATE_NOTE_ORDER: string[] = [
  "share_capital", "reserves_surplus",
  "lt_borrowings", "deferred_tax_liab", "other_lt_liab", "lt_provisions",
  "st_borrowings", "trade_payables", "other_current_liab", "st_provisions",
  "ppe",
  "nc_investments", "deferred_tax_assets", "lt_loans_advances", "other_nc_assets",
  "current_investments", "inventories", "trade_receivables",
  "cash_bank", "st_loans_advances", "other_current_assets",
  "revenue_from_ops", "other_income",
  "cost_materials", "purchases_stock", "changes_inventories",
  "employee_benefits", "finance_costs", "depreciation", "other_expenses",
  "eps", "ratios",
];

/**
 * NCE note scan order.  Note 1 (nce_accounting_policies) is always first;
 * this array covers Notes 2 onwards.
 */
export const NCE_NOTE_ORDER: string[] = [
  "owners_capital",
  "lt_borrowings", "other_lt_liab", "lt_provisions",
  "st_borrowings", "trade_payables", "other_current_liab", "st_provisions",
  "ppe",
  "nc_investments", "deferred_tax_assets", "lt_loans_advances", "other_nc_assets",
  "current_investments", "inventories", "trade_receivables",
  "cash_bank", "st_loans_advances", "other_current_assets",
  "nce_revenue_from_ops", "nce_other_income",
  "nce_cost_goods", "nce_employee_benefits", "nce_finance_costs",
  "nce_depreciation", "nce_other_expenses",
];

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 4 — v2: Registry key → FS item code mapping ─────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Maps each registry key to the FS item code(s) used in `computedAmounts` /
 * `mergedPY` for CORPORATE entities (SCHEDULE_III_DIV_I codes).
 */
const CORP_KEY_TO_FS_CODES: Readonly<Record<string, string[]>> = {
  share_capital:        ["BS_EQ_SC"],
  reserves_surplus:     ["BS_EQ_RS"],
  lt_borrowings:        ["BS_NCL_LTB"],
  deferred_tax_liab:    ["BS_NCL_DTL"],
  other_lt_liab:        ["BS_NCL_OLT"],
  lt_provisions:        ["BS_NCL_LTP"],
  st_borrowings:        ["BS_CL_STB"],
  trade_payables:       ["BS_CL_TP"],
  other_current_liab:   ["BS_CL_OCL"],
  st_provisions:        ["BS_CL_STP"],
  ppe:                  ["BS_NCA_FA"],
  nc_investments:       ["BS_NCA_INV"],
  deferred_tax_assets:  ["BS_NCA_DTA"],
  lt_loans_advances:    ["BS_NCA_LLA"],
  other_nc_assets:      ["BS_NCA_ONA"],
  current_investments:  ["BS_CA_CI"],
  inventories:          ["BS_CA_INV", "INV_RM", "INV_WIP", "INV_FG", "INV_STT", "INV_STOCK"],
  trade_receivables:    ["BS_CA_TR"],
  cash_bank:            ["BS_CA_CCE"],
  st_loans_advances:    ["BS_CA_SLA"],
  other_current_assets: ["BS_CA_OCA"],
  revenue_from_ops:     ["PL_REV_OPS"],
  other_income:         ["PL_REV_OI"],
  cost_materials:       ["PL_EXP_MAT"],
  purchases_stock:      ["PL_EXP_SIT"],
  changes_inventories:  ["PL_EXP_CII"],
  employee_benefits:    ["PL_EXP_EMP"],
  finance_costs:        ["PL_EXP_FIN"],
  depreciation:         ["PL_EXP_DEP"],
  other_expenses:       ["PL_EXP_OTH"],
  eps:                  ["PL_EPS_B", "PL_EPS_D"],
  ratios:               [],  // no FS line — always active once note exists
};

/**
 * Maps each registry key to the FS item code(s) used in `computedAmounts` /
 * `mergedPY` for NCE entities (NCE_FS_ITEMS codes).
 */
const NCE_KEY_TO_FS_CODES: Readonly<Record<string, string[]>> = {
  owners_capital:        ["NCE_CAP"],
  lt_borrowings:         ["NCE_LTB"],
  other_lt_liab:         ["NCE_OLTL"],
  lt_provisions:         ["NCE_LTP"],
  st_borrowings:         ["NCE_STB"],
  trade_payables:        ["NCE_TP"],
  other_current_liab:    ["NCE_OCL"],
  st_provisions:         ["NCE_STP"],
  ppe:                   ["NCE_PPE"],
  nc_investments:        ["NCE_NCINV"],
  deferred_tax_assets:   [],  // NCE entities rarely have DTA
  lt_loans_advances:     ["NCE_LTLA"],
  other_nc_assets:       ["NCE_ONCA"],
  current_investments:   ["NCE_CINV"],
  inventories:           ["NCE_STCK"],
  trade_receivables:     ["NCE_TR"],
  cash_bank:             ["NCE_CASH"],
  st_loans_advances:     ["NCE_STLA"],
  other_current_assets:  ["NCE_OCA"],
  nce_revenue_from_ops:  ["NCE_REV_OPS"],
  nce_other_income:      ["NCE_REV_OTH"],
  nce_cost_goods:        ["NCE_COGS"],
  nce_employee_benefits: ["NCE_EMP_EXP"],
  nce_finance_costs:     ["NCE_FIN_COST"],
  nce_depreciation:      ["NCE_DEPR"],
  nce_other_expenses:    ["NCE_OTH_EXP"],
};

/** Return the FS item code(s) for a registry key given the entity type. */
export function getKeyFsCodes(key: string, isNce: boolean): string[] {
  return (isNce ? NCE_KEY_TO_FS_CODES : CORP_KEY_TO_FS_CODES)[key] ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 5 — v2: hasData() pure function ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Return true when a note has any data.
 *
 * Three signal sources are checked in order:
 *   1. CY FS amount (from computedAmounts)
 *   2. PY FS amount (from mergedPY)
 *   3. COA mapped ledger count (from coaMapping)
 *
 * The function short-circuits at the first truthy signal.
 *
 * @param key             Registry key (e.g. "share_capital")
 * @param computedAmounts CY FS amounts keyed by FS item code
 * @param mergedPY        PY FS amounts keyed by FS item code
 * @param coaMapping      Ledger → {code} mapping from engagement.coa_mapping
 * @param isNce           True for non-corporate entities
 */
export function hasData(
  key:             string,
  computedAmounts: Record<string, number>,
  mergedPY:        Record<string, number>,
  coaMapping:      Record<string, { code: string }>,
  isNce:           boolean,
  /** When false, signal 3 (COA mapping) is skipped — only CY/PY amounts count.
   *  Pass false from buildDynamicRegistry when real amounts are provided so
   *  zero-balance mapped ledgers don't ghost-consume sequential note numbers. */
  useCoaSignal = true,
): boolean {
  const fsCodes = getKeyFsCodes(key, isNce);
  if (fsCodes.length === 0) return false;

  // 1 & 2 — Amount checks (CY + PY)
  for (const code of fsCodes) {
    if ((computedAmounts[code] ?? 0) !== 0) return true;
    if ((mergedPY[code] ?? 0) !== 0) return true;
  }

  // 3 — COA mapping check (any ledger mapped to one of this key's FS codes).
  // Skipped when useCoaSignal = false so that zero-balance mapped ledgers do
  // not consume a sequential note number and cause numbering gaps in the FS.
  if (!useCoaSignal) return false;
  const codeSet = new Set(fsCodes);
  for (const mapping of Object.values(coaMapping)) {
    if (mapping?.code && codeSet.has(mapping.code)) return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 6 — v2: buildDynamicRegistry() pure function ─────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a dynamic Map<registryKey, dynamicNoteNo>.
 *
 * Algorithm:
 *   • Note 1 is ALWAYS the accounting-policies note (never suppressed).
 *   • Walk CORPORATE_NOTE_ORDER or NCE_NOTE_ORDER in sequence.
 *   • For each key, call hasData(). If true, assign nextNote and increment.
 *     If false, skip — counter does NOT increment (no gap in numbering).
 *
 * @param computedAmounts  CY FS amounts keyed by FS item code
 * @param mergedPY         PY FS amounts keyed by FS item code
 * @param coaMapping       Ledger → {code} map from engagement.coa_mapping
 * @param isNonCorporate   True for non-corporate entity types
 */
/**
 * Keys that always receive a note number regardless of amounts or COA mapping.
 * "ppe" is always active because the FA schedule is rendered unconditionally —
 * there is always a PPE / Fixed Assets note even when the BS amount is zero.
 * "ratios" is always active because the Ratios disclosure is mandated by
 * Schedule III (Sch III Note 11) — and because it carries no FS codes the
 * generic hasData() check would otherwise skip it.  As "ratios" sits last in
 * CORPORATE_NOTE_ORDER, it receives the FINAL note number after every
 * other corporate note has been assigned.
 */
const CORP_ALWAYS_ACTIVE = new Set<string>(["ppe", "ratios"]);
const NCE_ALWAYS_ACTIVE  = new Set<string>(["ppe"]);

export function buildDynamicRegistry(
  computedAmounts:  Record<string, number>,
  mergedPY:         Record<string, number>,
  coaMapping:       Record<string, { code: string }>,
  isNonCorporate:   boolean,
  /** When false, signal 3 (COA mapping) is skipped inside hasData().
   *  Pass false when real CY/PY amounts are available (e.g. the FS outer
   *  component) so zero-balance mapped ledgers don't create numbering gaps. */
  useCoaSignal = true,
): Map<string, number> {
  const registry = new Map<string, number>();

  // Note 1: always accounting policies
  const policiesKey = isNonCorporate
    ? NOTE_KEYS.NCE_ACCOUNTING_POLICIES
    : NOTE_KEYS.ACCOUNTING_POLICIES;
  registry.set(policiesKey, 1);

  const alwaysActive = isNonCorporate ? NCE_ALWAYS_ACTIVE : CORP_ALWAYS_ACTIVE;
  const order = isNonCorporate ? NCE_NOTE_ORDER : CORPORATE_NOTE_ORDER;
  let nextNote = 2;

  for (const key of order) {
    if (
      alwaysActive.has(key) ||
      hasData(key, computedAmounts, mergedPY, coaMapping, isNonCorporate, useCoaSignal)
    ) {
      registry.set(key, nextNote);
      nextNote++;   // only increments when the note has data → no gaps
    }
    // keys with no data are silently skipped
  }

  return registry;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 7 — v2: Non-corporate type list (exported for reuse) ─────────────
// ═══════════════════════════════════════════════════════════════════════════════

export const NON_CORPORATE_TYPES: readonly string[] = [
  "Individual",
  "Proprietorship",
  "Sole Proprietorship",
  "Partnership",
  "LLP",
  "Limited Liability Partnership",
  "HUF",
  "Hindu Undivided Family",
  "Trust",
  "AOP",
  "Association of Persons",
  "BOI",
  "Body of Individuals",
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 8 — v2: useDynamicNoteRegistry() React hook ─────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * React hook that returns a dynamic note number registry for the given engagement.
 *
 * Usage:
 *   // Inside PipelineFinancialStatements (has computedAmounts + mergedPY):
 *   const { getNoteNo, getNoteHeading } = useDynamicNoteRegistry(
 *     engagementId, computedAmounts, mergedPY,
 *   );
 *
 *   // Inside Stage 5 Notes components (no pre-computed amounts):
 *   const { getNoteNo } = useDynamicNoteRegistry(engagementId);
 *   // → falls back to COA-mapping-only hasData() check
 *
 * @param engagementId    Audit engagement UUID
 * @param computedAmounts Optional pre-computed CY FS amounts (pass from PipelineFS)
 * @param mergedPY        Optional pre-computed PY FS amounts (pass from PipelineFS)
 */
export function useDynamicNoteRegistry(
  engagementId:    string,
  computedAmounts?: Record<string, number>,
  mergedPY?:        Record<string, number>,
) {
  // Fetch engagement to get entity_type and coa_mapping
  const { data: engagement } = useQuery({
    queryKey: ["engagement-note-registry", engagementId],
    queryFn:  async () => {
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("entity_type, coa_mapping, clients(entity_type)")
        .eq("id", engagementId)
        .single();
      return data as { entity_type: string | null; coa_mapping: unknown; clients?: { entity_type?: string } } | null;
    },
    enabled: !!engagementId,
    staleTime: 5 * 60 * 1000,  // 5 min — entity type and COA mapping rarely change mid-session
  });

  // ── Stage-5 notes fallback fetch ────────────────────────────────────────────
  // When a caller (NoteBSLiab / NoteBSAsset / NotePL / FAGrid) does NOT pass
  // computedAmounts / mergedPY, the registry falls back to the COA-mapping
  // signal which counts ANY mapped ledger as data — including ledgers with
  // zero balance that produce empty BS rows.  Those zero-balance rows are
  // suppressed on the BS face (PipelineFinancialStatements passes real
  // amounts) so the BS gets one numbering and the Notes tab gets a different
  // one (off-by-one for every suppressed row before a populated key).
  //
  // Fix: when the caller does not provide amounts, derive them from the
  // saved stage5_notes JSONB (which is the source of truth for what's on
  // the face of the BS / P&L after Phase E).  Both contexts then share a
  // single set of signals → identical numbering everywhere.
  const needsFallback = !computedAmounts && !mergedPY;
  const { data: stage5Notes } = useQuery({
    queryKey: ["stage5-notes-for-numbering", engagementId],
    queryFn:  async () => {
      const { data } = await (supabase.from as any)("audit_engagements")
        .select("stage5_notes")
        .eq("id", engagementId)
        .maybeSingle();
      return (data as any)?.stage5_notes ?? null;
    },
    enabled: !!engagementId && needsFallback,
    staleTime: 30 * 1000,
  });

  // ── TB-derived fallback fetch ───────────────────────────────────────────────
  // Stage-5 notes alone is insufficient for parity with the BS face — many
  // BS-Asset notes (Cash & Bank, Trade Receivables, Other Current Assets)
  // have data in the Trial Balance but no corresponding stage5_notes row
  // until the auditor opens that note.  The BS face counts these (because
  // PipelineFinancialStatements passes TB-derived computedAmounts to the
  // hook), so the Notes tab fallback drifts off-by-N for every such missing
  // BS-Asset note → cascades into wrong P&L note numbers.
  //
  // Fix: when the caller doesn't provide computedAmounts, fetch the Trial
  // Balance + COA mapping ourselves and aggregate by FS code — exactly
  // mirroring how PipelineFinancialStatements computes computedAmounts.
  // This guarantees both contexts see identical signals.
  const { data: tbRows } = useQuery({
    queryKey: ["tb-for-numbering", engagementId],
    queryFn:  async () => {
      const all: any[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase.from as any)("tally_trial_balance")
          .select("ledger_name, closing_balance, balance_type, opening_balance, opening_type")
          .eq("engagement_id", engagementId)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      return all as Array<{
        ledger_name: string;
        closing_balance: number | null;
        balance_type: string | null;
        opening_balance: number | null;
        opening_type:  string | null;
      }>;
    },
    enabled: !!engagementId && needsFallback,
    staleTime: 60 * 1000,
  });

  const coaMapping = useMemo<Record<string, { code: string }>>(() => {
    if (engagement?.coa_mapping && typeof engagement.coa_mapping === "object") {
      return engagement.coa_mapping as Record<string, { code: string }>;
    }
    return {};
  }, [engagement?.coa_mapping]);

  const isNonCorporate = useMemo<boolean>(() => {
    const type = (
      engagement?.entity_type ||
      engagement?.clients?.entity_type ||
      ""
    ).trim();
    return NON_CORPORATE_TYPES.some(
      t => t.toLowerCase() === type.toLowerCase(),
    );
  }, [engagement]);

  // Derive synthetic FS-code-keyed amounts from stage5_notes for the
  // fallback path (Notes tab callers).  For each registry key, look at the
  // saved note row; prefer the breakup-row sum (most accurate post-Phase E)
  // over the stored .cy/.py headline (which can be stale across re-syncs).
  const fallbackAmounts = useMemo<{ cy: Record<string, number>; py: Record<string, number> }>(() => {
    const cy: Record<string, number> = {};
    const py: Record<string, number> = {};
    if (!needsFallback || !stage5Notes) return { cy, py };
    const sectionsForKey = (key: string): ("bs_liab"|"bs_asset"|"pl")[] => {
      if (CORP_KEY_TO_FS_CODES[key] || NCE_KEY_TO_FS_CODES[key]) {
        // Crude section detection: BS liab keys live under bs_liab, etc.
        if (CORPORATE_NOTE_ORDER.indexOf(key) >= 0 && CORPORATE_NOTE_ORDER.indexOf(key) <= 9) return ["bs_liab"];
        if (NCE_NOTE_ORDER.indexOf(key) >= 0 && NCE_NOTE_ORDER.indexOf(key) <= 7) return ["bs_liab"];
        // P&L keys
        if (key.startsWith("nce_") && (key.includes("revenue") || key.includes("income") || key.includes("cost") || key.includes("employee") || key.includes("finance") || key.includes("depreciation") || key.includes("expense"))) return ["pl"];
        if (["revenue_from_ops","other_income","cost_materials","purchases_stock","changes_inventories","employee_benefits","finance_costs","depreciation","other_expenses","eps","ratios"].includes(key)) return ["pl"];
        return ["bs_asset"];
      }
      return [];
    };
    const keys = isNonCorporate ? NCE_NOTE_ORDER : CORPORATE_NOTE_ORDER;
    for (const key of keys) {
      const sections = sectionsForKey(key);
      const fsCodes  = (isNonCorporate ? NCE_KEY_TO_FS_CODES : CORP_KEY_TO_FS_CODES)[key] ?? [];
      if (fsCodes.length === 0) continue;
      let cySum = 0, pySum = 0;
      for (const section of sections) {
        const noteRow = (stage5Notes[section] as Record<string, any> | undefined)?.[key];
        if (!noteRow) continue;
        const breakup: any[] = Array.isArray(noteRow.breakup) ? noteRow.breakup : [];
        const populatedCy = breakup.filter(r => r != null && r.amount_cy != null && r.amount_cy !== "");
        const populatedPy = breakup.filter(r => r != null && r.amount_py != null && r.amount_py !== "");
        const breakupCy = populatedCy.reduce((s, r) => s + (Number.isFinite(Number(r.amount_cy)) ? Number(r.amount_cy) : 0), 0);
        const breakupPy = populatedPy.reduce((s, r) => s + (Number.isFinite(Number(r.amount_py)) ? Number(r.amount_py) : 0), 0);
        const headlineCy = Math.abs(Number(noteRow.cy ?? 0));
        const headlinePy = Math.abs(Number(noteRow.py ?? 0));
        // Prefer breakup sum when populated; fall back to headline.
        cySum += breakupCy !== 0 ? breakupCy : headlineCy;
        pySum += breakupPy !== 0 ? breakupPy : headlinePy;
      }
      // Distribute the key's amount across its FS codes (just put on the
      // first code — hasData() only cares whether any code is non-zero).
      if (cySum !== 0) cy[fsCodes[0]] = cySum;
      if (pySum !== 0) py[fsCodes[0]] = pySum;
    }
    return { cy, py };
  }, [needsFallback, stage5Notes, isNonCorporate]);

  // Build TB-derived amounts (the same signal the BS face uses).  This is
  // the PRIMARY source for fallback numbering — it captures every FS code
  // that has TB data, even when stage5_notes hasn't been populated yet.
  const tbAmounts = useMemo<{ cy: Record<string, number>; py: Record<string, number> }>(() => {
    const cy: Record<string, number> = {};
    const py: Record<string, number> = {};
    if (!needsFallback || !tbRows || tbRows.length === 0) return { cy, py };
    for (const r of tbRows) {
      const code = coaMapping[r.ledger_name]?.code;
      if (!code) continue;
      // Break #7: use fsSignConvention instead of inline isDr logic
      cy[code] = (cy[code] ?? 0) + fsSignedBalance(r.closing_balance, r.balance_type, "DR");
      py[code] = (py[code] ?? 0) + fsSignedOpening(r.opening_balance, r.opening_type, "DR");
    }
    return { cy, py };
  }, [needsFallback, tbRows, coaMapping]);

  // Merge TB-derived amounts (primary) with stage5_notes-derived amounts
  // (secondary).  TB wins when both are present — it matches the BS face.
  // stage5_notes covers cases where TB is unavailable (e.g. legacy
  // engagements migrated from external sources).
  const mergedFallbackCy: Record<string, number> = { ...fallbackAmounts.cy, ...tbAmounts.cy };
  const mergedFallbackPy: Record<string, number> = { ...fallbackAmounts.py, ...tbAmounts.py };

  const effectiveCy = computedAmounts ?? mergedFallbackCy;
  const effectivePy = mergedPY        ?? mergedFallbackPy;
  // When we have effective amounts, suppress the COA-mapping signal so
  // zero-balance mapped ledgers don't ghost-consume note numbers (matches
  // the BS-face call site behaviour).
  const useCoaSignal = !needsFallback
    ? false
    : (Object.keys(mergedFallbackCy).length === 0 && Object.keys(mergedFallbackPy).length === 0);

  const registry = useMemo<Map<string, number>>(
    () => buildDynamicRegistry(
      effectiveCy,
      effectivePy,
      coaMapping,
      isNonCorporate,
      useCoaSignal,
    ),
    [effectiveCy, effectivePy, coaMapping, isNonCorporate, useCoaSignal],
  );

  // ── Accessor helpers ────────────────────────────────────────────────────────

  /** Return the dynamic note number for a key, or undefined if note is suppressed. */
  const getDynamicNoteNo = (key: string): number | undefined =>
    registry.get(key);

  /** Return "{n}" when the note has data, else undefined. */
  const getNoteLabel = (key: string): string | undefined => {
    const n = registry.get(key);
    return n !== undefined ? `${n}` : undefined;
  };

  /**
   * Return "Note {n} — {label}" when the note has data,
   * else just {label} (note is suppressed for this engagement).
   */
  const getNoteHeading = (key: string, label: string): string => {
    const n = registry.get(key);
    return n !== undefined ? `Note ${n} — ${label}` : label;
  };

  return {
    registry,
    isNonCorporate,
    getNoteNo:      getDynamicNoteNo,
    getNoteLabel,
    getNoteHeading,
  };
}
