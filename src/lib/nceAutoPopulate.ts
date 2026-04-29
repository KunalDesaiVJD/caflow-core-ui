/**
 * nceAutoPopulate
 * ─────────────────────────────────────────────────────────────────────────
 * Reads an engagement's COA mapping + Tally Trial Balance and returns
 * auto-populated note data for every NCE note type.
 *
 * Two-stage population:
 *  Stage 1 — Individual ledger matching
 *    Each TB ledger whose COA-mapped FS code belongs to the note → custom row.
 *  Stage 2 — FS-total fallback (when Stage 1 finds nothing)
 *    Reads fa_financial_statements totals and places them as a single
 *    "Auto-filled from COA total" row so the grand total is always correct
 *    even when individual ledgers are not mapped to the note.
 *
 * Called:
 *  (a) Automatically on first visit to NCEDetailedNotes (if no notes exist)
 *  (b) Manually when the user clicks "Re-sync from COA"
 *
 * Auto rows vs manual rows:
 *  Auto rows (source = "auto") — refreshed on re-sync.
 *  Manual rows (source = "manual") — preserved verbatim across re-syncs.
 *  Existing static-row CY / PY values entered by the user are also kept.
 */

import { supabase } from "@/integrations/supabase/client";

// ── FS-code map ──────────────────────────────────────────────────────────────
//
// Each note type maps to the set of FS codes that belong to it.
// We include BOTH the NCE-specific codes (NCE_*) and the generic corporate
// codes (BS_*/PL_*) because the COA mapping can use either depending on how
// ledgers were auto-assigned or manually mapped.

export const NCE_NOTE_FS_MAP: Record<string, {
  lt?:  string[];   // Pattern-A long-term
  st?:  string[];   // Pattern-A short-term
  all?: string[];   // Pattern-B
}> = {
  borrowings:         { lt: ["NCE_LTB",   "BS_NCL_LTB"],               st: ["NCE_STB",      "BS_CL_STB"] },
  other_lt_liab:      { all: ["NCE_OLTL",  "BS_NCL_OLT"] },
  provisions:         { lt: ["NCE_LTP",   "BS_NCL_LTP"],               st: ["NCE_STP",      "BS_CL_STP"] },
  trade_payables:     { all: ["NCE_TP",   "BS_CL_TP"] },
  other_cl:           { all: ["NCE_OCL",  "BS_CL_OCL"] },
  cwip:               { all: ["NCE_CWIP", "BS_NCA_FA_WIP"] },
  investments:        { lt: ["NCE_NCINV", "BS_NCA_INV"],               st: ["NCE_CINV"] },
  loans_advances:     { lt: ["NCE_LTLA",  "BS_NCA_LLA"],               st: ["NCE_STLA",     "BS_CA_SLA"] },
  other_nc_assets:    { all: ["NCE_ONCA", "BS_NCA_ONA"] },
  inventories:        { all: ["NCE_STCK", "BS_CA_INV"] },
  trade_receivables:  { all: ["NCE_TR",   "BS_CA_TR"] },
  cash_bank:          { all: ["NCE_CASH", "BS_CA_CCE"] },
  other_ca:           { all: ["NCE_OCA",  "BS_CA_OCA"] },
  revenue_ops:        { all: ["NCE_REV_OPS", "PL_REV_OPS"] },
  other_income:       { all: ["NCE_REV_OTH", "PL_REV_OI"] },
  cogs:               { all: ["NCE_COGS", "NCE_CII", "PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII"] },
  employee_exp:       { all: ["NCE_EMP_EXP",  "PL_EXP_EMP"] },
  finance_costs:      { all: ["NCE_FIN_COST", "PL_EXP_FIN"] },
  other_expenses:     { all: ["NCE_OTH_EXP",  "PL_EXP_OTH", "PL_EXP_OEX"] },
};


// ── Smart static-row mapping ──────────────────────────────────────────────────
//
// For each note type, an ordered list of rules (most-specific first).
// When a TB ledger's name fuzzy-matches a rule, its amount is accumulated
// directly into the corresponding static row key instead of creating a
// custom row. This keeps auto-populated data inside standard Schedule-III
// row slots wherever the ledger name clearly matches.
//
// Pattern B notes: rowId → cy[rowId] / py[rowId]
// Pattern A notes: rowId → cy[rowId+"_lt"] / cy[rowId+"_st"] based on COA code

type SmartRule = { rowId: string; keywords: string[] };

