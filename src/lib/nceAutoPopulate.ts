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
  /** Per-ledger prior-year amount. Optional — older saved data may only carry amountCy. */
  amountPy?: number;
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
  /** 2026-06-02 — When true, the amount on this row originates from a Tally
   *  TB ledger (auto-populated, moved via "Move to…", or ejected as its own
   *  row). The amount is LOCKED — auditor can only re-categorise it (label /
   *  heading / section). False / undefined means the row was typed by hand
   *  via "+ Add row" and amounts are freely editable.
   *
   *  Decoupled from `source` because `source: "manual"` means *only* "survives
   *  Re-sync from COA". A moved auto-row also gets source="manual" so it
   *  doesn't get rebuilt — but its amount is still TB-derived and must stay
   *  locked. Reading the lock from `source` alone unlocked TB-backed amounts
   *  on Move-to / Eject — the bug this field exists to fix. */
  tbDerived?: boolean;
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
  /** For Pattern B notes: which TB ledgers were mapped into each static row.
   *  Keyed by NoteRowDef.id. Used to render the ℹ️ info popover in NCEDetailedNotes.
   *  amountPy was added later — older saved data may only carry amountCy. */
  cy_sources?: Record<string, { ledger: string; amountCy: number; amountPy?: number }[]>;
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

/** Natural side of an NCE note. Liabilities, equity and income are CR-natural
 *  (a Cr closing balance is the normal side and contributes positively to the
 *  note total); assets and expenses are DR-natural. Used by signedLedgerAmt()
 *  to net opposite-side ledgers within a group total. */
export const NOTE_NATURE: Record<string, "DR" | "CR"> = {
  // Liabilities + Equity (Cr-natural)
  borrowings:      "CR",
  other_lt_liab:   "CR",
  provisions:      "CR",
  trade_payables:  "CR",
  other_cl:        "CR",
  // Income (Cr-natural)
  revenue_ops:     "CR",
  other_income:    "CR",
  // Assets (Dr-natural)
  cwip:               "DR",
  investments:        "DR",
  loans_advances:     "DR",
  other_nc_assets:    "DR",
  inventories:        "DR",
  trade_receivables:  "DR",
  cash_bank:          "DR",
  other_ca:           "DR",
  // Expenses (Dr-natural)
  cogs:           "DR",
  employee_exp:   "DR",
  finance_costs:  "DR",
  other_expenses: "DR",
};

/** Signed amount of a TB ledger when contributing to a note total.
 *  Positive when balance_type matches the note's natural side (e.g. a Cr
 *  ledger under Trade Payables — the normal case); negative when opposite
 *  (e.g. a creditor whose closing is Dr because the party paid in advance —
 *  this should REDUCE the Trade Payables total, mirroring how a sundry-
 *  debtor's Cr balance reduces the Trade Receivables total).
 *  Issue: previously Math.abs() was used everywhere so opposite-side
 *  balances were silently added instead of netted, inflating group totals.
 *  We key the nature off the noteType (not the FS code) because NCE
 *  engagements use NCE_* codes that don't follow the corporate BS_CL_/
 *  BS_NCL_/PL_EXP_ prefix convention. */
function signedLedgerAmt(
  row: { closing_balance: number; balance_type: string },
  noteType: string,
): number {
  const cb = Math.abs(Number(row.closing_balance ?? 0));
  if (cb === 0) return 0;
  const isDr = String(row.balance_type ?? "").toUpperCase() === "DR";
  const nature: "DR" | "CR" = NOTE_NATURE[noteType] ?? "CR";
  if (nature === "CR") return isDr ? -cb : +cb;
  return isDr ? +cb : -cb;
}

/** Signed PY (= opening balance) — same sign convention as signedLedgerAmt
 *  but uses opening_balance / opening_type instead of closing_balance /
 *  balance_type. Returns 0 when the ledger had no opening.
 *
 *  Used to compute the PY column of BS notes from CY's TB opening balances
 *  under the CURRENT COA mapping classification. This fixes the DHANANI
 *  REALTY bug where a ledger that was reclassified from NCE_STB → NCE_LTB
 *  this year still showed under ST on the PY column (because PY was read
 *  from last year's saved breakdown, not recomputed from TB opening). */
function signedLedgerOpeningAmt(
  row: { opening_balance?: number | null; opening_type?: string | null },
  noteType: string,
): number {
  const ob = Math.abs(Number(row.opening_balance ?? 0));
  if (ob === 0) return 0;
  const isDr = String(row.opening_type ?? "").toUpperCase() === "DR";
  const nature: "DR" | "CR" = NOTE_NATURE[noteType] ?? "CR";
  if (nature === "CR") return isDr ? -ob : +ob;
  return isDr ? +ob : -ob;
}

// ── Note → FS-code reverse map ────────────────────────────────────────────────
//
// For each NCE BS / P&L code, the noteType whose grand total feeds that code's
// face value on the Balance Sheet / Profit & Loss view. Where a noteType
// spans LT and ST columns (Pattern A), the variant value identifies which
// column total to read.
//
// Used by getNCENoteFaceTotal() so the BS face picks up manual customRows the
// auditor added in Stage 7 Notes — without this the face only reflects the raw
// TB sum (auto-mapped ledgers) and ignores any "+ Add row" entries.
export const NCE_CODE_TO_NOTE: Record<string, { note: string; col?: "lt" | "st" }> = {
  // Liabilities + Equity
  NCE_LTB:    { note: "borrowings",     col: "lt" },
  NCE_STB:    { note: "borrowings",     col: "st" },
  NCE_OLTL:   { note: "other_lt_liab" },
  NCE_LTP:    { note: "provisions",     col: "lt" },
  NCE_STP:    { note: "provisions",     col: "st" },
  NCE_TP:     { note: "trade_payables" },
  NCE_OCL:    { note: "other_cl" },
  // Assets
  NCE_CWIP:   { note: "cwip" },
  NCE_NCINV:  { note: "investments",    col: "lt" },
  NCE_CINV:   { note: "investments",    col: "st" },
  NCE_LTLA:   { note: "loans_advances", col: "lt" },
  NCE_STLA:   { note: "loans_advances", col: "st" },
  NCE_ONCA:   { note: "other_nc_assets" },
  NCE_STCK:   { note: "inventories" },
  NCE_TR:     { note: "trade_receivables" },
  NCE_CASH:   { note: "cash_bank" },
  NCE_OCA:    { note: "other_ca" },
  // P&L
  NCE_REV_OPS: { note: "revenue_ops" },
  NCE_REV_OTH: { note: "other_income" },
  NCE_EMP_EXP: { note: "employee_exp" },
  NCE_FIN_COST:{ note: "finance_costs" },
  NCE_OTH_EXP: { note: "other_expenses" },
};

/** Compute the grand-total face value (or LT/ST column total for Pattern A)
 *  for an NCE note, INCLUDING manual custom rows. Returns null when the note
 *  has no entries — callers should fall back to the raw TB sum.
 *
 *  Why this exists: the BS / P&L face previously read from a separate
 *  `stage5_notes` JSONB whose `breakup[]` array only ever contained the auto-
 *  populated ledgers. A custom row added via "+ Add row" lives in
 *  `nce_financial_notes.cy_data` (with the row id in `_custom_rows`) and never
 *  made it to the BS face, producing visible mismatches like Trade Payables
 *  showing ₹19,84,766 on BS face vs ₹19,94,766 in the Notes total. */
