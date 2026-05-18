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
    // Unsecured — related parties (director/partner/owner/family loans most specific — keep before catch-alls)
    { rowId: "unsec_related",   keywords: [
        "loan from director", "director loan", "director's loan", "directors loan",
        "loan from partner", "partner loan", "partner's loan", "partners loan",
        "loan from owner", "owner loan", "owner's loan", "owners loan",
        "loan from proprietor", "proprietor loan", "proprietor's loan", "proprietors loan",
        "loan from promoter", "promoter loan", "promoter's loan",
        "loan from shareholder", "shareholder loan", "shareholders loan",
        "loan from relative", "relative loan", "loan from relatives", "relatives loan",
        "loan from family", "family loan", "loan from family member",
        "loan from member", "huf loan", "loan from huf",
        "loan from related party", "related party loan", "loans from related parties", "related parties loan",
        "loan from associate", "associate loan",
        "loan from subsidiary", "subsidiary loan",
        "loan from holding", "holding company loan",
        "loan from group company", "group company loan", "intercompany loan", "inter-company loan",
        "loan from kmp", "kmp loan", "key managerial personnel loan",
        "unsecured loan from director", "unsecured loan from partner",
        "unsecured loan from owner", "unsecured loan from proprietor",
        "unsecured loan from related",
        // HUF entities are always related parties in Indian partnership context
        " huf", "(huf)", "-huf",
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

/** Returns the first matching static rowId, or null if none match.
 *  Considers both the ledger name AND its Tally parent_group, so ledgers named
 *  after a person (e.g. "Mr Ashish K Patel") still classify as related-party
 *  when the parent_group identifies the relationship ("Loans from Partners",
 *  "Owner Loan Account", "Loans (Liability) - Director", etc.). */
function smartMatch(
  ledgerName: string,
  rules: SmartRule[],
  parentGroup?: string | null,
): string | null {
  const normName  = normLedger(ledgerName);
  const normGroup = parentGroup ? normLedger(parentGroup) : "";
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (normName.includes(kw) || (normGroup && normGroup.includes(kw))) {
        return rule.rowId;
      }
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
    if (!META_KEYS.has(k) && typeof v === "number") py[k] = Math.abs(v);
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
  // Issue 2 (today) — also pull opening_balance/opening_type from CY TB so
  // the cogs note's "Opening Inventories" rows source from the AUTHORITATIVE
  // value: Tally's own opening_balance for the current engagement (which by
  // accounting identity equals the prior-period closing).  Previously we only
  // selected closing_balance, forcing the cogs path to derive CY-Opening from
  // either the prior year's stage5_notes (which can be stale / wrong) or the
  // prior engagement's TB.  When the two disagreed we showed the wrong value
  // (Swastik Buildcon: WIP Opening rendered 9,54,65,534 from a stale prior
  // note, but the CY TB opening was 6,45,50,000).
  const { data: tbRows } = await supabase
    .from("tally_trial_balance")
    .select("ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group")
    .eq("engagement_id", engagementId);

  type TBRow = {
    ledger_name:      string;
    closing_balance:  number;
    balance_type:     string;
    opening_balance?: number | null;
    opening_type?:    string | null;
    parent_group?:    string | null;
  };
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
  // Hoisted PY shell TB rows so the per-ledger Pattern A path can read PY
  // amounts by ledger name without re-querying Supabase.
  let pyTb: TBRow[] = [];
  if (financialYear && clientId) {
    const parts = String(financialYear).split("-");
    if (parts.length === 2) {
      const startYr = parseInt(parts[0], 10);
      const prevFy  = `${startYr - 1}-${String(startYr).slice(-2)}`;
      // Load all prior-FY engagements (may include PY shell + a regular engagement)
      const { data: prevEngList } = await supabase
        .from("audit_engagements")
        .select("id, is_py_shell, coa_mapping")
        .eq("client_id", clientId)
        .eq("financial_year", prevFy);
      const prevEngs = (prevEngList ?? []) as any[];
      // Prefer the non-py_shell engagement for nce_financial_notes (it has user-entered PY).
      // Fall back to py_shell if that's all there is.
      const primaryPrev = prevEngs.find(e => !e.is_py_shell) ?? prevEngs[0] ?? null;
      if (primaryPrev?.id) {
        const { data: prevNoteRows } = await supabase
          .from("nce_financial_notes")
          .select("note_type, cy_data")
          .eq("engagement_id", primaryPrev.id);
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

      // PY-TB fallback — derive prior-year amounts directly from the PY shell
      // trial balance. Triggered PER NOTE whenever pyNotes[note] either:
      //   - doesn't exist (prior eng didn't save this note), OR
      //   - has only zero values (prior save was stale / pre-fix).
      //
      // ROOT-CAUSE FIX (Issue 1, this turn): previous gate was "all pyNotes
      // empty across every note". For SWASTIK the borrowings note had
      // pyNotes['borrowings'] with keys (mostly 0) so the gate failed and
      // every OTHER note (finance_costs, employee_exp, etc.) was denied the
      // fallback — their PY columns stayed blank even though PY shell TB
      // held the real numbers and COA mapping clearly classified them.
      const shellEng = prevEngs.find(e => e.is_py_shell) ?? primaryPrev;
      if (shellEng?.id) {
        const { data: pyTbRaw } = await supabase
          .from("tally_trial_balance")
          .select("ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group")
          .eq("engagement_id", shellEng.id);
        pyTb = (pyTbRaw ?? []) as TBRow[];
        const pyCoaMap: Record<string, { code: string }> =
          shellEng.coa_mapping && Object.keys(shellEng.coa_mapping).length > 0
            ? shellEng.coa_mapping
            : coaMapping;

        if (pyTb.length > 0) {
          for (const [nType, noteFs] of Object.entries(NCE_NOTE_FS_MAP)) {
            // PER-KEY MERGE — compute pyResult from PY shell TB classification,
            // then merge into pyNotes[nType] only for keys that don't already
            // have a positive saved value. This preserves any user-saved PY
            // amounts while filling in the static rows / catch-all buckets
            // that the prior auto-populate missed (e.g. SWASTIK's borrowings
            // had unsec_related_lt saved but unsec_other_lt missing).
            const existing = pyNotes[nType] ?? {};

            const pyResult: Record<string, number> = {};
            const pyRules = NOTE_SMART_MAP[nType] ?? [];

            // Determine Pattern A's "Other" catch-all rows so unmatched
            // ledgers in each section still contribute (e.g. a unique
            // borrowing ledger that doesn't match any smart rule falls into
            // unsec_other_lt instead of disappearing).
            const otherByCode: Record<string, string> = {};
            // Crude heuristic for Pattern A — pick rowIds that look like
            // catch-alls. Works for borrowings (sec_other / unsec_other),
            // provisions (other_prov), investments (quot_other / unquot_other),
            // loans_advances (kb_secured / kb_unsecured fallback). For codes
            // we don't have specific catch-alls for, unmatched ledgers are
            // dropped — matching prior behaviour.

            if (noteFs.all) {
              const codeSet = new Set(noteFs.all);
              for (const row of pyTb) {
                const mapped = pyCoaMap[row.ledger_name] ?? coaMapping[row.ledger_name];
                if (!mapped || !codeSet.has(mapped.code)) continue;
                const amt = ledgerAmt(row.closing_balance);
                if (amt === 0) continue;
                const rid = smartMatch(row.ledger_name, pyRules, row.parent_group);
                if (rid) {
                  pyResult[rid] = (pyResult[rid] ?? 0) + amt;
                }
              }
            } else if (noteFs.lt || noteFs.st) {
              const ltSet = new Set(noteFs.lt ?? []);
              const stSet = new Set(noteFs.st ?? []);
              for (const row of pyTb) {
                const mapped = pyCoaMap[row.ledger_name] ?? coaMapping[row.ledger_name];
                if (!mapped) continue;
                const isLT = ltSet.has(mapped.code);
                const isST = stSet.has(mapped.code);
                if (!isLT && !isST) continue;
                const amt = ledgerAmt(row.closing_balance);
                if (amt === 0) continue;
                const rid = smartMatch(row.ledger_name, pyRules, row.parent_group);
                if (rid) {
                  if (isLT) pyResult[rid + "_lt"] = (pyResult[rid + "_lt"] ?? 0) + amt;
                  if (isST) pyResult[rid + "_st"] = (pyResult[rid + "_st"] ?? 0) + amt;
                } else if (nType === "borrowings") {
                  // Pattern-A borrowings unmatched fallback: route to the
                  // section's "Other" bucket so the amount still flows into
                  // Total (A)/(B) instead of vanishing.
                  const pg = (row.parent_group || "").toLowerCase();
                  const nameHuf = /(\s|\(|-)huf/.test(row.ledger_name.toLowerCase());
                  const isRel = nameHuf || /\b(director|partner|owner|proprietor|promoter|shareholder|relative|family|huf|related)\b/.test(pg);
                  const target = isRel ? "unsec_related" : "unsec_other";
                  if (isLT) pyResult[target + "_lt"] = (pyResult[target + "_lt"] ?? 0) + amt;
                  if (isST) pyResult[target + "_st"] = (pyResult[target + "_st"] ?? 0) + amt;
                }
              }
            }

            if (Object.keys(pyResult).length > 0) {
              const merged: Record<string, number> = { ...existing };
              for (const [k, v] of Object.entries(pyResult)) {
                // Only fill keys that don't already carry a positive saved
                // value — authoritative user / prior-year data is preserved.
                const cur = Math.abs(Number(merged[k]) || 0);
                if (cur < 0.005 && Math.abs(v) > 0.005) merged[k] = v;
              }
              pyNotes[nType] = merged;
            }
          }
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

        const matchedRowId = smartMatch(row.ledger_name, smartRules, row.parent_group);
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

      // Stage 2: per-ledger rows (no parent_group wrapping).
      // Notes show ledger-level detail; synthetic group wrappers like
      // "Purchase Accounts" or "Unsecured Loans" pulled from Tally
      // parent_group are not appropriate for Schedule III breakups.
      //
      // ISSUE 1 FIX (per-ledger PY in Pattern B notes): build a PY-ledger
      // lookup keyed by name so each custom row gets its actual prior-year
      // closing balance from PY shell TB, instead of falling back to 0
      // whenever the prior engagement has no saved customRow with the same
      // label. Without this, Trade Payables / Other Current Liabilities /
      // Other Expenses etc. showed CY amounts per ledger but PY column "—".
      const pyByLedgerB: Record<string, number> = {};
      if (pyTb.length > 0) {
        for (const r of pyTb) {
          const nm = String(r.ledger_name || "").trim();
          if (!nm) continue;
          pyByLedgerB[nm.toLowerCase()] = ledgerAmt(r.closing_balance);
        }
      }
      let idx = 0;
      for (const um of unmatchedB) {
        const label = um.ledger;
        const id    = makeCustomId(label, idx++);
        newCy[id] = um.amt;
        const pyFromTb = pyByLedgerB[um.ledger.toLowerCase()] ?? 0;
        newPy[id] = pyFromTb > 0 ? pyFromTb : pyForCustomRow(noteType, id, label);
        autoRows.push({ id, label, source: "auto" });
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

      // ── Cogs/Inventory special: populate pc_open/pc_close + raw_/pack_/other_
      //
      // Schedule III "Changes in Inventories of Finished Goods, WIP & Stock-in-Trade"
      // requires fixed row IDs (pc_open_trade/wip/fg, pc_close_trade/wip/fg) and
      // material consumption rows (raw_open/close, pack_open/close, other_open/close)
      // that the generic Pattern-B grouping cannot fill — those IDs are not in
      // NOTE_SMART_MAP and inventory ledgers usually map to BS_CA_INV (BS Note 17),
      // not the P&L codes. Result: the "Closing Inventories (II)" rows render blank
      // even when Tally has Stock-in-Hand data.
      //
      // Robust fix: walk TB rows whose parent_group is an inventory group
      // (Stock-in-Hand / Stock-in-Trade / Inventories) and route them by ledger
      // name into the correct fixed row.
      // Opening side (pc_open_*, *_open) sources from PY closings — first the
      // prior-year notes' cy_data (if user has run cogs auto-populate before),
      // then a PY-shell-TB fallback (handles first-time cold-start).
      // Client-agnostic: pure name-pattern + parent_group matching.
      if (noteType === "cogs") {
        const INVENTORY_PG_TOKENS = [
          "stock-in-hand", "stock in hand",
          "stock-in-trade", "stock in trade",
          "inventories", "inventory",
        ];
        const isInventoryParent = (pg: string | null | undefined): boolean => {
          const lower = (pg || "").toLowerCase();
          return INVENTORY_PG_TOKENS.some(t => lower.includes(t));
        };
        const classifyInv = (name: string): "wip"|"fg"|"raw"|"pack"|"other"|"trade" => {
          const lower = (name || "").toLowerCase();
          if (/\b(wip|work[-\s]?in[-\s]?progress)\b/.test(lower))     return "wip";
          if (/finished/.test(lower))                                  return "fg";
          if (/raw[-\s]?material|raw[-\s]?stock|raw[-\s]?good/.test(lower)) return "raw";
          if (/packing/.test(lower))                                   return "pack";
          if (/other.*(material|stock)/.test(lower))                   return "other";
          return "trade";
        };
        const closeKeyFor = (cls: ReturnType<typeof classifyInv>): string => ({
          wip: "pc_close_wip", fg: "pc_close_fg", trade: "pc_close_trade",
          raw: "raw_close", pack: "pack_close", other: "other_close",
        }[cls]);
        const openKeyFor  = (cls: ReturnType<typeof classifyInv>): string => ({
          wip: "pc_open_wip", fg: "pc_open_fg", trade: "pc_open_trade",
          raw: "raw_open", pack: "pack_open", other: "other_open",
        }[cls]);

        // CY closings → pc_close_*/raw_close/pack_close/other_close
        for (const row of tb) {
          if (!isInventoryParent(row.parent_group)) continue;
          const amt = ledgerAmt(row.closing_balance);
          if (amt === 0) continue;
          if (ejectedSet.has(row.ledger_name)) continue;
          const key = closeKeyFor(classifyInv(row.ledger_name));
          newCy[key] = (newCy[key] ?? 0) + amt;
          if (!staticSources[key]) staticSources[key] = [];
          staticSources[key].push({ ledger: row.ledger_name, amountCy: amt });
        }

        // Issue 2 (today) — CY openings sourced FIRST from the current
        // engagement's TB opening_balance.  This is Tally's own definitive
        // value for the start-of-year stock — equal by accounting identity
        // to last year's closing, regardless of what any prior stage5_notes
        // happened to store.  Walk every inventory ledger and aggregate its
        // opening_balance into the matching pc_open_*/raw_open/etc. row.
        // openAmt uses Math.abs because Stock-in-Hand carries a Dr balance.
        for (const row of tb) {
          if (!isInventoryParent(row.parent_group)) continue;
          if (ejectedSet.has(row.ledger_name)) continue;
          const openAmt = Math.abs(Number(row.opening_balance ?? 0));
          if (openAmt === 0) continue;
          const key = openKeyFor(classifyInv(row.ledger_name));
          newCy[key] = (newCy[key] ?? 0) + openAmt;
        }

        // CY openings fallback (= PY closings): only fill rows the CY-TB
        // opening_balance pass above did NOT populate.  Prefer the prior
        // year's cogs note over a bare TB lookup.
        const pyCogs: Record<string, number> = pyNotes["cogs"] ?? {};
        const openMap: Record<string, string> = {
          pc_open_trade: "pc_close_trade",
          pc_open_wip:   "pc_close_wip",
          pc_open_fg:    "pc_close_fg",
          raw_open:      "raw_close",
          pack_open:     "pack_close",
          other_open:    "other_close",
        };
        for (const [openKey, closeSrcKey] of Object.entries(openMap)) {
          if (newCy[openKey]) continue; // already filled from CY-TB opening
          const v = pyCogs[closeSrcKey];
          if (typeof v === "number" && Math.abs(v) > 0) {
            newCy[openKey] = Math.abs(v);
          }
        }

        // PY-shell-TB fallback: cold-start case where prior-year cogs note
        // wasn't auto-populated yet, but PY-shell sync DID populate the prior
        // engagement's tally_trial_balance with Stock-in-Hand ledgers.
        // Issue 7 (today): also pull the PRIOR engagement's TB opening_balance
        // (which equals FY-2 closing) so the PY column of "Opening" rows
        // is filled — and PY column of "Closing" rows from prior closing.
        // Symptom this fixes (Swastik Buildcon): CY Opening: WIP = 9,54,65,534
        // but PY Opening: WIP was blank, making PY Increase/Decrease incorrect.
        if (financialYear && clientId) {
          const parts = String(financialYear).split("-");
          if (parts.length === 2) {
            const startYr = parseInt(parts[0], 10);
            const prevFy  = `${startYr - 1}-${String(startYr).slice(-2)}`;
            // Look in BOTH the regular prior engagement AND a PY shell — either
            // may hold the prior-year TB depending on how the user set up.
            const { data: prevEngList } = await supabase
              .from("audit_engagements")
              .select("id, is_py_shell")
              .eq("client_id", clientId)
              .eq("financial_year", prevFy);
            const prevIds = ((prevEngList ?? []) as Array<{ id: string }>)
              .map(e => e.id);
            if (prevIds.length > 0) {
              const { data: prevTb } = await supabase
                .from("tally_trial_balance")
                .select("ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group, engagement_id")
                .in("engagement_id", prevIds);
              for (const row of (prevTb ?? []) as TBRow[]) {
                if (!isInventoryParent((row as any).parent_group)) continue;

                const closeAmt = ledgerAmt(row.closing_balance);   // = PY closing
                const openAmt  = Math.abs(Number((row as any).opening_balance ?? 0)); // = FY-2 closing
                const cls = classifyInv(row.ledger_name);
                const openKey  = openKeyFor(cls);   // pc_open_*
                const closeKey = closeKeyFor(cls);  // pc_close_*

                // CY column: only set when not already filled from prior
                // year's cogs note (pyCogs branch above).
                if (closeAmt > 0 && !newCy[openKey]) {
                  newCy[openKey] = (newCy[openKey] ?? 0) + closeAmt;
                }

                // PY column — Opening row = FY-2 closing (= prior eng's
                // opening_balance), PY Closing row = PY closing (= prior eng's
                // closing_balance).
                if (openAmt > 0) {
                  newPy[openKey] = (newPy[openKey] ?? 0) + openAmt;
                }
                if (closeAmt > 0) {
                  newPy[closeKey] = (newPy[closeKey] ?? 0) + closeAmt;
                }
              }
            }
          }
        }
      }

    } else {
      // ── Pattern A (LT / ST columns) ────────────────────────────────────
      const ltSet      = new Set(noteFs.lt ?? []);
      const stSet      = new Set(noteFs.st ?? []);
      const smartRules = NOTE_SMART_MAP[noteType] ?? [];
      const unmatchedA: { ledger: string; amt: number; pyAmt: number; isLT: boolean; isST: boolean; parentGroup?: string; smartTarget?: string }[] = [];

      // Build a PY-ledger lookup keyed by name so individual customRows get
      // their actual PY closing instead of falling back to 0.
      const pyByLedger: Record<string, number> = {};
      if (pyTb.length > 0) {
        for (const r of pyTb) {
          const nm = String(r.ledger_name || "").trim();
          if (!nm) continue;
          pyByLedger[nm.toLowerCase()] = ledgerAmt(r.closing_balance);
        }
      }

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

        const matchedRowId = smartMatch(row.ledger_name, smartRules, row.parent_group);
        // ISSUE 1 FIX (per-ledger breakup in Notes): for "borrowings",
        // "investments" and "loans_advances" — notes where the auditor expects
        // ledger-level detail under each Schedule III sub-head — we ALWAYS
        // create a customRow per ledger, attached to the smart-matched static
        // row (or the section fallback). Previously smart-matched ledgers like
        // "Dipak B Patel (HUF)" were summed into unsec_related directly, so
        // the Note showed only "Loans from related parties: ₹2.02 cr" without
        // the per-ledger break-up the COA mapping clearly shows.
        const wantsPerLedgerBreakup =
          noteType === "borrowings" ||
          noteType === "investments" ||
          noteType === "loans_advances";

        if (matchedRowId && !wantsPerLedgerBreakup) {
          // Existing aggregate path for other Pattern A notes
          if (isLT) newCy[matchedRowId + "_lt"] = (newCy[matchedRowId + "_lt"] ?? 0) + amt;
          if (isST) newCy[matchedRowId + "_st"] = (newCy[matchedRowId + "_st"] ?? 0) + amt;
          if (isLT && !(matchedRowId + "_lt" in newPy))
            newPy[matchedRowId + "_lt"] = Math.abs(pyNotes[noteType]?.[matchedRowId + "_lt"] ?? 0);
          if (isST && !(matchedRowId + "_st" in newPy))
            newPy[matchedRowId + "_st"] = Math.abs(pyNotes[noteType]?.[matchedRowId + "_st"] ?? 0);
        } else {
          const pyAmt = pyByLedger[row.ledger_name.toLowerCase()] ?? 0;
          unmatchedA.push({
            ledger: row.ledger_name, amt, pyAmt, isLT, isST,
            parentGroup: row.parent_group ?? undefined,
            ...(matchedRowId ? { smartTarget: matchedRowId } : {}),
          });
        }
      }

      // Per-ledger rows (no parent_group wrapping).
      // Per user feedback: in Notes to Accounts, only ledgers should appear —
      // not synthetic group wrappers like "Unsecured Loans" derived from Tally
      // parent_group. Each TB ledger becomes its own customRow attached to
      // the appropriate static parent. This keeps Total (B) math correct and
      // matches the auditor's expectation that BS notes show ledger-level
      // detail rather than account-group categories.
      let idx = 0;
      for (const um of unmatchedA) {
        const label = um.ledger; // ledger name verbatim
        const id    = makeCustomId(label, idx++);
        if (um.isLT) {
          newCy[id + "_lt"] = um.amt;
          // Per-ledger PY: prefer PY shell TB closing for this ledger; fall
          // back to label-matched prior customRow lookup (handles renamed
          // breakup rows across years).
          newPy[id + "_lt"] = um.pyAmt > 0 ? um.pyAmt : pyForCustomRow(noteType, id, label, "_lt");
        }
        if (um.isST) {
          newCy[id + "_st"] = um.amt;
          newPy[id + "_st"] = um.pyAmt > 0 ? um.pyAmt : pyForCustomRow(noteType, id, label, "_st");
        }

        let rowSection:    string | undefined;
        let rowAttachedTo: string | undefined;
        if (noteType === "borrowings") {
          rowSection = "unsecured";
          // Use the smart-match target if available (e.g. "unsec_related" for
          // an HUF ledger that matched the keyword rule). Otherwise fall back
          // to parent_group / name heuristic.
          if (um.smartTarget) {
            rowAttachedTo = um.smartTarget;
          } else {
            const pgLower   = (um.parentGroup || "").toLowerCase();
            const nameLower = normLedger(um.ledger);
            const pgRelated = ["partner", "director", "promoter", "proprietor",
              "shareholder", "relative", "family", "huf", "related"].some(kw => pgLower.includes(kw));
            const nameHuf   = nameLower.includes(" huf") || nameLower.includes("(huf)") || nameLower.includes("-huf");
            rowAttachedTo = (pgRelated || nameHuf) ? "unsec_related" : "unsec_other";
          }
        } else if (um.smartTarget && (noteType === "investments" || noteType === "loans_advances")) {
          // For investments / loans_advances Pattern A notes, attach to the
          // smart-matched static row so per-ledger breakup renders beneath it.
          rowAttachedTo = um.smartTarget;
        }

        autoRows.push({
          id, label, source: "auto",
          ...(rowSection    ? { section: rowSection }       : {}),
          ...(rowAttachedTo ? { attachedTo: rowAttachedTo } : {}),
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

    // ── Silent absorption: re-attach manual rows under matching auto-groups ──
    // When a manual row is attached to the same static parent as a multi-ledger
    // auto-group (e.g. parent_group "Unsecured Loans"), re-route the manual
    // row's attachedTo from the static parent to the auto-group itself. This
    // makes the manual row render as a nested child of the auto-group instead
    // of as a sibling — matching the user's mental model: "Babulal H Patel
    // (HUF)" is part of the Unsecured Loans list and should sit underneath it,
    // not at the same indentation level. Amounts and identity are preserved.
    const absorbedManualRows: NCECustomRow[] = manualRows.map(mr => {
      if (!mr.attachedTo) return mr;
      const target = autoRows.find(ar =>
        ar.attachedTo === mr.attachedTo && (ar.sources?.length ?? 0) > 1
      );
      if (!target) return mr;
      // Re-attach to the auto-group; drop section tag (it inherits via parent).
      return { ...mr, attachedTo: target.id, section: undefined };
    });

    // ── Merge auto + manual ─────────────────────────────────────────────
    const mergedCy: Record<string, number> = { ...newCy };
    const mergedPy: Record<string, number> = { ...newPy };

    // Restore manual custom row amounts
    for (const mr of absorbedManualRows) {
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
      [...autoRows, ...absorbedManualRows]
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

    // ── Strip stale custom_* cy/py keys ────────────────────────────────────
    // After re-sync the customRows array is rebuilt from scratch
    // (autoRows + absorbedManualRows). Any prev.cy / prev.py keys that
    // belonged to customRows that no longer exist (e.g. a deleted
    // parent_group wrapper "Unsecured Loans" from before Issue 2 was fixed)
    // would otherwise remain in mergedCy → still picked up by extras filter
    // in computeDisplayData → inflate Total (B) and Total (A+B).
    const validCustomIds = new Set(
      [...autoRows, ...absorbedManualRows].map(cr => cr.id),
    );
    const purgeStale = (m: Record<string, number>) => {
      for (const k of Object.keys(m)) {
        if (!k.startsWith("custom_")) continue;
        const baseId = k.replace(/_lt$|_st$/, "");
        if (!validCustomIds.has(baseId)) delete m[k];
      }
    };
    purgeStale(mergedCy);
    purgeStale(mergedPy);

    out[noteType] = {
      cy:         mergedCy,
      py:         mergedPy,
      customRows: [...autoRows, ...absorbedManualRows],
      // Preserve user settings that survive re-sync
      hiddenRows:     prev.hiddenRows ?? [],
      labelOverrides: prev.labelOverrides ?? {},
      ejectedLedgers: prev.ejectedLedgers ?? [],
      ...(Object.keys(staticSources).length > 0 ? { cy_sources: staticSources } : {}),
    };
  }

  return out;
}