export const NOTE_SMART_MAP: Record<string, SmartRule[]> = {
  // ── Other Current Liabilities ──────────────────────────────────────────────
  // Smart-merge groups multiple ledgers with similar names into a single static
  // row. Example: "TDS 192B", "TDS 194I", "TDS 194C" all merge into "TDS Payable".
  // Individual ledger names remain visible via the "+" expander on the static row.
  other_cl: [
    { rowId: "tds_payable",  keywords: [
        "tds", "tax deducted", "t.d.s",
        "tds payable", "tds 192", "tds 194", "tds 195",
        "tds on salary", "tds on rent", "tds on professional", "tds on contractor",
        "tds on commission", "tds on interest",
    ] },
    { rowId: "gst_payable",  keywords: [
        "gst payable", "output gst", "gst liability",
        "igst payable", "cgst payable", "sgst payable",
        "gst output", "rcm payable", "reverse charge",
    ] },
    { rowId: "emp_payable",  keywords: [
        "salary payable", "wages payable", "employee payable", "staff payable",
        "salary outstanding", "wages outstanding", "salary due", "wages due",
    ] },
    { rowId: "inc_advance",  keywords: [
        "advance from customer", "income received in advance", "customer advance",
        "advance received", "advance payment received",
    ] },
  ],

  // ── Cash & Bank Balances ───────────────────────────────────────────────────
  cash_bank: [
    { rowId: "la_cc",      keywords: ["cash credit", "cc account", "cc limit", "overdraft", " od "] },
    { rowId: "la_fd_3m",   keywords: ["fixed deposit", " fd ", "fdr", "short term deposit"] },
    { rowId: "la_current", keywords: ["current a/c", "current account", "current a c", "savings", "bank"] },
    { rowId: "la_cash",    keywords: ["cash"] },
  ],

  // ── Inventories ────────────────────────────────────────────────────────────
  inventories: [
    { rowId: "raw_mat",     keywords: ["raw material", "raw stock", "raw goods"] },
    { rowId: "wip",         keywords: ["wip", "work in progress", "work-in-progress"] },
    { rowId: "finished",    keywords: ["finished good", "finished stock", "finished product", "fg "] },
    { rowId: "stock_trade", keywords: ["stock in trade", "stock-in-trade", "trading stock"] },
    { rowId: "stores",      keywords: ["stores", "spares"] },
  ],

  // ── Revenue from Operations ────────────────────────────────────────────────
  revenue_ops: [
    { rowId: "sale_services", keywords: ["service income", "consulting", "professional revenue", "service revenue"] },
    { rowId: "sale_products", keywords: ["sale", "sales", "revenue", "turnover", "income from project"] },
    { rowId: "other_ops",     keywords: ["other operating", "other ops"] },
  ],

  // ── Employee Benefits Expense ──────────────────────────────────────────────
  employee_exp: [
    { rowId: "pf",            keywords: ["provident fund", " pf ", " epf", "esic", "esi contribution"] },
    { rowId: "gratuity",      keywords: ["gratuity"] },
    { rowId: "staff_welfare", keywords: ["welfare", "staff welfare"] },
    { rowId: "other_allow",   keywords: ["allowance", "bonus", "incentive", "hrra", "lta"] },
    { rowId: "salaries",      keywords: ["salary", "salaries", "wage", "wages", "remuneration", "manpower", "director remuneration"] },
  ],

  // ── Finance Costs ──────────────────────────────────────────────────────────
  finance_costs: [
    { rowId: "int_partners",  keywords: ["to partner", "on partner", "partner interest", "interest to partner", "on partners capital", "partners capital"] },
    { rowId: "int_bank",      keywords: ["on bank loan", "bank interest", "cc interest", "od interest", "term loan interest", "on cc", "on od", "on working capital"] },
    { rowId: "bank_charges",  keywords: ["bank charge", "bank fee", "bank commission", "processing fee", "service charge", "lc charge"] },
    { rowId: "disc_charges",  keywords: ["discounting", "discount charge"] },
    { rowId: "guarantee",     keywords: ["guarantee"] },
    { rowId: "int_other",     keywords: ["interest"] }, // catch-all — keep last
    { rowId: "other_fin",     keywords: ["finance charge", "financing cost"] },
  ],

  // ── Other Expenses ─────────────────────────────────────────────────────────
  other_expenses: [
    { rowId: "advertisement",  keywords: ["advertisement", "advertising", "hoarding", "publicity", "banner"] },
    { rowId: "auditor_rem",    keywords: ["audit fee", "auditor", "audit charge", "statutory audit", "tax audit"] },
    { rowId: "legal",          keywords: ["legal", "advocate", "lawyer", "professional fee", "professional fees", "solicitor"] },
    { rowId: "rates_taxes",    keywords: ["rera", "auda", "municipal tax", "property tax", "stamp duty", "plan pass", "govt fee", "government fee", "regulatory", "noc fee", "development charge"] },
    { rowId: "power",          keywords: ["electricity", "power", "fuel", "energy", "generator"] },
    { rowId: "rent",           keywords: ["rent"] },
    { rowId: "labour",         keywords: ["labour", "labor", "contractor labour", "site labour"] },
    { rowId: "communication",  keywords: ["courier", "postage", "telephone", "mobile bill", "internet", "broadband", "communication"] },
    { rowId: "printing",       keywords: ["printing", "stationery", "stationary"] },
    { rowId: "travel",         keywords: ["travel", "conveyance", "petrol", "diesel", "vehicle", "cab", "uber"] },
    { rowId: "insurance",      keywords: ["insurance"] },
    { rowId: "repairs_bldg",   keywords: ["repair", "maintenance", "renovation"] },
    { rowId: "commission",     keywords: ["commission", "brokerage"] },
    { rowId: "miscellaneous",  keywords: ["miscellaneous", "misc", "kasar", "round off", "roundoff", "office expense", "tea", "refreshment"] },
  ],

  // ── Loans & Advances (Pattern A — fills static rows by section+column) ─────
  loans_advances: [
    { rowId: "unsec_adv_tax",  keywords: ["advance tax", "tds receivable", "income tax refund", "self assessment tax", "advance income tax"] },
    { rowId: "unsec_gst",      keywords: ["gst input", "input tax credit", "itc", "igst input", "cgst input", "sgst input"] },
    { rowId: "unsec_security", keywords: ["security deposit", "security money", "earnest money", "emd"] },
    { rowId: "unsec_prepaid",  keywords: ["prepaid expense", "prepaid"] },
    { rowId: "unsec_related",  keywords: ["advance to director", "advance to partner", "advance to related", "advance to associate"] },
  ],

  // ── Borrowings (Pattern A — splits into secured / unsecured sections) ────────
  borrowings: [
    // Secured — bank/FI term loans
    { rowId: "sec_term_bank",   keywords: ["secured term loan", "secured bank loan", "secured tl", "term loan from bank", "bank term loan", "working capital term loan"] },
    { rowId: "sec_demand_bank", keywords: ["cash credit", " cc ", "overdraft", " od "] },
    { rowId: "sec_term_fi",     keywords: ["loan from nbfc", "loan from finance", "finance company loan", "nbfc loan"] },
    { rowId: "sec_related",     keywords: ["secured loan from director", "secured loan from partner", "secured loan from promoter", "secured director", "secured partner"] },
    // Unsecured — related parties (director/partner/family loans most specific — keep before catch-alls)
    { rowId: "unsec_related",   keywords: [
        "loan from director", "director loan", "director's loan",
        "loan from partner", "partner loan", "partner's loan",
        "loan from promoter", "promoter loan",
        "loan from shareholder", "shareholder loan",
        "loan from relative", "relative loan",
        "loan from proprietor", "proprietor loan",
        "loan from family", "family loan",
        "loan from member", "huf loan", "loan from huf",
        "unsecured loan from director", "unsecured loan from partner",
      ] },
    // Unsecured — bank/FI (less common but possible)
    { rowId: "unsec_term_bank", keywords: ["unsecured term loan from bank", "unsecured bank loan", "unsecured tl"] },
    { rowId: "unsec_term_fi",   keywords: ["unsecured nbfc", "unsecured finance company"] },
  ],
};