export function getNCENoteFaceTotal(
  noteRow: { cy_data?: Record<string, any> | null; py_data?: Record<string, any> | null } | undefined | null,
  column: "cy" | "py",
  pattern?: "A" | "B",
  patternCol?: "lt" | "st",
): number | null {
  if (!noteRow) return null;
  // SCHEMA QUIRK / SHREE HARI ROOT CAUSE FIX (2026-06-05):
  // `_custom_rows` (with its `sources[]` sub-ledger arrays) is persisted
  // ONLY on cy_data. py_data carries the per-id PY numeric values but NOT
  // the customRow metadata. Reading `py_data._custom_rows` returns an empty
  // array — which means a PY column query previously saw NO customRows,
  // counted NO sources, and silently under-reported the BS PY face by
  // crores of rupees (SHREE HARI INFRA: ₹55.67 cr missing across A/B/C/D/E
  // heading rows). Always pull the customRow list from cy_data; values
  // for the requested column come from cy_data OR py_data as appropriate.
  const cyData = noteRow.cy_data ?? {};
  const pyData = noteRow.py_data ?? {};
  const valuesSource = (column === "cy" ? cyData : pyData) ?? {};
  if (!valuesSource || typeof valuesSource !== "object") return null;
  // Master customRow list — always from cy_data, regardless of column.
  const customRows: Array<{ id: string; section?: string; attachedTo?: string; sources?: Array<{ ledger?: string; amountCy?: number; amountPy?: number; column?: "lt" | "st" }> }> =
    Array.isArray((cyData as any)._custom_rows) ? (cyData as any)._custom_rows : [];

  // Strip meta keys to get the pure numeric map for the REQUESTED column.
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(valuesSource)) {
    if (META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) numeric[k] = v;
  }

  // SHREE HARI FIX (2026-06-04): some customRows carry their sub-ledger
  // breakup in an own `sources[]` array (heading-style rows like "A" / "B" /
  // "C" / "D" / "E" under "Other payables — Others"). The customRow's own
  // numeric value (cy[id]) is 0; the actual amounts live inside sources.
  // Without summing sources, the BS face under-counts by the entire
  // sub-ledger breakup — produced visible BS imbalance of ₹3,39,50,000 on
  // SHREE HARI INFRA (Other Current Liabilities). Helper used by both
  // Pattern A and Pattern B branches below.
  const isCol = column === "cy";
  const sourcesContribution = (cr: { id: string; sources?: Array<{ amountCy?: number; amountPy?: number; column?: "lt" | "st" }> }, patternColFilter?: "lt" | "st"): number => {
    if (!Array.isArray(cr.sources) || cr.sources.length === 0) return 0;
    // Only count sources when the customRow's own numeric is zero — same
    // guard as in NCEDetailedNotes / computeDisplayData to avoid double-
    // counting if a future code path ever populates both channels.
    const baseKey = patternColFilter ? cr.id + "_" + patternColFilter : cr.id;
    if ((numeric[baseKey] ?? 0) !== 0) return 0;
    let s = 0;
    for (const src of cr.sources) {
      if (patternColFilter && src.column !== patternColFilter) continue;
      s += Number((isCol ? src.amountCy : src.amountPy) ?? 0);
    }
    return s;
  };

  // Pattern A: caller asked for a specific column ("lt" or "st"). Sum every
  // non-customRow leaf suffix key plus customRows (respecting attachedTo /
  // section semantics from computeDisplayData). For simplicity here we sum
  // ALL suffixed keys for the chosen column, then add customRows for that
  // column. This mirrors the Total (A+B)_lt / _st row math in computeDisplayData.
  if (pattern === "A" && patternCol) {
    const suffix = "_" + patternCol;
    let total = 0;
    let hasAny = false;
    // Sum top-level suffixed keys, but EXCLUDE customRow ids (they're picked
    // up via the customRows loop with section/attachedTo awareness).
    const customIds = new Set(customRows.map(cr => cr.id));
    for (const [k, v] of Object.entries(numeric)) {
      if (!k.endsWith(suffix)) continue;
      const base = k.slice(0, -suffix.length);
      if (customIds.has(base)) continue;
      // Skip section/grand totals — they're DERIVED from the leaves below.
      if (base === "total" || base === "total_ab" || base === "sec_total" || base === "unsec_total") continue;
      total += v;
      hasAny = true;
    }
    for (const cr of customRows) {
      const v = numeric[cr.id + suffix];
      if (v != null) { total += v; hasAny = true; }
      // SHREE HARI fix — also add the row's own sources[] sub-ledger
      // breakup, filtered to the requested LT/ST column.
      const srcAdd = sourcesContribution(cr, patternCol);
      if (srcAdd !== 0) { total += srcAdd; hasAny = true; }
    }
    return hasAny ? Math.round(total * 100) / 100 : null;
  }

  // Pattern B: sum leaf keys + sectionless customRows. We deliberately read
  // only KEYS that look like "leaf" ids (not the synthetic "total" row); for
  // legacy data we fall back to all non-meta numeric keys minus any key whose
  // base id collides with a customRow (avoiding double-count).
  const customIds = new Set(customRows.map(cr => cr.id));
  let total = 0;
  let hasAny = false;
  for (const [k, v] of Object.entries(numeric)) {
    if (k === "total") continue;       // grand total — derived
    if (k === "total_ab" || k === "sec_total" || k === "unsec_total") continue;
    if (customIds.has(k)) continue;    // customRow — added separately below
    total += v;
    hasAny = true;
  }
  // ROOT-CAUSE FIX: include ALL customRows (attached AND unattached). When a
  // breakup ledger is attached to a catch-all static row (e.g. "Others"), that
  // static row's own value is ZEROED — the child customRow holds the amount —
  // so the old "attached rows are summed via their parent" assumption dropped
  // the entire amount. Static parents with children contribute 0 to the leaf
  // sum above, and each child contributes its value here → no double-count.
  for (const cr of customRows) {
    const v = numeric[cr.id];
    if (v != null) { total += v; hasAny = true; }
    // SHREE HARI fix — sum the customRow's own sources[] sub-ledger breakup
    // (heading rows like "A" / "B" / "C" / "D" / "E" hold their amounts here,
    // not in numeric[cr.id]). Without this, the BS face under-counted by the
    // entire sub-ledger group and ₹3.39 cr appeared as a balance imbalance.
    const srcAdd = sourcesContribution(cr);
    if (srcAdd !== 0) { total += srcAdd; hasAny = true; }
  }
  return hasAny ? Math.round(total * 100) / 100 : null;
}

// ── Serialise / deserialise ───────────────────────────────────────────────────

