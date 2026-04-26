/**
 * noteNumberRegistry — single source of truth for corporate Schedule III
 * note numbers used in the Stage 5 Notes tab (NoteBSLiab, NoteBSAsset,
 * NotePL, FAGrid) and the Stage 7 Financial Statements BS/PL columns.
 *
 * RULE: If the note order ever changes, update ONLY this file.
 * Every consumer reads from NOTE_REGISTRY or the helper functions below —
 * no hardcoded note numbers anywhere else.
 *
 * Corporate entities ONLY. NCE / non-corporate notes live in
 * src/config/nceNotesConfig.ts (NOTE_META) and must not be touched here.
 */

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

// ─── Canonical note order ─────────────────────────────────────────────────────
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

  // ── BS — Assets side (FA sub-tab first, then BS-Asset sub-tab) ──────────
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
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return the note number for a given key, or undefined if not registered. */
export function getNoteNo(key: string): number | undefined {
  return NOTE_REGISTRY.find(n => n.key === key)?.noteNo;
}

/** Return all entries for a given category (e.g. all "BS-Liab" notes). */
export function getNotesByCategory(cat: NoteEntry["category"]): NoteEntry[] {
  return NOTE_REGISTRY.filter(n => n.category === cat);
}

/** Return the label for a given key, or undefined. */
export function getNoteLabel(key: string): string | undefined {
  return NOTE_REGISTRY.find(n => n.key === key)?.label;
}

/** Build a lookup map from key → NoteEntry for O(1) access. */
export const NOTE_MAP: ReadonlyMap<string, NoteEntry> = new Map(
  NOTE_REGISTRY.map(n => [n.key, n]),
);