/** Normalise a ledger name for keyword matching. */
function normLedger(name: string): string {
  return " " + name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
}

/** Returns the first matching static rowId, or null if none match. */
function smartMatch(ledgerName: string, rules: SmartRule[]): string | null {
  const norm = normLedger(ledgerName);
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (norm.includes(kw)) return rule.rowId;
    }
  }
  return null;
}

// ── Custom row type ───────────────────────────────────────────────────────────

/** A single TB ledger that contributes to a merged custom row.
 *  Stored on `NCECustomRow.sources` so the (i) info popover can show what's
 *  bundled together. For Pattern A, one ledger may contribute to LT, ST or both. */
export interface NCEMergedSource {
  ledger:    string;
  amountCy:  number;
  /** "lt" | "st" — only set for Pattern A merged rows. */
  column?:   "lt" | "st";
}

export interface NCECustomRow {
  id:       string;
  label:    string;
  source:   "auto" | "manual";
  /** For Pattern-A notes with sections: which section total to insert before.
   *  "secured" | "unsecured" → row appears under that section heading and
   *  is counted in that section's total (not the grand total directly).
   *  Absent → row is a global custom row counted only in the grand total. */
  section?: string;
  /** When auto-populated from MULTIPLE TB ledgers that share a common head
   *  (e.g. "Site Expense - 18%" + "Site Expense - URD" → merged "Site Expense"),
   *  this records the underlying ledgers and their amounts. The (i) info button
   *  in the editor shows this list to the user. Absent for single-ledger rows. */
  sources?: NCEMergedSource[];
  /** When user uses the "Move to…" dropdown, the row is visually attached
   *  beneath the chosen static row (by NoteRowDef.id) instead of appearing
   *  in the generic pre-total block. Amounts stay on the custom row — the
   *  static row is unchanged. */
  attachedTo?: string;
  /** The original TB ledger name when this row was created by ejecting a
   *  ledger from a merged auto row. Stored so that deleting this row can
   *  clean up the note's `ejectedLedgers` list, allowing the ledger to be
   *  re-merged on the next Re-sync from COA. */
  ejectedSource?: string;
}