// Reserved keys used as JSONB metadata inside cy_data — must be filtered out
// when reading numeric values back into the cy/py maps.
// NCE Task 7: added _source_label_overrides so user-edited source sub-ledger labels
// survive page reload (previously this field was in NCENoteData but never persisted).
const META_KEYS = new Set(["_custom_rows", "_hidden_rows", "_label_overrides", "_cy_sources", "_ejected_ledgers", "_source_label_overrides"]);

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

  // NCE Task 7: restore source sub-ledger label overrides
  const sourceLabelOverrides: Record<string, string> =
    rawCy._source_label_overrides && typeof rawCy._source_label_overrides === "object"
      ? (rawCy._source_label_overrides as Record<string, string>)
      : {};

  const cy: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCy)) {
    if (!META_KEYS.has(k) && typeof v === "number") cy[k] = v;
  }
  const py: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawPy)) {
    // Preserve sign — debit/credit netting may produce signed values, and
    // unconditional Math.abs would silently strip out negative contributions
    // for opposite-side ledgers (e.g. a Dr-balance ledger under Trade Payables).
    if (!META_KEYS.has(k) && typeof v === "number") py[k] = v;
  }
  return { cy, py, customRows, hiddenRows, labelOverrides, cy_sources, ejectedLedgers, sourceLabelOverrides };
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
      // NCE Task 7: persist source sub-ledger label overrides
      ...(d.sourceLabelOverrides && Object.keys(d.sourceLabelOverrides).length > 0
        ? { _source_label_overrides: d.sourceLabelOverrides }
        : {}),
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

  // ── Precompute lookup maps used by the per-note PY-only walks ───────────
  // These depend ONLY on coaMapping + tb (constant across all notes), so we
  // build them ONCE here instead of rebuilding inside every note iteration.
  // The previous in-loop `tb.find(...)` was O(ledgers²) per note × 19 notes,
  // which made re-sync crawl on large engagements (600+ ledgers).
  const tbParentByLedgerLower: Record<string, string> = {};
  for (const r of tb) {
    const nm = String(r.ledger_name || "").trim().toLowerCase();
    if (nm) tbParentByLedgerLower[nm] = String(r.parent_group || "").toLowerCase().trim();
  }
  const groupToCodeGlobal: Record<string, string> = (() => {
    const counts: Record<string, Record<string, number>> = {};
    for (const [ledger, m] of Object.entries(coaMapping || {})) {
      const c = (m as any)?.code; if (!c) continue;
      const grp = tbParentByLedgerLower[ledger.toLowerCase().trim()];
      if (!grp) continue;
      if (!counts[grp]) counts[grp] = {};
      counts[grp][c] = (counts[grp][c] || 0) + 1;
    }
    const out: Record<string, string> = {};
    for (const [grp, codeCounts] of Object.entries(counts)) {
      let best = "", bestN = 0, tie = false;
      for (const [c, n] of Object.entries(codeCounts)) {
        if (n > bestN) { best = c; bestN = n; tie = false; }
        else if (n === bestN) tie = true;
      }
      if (best && !tie) out[grp] = best;
    }
    return out;
  })();

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
  // Hoisted PY shell coa_mapping — used by both the per-note PY fallback
  // (below) AND the Pattern A/B PY-only ledger walks so CLOSED ledgers
  // that only exist in PY can still be classified to a CY FS code via
  // the PY shell's own mapping (the CY mapping won't carry them since
  // the ledger doesn't appear in CY TB).
  let pyCoaMap: Record<string, { code: string }> = {};
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
        pyCoaMap =
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
    // Note 4 fix: collapse duplicate MANUAL rows before processing. A pre-fix
    // runaway loop (auto walk re-creating ledgers + the "promote to manual" heal
    // converting them every cycle) accumulated the SAME ledger 10-20x as manual
    // rows, which are preserved verbatim across re-syncs and so never self-healed.
    // De-duplicating by label+attachedTo+section (keep first) means a re-sync now
    // writes ONE clean row per ledger and totals stop multiplying.
    const _seenManual = new Set<string>();
    let manualRows = prev.customRows.filter(r => {
      if (r.source !== "manual") return false;
      const key = `${(r.label || "").trim().toLowerCase()}|${r.attachedTo ?? ""}|${r.section ?? ""}`;
      if (!(r.label || "").trim()) return true;
      if (_seenManual.has(key)) return false;
      _seenManual.add(key);
      return true;
    });

    // 2026-06-04 — STALE PATTERN-A LEDGER PURGE (DHANANI REALTY + SHREE HARI).
    // For per-ledger-breakup Pattern A notes (borrowings / investments /
    // loans_advances), drop any manual row whose label matches a TB ledger
    // — regardless of whether that TB ledger is currently mapped to one of
    // this note's codes or not. Two failure modes converge here:
    //
    //   (a) Reclassification across LT/ST inside the same note (DHANANI
    //       REALTY): the manual row still carried the OLD _st / _lt suffix
    //       after the user flipped the ledger between NCE_STB and NCE_LTB.
    //   (b) Reclassification across NOTES (SHREE HARI INFRA): HUF loan
    //       ledgers once mapped to NCE_LTB persisted as manual rows in
    //       this note, but later the user mapped them to a different code
    //       (NCE_CAP / NCE_STLA / etc.). The earlier 'in-scope only' purge
    //       missed them because the ledger's current mapping isn't in this
    //       note's ltSet/stSet — so the rows kept appearing as empty
    //       placeholders forever.
    //
    // Broader rule: any TB ledger is processed afresh by the appropriate
    // note's auto-populate based on its CURRENT mapping. A manual row
    // whose label matches a TB ledger is by definition redundant in this
    // note — either auto-populate will recreate it correctly here (if the
    // mapping still belongs), or it should disappear (if the mapping
    // moved). Drop them; the purgeStale pass scrubs orphan _lt/_st keys.
    //
    // Manual rows whose label does NOT match any TB ledger (e.g. an HUF
    // loan typed by hand without a Tally ledger) are kept unchanged.
    const _wantsPerLedgerBreakup =
      noteType === "borrowings" ||
      noteType === "investments" ||
      noteType === "loans_advances";
    if (_wantsPerLedgerBreakup && tb.length > 0) {
      const tbLedgerSet = new Set<string>();
      for (const row of tb) {
        const nm = (row.ledger_name || "").trim().toLowerCase();
        if (nm) tbLedgerSet.add(nm);
      }
      if (tbLedgerSet.size > 0) {
        const before = manualRows.length;
        manualRows = manualRows.filter(mr => {
          const lbl = (mr.label || "").trim().toLowerCase();
          return !tbLedgerSet.has(lbl);
        });
        const dropped = before - manualRows.length;
        if (dropped > 0) {
          // eslint-disable-next-line no-console
          console.log(`[nceAutoPopulate] ${noteType}: purged ${dropped} stale Pattern-A manual row(s) whose ledger now lives in a different note (LT↔ST or cross-note reclassification).`);
        }
      }
    }

    // Build a set of TB ledger names the user has explicitly ejected to
    // standalone rows. These are skipped during auto-grouping so they won't
    // be re-merged into an auto row on re-sync.
    const ejectedSet = new Set(prev.ejectedLedgers ?? []);

    // Note 4 fix (NCE — duplicate rendering after move): build a set of labels
    // belonging to MANUAL custom rows (rows the user re-parented via "Move to…"
    // or typed by hand). A re-sync rebuilds auto rows straight from the TB, so
    // without this guard a ledger the user already moved into a manual row gets
    // re-created as a fresh standalone auto row → the SAME ledger then appears
    // twice (once nested under its new parent, once standalone) and every total
    // double-counts it. Skipping any TB ledger whose name matches a manual row
    // label makes the move a TRUE re-parent: the ledger lives ONLY in the manual
    // row. Also self-heals already-duplicated saved data on the next re-sync,
    // because customRows is rebuilt as [autoRows, ...manualRows] from scratch.
    const manualLabelSet = new Set(
      manualRows
        .map(mr => (mr.label || "").trim().toLowerCase())
        .filter(Boolean),
    );
    // Also treat the source ledgers bundled inside manual auto-groups as claimed.
    for (const mr of manualRows) {
      for (const s of mr.sources ?? []) {
        const nm = (s.ledger || "").trim().toLowerCase();
        if (nm) manualLabelSet.add(nm);
      }
    }
    const isClaimedByManual = (ledgerName: string) =>
      manualLabelSet.has((ledgerName || "").trim().toLowerCase());

    const newCy:         Record<string, number> = {};
    const newPy:         Record<string, number> = {};
    const autoRows:      NCECustomRow[]         = [];
    const staticSources: Record<string, { ledger: string; amountCy: number; amountPy?: number }[]> = {};

    // STALE-MANUAL-ROW REFRESH (Pattern B strict-TB notes):
    // For trade_payables / other_cl / other_lt_liab / cogs every customRow IS
    // a TB ledger.  We populate these maps in the Pattern B branch below; at
    // merge time we use them to overwrite any manual row whose label matches a
    // current TB ledger, so stale prev.cy values cannot inflate the note total
    // after a ledger's Tally balance changes (MAHARSH INFRA bug, June 2026).
    // Both maps are keyed by lowercased trimmed ledger name.
    const STRICTLY_TB_DRIVEN_B = new Set(['cogs', 'trade_payables', 'other_cl', 'other_lt_liab']);
    let tbRefreshCy: Record<string, number> | null = null;
    let tbRefreshPy: Record<string, number> | null = null;

    // PY-ledger lookup keyed by lowercase ledger name → signed PY closing.
    // Used to attach per-ledger amountPy to staticSources so the expandable
    // breakdown shows BOTH CY and PY amounts per ledger (Issue 2).
    const pyByLedgerStatic: Record<string, number> = {};
    if (pyTb.length > 0) {
      for (const r of pyTb) {
        const nm = String(r.ledger_name || "").trim();
        if (!nm) continue;
        pyByLedgerStatic[nm.toLowerCase()] = signedLedgerAmt(r, noteType);
      }
    }

    if (noteFs.all) {
      // ── Pattern B ──────────────────────────────────────────────────────
      const codeSet    = new Set(noteFs.all);
      const smartRules = NOTE_SMART_MAP[noteType] ?? [];
      // Stage 1: split each ledger into "matched-static" or "unmatched"
      // pyAmt is optional so PY-only ledgers (no CY balance) can still flow
      // through Stage 2 as their own customRow with amt = 0 and pyAmt set.
      const unmatchedB: { ledger: string; amt: number; parentGroup?: string; pyAmt?: number }[] = [];

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !codeSet.has(mapped.code)) continue;
        // ISSUE FIX (debit/credit netting): use signed amount so opposite-
        // side balances (e.g. a Dr-balance ledger inside a CR-natural head
        // like Trade Payables) reduce the group total instead of inflating it.
        const amt = signedLedgerAmt(row, noteType);
        if (Math.abs(amt) < 0.005) continue;
        // Skip ledgers the user has explicitly ejected to standalone rows
        if (ejectedSet.has(row.ledger_name)) continue;
        // Note 4 fix: skip ledgers already represented by a user manual row
        // (re-parented/typed) so we never re-create a duplicate auto row.
        if (isClaimedByManual(row.ledger_name)) continue;

        const matchedRowId = smartMatch(row.ledger_name, smartRules, row.parent_group);
        if (matchedRowId) {
          // Accumulate directly into the static row — no custom row created
          newCy[matchedRowId] = (newCy[matchedRowId] ?? 0) + amt;
          // Track which ledgers feed this static row (for info popover).
          // Carry PY amount too so the expander shows BOTH CY + PY columns.
          if (!staticSources[matchedRowId]) staticSources[matchedRowId] = [];
          // Per-ledger PY: look up against PY TB using the SAME head nature
          // so signs net correctly in the expanded breakdown.
          const pyRowLookup = pyTb.find(r => r.ledger_name?.toLowerCase() === row.ledger_name.toLowerCase());
          const pyAmtLedger = pyRowLookup ? signedLedgerAmt(pyRowLookup, noteType) : 0;
          staticSources[matchedRowId].push({
            ledger: row.ledger_name,
            amountCy: amt,
            amountPy: pyAmtLedger,
          });
          // PY total: carry from prior-year cy_data for the same static key.
          // Use Math.abs to guard against stale negative values stored in old data.
          if (!(matchedRowId in newPy)) {
            newPy[matchedRowId] = Math.abs(pyNotes[noteType]?.[matchedRowId] ?? 0);
          }
        } else {
          unmatchedB.push({ ledger: row.ledger_name, amt, parentGroup: row.parent_group ?? undefined });
        }
      }

      // Also walk PY TB so static rows pick up per-ledger PY contributions
      // from PY-only ledgers (e.g. Suresh Chavda or TDS Payable-194A-24-25
      // CLOSED accounts that don't appear in CY TB but contributed to last
      // year's TDS Payable total).
      //
      // ROOT-CAUSE FIX (this turn): previously the lookup only consulted
      // `coaMapping` (CY engagement's mapping). A CLOSED PY-only ledger
      // doesn't exist in CY TB, so its CY mapping entry is missing — the
      // ledger silently dropped out and the PY column showed no breakup
      // even though the variance drill listed the ledger with a clear PY
      // amount. We now also consult the PY shell engagement's own mapping
      // (pyCoaMap) and, as a last resort, inherit the FS code from any
      // CY ledger sharing the same Tally parent_group. This way ledgers
      // renamed between years (Tally export quirk) still classify.
      if (pyTb.length > 0) {
        const cyMappingLower: Record<string, { code: string }> = {};
        for (const [k, v] of Object.entries(coaMapping || {})) {
          if (v?.code) cyMappingLower[k.toLowerCase().trim()] = v;
        }
        const pyMappingLower: Record<string, { code: string }> = {};
        for (const [k, v] of Object.entries(pyCoaMap || {})) {
          if (v?.code) pyMappingLower[k.toLowerCase().trim()] = v;
        }
        // parent_group → FS code map (precomputed once at fn scope — avoids
        // the previous O(ledgers²) tb.find per note that hung large engagements).
        const groupToCode = groupToCodeGlobal;
        // Track every ledger already produced by the CY walk so the PY-only
        // walk below doesn't re-create them as duplicate customRows. BUG FIX:
        // previously this only watched staticSources (smart-matched ledgers).
        // For Pattern B notes without smart-match (trade_payables, etc.)
        // every CY ledger goes to unmatchedB instead, so the PY walk had no
        // way to know they were already handled and ended up emitting a
        // second "PY-only" row for the same ledger (Akash Ghanshyambhai
        // Gediya appeared twice on DBS REALTY).
        const cySeenLedger = new Set([
          ...Object.values(staticSources).flat().map(s => s.ledger.toLowerCase()),
          ...unmatchedB.map(u => u.ledger.toLowerCase()),
        ]);
        for (const row of pyTb) {
          const nm = String(row.ledger_name || "").trim();
          if (!nm) continue;
          const nmLower = nm.toLowerCase();
          if (cySeenLedger.has(nmLower)) continue;
          // Note 4 fix: skip PY-only ledgers already claimed by a manual row.
          if (isClaimedByManual(nm)) continue;
          // Resolution order: PY-shell exact → PY-shell lower → CY exact →
          // CY lower → parent_group inheritance. Mirrors how the variance
          // drill resolves PY ledgers, so what the auditor sees in the
          // drill always reaches the expanded note breakdown.
          let mapped: { code: string } | undefined =
            (pyCoaMap as any)[nm] ||
            pyMappingLower[nmLower] ||
            (coaMapping as any)[nm] ||
            cyMappingLower[nmLower];
          if (!mapped?.code) {
            const grp = String((row as any).parent_group || "").toLowerCase().trim();
            if (grp && groupToCode[grp]) mapped = { code: groupToCode[grp] };
          }
          if (!mapped?.code || !codeSet.has(mapped.code)) continue;
          const pyAmt = signedLedgerAmt(row, noteType);
          if (Math.abs(pyAmt) < 0.005) continue;
          const matchedRowId = smartMatch(nm, smartRules, row.parent_group);
          if (matchedRowId) {
            // Smart-match → attach as a sub-row under the static row (e.g.
            // TDS Payable-194A-24-25 → TDS Payable).
            if (!staticSources[matchedRowId]) staticSources[matchedRowId] = [];
            staticSources[matchedRowId].push({
              ledger: nm,
              amountCy: 0,
              amountPy: pyAmt,
            });
          } else {
            // No smart-match (e.g. trade_payables, where every creditor is its
            // own line). Push to unmatchedB so Stage 2 creates a customRow
            // with amountCy = 0 and amountPy = the PY closing. Without this,
            // CLOSED ledgers (Ambition Electric, Kapadiya Hiren, etc.) that
            // had balances last year but none this year silently disappear
            // from the auto-populated note even though COA Mapping still
            // shows them under Trade Payables.
            unmatchedB.push({
              ledger: nm,
              amt: 0,
              parentGroup: (row as any).parent_group ?? undefined,
              pyAmt,
            });
          }
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
      // ROOT-CAUSE FIX (Issue: BS face PY ≠ variance drill PY by 2×Dr_total):
      // pyByLedgerB previously used ledgerAmt() (Math.abs) so a Cr-balance PY
      // ledger always produced a POSITIVE value here, regardless of head
      // nature. For CR-natural notes (trade_payables, other_cl, ...) where
      // Cr balance should contribute +cb and Dr should contribute -cb, this
      // worked for Cr ledgers but FLIPPED the sign of Dr-balance creditors
      // (party paid in advance) — they got +cb in the customRow but the
      // variance drill computed -cb. The two diverged by exactly 2×|Dr_sum|
      // on every report (DBS REALTY: ₹71.24 lakh = 2 × ₹35.62 lakh).
      //
      // Fix: sign-aware lookup using the same NOTE_NATURE convention as the
      // PY-only walk and the CY aggregation. Every PY value across the
      // entire note now respects the head's natural side, so the note
      // total = variance drill total = BS face total for every NCE client.
      const pyByLedgerB: Record<string, number> = {};
      if (pyTb.length > 0) {
        for (const r of pyTb) {
          const nm = String(r.ledger_name || "").trim();
          if (!nm) continue;
          pyByLedgerB[nm.toLowerCase()] = signedLedgerAmt(r, noteType);
        }
      }
      // STALE-MANUAL-ROW FIX (MAHARSH INFRA, June 2026):
      // For STRICTLY-TB-DRIVEN Pattern B notes (trade_payables, other_cl,
      // other_lt_liab, cogs) every customRow IS a TB ledger.  When the user's
      // Tally balance changes (e.g. a creditor is fully paid, ledger closes
      // to 0), the customRow had been left at its stale prev.cy value because
      // (a) the heal had promoted it from "auto" to "manual" to preserve
      // placement, and (b) manualLabelSet correctly skips re-creating it as
      // a fresh auto row.  Result: the note kept inflating the BS face by
      // the difference between the stale value and the current TB closing.
      // Build a current TB-by-ledger CY map so we can refresh those rows below.
      const cyByLedgerB: Record<string, number> = {};
      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !codeSet.has(mapped.code)) continue;
        const nm = String(row.ledger_name || "").trim();
        if (!nm) continue;
        cyByLedgerB[nm.toLowerCase()] = signedLedgerAmt(row, noteType);
      }
      // Expose the maps to the merge step (outer scope) so manual-row CY/PY
      // values get refreshed from TB.  Only for strictly-TB-driven notes —
      // for other Pattern B notes (where users genuinely type custom amounts)
      // the old preserve-verbatim behaviour stays.
      if (STRICTLY_TB_DRIVEN_B.has(noteType)) {
        tbRefreshCy = cyByLedgerB;
        tbRefreshPy = pyByLedgerB;
      }
      // Default attachedTo for COGS auto-mapped ledgers: every plain expense
      // ledger (Hardware Purchase, Cement Purchase, etc.) lands under
      // "Add: Purchases of raw materials" (raw_purch) by default. The
      // auditor can still move it elsewhere via the row-actions menu
      // (Stock-in-Trade / Packing material / etc.). Inventory ledgers are
      // routed via the cogs special block further down — they hit the fixed
      // pc_open_*/pc_close_* slots, not the unmatchedB customRow path.
      //
      // SMART-MERGE (Issue 2 fix — OM REALTY "Site Expense - 12%", "Site
      // Expense - 18%", "Site Expense - URD" rendered as three separate
      // rows): group unmatched ledgers by their normalised base head
      // (deriveBaseHead/groupKey strip "- 18%", "- URD", "- IGST", trailing
      // month names and numbers). Ledgers sharing a base head merge into ONE
      // custom row whose label is the merged base head and whose `sources`
      // array carries the per-ledger breakdown (shown via the ℹ️ popover).
      // Single-ledger groups keep their verbatim label and no `sources` — so
      // unrelated ledgers ("Unpaid Audit Fees" vs "Unpaid Professional Fees")
      // stay as separate rows.
      const groupedB = new Map<string, {
        baseLabel: string;
        ledgers:   typeof unmatchedB;
      }>();
      for (const um of unmatchedB) {
        const k = groupKey(um.ledger);
        if (!groupedB.has(k)) {
          groupedB.set(k, { baseLabel: deriveBaseHead(um.ledger), ledgers: [] });
        }
        groupedB.get(k)!.ledgers.push(um);
      }
      let idx = 0;
      for (const group of groupedB.values()) {
        const isMerged = group.ledgers.length > 1;
        const label    = isMerged ? group.baseLabel : group.ledgers[0].ledger;
        const id       = makeCustomId(label, idx++);
        // Aggregate CY and PY across every ledger in the group, and build a
        // sources[] entry for each so the (i) popover can show the underlying
        // breakdown ("Site Expense" — comprising "Site Expense - 12%" ₹57,588,
        // "Site Expense - 18%" ₹2,42,323, "Site Expense - URD" ₹15,000).
        let cySum = 0;
        let pySum = 0;
        const sources: NCEMergedSource[] = [];
        for (const g of group.ledgers) {
          cySum += g.amt;
          const pyFromWalk = g.pyAmt ?? 0;
          const pyFromTb   = pyByLedgerB[g.ledger.toLowerCase()] ?? 0;
          const pyVal = Math.abs(pyFromWalk) > 0.005
            ? pyFromWalk
            : (Math.abs(pyFromTb) > 0.005 ? pyFromTb : pyForCustomRow(noteType, id, g.ledger));
          pySum += pyVal;
          sources.push({ ledger: g.ledger, amountCy: g.amt, amountPy: pyVal });
        }
        newCy[id] = cySum;
        newPy[id] = pySum;
        // ISSUE (collapse/expand internal heads): Pattern B breakup ledgers
        // used to be created with NO attachedTo (except cogs), so they rendered
        // as a FLAT, always-visible list before the grand total with no
        // collapsible head — e.g. every Trade Payables creditor / Other
        // Current Liabilities payable was permanently expanded. Attach each
        // unmatched ledger to its note's catch-all static head so it nests
        // under that head with the standard +/- toggle (collapsed by default).
        const DEFAULT_ATTACH_B: Record<string, string> = {
          cogs:           "raw_purch",
          trade_payables: "others",      // (b) Others
          other_cl:       "other_cl",    // Other payables — Others
          other_lt_liab:  "others",      // (b) Others (please specify)
        };
        const attachTarget = DEFAULT_ATTACH_B[noteType];
        const row: NCECustomRow = {
          id, label, source: "auto",
          tbDerived: true,                       // amount comes from TB → lock from edit
          ...(attachTarget ? { attachedTo: attachTarget } : {}),
          ...(isMerged ? { sources } : {}),
        };
        autoRows.push(row);
      }

      // Fallback: if nothing was populated at all, use FS-code totals.
      // Same double-count guard as Pattern A — manual rows count as "data".
      // IMPORTANT: check BOTH cy AND py. A note whose figures live only in the
      // PY column (e.g. a manual "Interest On Deposit" with py=8,785, cy=0)
      // was wrongly treated as empty, so the "Auto-filled from COA total"
      // placeholder kept being re-created on every sync and double-counted.
      const manualHasAmountB = manualRows.some(mr =>
        Math.abs(prev.cy?.[mr.id] ?? 0) > 0.005 || Math.abs(prev.py?.[mr.id] ?? 0) > 0.005,
      );
      const hasData = autoRows.length > 0
        || Object.values(newCy).some(v => Math.abs(v) > 0.005)
        || Object.values(newPy).some(v => Math.abs(v) > 0.005)
        || manualHasAmountB;
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
          autoRows.push({ id, label: "Auto-filled from COA total", source: "auto", tbDerived: true });
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
      // their actual PY closing instead of falling back to 0. We sign the
      // PY value using the SAME mapping head's nature (the same ledger is
      // assumed to live under the same head across years) so Dr balances in
      // a Cr-natural head subtract from group totals consistently CY + PY.
      const pyByLedger: Record<string, number> = {};
      if (pyTb.length > 0) {
        for (const r of pyTb) {
          const nm = String(r.ledger_name || "").trim();
          if (!nm) continue;
          const m = coaMapping[nm];
          pyByLedger[nm.toLowerCase()] = m ? signedLedgerAmt(r, noteType) : ledgerAmt(r.closing_balance);
        }
      }

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped) continue;
        const isLT = ltSet.has(mapped.code);
        const isST = stSet.has(mapped.code);
        if (!isLT && !isST) continue;
        // Signed amount — see signedLedgerAmt() docs. Net opposite-side
        // balances within the head so group totals match COA Mapping math.
        const amt = signedLedgerAmt(row, noteType);
        // 2026-06-04 — PY signed amount from THIS ledger's own opening
        // balance, classified by the CURRENT mapping's LT/ST. Replaces the
        // earlier pyNotes-snapshot lookup that locked PY to last year's
        // classification. Fixes DHANANI REALTY where a ledger reclassified
        // STB → LTB this year was still being placed in the ST column on
        // PY (because last year's saved breakup had it under ST). Now both
        // CY and PY apply the same isLT/isST rule, so reclassifications
        // automatically propagate across both periods.
        //
        // Edge case: a ledger with CY opening = 0 but a non-zero PY-shell
        // closing (TB data inconsistency, or a ledger renamed between FYs).
        // Prefer CY opening — but when it's zero, fall back to PY-shell
        // closing so a real PY balance isn't silently dropped. When BOTH
        // are zero, the ledger is genuinely empty in PY too and the loop
        // below skips it (no orphan placeholder row).
        const pyAmtFromOpening   = signedLedgerOpeningAmt(row, noteType);
        const pyAmtFromShellLater = pyByLedger[row.ledger_name.toLowerCase()] ?? 0;
        const pyAmtThisLedger    = Math.abs(pyAmtFromOpening) > 0.005
          ? pyAmtFromOpening
          : pyAmtFromShellLater;
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
        // ROOT-CAUSE FIX (Issue 1, CLOSED ledgers vanish): a ledger that closed
        // during CY still appears in the CY trial balance, but with closing 0,
        // so signedLedgerAmt() returns ~0. The old `if (<0.005) continue` then
        // dropped it from the CY loop — AND the PY-only walk also skipped it
        // (it IS present in CY TB, so it's in cySeen). The ledger therefore
        // disappeared from BOTH paths: e.g. "Advance Tax - 2024-25",
        // "TDS Reimbursement - Toyota Finance Service", "TDS/TCS Recevable-2425"
        // on OM REALTY (closing 0 in CY, real balance in PY) never rendered as
        // a breakup row even though COA Mapping clearly classifies them.
        // For per-ledger-breakup notes, KEEP the ledger when it has a non-zero
        // PY balance so it surfaces as a CY 0 / PY <amt> breakup line.
        //
        // 2026-06-04 — keepForPy now reads from pyAmtThisLedger (which already
        // falls back from CY opening → PY-shell closing) so it ALWAYS agrees
        // with the value that ends up being assigned via unmatchedA.push().
        // Previously keepForPy checked PY-shell directly while um.pyAmt was
        // pushed from CY opening — if PY-shell had data but CY opening was 0
        // we kept the ledger but pushed pyAmt=0, producing an orphan blank-
        // amount row on SHREE HARI ("Bajaj Housing Finance Limited", "SBI
        // Car Loan") in the LT note. With the new merged source, an orphan
        // means both sources are zero → ledger skipped → no empty row.
        const keepForPy = wantsPerLedgerBreakup && Math.abs(pyAmtThisLedger) > 0.005;
        if (Math.abs(amt) < 0.005 && !keepForPy) continue;
        // Skip ledgers the user has explicitly ejected to standalone rows
        if (ejectedSet.has(row.ledger_name)) continue;
        // Note 4 fix: skip ledgers already represented by a user manual row.
        if (isClaimedByManual(row.ledger_name)) continue;

        const matchedRowId = smartMatch(row.ledger_name, smartRules, row.parent_group);

        if (matchedRowId && !wantsPerLedgerBreakup) {
          // Existing aggregate path for other Pattern A notes
          if (isLT) newCy[matchedRowId + "_lt"] = (newCy[matchedRowId + "_lt"] ?? 0) + amt;
          if (isST) newCy[matchedRowId + "_st"] = (newCy[matchedRowId + "_st"] ?? 0) + amt;
          // 2026-06-04 — PY now sums per-ledger opening balances under the
          // CURRENT classification (was: snapshot of last year's saved total
          // under last year's classification — see comment on pyAmtThisLedger).
          if (isLT) newPy[matchedRowId + "_lt"] = (newPy[matchedRowId + "_lt"] ?? 0) + Math.abs(pyAmtThisLedger);
          if (isST) newPy[matchedRowId + "_st"] = (newPy[matchedRowId + "_st"] ?? 0) + Math.abs(pyAmtThisLedger);
        } else {
          unmatchedA.push({
            // 2026-06-04 — pyAmt now sourced from THIS ledger's opening
            // balance (current classification), not last year's snapshot,
            // so per-ledger custom rows in borrowings/investments/loans_
            // advances show the correct PY column after a reclassification.
            ledger: row.ledger_name, amt, pyAmt: pyAmtThisLedger, isLT, isST,
            parentGroup: row.parent_group ?? undefined,
            ...(matchedRowId ? { smartTarget: matchedRowId } : {}),
          });
        }
      }

      // ── PY-only ledger walk (Pattern A) ─────────────────────────────────
      // ROOT-CAUSE FIX (Issue: CLOSED ledgers missing from Pattern A notes &
      // FS): the loop above only iterates CY trial-balance rows. A ledger
      // that existed only in the PRIOR year (CLOSED — closing 0 in CY, so it
      // isn't in CY TB at all) was therefore never turned into a breakup row.
      // Result: "Advance Tax - 2024-25", "TDS Reimbursement", "TDS/TCS
      // Receivable-2425" etc. showed in the Variance Drill / COA mapping but
      // vanished from the loans_advances note AND from the BS face PY column.
      // Mirror the Pattern B PY-only walk: resolve each PY-shell ledger via
      // PY-shell mapping → CY mapping → parent_group inheritance, and push a
      // breakup row with CY 0 + signed PY amount under the matched static row.
      //
      // Wrapped in try/catch so any unexpected error in this supplementary
      // walk can NEVER blank the whole note — the CY-derived rows above are
      // the authoritative content and must always survive.
      if (pyTb.length > 0) {
        try {
          const cyMappingLowerA: Record<string, { code: string }> = {};
          for (const [k, v] of Object.entries(coaMapping || {})) {
            if (v?.code) cyMappingLowerA[k.toLowerCase().trim()] = v;
          }
          const pyMappingLowerA: Record<string, { code: string }> = {};
          for (const [k, v] of Object.entries(pyCoaMap || {})) {
            if (v?.code) pyMappingLowerA[k.toLowerCase().trim()] = v;
          }
          // parent_group → FS code inheritance (precomputed once at fn scope)
          const groupToCodeA = groupToCodeGlobal;
          const cySeen = new Set(tb.map(r => r.ledger_name.toLowerCase().trim()));
          // Also skip ledgers already pushed to unmatchedA from the CY loop.
          const inUnmatched = new Set(unmatchedA.map(u => u.ledger.toLowerCase().trim()));
          for (const row of pyTb) {
            const nm = String(row.ledger_name || "").trim();
            if (!nm) continue;
            const nmLower = nm.toLowerCase();
            if (cySeen.has(nmLower) || inUnmatched.has(nmLower)) continue;
            if (ejectedSet.has(nm)) continue;
            // Note 4 fix: skip PY-only ledgers already claimed by a manual row.
            if (isClaimedByManual(nm)) continue;
            let mapped: { code: string } | undefined =
              (pyCoaMap as any)[nm] || pyMappingLowerA[nmLower] ||
              (coaMapping as any)[nm] || cyMappingLowerA[nmLower];
            if (!mapped?.code) {
              const grp = String((row as any).parent_group || "").toLowerCase().trim();
              if (grp && groupToCodeA[grp]) mapped = { code: groupToCodeA[grp] };
            }
            if (!mapped?.code) continue;
            const isLT = ltSet.has(mapped.code);
            const isST = stSet.has(mapped.code);
            if (!isLT && !isST) continue;
            const pyAmt = signedLedgerAmt(row, noteType);
            if (Math.abs(pyAmt) < 0.005) continue;
            const matchedRowId = smartMatch(nm, smartRules, row.parent_group);
            unmatchedA.push({
              ledger: nm, amt: 0, pyAmt, isLT, isST,
              parentGroup: (row as any).parent_group ?? undefined,
              ...(matchedRowId ? { smartTarget: matchedRowId } : {}),
            });
          }
        } catch (e) {
          console.warn("[nceAutoPopulate] Pattern A PY-only walk failed (non-fatal):", (e as Error)?.message);
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
          // breakup rows across years). Math.abs guard so signed-negative PY
          // values (Dr balance in a Cr-natural head, etc.) aren't discarded.
          newPy[id + "_lt"] = Math.abs(um.pyAmt) > 0.005 ? um.pyAmt : pyForCustomRow(noteType, id, label, "_lt");
        }
        if (um.isST) {
          newCy[id + "_st"] = um.amt;
          newPy[id + "_st"] = Math.abs(um.pyAmt) > 0.005 ? um.pyAmt : pyForCustomRow(noteType, id, label, "_st");
        }

        let rowSection:    string | undefined;
        let rowAttachedTo: string | undefined;
        if (noteType === "borrowings") {
          // ROOT-CAUSE FIX (Issue: "Term Loans — Banks (Unsecured)" lands on
          // Secured): when a ledger's own name or Tally parent_group EXPLICITLY
          // says "unsecured", it must NEVER be routed to a secured row — even
          // though its name also matches a secured keyword (e.g. "Term Loan
          // from Bank (Unsecured)" matches the sec_term_bank rule). Detect the
          // explicit qualifier and, if present, force the unsecured counterpart.
          const classifyTxt =
            " " + normLedger(um.ledger).trim() + " " +
            (um.parentGroup || "").toLowerCase().trim() + " ";
          const isExplicitUnsecured = /unsecured|un-secured|un secured/.test(classifyTxt);
          // Secured-row → unsecured-row counterpart map (ids from nceNotesConfig).
          const SEC_TO_UNSEC: Record<string, string> = {
            sec_term_bank:   "unsec_term_bank",
            sec_term_fi:     "unsec_term_fi",
            sec_term_others: "unsec_term_others",
            sec_demand_bank: "unsec_demand_bank",
            sec_demand_other:"unsec_demand_other",
            sec_deferred:    "unsec_deferred",
            sec_related:     "unsec_related",
            sec_other:       "unsec_other",
          };

          // Use the smart-match target if available (e.g. "unsec_related" for
          // an HUF ledger, or "sec_demand_bank" for a CC/OD bank ledger).
          // Otherwise fall back to parent_group / name heuristic.
          if (um.smartTarget) {
            rowAttachedTo = um.smartTarget;
            if (isExplicitUnsecured && rowAttachedTo.startsWith("sec_")) {
              rowAttachedTo = SEC_TO_UNSEC[rowAttachedTo] ?? "unsec_other";
            }
          } else {
            const pgLower   = (um.parentGroup || "").toLowerCase();
            const nameLower = normLedger(um.ledger);
            // Secured bank facilities (CC/OD/term loan) routed to the secured
            // demand/term rows even when smartMatch missed the exact keyword —
            // a parent_group that mentions a bank/secured facility is a strong
            // signal. This keeps "Loans on demand — Banks" populated with its
            // actual ledger breakup instead of leaving a stale aggregate.
            // Suppressed when the ledger is explicitly unsecured.
            const pgSecuredBank = !isExplicitUnsecured &&
              ["cash credit", " cc ", "overdraft", " od ", "bank od",
               "secured loan", "working capital"].some(kw => (" " + pgLower + " ").includes(kw));
            const pgRelated = ["partner", "director", "promoter", "proprietor",
              "shareholder", "relative", "family", "huf", "related"].some(kw => pgLower.includes(kw));
            const nameHuf   = nameLower.includes(" huf") || nameLower.includes("(huf)") || nameLower.includes("-huf");
            rowAttachedTo = pgSecuredBank
              ? "sec_demand_bank"
              : (pgRelated || nameHuf) ? "unsec_related" : "unsec_other";
          }
          // ROOT-CAUSE FIX: section MUST follow the attached row. Previously
          // every borrowings breakup row was hardcoded section="unsecured",
          // so a ledger correctly attached to a SECURED row (sec_demand_bank,
          // sec_term_bank, …) carried a contradictory section tag — the
          // renderer groups children by section, so the row could fail to
          // render beneath its secured parent (e.g. "Loans on demand — Banks"
          // showed a stale aggregate with no expandable per-ledger breakup).
          rowSection = rowAttachedTo.startsWith("sec_") ? "secured" : "unsecured";
        } else if (um.smartTarget && (noteType === "investments" || noteType === "loans_advances")) {
          // For investments / loans_advances Pattern A notes, attach to the
          // smart-matched static row so per-ledger breakup renders beneath it.
          rowAttachedTo = um.smartTarget;
        }

        autoRows.push({
          id, label, source: "auto",
          tbDerived: true,                       // amount comes from TB → lock from edit
          ...(rowSection    ? { section: rowSection }       : {}),
          ...(rowAttachedTo ? { attachedTo: rowAttachedTo } : {}),
        });
      }

      // Fallback: use FS-code totals
      // ISSUE 1 FIX (provisions double-count): also treat manual rows as
      // "data present" so the synthetic "Auto-filled from COA total" row
      // doesn't get appended when the user has already typed manual entries.
      // Previously the manual rows' amounts (preserved later from prev.cy)
      // PLUS the auto-total row were both summed into Total, inflating it by
      // 2× the manual amount.
      // Check BOTH cy AND py (PY-only notes were wrongly treated as empty,
      // causing the "Auto-filled from COA total" placeholder to regenerate and
      // double-count — see the Pattern B note above).
      const manualHasAmount = manualRows.some(mr =>
        Math.abs(prev.cy?.[mr.id] ?? 0) > 0.005 ||
        Math.abs(prev.cy?.[mr.id + "_lt"] ?? 0) > 0.005 ||
        Math.abs(prev.cy?.[mr.id + "_st"] ?? 0) > 0.005 ||
        Math.abs(prev.py?.[mr.id] ?? 0) > 0.005 ||
        Math.abs(prev.py?.[mr.id + "_lt"] ?? 0) > 0.005 ||
        Math.abs(prev.py?.[mr.id + "_st"] ?? 0) > 0.005,
      );
      const hasData = autoRows.length > 0
        || Object.values(newCy).some(v => Math.abs(v) > 0.005)
        || Object.values(newPy).some(v => Math.abs(v) > 0.005)
        || manualHasAmount;
      if (!hasData) {
        let ltCY = 0, ltPY = 0, stCY = 0, stPY = 0;
        for (const code of (noteFs.lt ?? [])) { ltCY += fsByCode[code]?.cy ?? 0; ltPY += fsByCode[code]?.py ?? 0; }
        for (const code of (noteFs.st ?? [])) { stCY += fsByCode[code]?.cy ?? 0; stPY += fsByCode[code]?.py ?? 0; }
        if (ltCY > 0 || stCY > 0 || ltPY > 0 || stPY > 0) {
          const id = "custom_auto_total";
          if (ltCY > 0 || ltPY > 0) { newCy[id + "_lt"] = ltCY; newPy[id + "_lt"] = ltPY; }
          if (stCY > 0 || stPY > 0) { newCy[id + "_st"] = stCY; newPy[id + "_st"] = stPY; }
          autoRows.push({ id, label: "Auto-filled from COA total", source: "auto", tbDerived: true });
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

    // STALE-MANUAL-ROW REFRESH (continued — MAHARSH INFRA fix):
    // For strictly-TB-driven Pattern B notes, after restoring manual values
    // from prev.cy/prev.py, OVERWRITE any manual row whose label matches a
    // current TB ledger with the TB's current signed amount.  This makes
    // such rows track the current Tally balance instead of holding a stale
    // value from a previous sync.  User-typed manual rows whose label does
    // NOT match any TB ledger are left untouched (preserve verbatim).
    if (tbRefreshCy || tbRefreshPy) {
      // ── BUG N3 FIX (2026-06-04) ────────────────────────────────────
      // Pre-compute the set of row IDs that have at least one customRow
      // attached to them. These are INTERMEDIATE groupings created by the
      // auditor (e.g. SHREE HARI INFRA's "A" heading under Other Payables
      // → Others, with child rows "Office No. 201", "A-0903 Dineshbhai"…).
      // Such a heading's own amount is meant to be the aggregate of its
      // descendants — NEVER a TB ledger. Zeroing it out (which the old code
      // unconditionally did when the label didn't match TB) destroyed the
      // displayed aggregate every Re-sync. From now on: any row that has
      // children attached to it is left strictly alone here. Its display
      // value is computed by the renderer's recursive sumCustomDisplayB.
      const hasChildren = new Set<string>();
      for (const cr of absorbedManualRows) {
        if (cr.attachedTo) hasChildren.add(cr.attachedTo);
      }
      // Also include auto rows from this rebuild, in case a manual was
      // moved under an auto-row in a previous sync — same protection.
      for (const cr of autoRows) {
        if (cr.attachedTo) hasChildren.add(cr.attachedTo);
      }
      let refreshedCount = 0;
      for (const mr of absorbedManualRows) {
        // Intermediate heading guard — see comment above. Skip entirely.
        if (hasChildren.has(mr.id)) continue;
        const lbl = (mr.label || "").trim().toLowerCase();
        if (!lbl) continue;
        const newCyVal = tbRefreshCy?.[lbl];
        const newPyVal = tbRefreshPy?.[lbl];
        // newCyVal===undefined means the ledger is no longer in TB at all
        // (e.g. deleted in Tally).  In that case set the row to 0 — it would
        // otherwise hold a stale value forever.  We deliberately do NOT
        // remove the row itself; the user can decide to delete it.
        if (newCyVal !== undefined) {
          if (mergedCy[mr.id] !== newCyVal) refreshedCount++;
          mergedCy[mr.id] = newCyVal;
        } else if (tbRefreshCy) {
          // Strictly-TB-driven note: ledger gone from TB → zero out
          if ((mergedCy[mr.id] ?? 0) !== 0) refreshedCount++;
          mergedCy[mr.id] = 0;
        }
        if (newPyVal !== undefined) {
          mergedPy[mr.id] = newPyVal;
        } else if (tbRefreshPy) {
          mergedPy[mr.id] = 0;
        }
      }
      if (refreshedCount > 0) {
        // Diagnostic breadcrumb in console; quiet at runtime, useful in support.
        // eslint-disable-next-line no-console
        console.log(`[nceAutoPopulate] ${noteType}: refreshed ${refreshedCount} stale manual row(s) from current TB.`);
      }
    }

    // ISSUE 1 FIX (PY value for manual rows): when a manual row's label
    // matches a TB ledger (e.g. user manually typed "Unpaid Audit Fees"
    // and a CY/PY ledger with the same name exists), inherit the PY
    // closing from PY shell TB into the manual row's PY column. Without
    // this, manual rows always showed PY = 0 even when the ledger clearly
    // existed in PY with a known closing balance — the auditor had no way
    // to see the prior-year amount short of typing it again. This bridges
    // the COA mapping's per-ledger PY into the manual rows that auditors
    // type to document explanatory line items under each Schedule III head.
    // Only fills the PY when the saved PY is zero AND a TB match exists,
    // so any user-edited PY value is preserved.
    if (pyTb.length > 0) {
      const pyByName: Record<string, number> = {};
      for (const r of pyTb) {
        const nm = String(r.ledger_name || "").trim();
        if (!nm) continue;
        pyByName[nm.toLowerCase()] = ledgerAmt(r.closing_balance);
      }
      // Detect whether this note follows Pattern A (LT/ST columns).
      const isPatternA = !noteFs.all && !!(noteFs.lt || noteFs.st);
      for (const mr of absorbedManualRows) {
        if (!mr.label) continue;
        const pyAmt = pyByName[mr.label.toLowerCase()];
        if (!pyAmt || pyAmt < 0.005) continue;
        // Decide which suffix to fill based on note shape and where the CY
        // amount lives on the manual row.
        if (isPatternA) {
          const cyLt = Math.abs(mergedCy[mr.id + "_lt"] ?? 0);
          const cyStV = Math.abs(mergedCy[mr.id + "_st"] ?? 0);
          if (cyLt > 0.005 && (mergedPy[mr.id + "_lt"] ?? 0) < 0.005) {
            mergedPy[mr.id + "_lt"] = pyAmt;
          } else if (cyStV > 0.005 && (mergedPy[mr.id + "_st"] ?? 0) < 0.005) {
            mergedPy[mr.id + "_st"] = pyAmt;
          } else if (cyLt < 0.005 && cyStV < 0.005) {
            // No CY amount yet — default to ST since the user usually fills
            // ST first for current-liability provisions.
            if ((mergedPy[mr.id + "_st"] ?? 0) < 0.005) {
              mergedPy[mr.id + "_st"] = pyAmt;
            }
          }
        } else {
          // Pattern B — single column
          if ((mergedPy[mr.id] ?? 0) < 0.005) {
            mergedPy[mr.id] = pyAmt;
          }
        }
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
    //
    // 2026-06-01 ROOT-CAUSE FIX (MAHARSH INFRA "Rates and taxes" PY stuck):
    // previously this loop ran for EVERY key in pyNotes — including static
    // row ids whose contributing ledger had been moved away via "Move to…".
    // Result: even after a Re-sync that correctly produced newCy / newPy of
    // 0 for the now-empty static row, this loop revived the prior-year PY
    // (e.g. rates_taxes PY = 39,96,555 from the year when the ledger was
    // still smart-matched there). Restrict the carry-forward to keys with
    // CURRENT-YEAR activity (key already present in newCy / newPy / mergedCy
    // / mergedPy). Static rows that have no contributing ledger this year
    // stay at 0 instead of inheriting last year's ghost.
    if (pyNotes[noteType]) {
      const isCurrentlyActive = (k: string): boolean =>
        k in newCy || k in newPy || k in mergedCy || k in mergedPy;
      for (const [k, v] of Object.entries(pyNotes[noteType])) {
        if (!(k in mergedPy) && isCurrentlyActive(k)) mergedPy[k] = Math.abs(v);
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

    // ── DUPLICATION SAFETY NET (auto-populate output) ─────────────────
    // For each static row that has both cy_sources AND a customRow attached
    // to it whose label matches one of the source ledgers, drop that ledger
    // from cy_sources and subtract its amount from cy[staticId] (+ _lt/_st).
    // Prevents the BHAKTI-style state where the renderer would otherwise
    // count the same ledger twice (once via the static aggregate, once via
    // the attached customRow). Belt-and-braces with the renderer-side
    // overlap subtract in NCEDetailedNotes.computeOverlap.
    const finalCustomRows = [...autoRows, ...absorbedManualRows];
    const cleanedSources: typeof staticSources = {};
    for (const [staticId, srcs] of Object.entries(staticSources)) {
      const childLedgerSet = new Set<string>();
      for (const cr of finalCustomRows) {
        if (cr.attachedTo !== staticId) continue;
        const lbl = (cr.label || "").trim().toLowerCase();
        const ej  = ((cr as any).ejectedSource || "").trim().toLowerCase();
        if (lbl) childLedgerSet.add(lbl);
        if (ej)  childLedgerSet.add(ej);
      }
      if (childLedgerSet.size === 0) {
        cleanedSources[staticId] = srcs;
        continue;
      }
      const remaining: typeof srcs = [];
      for (const s of srcs) {
        const lg = (s.ledger || "").trim().toLowerCase();
        if (lg && childLedgerSet.has(lg)) {
          const aCy = Number(s.amountCy || 0);
          const aPy = Number((s as any).amountPy || 0);
          mergedCy[staticId] = Math.max(0, (mergedCy[staticId] ?? 0) - aCy);
          mergedPy[staticId] = Math.max(0, (mergedPy[staticId] ?? 0) - aPy);
          if ((s as any).column === "lt") {
            mergedCy[staticId + "_lt"] = Math.max(0, (mergedCy[staticId + "_lt"] ?? 0) - aCy);
            mergedPy[staticId + "_lt"] = Math.max(0, (mergedPy[staticId + "_lt"] ?? 0) - aPy);
          }
          if ((s as any).column === "st") {
            mergedCy[staticId + "_st"] = Math.max(0, (mergedCy[staticId + "_st"] ?? 0) - aCy);
            mergedPy[staticId + "_st"] = Math.max(0, (mergedPy[staticId + "_st"] ?? 0) - aPy);
          }
          continue;
        }
        remaining.push(s);
      }
      if (remaining.length > 0) cleanedSources[staticId] = remaining;
    }

    // 2026-06-04 — Final safety net for SHREE HARI's empty-row leak.
    // For per-ledger-breakup Pattern A notes, drop any customRow whose
    // CY / PY values across BOTH _lt and _st (and the bare key) all
    // round to zero AND who has no sources[] (= isn't a smart-match
    // aggregate that intentionally shows breakup detail with zero CY).
    // This catches edge cases where an upstream path pushed an orphan
    // row despite the keep-condition checks above — the user sees
    // 'Auto' rows in the LT / ST note with both columns blank.
    //
    // Manual rows are NOT touched (auditor may have a future-fill
    // placeholder). Aggregate rows with attached children are kept too
    // (the static-row total still uses them as parents).
    let leakFreeCustomRows: NCECustomRow[] = finalCustomRows;
    if (_wantsPerLedgerBreakup) {
      const isOrphanEmpty = (cr: NCECustomRow): boolean => {
        if (cr.source !== "auto") return false;             // manual rows kept
        if ((cr.sources?.length ?? 0) > 0) return false;    // aggregates kept
        // Look for any non-zero value in cy/py for this row id (bare + suffixed).
        const anyVal = (m: Record<string, number>) =>
          Math.abs(Number(m[cr.id]        ?? 0)) > 0.005 ||
          Math.abs(Number(m[cr.id + "_lt"] ?? 0)) > 0.005 ||
          Math.abs(Number(m[cr.id + "_st"] ?? 0)) > 0.005;
        return !anyVal(mergedCy) && !anyVal(mergedPy);
      };
      const droppedIds = finalCustomRows.filter(isOrphanEmpty).map(cr => cr.id);
      if (droppedIds.length > 0) {
        leakFreeCustomRows = finalCustomRows.filter(cr => !droppedIds.includes(cr.id));
        // Also purge any orphan keys these rows might own (they should
        // already be zero, but be explicit).
        for (const id of droppedIds) {
          for (const sfx of ["", "_lt", "_st"]) {
            delete mergedCy[id + sfx];
            delete mergedPy[id + sfx];
          }
        }
        // eslint-disable-next-line no-console
        console.log(`[nceAutoPopulate] ${noteType}: dropped ${droppedIds.length} orphan empty auto row(s) (no CY / PY data).`);
      }
    }

    out[noteType] = {
      cy:         mergedCy,
      py:         mergedPy,
      customRows: leakFreeCustomRows,
      // Preserve user settings that survive re-sync
      hiddenRows:     prev.hiddenRows ?? [],
      labelOverrides: prev.labelOverrides ?? {},
      ejectedLedgers: prev.ejectedLedgers ?? [],
      ...(Object.keys(cleanedSources).length > 0 ? { cy_sources: cleanedSources } : {}),
    };
  }

  return out;
}
