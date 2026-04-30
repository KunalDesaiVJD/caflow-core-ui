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
): boolean {
  const fsCodes = getKeyFsCodes(key, isNce);
  if (fsCodes.length === 0) return false;

  // 1 & 2 — Amount checks (CY + PY)
  for (const code of fsCodes) {
    if ((computedAmounts[code] ?? 0) !== 0) return true;
    if ((mergedPY[code] ?? 0) !== 0) return true;
  }

  // 3 — COA mapping check (any ledger mapped to one of this key's FS codes)
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
export function buildDynamicRegistry(
  computedAmounts:  Record<string, number>,
  mergedPY:         Record<string, number>,
  coaMapping:       Record<string, { code: string }>,
  isNonCorporate:   boolean,
): Map<string, number> {
  const registry = new Map<string, number>();

  // Note 1: always accounting policies
  const policiesKey = isNonCorporate
    ? NOTE_KEYS.NCE_ACCOUNTING_POLICIES
    : NOTE_KEYS.ACCOUNTING_POLICIES;
  registry.set(policiesKey, 1);

  const order = isNonCorporate ? NCE_NOTE_ORDER : CORPORATE_NOTE_ORDER;
  let nextNote = 2;

  for (const key of order) {
    if (hasData(key, computedAmounts, mergedPY, coaMapping, isNonCorporate)) {
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

  const registry = useMemo<Map<string, number>>(
    () => buildDynamicRegistry(
      computedAmounts ?? {},
      mergedPY        ?? {},
      coaMapping,
      isNonCorporate,
    ),
    [computedAmounts, mergedPY, coaMapping, isNonCorporate],
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