export interface NCENoteData {
  cy:         Record<string, number>;
  py:         Record<string, number>;
  customRows: NCECustomRow[];
  /** Static rows the user has soft-deleted (hidden from display).
   *  Listed by NoteRowDef.id. Survives re-sync. */
  hiddenRows?: string[];
  /** User-edited labels for static rows. Keyed by NoteRowDef.id.
   *  Empty string keeps the default config label. Survives re-sync. */
  labelOverrides?: Record<string, string>;
  /** For Pattern B notes: which TB ledgers were mapped into each static row (CY only).
   *  Keyed by NoteRowDef.id. Used to render the ℹ️ info popover in NCEDetailedNotes. */
  cy_sources?: Record<string, { ledger: string; amountCy: number }[]>;
  /** TB ledger names that the user has explicitly ejected to standalone rows.
   *  During Re-sync from COA, ledgers in this list are skipped in the auto-grouping
   *  step — they will NOT be re-merged back into an auto row.
   *  A ledger is removed from this list when the user deletes its standalone row,
   *  at which point re-sync will include it again in auto-grouping. */
  ejectedLedgers?: string[];
  /** User-edited display labels for source sub-ledger rows.
   *  Keyed as `${staticRowId}::${originalLedgerName}`.
   *  Amounts remain locked to Tally TB data; only the label is overridden. */
  sourceLabelOverrides?: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCustomId(name: string, idx: number): string {
  return (
    "custom_" +
    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) +
    "_" + idx
  );
}

/** Strip percentage / URD / GST-rate suffixes after a dash so similar
 *  ledgers normalise to the same base name.
 *  "Site Expense - 18%" → "Site Expense"
 *  "Site Expense - URD" → "Site Expense"
 *  "Salary - January"   → "Salary" */
function deriveBaseHead(name: string): string {
  return name
    .trim()
    // strip "- 18%", "-5%" etc
    .replace(/\s*[-—]\s*\d+\s*%.*$/i, "")
    // strip GST/regn classifiers
    .replace(/\s*[-—]\s*(urd|reg|regd|registered|unregistered|igst|cgst|sgst|gst|exempt|nil|0%|5%|12%|18%|28%)\b.*$/i, "")
    // strip month names that appear as suffixes
    .replace(/\s*[-—]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d*.*$/i, "")
    // strip plain trailing numbers e.g. "Loan A/c - 123"
    .replace(/\s*[-—]\s*\d+.*$/, "")
    .trim();
}

/** Group key for unmatched ledgers — the FULL normalised base head, lowercased.
 *  Only ledgers that share the same base head after stripping GST/month/number
 *  suffixes get merged (e.g. "Site Expense - 18%" + "Site Expense - URD" both
 *  → "site expense"). Ledgers with different descriptions are NEVER merged
 *  even if they share a first word — e.g. "Unpaid Audit Fees" and
 *  "Unpaid Professional Fees" stay as two separate rows. */
function groupKey(name: string): string {
  return deriveBaseHead(name).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pick the displayed merged label from a list of base heads.
 *  Strategy: the most-frequent base head, falling back to the longest
 *  common prefix when frequencies tie. */
function pickMergedLabel(baseHeads: string[]): string {
  if (baseHeads.length === 0) return "";
  if (baseHeads.length === 1) return baseHeads[0];
  const counts = new Map<string, number>();
  for (const h of baseHeads) counts.set(h, (counts.get(h) ?? 0) + 1);
  let best = baseHeads[0]; let bestN = 0;
  for (const [h, n] of counts) if (n > bestN) { best = h; bestN = n; }
  return best;
}

// tally_trial_balance stores a single closing_balance (always positive) and
// balance_type ("Dr" | "Cr"). For notes we just want the magnitude.
function ledgerAmt(closingBalance: number): number {
  return Math.abs(closingBalance ?? 0);
}

// ── Serialise / deserialise ───────────────────────────────────────────────────

// Reserved keys used as JSONB metadata inside cy_data — must be filtered out
// when reading numeric values back into the cy/py maps.
const META_KEYS = new Set(["_custom_rows", "_hidden_rows", "_label_overrides", "_cy_sources", "_ejected_ledgers"]);

export function deserialiseNoteData(
  rawCy: Record<string, any>,
  rawPy: Record<string, any>,
): NCENoteData {
  const customRows: NCECustomRow[] = Array.isArray(rawCy._custom_rows)
    ? (rawCy._custom_rows as NCECustomRow[])
    : [];
  const hiddenRows: string[] = Array.isArray(rawCy._hidden_rows)
    ? (rawCy._hidden_rows as string[])
    : [];
  const labelOverrides: Record<string, string> =
    rawCy._label_overrides && typeof rawCy._label_overrides === "object"
      ? (rawCy._label_overrides as Record<string, string>)
      : {};
  const cy_sources: Record<string, { ledger: string; amountCy: number }[]> | undefined =
    rawCy._cy_sources && typeof rawCy._cy_sources === "object"
      ? (rawCy._cy_sources as Record<string, { ledger: string; amountCy: number }[]>)
      : undefined;

  const ejectedLedgers: string[] = Array.isArray(rawCy._ejected_ledgers)
    ? (rawCy._ejected_ledgers as string[])
    : [];

  const cy: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCy)) {
    if (!META_KEYS.has(k) && typeof v === "number") cy[k] = v;
  }
  const py: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawPy)) {
    if (!META_KEYS.has(k) && typeof v === "number") py[k] = v;
  }
  return { cy, py, customRows, hiddenRows, labelOverrides, cy_sources, ejectedLedgers };
}

export function serialiseNoteData(
  d: NCENoteData,
): { cy_data: Record<string, any>; py_data: Record<string, number> } {
  return {
    cy_data: {
      ...d.cy,
      _custom_rows:      d.customRows,
      _hidden_rows:      d.hiddenRows ?? [],
      _label_overrides:  d.labelOverrides ?? {},
      _ejected_ledgers:  d.ejectedLedgers ?? [],
      ...(d.cy_sources && Object.keys(d.cy_sources).length > 0
        ? { _cy_sources: d.cy_sources }
        : {}),
    },
    py_data: d.py,
  };
}

// ── Main auto-populate ────────────────────────────────────────────────────────

export async function nceAutoPopulate(
  engagementId: string,
  existing: Record<string, NCENoteData> = {},
): Promise<Record<string, NCENoteData>> {
  // ── 1. Load engagement ──────────────────────────────────────────────────
  const { data: eng } = await supabase
    .from("audit_engagements")
    .select("coa_mapping, financial_year, client_id")
    .eq("id", engagementId)
    .maybeSingle();

  const coaMapping: Record<string, { code: string }> =
    (eng as any)?.coa_mapping ?? {};
  const financialYear: string = (eng as any)?.financial_year ?? "";
  const clientId: string      = (eng as any)?.client_id ?? "";

  // ── 2. Load CY trial balance ────────────────────────────────────────────
  // tally_trial_balance uses closing_balance (magnitude) + balance_type ("Dr"/"Cr")
  const { data: tbRows } = await supabase
    .from("tally_trial_balance")
    .select("ledger_name, closing_balance, balance_type, parent_group")
    .eq("engagement_id", engagementId);

  type TBRow = { ledger_name: string; closing_balance: number; balance_type: string; parent_group?: string | null };
  const tb: TBRow[] = (tbRows ?? []) as TBRow[];

  // ── 3. Load CY FS totals (fallback for notes with no TB ledger matches) ─
  // fa_financial_statements stores pre-computed FS-code totals. Used when
  // no individual TB ledgers are mapped to a note's FS codes.
  const { data: fsRows } = await supabase
    .from("fa_financial_statements")
    .select("line_item_code, amount_cy, amount_py")
    .eq("engagement_id", engagementId);

  const fsByCode: Record<string, { cy: number; py: number }> = {};
  for (const r of (fsRows ?? [])) {
    fsByCode[(r as any).line_item_code] = {
      cy: Math.abs(Number((r as any).amount_cy) || 0),
      py: Math.abs(Number((r as any).amount_py) || 0),
    };
  }

  // ── 4. Load PY amounts from prior year's nce_financial_notes ───────────
  //
  // We also load the prior year's _custom_rows so we can match custom rows
  // by LABEL (not just by generated ID). Generated IDs (custom_XXX_0) are
  // order-dependent: if a new ledger group appears or disappears the indices
  // shift and pyNotes[id] returns 0 for every row — causing all PY
  // individual rows to show "—" even though PY data exists.
  const pyNotes:      Record<string, Record<string, number>>  = {};
  const pyCustomRows: Record<string, NCECustomRow[]>          = {};
  if (financialYear && clientId) {
    const parts = String(financialYear).split("-");
    if (parts.length === 2) {
      const startYr = parseInt(parts[0], 10);
      const prevFy  = `${startYr - 1}-${String(startYr).slice(-2)}`;
      const { data: prevEng } = await supabase
        .from("audit_engagements")
        .select("id")
        .eq("client_id", clientId)
        .eq("financial_year", prevFy)
        .maybeSingle();
      if ((prevEng as any)?.id) {
        const { data: prevNoteRows } = await supabase
          .from("nce_financial_notes")
          .select("note_type, cy_data")
          .eq("engagement_id", (prevEng as any).id);
        for (const r of (prevNoteRows ?? [])) {
          const raw = (r.cy_data as Record<string, any>) ?? {};
          const nums: Record<string, number> = {};
          for (const [k, v] of Object.entries(raw)) {
            if (!META_KEYS.has(k) && typeof v === "number") nums[k] = v as number;
          }
          pyNotes[r.note_type]      = nums;
          pyCustomRows[r.note_type] = Array.isArray(raw._custom_rows)
            ? (raw._custom_rows as NCECustomRow[])
            : [];
        }
      }
    }
  }

  /** Look up prior-year amount for a custom row by matching its label to the
   *  prior year's _custom_rows array, then reading the matched row's ID from
   *  pyNotes. Falls back to a direct ID lookup for backwards compatibility. */
  function pyForCustomRow(noteType: string, currentId: string, label: string, suffix = ""): number {
    const priorRows = pyCustomRows[noteType] ?? [];
    const match = priorRows.find(r => r.label === label);
    if (match) return Math.abs(pyNotes[noteType]?.[match.id + suffix] ?? 0);
    // Fall back to direct key lookup (works when groups are in the same order)
    return Math.abs(pyNotes[noteType]?.[currentId + suffix] ?? 0);
  }

  // ── 5. Build per-note results ───────────────────────────────────────────
  const out: Record<string, NCENoteData> = {};

  for (const [noteType, noteFs] of Object.entries(NCE_NOTE_FS_MAP)) {
    const prev = existing[noteType] ?? { cy: {}, py: {}, customRows: [] };
    const manualRows = prev.customRows.filter(r => r.source === "manual");

    // Build a set of TB ledger names the user has explicitly ejected to
    // standalone rows. These are skipped during auto-grouping so they won't
    // be re-merged into an auto row on re-sync.
    const ejectedSet = new Set(prev.ejectedLedgers ?? []);

    const newCy:         Record<string, number> = {};
    const newPy:         Record<string, number> = {};
    const autoRows:      NCECustomRow[]         = [];
    const staticSources: Record<string, { ledger: string; amountCy: number }[]> = {};

    if (noteFs.all) {
      // ── Pattern B ──────────────────────────────────────────────────────
      const codeSet    = new Set(noteFs.all);
      const smartRules = NOTE_SMART_MAP[noteType] ?? [];
      // Stage 1: split each ledger into "matched-static" or "unmatched"
      const unmatchedB: { ledger: string; amt: number; parentGroup?: string }[] = [];

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !codeSet.has(mapped.code)) continue;
        const amt = ledgerAmt(row.closing_balance);
        if (amt === 0) continue;
        // Skip ledgers the user has explicitly ejected to standalone rows
        if (ejectedSet.has(row.ledger_name)) continue;

        const matchedRowId = smartMatch(row.ledger_name, smartRules);
        if (matchedRowId) {
          // Accumulate directly into the static row — no custom row created
          newCy[matchedRowId] = (newCy[matchedRowId] ?? 0) + amt;
          // Track which ledgers feed this static row (for info popover)
          if (!staticSources[matchedRowId]) staticSources[matchedRowId] = [];
          staticSources[matchedRowId].push({ ledger: row.ledger_name, amountCy: amt });
          // PY: carry from prior-year cy_data for the same static key, if any.
          // Use Math.abs to guard against stale negative values stored in old data.
          if (!(matchedRowId in newPy)) {
            newPy[matchedRowId] = Math.abs(pyNotes[noteType]?.[matchedRowId] ?? 0);
          }
        } else {
          unmatchedB.push({ ledger: row.ledger_name, amt, parentGroup: row.parent_group ?? undefined });
        }
      }

      // Stage 2: group unmatched ledgers.
      // Priority: use Tally parent_group when available (e.g. "Purchase Accounts"
      // → all purchase ledgers merge into one row labelled by the group).
      // Fallback: group by common name head (strips GST-rate / month suffixes).
      const groupsB = new Map<string, { ledger: string; amt: number; parentGroup?: string }[]>();
      for (const um of unmatchedB) {
        // Use parent_group key when non-trivial (not the ledger's own name)
        const pg = (um as any).parentGroup;
        const k = (pg && pg.trim()) ? pg.trim().toLowerCase() : groupKey(um.ledger);
        if (!groupsB.has(k)) groupsB.set(k, []);
        groupsB.get(k)!.push(um);
      }
      let idx = 0;
      for (const [groupK, ledgers] of groupsB.entries()) {
        const totalAmt = ledgers.reduce((s, l) => s + l.amt, 0);
        // When grouped by parent_group, use the parent group name as label
        // (cleaned up: "Purchase Accounts" → "Purchase Accounts").
        // When grouped by name similarity, pick the most common base head.
        const hasPg = ledgers.length > 1 && ledgers[0].parentGroup;
        const baseHeads = ledgers.map(l => deriveBaseHead(l.ledger));
        const label = hasPg
          ? (ledgers[0].parentGroup as string)
          : (ledgers.length === 1 ? ledgers[0].ledger : pickMergedLabel(baseHeads));
        const id = makeCustomId(label, idx++);
        newCy[id] = totalAmt;
        // Match PY by label (stable across re-syncs) rather than by generated ID
        // (which shifts when group order changes → old behaviour gave PY = 0)
        newPy[id] = pyForCustomRow(noteType, id, label);
        autoRows.push({
          id,
          label,
          source: "auto",
          sources: ledgers.length > 1
            ? ledgers.map(l => ({ ledger: l.ledger, amountCy: l.amt }))
            : undefined,
        });
      }

      // Fallback: if nothing was populated at all, use FS-code totals
      const hasData = autoRows.length > 0 || Object.values(newCy).some(v => v > 0);
      if (!hasData) {
        let fsCY = 0, fsPY = 0;
        for (const code of noteFs.all) {
          fsCY += fsByCode[code]?.cy ?? 0;
          fsPY += fsByCode[code]?.py ?? 0;
        }
        if (fsCY > 0 || fsPY > 0) {
          const id = "custom_auto_total";
          newCy[id] = fsCY;
          newPy[id] = fsPY;
          autoRows.push({ id, label: "Auto-filled from COA total", source: "auto" });
        }
      }

    } else {
      // ── Pattern A (LT / ST columns) ────────────────────────────────────
      const ltSet      = new Set(noteFs.lt ?? []);
      const stSet      = new Set(noteFs.st ?? []);
      const smartRules = NOTE_SMART_MAP[noteType] ?? [];
      const unmatchedA: { ledger: string; amt: number; isLT: boolean; isST: boolean }[] = [];

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped) continue;
        const isLT = ltSet.has(mapped.code);
        const isST = stSet.has(mapped.code);
        if (!isLT && !isST) continue;
        const amt = ledgerAmt(row.closing_balance);
        if (amt === 0) continue;
        // Skip ledgers the user has explicitly ejected to standalone rows
        if (ejectedSet.has(row.ledger_name)) continue;

        const matchedRowId = smartMatch(row.ledger_name, smartRules);
        if (matchedRowId) {
          // Fill static row directly with LT/ST suffix
          if (isLT) newCy[matchedRowId + "_lt"] = (newCy[matchedRowId + "_lt"] ?? 0) + amt;
          if (isST) newCy[matchedRowId + "_st"] = (newCy[matchedRowId + "_st"] ?? 0) + amt;
          // PY from prior year if available (Math.abs guards against stale negatives)
          if (isLT && !(matchedRowId + "_lt" in newPy))
            newPy[matchedRowId + "_lt"] = Math.abs(pyNotes[noteType]?.[matchedRowId + "_lt"] ?? 0);
          if (isST && !(matchedRowId + "_st" in newPy))
            newPy[matchedRowId + "_st"] = Math.abs(pyNotes[noteType]?.[matchedRowId + "_st"] ?? 0);
        } else {
          unmatchedA.push({ ledger: row.ledger_name, amt, isLT, isST, parentGroup: row.parent_group ?? undefined });
        }
      }

      // Group unmatched Pattern-A ledgers by parent_group (primary) or common
      // name head (fallback). LT/ST sides are summed independently per group.
      const groupsA = new Map<string, typeof unmatchedA>();
      for (const um of unmatchedA) {
        const pg = (um as any).parentGroup;
        const k = (pg && pg.trim()) ? pg.trim().toLowerCase() : groupKey(um.ledger);
        if (!groupsA.has(k)) groupsA.set(k, []);
        groupsA.get(k)!.push(um);
      }
      let idx = 0;
      for (const [, ledgers] of groupsA.entries()) {
        const hasPg = ledgers.length > 1 && (ledgers[0] as any).parentGroup;
        const baseHeads = ledgers.map(l => deriveBaseHead(l.ledger));
        const label = hasPg
          ? ((ledgers[0] as any).parentGroup as string)
          : (ledgers.length === 1 ? ledgers[0].ledger : pickMergedLabel(baseHeads));
        const id = makeCustomId(label, idx++);

        let totalLt = 0, totalSt = 0;
        for (const l of ledgers) {
          if (l.isLT) totalLt += l.amt;
          if (l.isST) totalSt += l.amt;
        }
        // PY: match prior-year row by label (robust against group-order changes)
        if (totalLt > 0) { newCy[id + "_lt"] = totalLt; newPy[id + "_lt"] = pyForCustomRow(noteType, id, label, "_lt"); }
        if (totalSt > 0) { newCy[id + "_st"] = totalSt; newPy[id + "_st"] = pyForCustomRow(noteType, id, label, "_st"); }

        // For borrowings, all unmatched are unsecured by nature.
        // Attach them under the "Other unsecured loans" (unsec_other) static row so
        // they appear nested as children rather than as standalone custom rows.
        // The section tag keeps them counted in the unsec_total formula.
        const section    = noteType === "borrowings" ? "unsecured"   : undefined;
        const attachedTo = noteType === "borrowings" ? "unsec_other" : undefined;
        autoRows.push({
          id, label, source: "auto",
          ...(section    ? { section }    : {}),
          ...(attachedTo ? { attachedTo } : {}),
          sources: ledgers.length > 1
            ? ledgers.map(l => ({
                ledger: l.ledger,
                amountCy: l.amt,
                column: l.isLT ? "lt" : "st",
              }))
            : undefined,
        });
      }

      // Fallback: use FS-code totals
      const hasData = autoRows.length > 0 || Object.values(newCy).some(v => v > 0);
      if (!hasData) {
        let ltCY = 0, ltPY = 0, stCY = 0, stPY = 0;
        for (const code of (noteFs.lt ?? [])) { ltCY += fsByCode[code]?.cy ?? 0; ltPY += fsByCode[code]?.py ?? 0; }
        for (const code of (noteFs.st ?? [])) { stCY += fsByCode[code]?.cy ?? 0; stPY += fsByCode[code]?.py ?? 0; }
        if (ltCY > 0 || stCY > 0 || ltPY > 0 || stPY > 0) {
          const id = "custom_auto_total";
          if (ltCY > 0 || ltPY > 0) { newCy[id + "_lt"] = ltCY; newPy[id + "_lt"] = ltPY; }
          if (stCY > 0 || stPY > 0) { newCy[id + "_st"] = stCY; newPy[id + "_st"] = stPY; }
          autoRows.push({ id, label: "Auto-filled from COA total", source: "auto" });
        }
      }
    }

    // ── Merge auto + manual ─────────────────────────────────────────────
    const mergedCy: Record<string, number> = { ...newCy };
    const mergedPy: Record<string, number> = { ...newPy };

    // Restore manual custom row amounts
    for (const mr of manualRows) {
      for (const suffix of ["", "_lt", "_st"]) {
        const k = mr.id + suffix;
        if (prev.cy[k] !== undefined) mergedCy[k] = prev.cy[k];
        if (prev.py[k] !== undefined) mergedPy[k] = prev.py[k];
      }
    }

    // Restore existing static-row user values (non-custom keys) — but ONLY
    // when auto-populate didn't find any fresh data this run. Reasoning: a
    // successful re-sync means COA + TB are the canonical source of truth, so
    // any stale static-row amounts saved from an earlier run must be cleared.
    // Otherwise the note total drifts above the BS line-item total (e.g.
    // partner-loan custom rows correctly sum to ₹5.37 cr but the stale
    // "Other unsecured loans" static row adds another ₹3.45 cr → ₹8.82 cr).
    //
    // When auto-populate produces NO data (cold-start, no COA yet), we still
    // preserve prior user-typed amounts so first-time setup doesn't lose work.
    const autoProducedData =
      autoRows.length > 0 || Object.keys(newCy).length > 0;
    if (!autoProducedData) {
      for (const [k, v] of Object.entries(prev.cy)) {
        if (!k.startsWith("custom_") && !(k in mergedCy)) mergedCy[k] = v;
      }
      for (const [k, v] of Object.entries(prev.py)) {
        if (!k.startsWith("custom_") && !(k in mergedPy)) mergedPy[k] = v;
      }
    }

    // Zero-out static row values for any static row that now has attached custom
    // rows. This prevents double-counting: the formula adds the static row's own
    // value AND the child custom rows as extras — if the static row has a stale
    // non-zero value from an old auto-populate run, the total would be inflated.
    // After this step the static row acts purely as a visual "heading" container.
    const attachedStaticIds = new Set(
      [...autoRows, ...manualRows]
        .map(cr => cr.attachedTo)
        .filter((id): id is string => !!id),
    );
    for (const staticId of attachedStaticIds) {
      // Clear all variants: plain, _lt, _st
      for (const suffix of ["", "_lt", "_st"]) {
        mergedCy[staticId + suffix] = 0;
        mergedPy[staticId + suffix] = 0;
      }
    }

    // Apply prior-year CY as PY for static rows if not already set.
    // Math.abs guards against stale negative values that may exist in old data.
    if (pyNotes[noteType]) {
      for (const [k, v] of Object.entries(pyNotes[noteType])) {
        if (!(k in mergedPy)) mergedPy[k] = Math.abs(v);
      }
    }

    out[noteType] = {
      cy:         mergedCy,
      py:         mergedPy,
      customRows: [...autoRows, ...manualRows],
      // Preserve user settings that survive re-sync
      hiddenRows:     prev.hiddenRows ?? [],
      labelOverrides: prev.labelOverrides ?? {},
      ejectedLedgers: prev.ejectedLedgers ?? [],
      ...(Object.keys(staticSources).length > 0 ? { cy_sources: staticSources } : {}),
    };
  }

  return out;
}
