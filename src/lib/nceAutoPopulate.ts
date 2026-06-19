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
// 2026-06-05 Phase 3 — every getNCENoteFaceTotal call now reads from the
// canonical computeNoteTotals helper instead of its own leaf-sum algorithm.
// NOTES_CONFIG is needed to resolve note_type → NoteConfig at call time.
import { NOTES_CONFIG } from "@/config/nceNotesConfig";
import { computeNoteTotals } from "@/lib/nceNoteTotals";
import { buildNoteFsMap } from "@/lib/nceNoteRegistry";

// ── FS-code map ──────────────────────────────────────────────────────────────
//
// Each note type maps to the set of FS codes that belong to it.
// We include BOTH the NCE-specific codes (NCE_*) and the generic corporate
// codes (BS_*/PL_*) because the COA mapping can use either depending on how
// ledgers were auto-assigned or manually mapped.

// Phase 6 — DERIVED from the single-source nceNoteRegistry (was a hand-literal).
// The registry carries the same note→codes wiring incl. the corporate / INV
// twins (BS_CL_TP_MSME, BS_CA_CI, INV_*, …). NCE_DEPR / PL_EXP_DEP are
// intentionally still absent (depreciation is a standalone P&L line; including
// it would double-count). The parity test asserts buildNoteFsMap() reproduces
// the old literal byte-for-byte.
export const NCE_NOTE_FS_MAP: Record<string, {
  lt?:  string[];
  st?:  string[];
  all?: string[];
}> = buildNoteFsMap();


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
  /** When true, the user explicitly moved this row via "Move to…" or
   *  ejected it to a specific heading. Rows with this flag are NEVER
   *  purged by the per-ledger-breakup stale-artifact cleanup in
   *  nceAutoPopulate — they represent intentional user placements. */
  userMoved?: boolean;
}

export type NceEditCol = "lt" | "st";

/**
 * A single auditor edit, recorded so a fresh rebuild from TB + COA can re-apply
 * the auditor's intent (mirrors Corporate's `manual_edits[]`, but typed and
 * structural — NCE edits include custom rows, hides, moves and reclasses, not
 * just leaf-value overrides).
 *
 * Phase 1 (FS re-architecture). This ledger is PERSISTED (dual-written alongside
 * the legacy metadata channels) as the foundation; the build-then-overlay engine
 * that CONSUMES it to drive re-sync lands behind a flag in a later step. Contract
 * notes (from the design review — get these wrong and the BS silently mis-states):
 *   • `cy`/`py` figures are SIGNED post-edit values copied verbatim from the
 *     numeric maps — NEVER Math.abs (opposite-side ledgers store negatives).
 *   • a `custom` edit carries `keys` — the exact populated numeric-key topology
 *     (bare / `_lt` / `_st`) with each key's cy/py — so Pattern-A rows round-trip
 *     byte-stable instead of collapsing to a single column.
 *   • every variant carries `noteType` so dedupe/lookup keys are globally unique
 *     (custom row ids are only unique within a note).
 *   • a TB-derived/ejected `custom` edit carries `ledgerRef` so the overlay can
 *     RE-SOURCE the figure from current TB rather than replay a frozen snapshot.
 */
export type NceEdit =
  | { kind: "value";   noteType: string; rowId: string; col?: NceEditCol; cy?: number; py?: number }
  | { kind: "label";   noteType: string; rowId: string; ledger?: string; text: string }
  | { kind: "hide";    noteType: string; rowId: string }
  | { kind: "move";    noteType: string; rowId: string; attachedTo?: string; section?: string }
  | { kind: "reclass"; noteType: string; ledger: string; toNote?: string; ejectFrom?: string }
  | {
      kind: "custom"; noteType: string; rowId: string;
      label?: string; section?: string; attachedTo?: string;
      tbDerived?: boolean; userMoved?: boolean;
      ledgerRef?: string; ejectedSource?: string;
      /** Exact populated numeric keys for this row (bare / `_lt` / `_st`) with
       *  their SIGNED cy/py values — preserves Pattern-A column topology. */
      keys: Record<string, { cy?: number; py?: number }>;
    };

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
  /** Phase 1 — unified edit-ledger. Persisted as cy_data._manual_edits and
   *  dual-written alongside the legacy channels above for one release.
   *  deserialiseNoteData always returns this (defaulting to []); other
   *  constructors may omit it. Optional so the ~40 existing NCENoteData literals
   *  don't all have to set it. */
  manualEdits?: NceEdit[];
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
export function deriveBaseHead(name: string): string {
  return name
    .trim()
    // strip parenthetical disambiguators e.g. "(Survey No. 1166)", "(Branch X)"
    .replace(/\s*\([^)]*\).*$/, "")
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

/** Strict near-duplicate collapse for custom rows.
 *
 *  ROOT CAUSE (DBS REALTY, June 2026): a COA re-sync produced, for the same
 *  ledger, BOTH a full-label row ("Aluminium Section Purchase - 18%") and a
 *  base-head row ("Aluminium Section Purchase"). The dedup heal + export + face
 *  total all keyed on the EXACT label, so the two were never recognised as the
 *  same line item → both rendered AND both summed → the note total double-counted.
 *
 *  Two rows are collapsed ONLY when ALL of these match:
 *    • the makeCustomId SLUG BASE (the id with its trailing "_<idx>" stripped) —
 *      this is derived from the SOURCE LEDGER NAME, so "X - 18%" duplicated as
 *      "X" share it ("custom_x_18__0" / "custom_x_18__1"), while genuinely
 *      different ledgers ("Cement - 18%" vs "Cement - 28%" →
 *      "custom_cement_18_" vs "custom_cement_28_") do NOT
 *    • attachedTo parent + section tag
 *    • the per-column CY signature AND per-column PY signature (bare / _lt / _st)
 *  Keying on the id slug (not the label base head) avoids ever merging two
 *  distinct ledgers that happen to share a base head and amount; the identical-
 *  amount guard is a second safety net. The longest (most descriptive) label is
 *  kept. Returns the kept rows + the dropped ids so callers can also strip the
 *  dropped ids' amounts from their numeric maps. */
export function collapseDuplicateCustomRows<
  T extends { id: string; label?: string; attachedTo?: string; section?: string },
>(
  rows: T[],
  cy: Record<string, number>,
  py: Record<string, number>,
): { rows: T[]; droppedIds: string[] } {
  const sig = (m: Record<string, number>, id: string) =>
    `${Math.round(Number(m[id] ?? 0))}_${Math.round(Number(m[id + "_lt"] ?? 0))}_${Math.round(Number(m[id + "_st"] ?? 0))}`;
  // Strip the trailing "_<idx>" that makeCustomId appends, leaving the slug that
  // encodes the source ledger name. Hand-typed rows (newCustomId → random) have
  // no shared slug, so they never collapse against each other.
  const slugBase = (id: string) => String(id).replace(/_\d+$/, "");
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k =
      slugBase(r.id) +
      "|" + (r.attachedTo ?? "") +
      "|" + (r.section ?? "") +
      "|" + sig(cy, r.id) +
      "|" + sig(py, r.id);
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const kept: T[] = [];
  const droppedIds: string[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { kept.push(g[0]); continue; }
    // Keep the longest (most descriptive) label, e.g. "X - 18%" over "X".
    g.sort((a, b) => String(b.label ?? "").trim().length - String(a.label ?? "").trim().length);
    kept.push(g[0]);
    for (const d of g.slice(1)) droppedIds.push(d.id);
  }
  return { rows: kept, droppedIds };
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
 *  note total); assets and expenses are DR-natural.
 *
 *  2026-06-05 Phase 1 of the FS Re-Architecture: the canonical definition now
 *  lives in src/lib/fsSignConvention.ts and is re-exported here so existing
 *  imports keep working. Any new sign-derivation callsite must call
 *  signedBalance / signedOpening from that module — NEVER inline
 *  `balance_type === "DR" ? ... : ...`. */
export { NOTE_NATURE } from "@/lib/fsSignConvention";
import { signedBalance, signedOpening } from "@/lib/fsSignConvention";
import { NCE_SIGNED_NOTE_AMOUNTS } from "@/lib/nceFeatureFlags";

/** Signed amount of a TB ledger when contributing to a note total — thin
 *  adapter that defers to the shared fsSignConvention module so every
 *  caller everywhere in the codebase gets the same sign rule. See
 *  fsSignConvention.signedBalance for the full convention. */
function signedLedgerAmt(
  row: { closing_balance: number; balance_type: string },
  noteType: string,
): number {
  return signedBalance(row.closing_balance, row.balance_type, noteType);
}

/** BUG 1 (sign) choke-point. The ONE converter every TB→note-amount writer
 *  should call. When NCE_SIGNED_NOTE_AMOUNTS is ON it returns the head-signed
 *  amount (a contra DEDUCTS); when OFF it returns the legacy magnitude
 *  (ledgerAmt = Math.abs), so the default build is byte-identical to pre-fix.
 *  `signed` is overridable for unit tests. Exported for testing. */
export function noteAmt(
  row: { closing_balance: number; balance_type: string },
  noteType: string,
  signed: boolean = NCE_SIGNED_NOTE_AMOUNTS,
): number {
  return signed ? signedLedgerAmt(row, noteType) : ledgerAmt(row.closing_balance);
}

/** Signed PY (= opening balance) — adapter that defers to the shared
 *  fsSignConvention.signedOpening so PY column math matches the CY column
 *  exactly under the current head's nature. */
function signedLedgerOpeningAmt(
  row: { opening_balance?: number | null; opening_type?: string | null },
  noteType: string,
): number {
  return signedOpening(row.opening_balance, row.opening_type, noteType);
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
export const NCE_CODE_TO_NOTE: Record<string, { note: string; col?: "lt" | "st"; config?: string }> = {
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
  NCE_COGS:    { note: "cogs", config: "cogs_a" },
  NCE_CII:     { note: "cogs", config: "cogs_c" },
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
  noteRow: { cy_data?: Record<string, any> | null; py_data?: Record<string, any> | null; note_type?: string } | undefined | null,
  column: "cy" | "py",
  pattern?: "A" | "B",
  patternCol?: "lt" | "st",
  configNoteType?: string,
): number | null {
  if (!noteRow) return null;
  // 2026-06-05 Phase 3 — delegated to the canonical computeNoteTotals helper
  // so the BS / P&L face reads the SAME number as the Notes Total row, the
  // renderer per-row aggregate, and the DOCX export. Algorithm: walk the
  // note's config formula DAG (matches what auditors see at "Note Total"
  // and what the auto-populate writes back into cy_data when it runs
  // computeDisplayData under the hood).
  //
  // SCHEMA QUIRK / SHREE HARI ROOT CAUSE FIX (2026-06-05):
  // `_custom_rows` (with its `sources[]` sub-ledger arrays) is persisted
  // ONLY on cy_data. py_data carries the per-id PY numeric values but NOT
  // the customRow metadata. Reading `py_data._custom_rows` returns an empty
  // array — which means a PY column query previously saw NO customRows,
  // counted NO sources, and silently under-reported the BS PY face by
  // crores of rupees (SHREE HARI INFRA: ₹55.67 cr missing across A/B/C/D/E
  // heading rows). Always pull the customRow list from cy_data; the value
  // matrices for the formula DAG come from cy_data + py_data respectively.
  const cyData = noteRow.cy_data ?? {};
  const pyData = noteRow.py_data ?? {};
  if (!cyData || typeof cyData !== "object") return null;
  if (!pyData || typeof pyData !== "object") return null;
  const customRows: Array<{ id: string; label?: string; section?: string; attachedTo?: string; sources?: Array<{ ledger?: string; amountCy?: number; amountPy?: number; column?: "lt" | "st" }> }> =
    Array.isArray((cyData as any)._custom_rows) ? (cyData as any)._custom_rows : [];

  // Strip meta keys → pure numeric maps per column.
  // 2026-06-12 — numeric STRINGS are coerced instead of dropped (latent-RC
  // audit). A value saved as "45000" (legacy save / SQL data fix) was
  // silently excluded from the face while the renderer's Number() coercion
  // still displayed it — Note Total ≠ Face with no visible cause. Strings
  // that don't parse cleanly are still skipped.
  const coerce = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const numericCy: Record<string, number> = {};
  for (const [k, v] of Object.entries(cyData)) {
    if (META_KEYS.has(k)) continue;
    const n = coerce(v);
    if (n !== null) numericCy[k] = n;
  }
  const numericPy: Record<string, number> = {};
  for (const [k, v] of Object.entries(pyData)) {
    if (META_KEYS.has(k)) continue;
    const n = coerce(v);
    if (n !== null) numericPy[k] = n;
  }

  // Resolve the NoteConfig. The note_type stored on noteRow is keyed by
  // the underlying NCE storage record (e.g. "borrowings" — Pattern A
  // data with _lt/_st suffixed keys), but there is NO NoteConfig with
  // noteType "borrowings" — only the split views "borrowings_lt" and
  // "borrowings_st", both Pattern B. For Pattern A face queries we
  // borrow the row list from a split view and override pattern → "A"
  // so computeNoteTotals walks the LT/ST formula correctly. Likewise
  // for "provisions" and "loans_advances".
  // When configNoteType is provided (e.g. "cogs_a" for the materials-consumed
  // sub-section of the combined "cogs" note), look up that sub-config instead
  // of the storage note_type. This lets the P&L face read section-specific
  // totals from a multi-section note stored in a single DB row.
  const nt = configNoteType || noteRow.note_type;
  let cfg: NoteConfig | undefined;
  if (pattern === "A" && patternCol) {
    const splitCfg =
      NOTES_CONFIG.find(c => c.noteType === nt + "_lt") ??
      NOTES_CONFIG.find(c => c.noteType === nt + "_st") ??
      // already a split view name
      NOTES_CONFIG.find(c => c.noteType === nt);
    if (splitCfg) cfg = { ...splitCfg, pattern: "A" } as NoteConfig;
  } else {
    cfg = NOTES_CONFIG.find(c => c.noteType === nt);
  }
  if (!cfg) return null;

  // Collapse re-sync near-duplicates (full-label "X - 18%" + base-head "X" of
  // the SAME ledger, same parent, same amount) so the face / reconciliation
  // total can never double-count them. Strict amount match → genuinely distinct
  // rows are never merged. Also strip the dropped ids from the numeric maps so
  // computeNoteTotals does not sum the removed copy.
  const { rows: dedupedCustomRows, droppedIds: dupDroppedIds } =
    collapseDuplicateCustomRows(customRows, numericCy, numericPy);
  for (const id of dupDroppedIds) {
    for (const sfx of ["", "_lt", "_st"]) { delete numericCy[id + sfx]; delete numericPy[id + sfx]; }
  }
  const totals = computeNoteTotals(cfg, numericCy, numericPy, dedupedCustomRows);

  if (totals.pattern === "A") {
    const col: "lt" | "st" = patternCol ?? "lt";
    const gt = totals.grandTotal;
    const v = column === "cy"
      ? (col === "lt" ? gt.ltCy : gt.stCy)
      : (col === "lt" ? gt.ltPy : gt.stPy);
    if (v === 0 && !hasAnyNonZero(totals.perRow)) return null;
    return Math.round(v * 100) / 100;
  }
  // Pattern B
  const v = column === "cy" ? totals.grandTotal.cy : totals.grandTotal.py;
  if (v === 0 && !hasAnyNonZero(totals.perRow)) return null;
  return Math.round(v * 100) / 100;
}

/** Small helper used by getNCENoteFaceTotal to distinguish a true "no data"
 *  state (return null, matches legacy behaviour) from a computed zero
 *  (return 0). Any non-zero per-row value flips it. */
function hasAnyNonZero(perRow: Record<string, { cy?: number; py?: number; ltCy?: number; ltPy?: number; stCy?: number; stPy?: number }>): boolean {
  for (const v of Object.values(perRow)) {
    if (Math.abs(Number(v.cy   ?? 0)) > 0.005) return true;
    if (Math.abs(Number(v.py   ?? 0)) > 0.005) return true;
    if (Math.abs(Number(v.ltCy ?? 0)) > 0.005) return true;
    if (Math.abs(Number(v.ltPy ?? 0)) > 0.005) return true;
    if (Math.abs(Number(v.stCy ?? 0)) > 0.005) return true;
    if (Math.abs(Number(v.stPy ?? 0)) > 0.005) return true;
  }
  return false;
}

// ── Serialise / deserialise ───────────────────────────────────────────────────

// Reserved keys used as JSONB metadata inside cy_data — must be filtered out
// when reading numeric values back into the cy/py maps.
// NCE Task 7: added _source_label_overrides so user-edited source sub-ledger labels
// survive page reload (previously this field was in NCENoteData but never persisted).
const META_KEYS = new Set(["_custom_rows", "_hidden_rows", "_label_overrides", "_cy_sources", "_ejected_ledgers", "_source_label_overrides", "_manual_edits"]);

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

  // Phase 1 — unified edit-ledger. Read it back verbatim if present; default to
  // []. (No legacy-channel fold yet — that synthesis lands with the consuming
  // build-then-overlay engine so it can be validated against its actual reader.)
  const manualEdits: NceEdit[] = Array.isArray(rawCy._manual_edits)
    ? (rawCy._manual_edits as NceEdit[])
    : [];

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
  return { cy, py, customRows, hiddenRows, labelOverrides, cy_sources, ejectedLedgers, sourceLabelOverrides, manualEdits };
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
      // Phase 1 — dual-write the edit-ledger. Conditional emit (like the two
      // channels above) keeps the round-trip a fixed point: absent -> [] on
      // read -> omitted on write -> absent. Legacy channels above are passed
      // through verbatim (NOT re-derived) so an older build reads byte-identical.
      ...(d.manualEdits && d.manualEdits.length > 0
        ? { _manual_edits: d.manualEdits }
        : {}),
    },
    py_data: d.py,
  };
}

// ─── Phase 1: edit-ledger mutation + overlay helpers ─────────────────────────
//
// These power the build-then-overlay re-sync model. nceAutoPopulate (later,
// behind a flag) will produce a PURE auto layer from TB+COA, then
// respectNceManualEdits replays the auditor's edit-ledger on top — so re-sync
// reclassifies ledgers (incl. LT↔ST from a COA mapping change) WITHOUT discarding
// manual edits. Pure + side-effect-free; exported for unit tests and the upcoming
// engine wiring (NOT yet on the live path).

/** Stable dedupe/lookup key for an edit (kind + note + target + column).
 *  Includes noteType so colliding custom-row ids across notes never collide. */
function nceEditKey(e: NceEdit): string {
  switch (e.kind) {
    case "reclass": return `reclass|${e.noteType}|${e.ledger}`;
    case "value":   return `value|${e.noteType}|${e.rowId}|${e.col ?? "all"}`;
    case "label":   return `label|${e.noteType}|${e.rowId}|${e.ledger ?? ""}`;
    default:        return `${e.kind}|${e.noteType}|${e.rowId}`;
  }
}

/** Add an edit, replacing any existing edit with the same key (last-write-wins).
 *  Returns a NEW array. */
export function addNceEdit(edits: NceEdit[] | undefined, edit: NceEdit): NceEdit[] {
  const k = nceEditKey(edit);
  const out = (edits ?? []).filter(e => nceEditKey(e) !== k);
  out.push(edit);
  return out;
}

/** Remove every edit matching the predicate. Returns a NEW array. */
export function removeNceEdit(edits: NceEdit[] | undefined, pred: (e: NceEdit) => boolean): NceEdit[] {
  return (edits ?? []).filter(e => !pred(e));
}

/** Find the first edit matching the predicate. */
export function findNceEdit(edits: NceEdit[] | undefined, pred: (e: NceEdit) => boolean): NceEdit | undefined {
  return (edits ?? []).find(pred);
}

const uniqPush = (arr: string[] | undefined, v: string): string[] => {
  const s = new Set(arr ?? []); s.add(v); return [...s];
};

/** Apply ONE edit to a single note (mutates `note`). `customById` indexes the
 *  note's current custom rows. */
function applyNceEditTo(
  note: NCENoteData,
  e: NceEdit,
  customById: Map<string, NCECustomRow>,
): void {
  switch (e.kind) {
    case "hide":
      note.hiddenRows = uniqPush(note.hiddenRows, e.rowId);
      return;
    case "label":
      if (e.ledger) {
        note.sourceLabelOverrides = { ...(note.sourceLabelOverrides ?? {}), [`${e.rowId}::${e.ledger}`]: e.text };
      } else {
        note.labelOverrides = { ...(note.labelOverrides ?? {}), [e.rowId]: e.text };
      }
      return;
    case "move": {
      const row = customById.get(e.rowId);
      if (!row) return;
      if (e.attachedTo !== undefined) row.attachedTo = e.attachedTo;
      if (e.section !== undefined) row.section = e.section;
      row.userMoved = true;
      return;
    }
    case "reclass":
      note.ejectedLedgers = uniqPush(note.ejectedLedgers, e.ledger);
      return;
    case "value": {
      // KEY-SPECIFIC GATE: only override a numeric key the fresh build actually
      // produced. After a COA LT↔ST reclassification the build writes the new
      // column key (e.g. `${id}_st`) and omits the old one (`${id}_lt`); gating
      // on the exact key means a stale LT edit can NOT resurrect the old column
      // — the exact ST↔LT corruption this guard exists to prevent.
      const key = e.col ? `${e.rowId}_${e.col}` : e.rowId;
      if (!(key in note.cy) && !(key in note.py)) return;
      if (e.cy !== undefined) note.cy[key] = e.cy;   // SIGNED verbatim (never Math.abs)
      if (e.py !== undefined) note.py[key] = e.py;
      return;
    }
    case "custom": {
      if (customById.has(e.rowId)) return;     // already produced by the build
      if (e.tbDerived || e.ledgerRef) return;  // TB-sourced rows are the build's job
      const row: NCECustomRow = {
        id: e.rowId, label: e.label ?? "", source: "manual",
        ...(e.section ? { section: e.section } : {}),
        ...(e.attachedTo ? { attachedTo: e.attachedTo } : {}),
      };
      note.customRows.push(row);
      customById.set(e.rowId, row);
      for (const [k, v] of Object.entries(e.keys ?? {})) {
        if (v.cy !== undefined) note.cy[k] = v.cy;   // signed verbatim
        if (v.py !== undefined) note.py[k] = v.py;
      }
      return;
    }
  }
}

/** Overlay one note's edit-ledger onto its freshly-built auto layer. */
function overlayNoteEdits(noteType: string, autoNote: NCENoteData, edits: NceEdit[]): NCENoteData {
  const note: NCENoteData = JSON.parse(JSON.stringify(autoNote));
  note.manualEdits = [...edits];
  const customById = new Map<string, NCECustomRow>(note.customRows.map(r => [r.id, r]));
  for (const e of edits) {
    if (e.noteType !== noteType) continue;
    applyNceEditTo(note, e, customById);
  }
  return note;
}

/**
 * Build-then-overlay re-sync: replay each note's edit-ledger (carried on the
 * EXISTING saved notes) onto the freshly rebuilt `auto` layer. The auto layer is
 * the authority for TB-derived figures and classification (so a COA LT↔ST change
 * flows straight through), and the ledger restores only the auditor's manual
 * intent. Mirrors Corporate's respectManualEdits but for the structural NCE
 * model. PURE — returns a new map, never mutates inputs.
 */
export function respectNceManualEdits(
  auto: Record<string, NCENoteData>,
  existing: Record<string, NCENoteData>,
): Record<string, NCENoteData> {
  const out: Record<string, NCENoteData> = {};
  for (const [noteType, autoNote] of Object.entries(auto)) {
    out[noteType] = overlayNoteEdits(noteType, autoNote, existing[noteType]?.manualEdits ?? []);
  }
  return out;
}

export interface ResyncNoteDiff {
  noteType: string;
  /** Per-key CY changes. Covers LT↔ST moves: a reclassification shows BOTH
   *  `${id}_lt` (dropping) and `${id}_st` (rising). */
  changes: { key: string; oldCy: number; newCy: number }[];
}

/**
 * Dry-run diff for the safe Re-sync: per note, which CY numeric keys would change
 * if the freshly rebuilt notes replaced the current ones. Powers the pre-write
 * confirmation so the auditor sees every change — including an LT↔ST
 * reclassification — before anything is saved. Pure.
 */
export function computeResyncDiff(
  oldData: Record<string, NCENoteData>,
  newData: Record<string, NCENoteData>,
  tol = 0.5,
): ResyncNoteDiff[] {
  const out: ResyncNoteDiff[] = [];
  const noteTypes = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  for (const nt of [...noteTypes].sort()) {
    const o = oldData[nt]?.cy ?? {};
    const n = newData[nt]?.cy ?? {};
    const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
    const changes: { key: string; oldCy: number; newCy: number }[] = [];
    for (const k of keys) {
      const ov = Number(o[k] ?? 0), nv = Number(n[k] ?? 0);
      if (Math.abs(ov - nv) > tol) changes.push({ key: k, oldCy: ov, newCy: nv });
    }
    if (changes.length) out.push({ noteType: nt, changes });
  }
  return out;
}

/**
 * Whether a prior MANUAL row survives the stale-ledger purge on re-sync.
 * Pure + exported for testing.
 *
 *   - `currentCode` = the row's underlying ledger's CURRENT CY COA code, or
 *     undefined when the row's label matches no TB ledger (auditor-typed text).
 *   - `ourCodes`    = the FS codes THIS note owns.
 *
 * Order matters — CROSS-NOTE RE-MAP WINS: if the ledger is now mapped to a code
 * this note does NOT own, the row is dropped even when `userMoved` is set, so a
 * COA re-map (e.g. moving a ledger from Short-Term Loans → Other Current Assets)
 * removes it from the OLD note instead of leaving it duplicated in both
 * (WASTIK BUILDCON). `userMoved` only protects an INTRA-note placement.
 */
export function keepManualRowOnResync(args: {
  hasLabel:           boolean;
  currentCode:        string | undefined;
  ourCodes:           Set<string>;
  userMoved:          boolean;
  isPerLedgerBreakup: boolean;
}): boolean {
  const { hasLabel, currentCode, ourCodes, userMoved, isPerLedgerBreakup } = args;
  if (!hasLabel) return true;                 // unlabeled row → keep
  if (!currentCode) return true;              // user-typed (no TB match) → keep
  if (!ourCodes.has(currentCode)) return false; // mapped to a DIFFERENT note → drop
  if (userMoved) return true;                 // still ours + user-placed → keep placement
  if (isPerLedgerBreakup) return false;       // breakup note → rebuild from auto
  return true;                                // still ours → keep
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
  // RC1 fix: hoisted here so both Pattern-A and Pattern-B Stage 2 fallback
  // blocks can reference it without re-declaring inside each block scope.
  const coaHasEntries = Object.keys(coaMapping).length > 0;
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
  // 2026-06-08 FIX: PostgREST default limit is 1000 rows. SHRI RAM PRODUCTS
  // has 1229 TB rows — the old single query silently truncated at 1000,
  // dropping ledgers like "Web Developing Fees Exp" (₹1,84,000) that
  // appeared after the 1000th row. Paginate to fetch ALL rows.
  const TB_COLS = "ledger_name, closing_balance, balance_type, opening_balance, opening_type, parent_group";
  const TB_PAGE = 1000;
  const tbRows: any[] = [];
  for (let from = 0; ; from += TB_PAGE) {
    const { data, error } = await supabase
      .from("tally_trial_balance")
      .select(TB_COLS)
      .eq("engagement_id", engagementId)
      .range(from, from + TB_PAGE - 1);
    if (error || !data || data.length === 0) break;
    tbRows.push(...data);
    if (data.length < TB_PAGE) break;
  }

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
                const amt = noteAmt(row, nType);
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
                const amt = noteAmt(row, nType);
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
    // ─── PHASE 7 INSTRUMENTATION (REMOVE AFTER SHREE HARI DIAGNOSIS) ───
    // Traces the in-app sign override path on SHREE HARI's other_cl
    // "Member Sales (Pos)" specifically. Fires for any engagement that
    // has a customRow whose label matches /member sales/i in other_cl.
    // The user provides browser console output; we identify the
    // overriding line; we remove this instrumentation.
    // BUG-116: SIGN-TRACE diagnostic instrumentation disabled (was: noteType === "other_cl").
    // Left inert (flag OFF) rather than ripped out, since _msLog is threaded through WP2-WP4.
    const _msTraceOn = false;
    let _msId: string | null = null;
    if (_msTraceOn) {
      const ms = (prev.customRows || []).find(r => /member sales/i.test(r.label || ""));
      _msId = ms ? ms.id : null;
      if (_msId) {
        // eslint-disable-next-line no-console
        console.log(`[SIGN-TRACE] WP1  found Member Sales row  id=${_msId}  prev.cy[id]=${prev.cy?.[_msId]}  prev.py[id]=${prev.py?.[_msId]}  source=${ms?.source}  attachedTo=${ms?.attachedTo}  tbDerived=${(ms as any)?.tbDerived}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[SIGN-TRACE] WP1  no Member Sales customRow in other_cl prev (customRowCount=${(prev.customRows || []).length})`);
      }
    }
    const _msLog = (where: string, extras?: Record<string, unknown>) => {
      if (!_msTraceOn || !_msId) return;
      const e = extras ? Object.entries(extras).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("  ") : "";
      // eslint-disable-next-line no-console
      console.log(`[SIGN-TRACE] ${where}  ${e}`);
    };
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

    // 2026-06-04 — STALE-LEDGER PURGE (universal, Pattern A + Pattern B).
    //
    // SKYLARK CORPORATION (5th report continuation): when a ledger is re-mapped
    // in COA from one note to another (e.g. "Input CGST" / "Input SGST" moved
    // from NCE_OCL → NCE_OCA), the NEW note picks it up via auto-populate, but
    // the OLD note's customRow — which had been promoted to source: "manual"
    // by an earlier self-heal or user touch — survived every Re-sync as an
    // empty-amount ghost row attached to its original parent ("Other payables
    // — Others" under Note 8 in SKYLARK). The earlier Pattern-A-only purge at
    // this site (borrowings / investments / loans_advances) protected those
    // notes but left every Pattern B note (other_cl, other_ca, trade_payables,
    // cash_bank, …) vulnerable.
    //
    // Earlier failure modes this also still covers:
    //   (a) DHANANI REALTY — same note, ledger flipped between NCE_STB and
    //       NCE_LTB. New code = current mapping; if it's in our codes we keep
    //       the row (the LT/ST suffix is rebuilt downstream).
    //   (b) SHREE HARI INFRA — HUF loan re-mapped from NCE_LTB to NCE_CAP /
    //       NCE_STLA. New code is NOT in borrowings' codes → drop.
    //   (c) SKYLARK CORPORATION — Pattern B, NCE_OCL → NCE_OCA. New code is
    //       NOT in other_cl's codes → drop.
    //
    // Rule: drop any manual row whose label matches a TB ledger that is
    // CURRENTLY mapped to a code THIS NOTE DOES NOT OWN. This is stricter
    // (= safer) than the previous "drop if matches any TB ledger" rule —
    // a manual row whose label coincides with a TB ledger still mapped to
    // THIS note is preserved (the user may have intentionally typed it,
    // and the existing silent-absorb / overlap-subtract paths will dedupe
    // it against the auto row downstream).
    //
    // Manual rows whose label does NOT match any TB ledger (auditor-typed
    // text rows like "Unpaid audit fees", HUF loans without a Tally ledger,
    // etc.) are kept unchanged.
    if (tb.length > 0 || pyTb.length > 0) {
      const ourCodes = new Set<string>([
        ...(noteFs.all ?? []),
        ...(noteFs.lt  ?? []),
        ...(noteFs.st  ?? []),
      ]);
      // Build label → current mapping code for every TB ledger that has a
      // mapping. Ledgers with no mapping fall through (no entry in the map).
      //
      // OM REALTY (round 3) fix: also include PY-shell TB ledger names. Without
      // this, manual rows tied to a ledger that ONLY appears in the prior-year
      // TB (e.g. AU Small Finance Bank Ltd (OD A/c) — a loan that was settled
      // in CY so the ledger is closed / absent from the CY TB) could never be
      // detected as "moved to a different note". The auditor moved that ledger
      // to NCE_LTB in CY coa_mapping, but the original NCE_STB manual row kept
      // injecting ₹8,04,44,734 into the Short-Term Borrowings note's PY total
      // — and therefore into the BS PY face — because the existing purge only
      // scanned CY TB labels. Adding PY-shell labels (mapped via the same CY
      // coa_mapping that drives the FS face) closes the loop so the note
      // breakup ALWAYS matches what COA Mapping says, on every Re-sync. PY-
      // shell coa_mapping is used as a fallback only when CY mapping is silent
      // for that exact ledger string, mirroring the auto-row classification
      // logic above.
      const tbCodeByLabel = new Map<string, string>();
      for (const row of tb) {
        const nm = (row.ledger_name || "").trim().toLowerCase();
        if (!nm) continue;
        const mapped = coaMapping[row.ledger_name];
        if (mapped?.code) tbCodeByLabel.set(nm, mapped.code);
      }
      for (const row of pyTb) {
        const nm = (row.ledger_name || "").trim().toLowerCase();
        if (!nm) continue;
        // Prefer CY coa_mapping (the FS face authority); fall back to the PY
        // shell's mapping only when CY mapping has no entry for this exact
        // ledger string. Don't clobber an existing CY-derived classification.
        if (tbCodeByLabel.has(nm)) continue;
        const mapped = coaMapping[row.ledger_name] ?? pyCoaMap[row.ledger_name];
        if (mapped?.code) tbCodeByLabel.set(nm, mapped.code);
      }
      // SHREE HARI INFRA root cause (Loans on demand — Banks PY ghosted at
      // Rs.87.48 cr): for per-ledger-breakup Pattern A notes — borrowings,
      // investments, loans_advances — an older buggy version of this code
      // attached HUF / partner-loan ledgers to the WRONG static parent
      // (sec_demand_bank instead of unsec_related) before the
      // isExplicitUnsecured guard was tightened. The self-heal promoted those
      // wrongly-parented autoRows to source: "manual" to preserve placement,
      // and every Re-sync since then has KEPT them because the stricter rule
      // ("drop only when ledger moved to a different note") sees that the
      // ledger is still mapped to NCE_LTB and lets the manual row survive.
      // Meanwhile the auto loop's isClaimedByManual() short-circuit skips
      // re-creating the same ledger with the now-correct attachedTo, so the
      // wrong-parent row sticks forever.
      //
      // For these per-ledger-breakup notes the auto loop is the
      // authoritative source of truth: every TB ledger mapped to one of this
      // note's codes BECOMES a customRow with current-heuristic attachedTo.
      // Manual rows whose label matches a TB ledger are by definition
      // redundant — the auto path will rebuild them cleanly with the right
      // parent. So drop them aggressively. User-typed rows without any TB
      // match (e.g. a manually typed HUF loan with no Tally ledger of that
      // name) are kept untouched. Pattern B notes and non-breakup Pattern A
      // notes use the stricter rule below.
      const isPerLedgerBreakup =
        noteType === "borrowings" ||
        noteType === "investments" ||
        noteType === "loans_advances";
      if (tbCodeByLabel.size > 0) {
        const before = manualRows.length;
        manualRows = manualRows.filter(mr => keepManualRowOnResync({
          hasLabel: !!(mr.label || "").trim(),
          currentCode: tbCodeByLabel.get((mr.label || "").trim().toLowerCase()),
          ourCodes,
          userMoved: mr.userMoved === true,
          isPerLedgerBreakup,
        }));
        const dropped = before - manualRows.length;
        if (dropped > 0) {
          // eslint-disable-next-line no-console
          console.log(`[nceAutoPopulate] ${noteType}: purged ${dropped} stale manual row(s) (${isPerLedgerBreakup ? "per-ledger-breakup: rebuilding from auto" : "ledger moved to a different note"}).`);
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
    // ─── WP2  manualRows after dedup + broader purge ───
    _msLog("WP2  manualRows after dedup+purge", {
      msInManualRows: manualRows.some(r => r.id === _msId),
      manualRowsCount: manualRows.length,
    });
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

      // DOUBLE-COUNT FIX: accumulate PY per-ledger from TB rather than
      // initialising from pyNotes bulk value. Previously the CY walk set
      // newPy[matchedRowId] = pyNotes aggregate (prior year total), then the
      // PY-only walk ADDED each individual PY-only ledger on top — causing
      // any ledger already included in pyNotes to be counted twice. The
      // result was that "Balance in current account" PY = 1,08,024 while
      // only HDFC Bank (54,012) was visible as a child row.
      //
      // New approach: newPy[matchedRowId] starts at 0 and accumulates ONLY
      // individual TB-sourced amounts. After both walks complete a fallback
      // block restores pyNotes for rows that have NO TB evidence at all
      // (e.g. when PY shell TB is empty).
      const pyFromTbStatic: Record<string, number> = {}; // tracks rows with TB-derived PY

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
          // DOUBLE-COUNT FIX: accumulate per-ledger PY from PY TB (not pyNotes).
          // pyNotes fallback applied after both walks complete (see below).
          newPy[matchedRowId] = (newPy[matchedRowId] ?? 0) + pyAmtLedger;
          pyFromTbStatic[matchedRowId] = (pyFromTbStatic[matchedRowId] ?? 0) + pyAmtLedger;
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
            // DOUBLE-COUNT FIX: accumulate per-ledger PY from PY TB.
            // Previously we called newPy[matchedRowId] += pyAmt here, but
            // combined with the CY walk's pyNotes initialization this caused
            // double-counting (the ledger appeared once in pyNotes and again
            // in the per-ledger addition). Now we accumulate here and into
            // pyFromTbStatic; pyNotes fallback is applied AFTER both walks
            // only for rows with zero TB-derived PY evidence.
            newPy[matchedRowId] = (newPy[matchedRowId] ?? 0) + pyAmt;
            pyFromTbStatic[matchedRowId] = (pyFromTbStatic[matchedRowId] ?? 0) + pyAmt;
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

      // DOUBLE-COUNT FIX — fallback: for every static row that has CY data
      // (newCy[rowId] > 0) but ZERO accumulated TB-derived PY (pyFromTbStatic
      // was never populated for it), restore the prior-year note value from
      // pyNotes as a best-effort PY. This covers the case where the PY shell
      // TB is empty or the PY shell TB doesn't carry the relevant ledgers.
      // We do NOT fall back when pyFromTbStatic[rowId] is defined (even if 0)
      // because a genuine zero PY is a valid result (ledger existed last year
      // with zero balance).
      for (const rowId of Object.keys(newCy)) {
        if (rowId in pyFromTbStatic) continue; // TB has evidence — keep it
        const pyNotesVal = pyNotes[noteType]?.[rowId];
        if (pyNotesVal && Math.abs(pyNotesVal) > 0.005) {
          newPy[rowId] = Math.abs(pyNotesVal);
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
        const nmLower = nm.toLowerCase();
        cyByLedgerB[nmLower] = signedLedgerAmt(row, noteType);
        // ── SIGN ROOT-CAUSE FIX (2026-06-05, SHREE HARI "Member Sales (Pos)") ──
        //
        // Phase 2 of the FS Re-Architecture — the canonical fallback for the
        // 18 engagements / 323 ledgers where PY-shell TB was never created
        // (or was created empty). The PY refresh map (pyByLedgerB) is built
        // ONLY from the PY-shell TB above; when the shell has no row for this
        // ledger, pyByLedgerB has no entry → the refresh loop below would
        // either set the manual row's PY to 0 OR leave a STALE WRONG-SIGNED
        // value (e.g. "Member Sales (Pos)", a Dr advance under Other Current
        // Liabilities, was stored as +27.9 cr instead of −27.9 cr).
        //
        // Fix: fall back to the SIGNED CY opening balance (= prior-year close
        // by accounting identity) via the shared signedOpening helper, which
        // applies the head's natural side (Dr on a Cr-head → negative). The
        // note's stored PY now matches the signed trial balance that COA
        // Mapping's BS face uses — so FS Notes Total === COA-Mapping BS face,
        // and the three-way reconciliation closes on every engagement.
        //
        // Precedence: a real PY-shell value (already in pyByLedgerB) always
        // wins; this only fills the gap when the shell didn't supply one.
        // Idempotent: signedOpening is a pure function of the TB row's
        // opening_type, so re-running converges and never double-flips.
        if (pyByLedgerB[nmLower] === undefined) {
          const py = signedOpening(row.opening_balance, row.opening_type, noteType);
          if (Math.abs(py) > 0.005) pyByLedgerB[nmLower] = py;
        }
      }
      // ─── WP3  pyByLedgerB / cyByLedgerB BEFORE tbRefresh wiring ───
      _msLog("WP3  pyByLedgerB and cyByLedgerB built", {
        pyTbLen: pyTb.length,
        pyByLedgerB_ms: pyByLedgerB["member sales (pos)"],
        cyByLedgerB_ms: cyByLedgerB["member sales (pos)"],
        strict: STRICTLY_TB_DRIVEN_B.has(noteType),
      });
      // Expose the maps to the merge step (outer scope) so manual-row CY/PY
      // values get refreshed from TB.  Only for strictly-TB-driven notes —
      // for other Pattern B notes (where users genuinely type custom amounts)
      // the old preserve-verbatim behaviour stays.
      if (STRICTLY_TB_DRIVEN_B.has(noteType)) {
        // Also add entries keyed by the merged base head (groupKey) so that
        // custom rows whose labels were derived by deriveBaseHead (stripping
        // "- 18%", "- URD", etc.) can be looked up during the tbRefresh step.
        // Without this, "Steel Purchase" (merged label) can't find
        // "steel purchase - 18%" in the map → PY stays 0.
        const augCy = { ...cyByLedgerB };
        const augPy = { ...pyByLedgerB };
        for (const [fullName, amt] of Object.entries(cyByLedgerB)) {
          const gk = groupKey(fullName);
          if (gk && gk !== fullName && !(gk in augCy)) augCy[gk] = amt;
          else if (gk && gk !== fullName && gk in augCy) augCy[gk] += amt;
        }
        for (const [fullName, amt] of Object.entries(pyByLedgerB)) {
          const gk = groupKey(fullName);
          if (gk && gk !== fullName && !(gk in augPy)) augPy[gk] = amt;
          else if (gk && gk !== fullName && gk in augPy) augPy[gk] += amt;
        }
        tbRefreshCy = augCy;
        tbRefreshPy = augPy;
      }
      _msLog("WP4  tbRefresh wired", {
        tbRefreshCy_ms: tbRefreshCy?.["member sales (pos)"],
        tbRefreshPy_ms: tbRefreshPy?.["member sales (pos)"],
      });
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
      // RC1 fix: Skip Stage 2 fa_financial_statements fallback when COA mapping
      // is empty. If coaMapping has no entries, Stage 1 found nothing NOT because
      // this note lacks ledgers but because NOTHING is mapped at all. Using
      // fsByCode (stale fa_financial_statements rows) re-injects old saved amounts
      // into notes, causing the BS face to show phantom data even with empty COA.
      // Fallback is only useful when COA is mapped but no ledgers happen to belong
      // to this particular note — allow it only in that case.
      // coaHasEntries is declared at function scope (after coaMapping is built).
      if (!hasData && coaHasEntries) {
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
          // BUG-009/113: route through the flag-gated sign choke-point (OFF=Math.abs;
          // ON=head-signed so an abnormal Cr stock ledger nets instead of inflating).
          const amt = noteAmt(row, "cogs");
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
          // BUG-009/113: flag-gated sign for the opening too (OFF=Math.abs, ON=head-signed).
          const openAmt = NCE_SIGNED_NOTE_AMOUNTS ? signedLedgerOpeningAmt(row, "cogs") : Math.abs(Number(row.opening_balance ?? 0));
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
            // BUG-009/113: preserve the stored note sign when signing is ON.
            newCy[openKey] = NCE_SIGNED_NOTE_AMOUNTS ? v : Math.abs(v);
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

                // BUG-009/113: flag-gated sign for the PY-shell inventory walk (OFF=Math.abs).
                const closeAmt = noteAmt(row, "cogs");   // = PY closing
                const openAmt  = NCE_SIGNED_NOTE_AMOUNTS ? signedLedgerOpeningAmt(row as any, "cogs") : Math.abs(Number((row as any).opening_balance ?? 0)); // = FY-2 closing
                const cls = classifyInv(row.ledger_name);
                const openKey  = openKeyFor(cls);   // pc_open_*
                const closeKey = closeKeyFor(cls);  // pc_close_*

                // CY column: only set when not already filled from prior
                // year's cogs note (pyCogs branch above).
                // BUG-009/113: !== 0 (not > 0) so a signed (negative) abnormal stock nets.
                // Byte-identical when the sign flag is OFF (Math.abs is never negative).
                if (closeAmt !== 0 && !newCy[openKey]) {
                  newCy[openKey] = (newCy[openKey] ?? 0) + closeAmt;
                }

                // PY column — Opening row = FY-2 closing (= prior eng's
                // opening_balance), PY Closing row = PY closing (= prior eng's
                // closing_balance).
                // BUG-009/113: !== 0 (not > 0) so signed negatives net; byte-identical when OFF.
                if (openAmt !== 0) {
                  newPy[openKey] = (newPy[openKey] ?? 0) + openAmt;
                }
                if (closeAmt !== 0) {
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
          pyByLedger[nm.toLowerCase()] = m ? signedLedgerAmt(r, noteType) : noteAmt(r, noteType);
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
          // BUG 1 (sign): pyAmtThisLedger is already head-signed. When the sign
          // flag is OFF we keep the legacy Math.abs (magnitude) for parity.
          if (isLT) newPy[matchedRowId + "_lt"] = (newPy[matchedRowId + "_lt"] ?? 0) + (NCE_SIGNED_NOTE_AMOUNTS ? pyAmtThisLedger : Math.abs(pyAmtThisLedger));
          if (isST) newPy[matchedRowId + "_st"] = (newPy[matchedRowId + "_st"] ?? 0) + (NCE_SIGNED_NOTE_AMOUNTS ? pyAmtThisLedger : Math.abs(pyAmtThisLedger));
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
      // RC1 fix (Pattern A): same guard as Pattern B above — skip Stage 2
      // fa_financial_statements fallback when COA mapping is empty to prevent
      // stale saved FS amounts from re-appearing in notes after COA is cleared.
      if (!hasData && coaHasEntries) {
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

    if (_msTraceOn && _msId) {
      const msAbsorbed = absorbedManualRows.find(r => r.id === _msId);
      _msLog("WP5  absorbedManualRows", {
        msInAbsorbed: !!msAbsorbed,
        msAttachedToAfter: msAbsorbed?.attachedTo,
        autoRowsCount: autoRows.length,
      });
    }

    // ── Merge auto + manual ─────────────────────────────────────────────
    const mergedCy: Record<string, number> = { ...newCy };
    const mergedPy: Record<string, number> = { ...newPy };

    // ── PARENT-WITH-CHILDREN ZERO-OUT (MAHARSH INFRA double-count fix) ──
    // When an auto row (e.g. merged "Plot No. A" with 2 TB sources) later
    // acquires manual children (user dragged 30+ individual plot rows under
    // it), its own raw CY/PY value duplicates amounts already carried by
    // the children — because computeNoteTotals sums raw + children, and
    // the children include rows whose sources overlap with the parent's.
    // Fix: zero the raw value of any auto row that has manual children
    // attached to it. The children carry all leaf amounts; the parent is
    // now purely a grouping header.
    // When an auto row's sources overlap with its children's sources,
    // zero the parent's raw CY/PY to prevent double-counting in
    // computeNoteTotals (which sums raw + children). Only zero when
    // there IS actual overlap — otherwise the parent's sources are
    // distinct ledgers and zeroing them loses legitimate data.
    // SWASTIK FIX: "Site Expense" parent had sources [Site Expense -
    // 18%, Site Expense - URD] and child [Site Survay Expense]. The
    // child is a DIFFERENT ledger — zeroing the parent destroyed 2.87L.
    const autoIdsWithChildren = new Set<string>();
    for (const mr of absorbedManualRows) {
      if (mr.attachedTo) autoIdsWithChildren.add(mr.attachedTo);
    }
    for (const ar of autoRows) {
      if (ar.attachedTo) autoIdsWithChildren.add(ar.attachedTo);
    }
    for (const arId of autoIdsWithChildren) {
      if (!(arId in mergedCy) || !autoRows.some(ar => ar.id === arId)) continue;
      const parentRow = autoRows.find(ar => ar.id === arId);
      if (!parentRow?.sources || parentRow.sources.length === 0) continue;
      const parentSourceLabels = new Set(
        parentRow.sources.map(s => (s.ledger || "").trim().toLowerCase()).filter(Boolean),
      );
      const childLabels = new Set(
        [...absorbedManualRows, ...autoRows]
          .filter(cr => cr.attachedTo === arId)
          .flatMap(cr => {
            const labels: string[] = [];
            const lbl = (cr.label || "").trim().toLowerCase();
            if (lbl) labels.push(lbl);
            for (const s of cr.sources ?? []) {
              const sl = (s.ledger || "").trim().toLowerCase();
              if (sl) labels.push(sl);
            }
            return labels;
          }),
      );
      const hasOverlap = [...parentSourceLabels].some(l => childLabels.has(l));
      if (hasOverlap) {
        for (const suffix of ["", "_lt", "_st"]) {
          const k = arId + suffix;
          if (k in mergedCy) mergedCy[k] = 0;
          if (k in mergedPy) mergedPy[k] = 0;
        }
      }
    }

    _msLog("WP6  pre-restore", {
      mergedPy_ms_before: _msId ? mergedPy[_msId] : "n/a",
      prev_py_ms: _msId ? prev.py?.[_msId] : "n/a",
    });

    // Restore manual custom row amounts
    for (const mr of absorbedManualRows) {
      for (const suffix of ["", "_lt", "_st"]) {
        const k = mr.id + suffix;
        if (prev.cy[k] !== undefined) mergedCy[k] = prev.cy[k];
        if (prev.py[k] !== undefined) mergedPy[k] = prev.py[k];
      }
    }

    _msLog("WP7  post-restore", {
      mergedCy_ms: _msId ? mergedCy[_msId] : "n/a",
      mergedPy_ms: _msId ? mergedPy[_msId] : "n/a",
    });

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
      // ── DOUBLE-COUNT FIX (DBS REALTY, June 2026) ─────────────────────
      // Build a set of row IDs that already have TB-sourced ledgers. Also
      // build a mapping from TB ledger name → owning row ID, so we can
      // detect when a standalone manual row (0 sources) duplicates a
      // ledger that's already counted as a source under another row.
      // The source label stored in sources[].ledger may differ from the
      // TB ledger_name (e.g. "A-603 Rajesh Desai" vs "A-603 Rajeshbhai
      // Kanubhai Desai"), so we must match via the CURRENT tbRefreshCy
      // keys (which ARE TB ledger names) against the manual row labels.
      const tbLedgerToOwnerRow = new Map<string, string>();
      for (const cr of [...absorbedManualRows, ...autoRows]) {
        if (!cr.sources || !Array.isArray(cr.sources)) continue;
        for (const src of cr.sources) {
          const sLbl = (src.ledger || "").trim().toLowerCase();
          if (sLbl) tbLedgerToOwnerRow.set(sLbl, cr.id);
        }
      }
      // Also map using the tbRefreshCy keys → find which custom row each
      // TB ledger ends up in. For each TB ledger name in tbRefreshCy, if
      // the groupKey of the TB ledger matches a source in some group,
      // register the TB ledger name as owned by that group.
      // This handles the case where sources store a shortened name but
      // the TB has the full name.
      if (tbRefreshCy) {
        for (const tbName of Object.keys(tbRefreshCy)) {
          if (tbLedgerToOwnerRow.has(tbName)) continue;
          // Check if any group's sources contain this ledger by checking
          // source amounts — if a group row's CY value includes this TB
          // ledger's amount, it's already counted. Use groupKey matching.
          const gk = groupKey(tbName);
          if (gk && tbLedgerToOwnerRow.has(gk)) {
            tbLedgerToOwnerRow.set(tbName, tbLedgerToOwnerRow.get(gk)!);
          }
        }
      }

      _msLog("WP8  refresh loop entered", {
        msInHasChildren: _msId ? hasChildren.has(_msId) : "n/a",
        absorbedCount: absorbedManualRows.length,
        tbLedgerToOwnerCount: tbLedgerToOwnerRow.size,
      });
      let refreshedCount = 0;
      for (const mr of absorbedManualRows) {
        // Intermediate heading guard — see comment above. Skip entirely.
        if (hasChildren.has(mr.id)) continue;
        const lbl = (mr.label || "").trim().toLowerCase();
        if (!lbl) continue;

        // ── DOUBLE-COUNT GUARD ───────────────────────────────────────
        // For STRICTLY_TB_DRIVEN notes, a manual row that has 0 sources
        // (no TB ledgers directly attached) but whose label matches a
        // current TB ledger that is ALREADY counted as a source inside
        // another row (tbLedgerToOwnerRow tracks this), zero it to
        // prevent double-counting. Example: DBS REALTY "A-603
        // Rajeshbhai Kanubhai Desai" ₹3,30,000 was in group "A"'s
        // 15 sources AND as a standalone manual row → double-counted.
        //
        // SHREE MARUTI FIX: previously this guard zeroed ANY manual row
        // with 0 sources whose label matched a TB ledger, assuming it
        // was "necessarily a duplicate". That assumption is wrong when
        // the ledger is NOT a source inside any other row — e.g. "PLOT
        // NO : 054 MAHESHBHAI PATEL" is a standalone plot that's not
        // bundled into the "PLOT NO : B" aggregate. Zeroing it dropped
        // ₹13.97L from the other_cl note total and broke BS balance.
        // Fix: only zero when tbLedgerToOwnerRow confirms the ledger
        // is actually owned by another row.
        const mrSources = (mr.sources ?? []).length;
        if (noteType !== "cogs" && mrSources === 0 && tbRefreshCy && tbRefreshCy[lbl] !== undefined
            && tbLedgerToOwnerRow.has(lbl)) {
          if ((mergedCy[mr.id] ?? 0) !== 0) {
            refreshedCount++;
            // eslint-disable-next-line no-console
            console.log(`[nceAutoPopulate] ${noteType}: zeroed duplicate row "${mr.label}" (already in a group's sources).`);
          }
          mergedCy[mr.id] = 0;
          // NOTE: only zero CY — PY may have legitimate values from PY
          // shell that aren't duplicated. Zeroing PY broke DBS REALTY PY
          // BS by ₹13.42 cr (37 trade_payables PY values wiped).
          continue;
        }

        const newCyVal = tbRefreshCy?.[lbl];
        const newPyVal = tbRefreshPy?.[lbl];
        if (_msTraceOn && mr.id === _msId) {
          _msLog("WP9  refresh on Member Sales row", {
            lbl, newCyVal, newPyVal,
            mergedPy_ms_before: mergedPy[mr.id],
          });
        }
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
        if (_msTraceOn && mr.id === _msId) {
          _msLog("WP10  refresh after Member Sales write", {
            mergedCy_ms_after: mergedCy[mr.id],
            mergedPy_ms_after: mergedPy[mr.id],
          });
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
    //
    // 2026-06-05 ROOT-CAUSE FIX (SHREE HARI INFRA + SKYLARK CORPORATION —
    // "Member Sales (Pos)" and any other Dr-balance ledger mapped to a Cr-
    // natural head). Two compounding bugs at this site flipped a Dr-balance
    // PY into a positive number stored on the manual row, inflating every
    // affected NCE engagement's BS face by exactly 2×|ledger|:
    //
    //   (a) `ledgerAmt(r.closing_balance)` = Math.abs(closing_balance) — strips
    //       the head-nature sign. For an opposite-side balance the result was
    //       the wrong sign. Replace with `signedLedgerAmt(r, noteType)` so the
    //       lookup matches the convention used by pyByLedgerB / the CY path
    //       (see the comment block at the Pattern B per-ledger PY lookup).
    //
    //   (b) Every "is the saved PY empty?" guard compared a raw signed value
    //       against `< 0.005`. A correctly-signed negative PY (e.g.
    //       -27,90,28,500) trivially satisfies `< 0.005`, so the guard either
    //       skipped a valid back-fill or, worse, treated the slot as empty and
    //       clobbered the upstream STALE-MANUAL-ROW REFRESH's correct
    //       negative value. Wrap every slot-read in Math.abs(...) so signed
    //       values are properly recognised as "has data".
    //
    // Net effect after both fixes: for every NCE engagement, the next Re-sync
    // walks any manual row whose label matches a PY-shell TB ledger and back-
    // fills the manual row's PY with the SIGNED amount under the current
    // head's nature. The buggy positive-overwrite on Dr-balance ledgers
    // (Member Sales (Pos) etc.) is gone — the BS face PY of Other Current
    // Liabilities / Trade Payables / etc. drops by 2×|Dr-sum| to the correct
    // value, and Notes 4/8/etc. show the negative contribution that nets the
    // group total instead of inflating it.
    if (pyTb.length > 0) {
      const pyByName: Record<string, number> = {};
      for (const r of pyTb) {
        const nm = String(r.ledger_name || "").trim();
        if (!nm) continue;
        // Sign-aware — see fix-comment block above. Replaces unsigned
        // ledgerAmt() that silently dropped the head-nature sign.
        pyByName[nm.toLowerCase()] = signedLedgerAmt(r, noteType);
      }
      // Detect whether this note follows Pattern A (LT/ST columns).
      const isPatternA = !noteFs.all && !!(noteFs.lt || noteFs.st);
      for (const mr of absorbedManualRows) {
        if (!mr.label) continue;
        const pyAmt = pyByName[mr.label.toLowerCase()];
        // Was: `pyAmt < 0.005` — wrong sign for a Dr-balance ledger.
        if (!pyAmt || Math.abs(pyAmt) < 0.005) continue;
        // Decide which suffix to fill based on note shape and where the CY
        // amount lives on the manual row.
        if (isPatternA) {
          const cyLt = Math.abs(mergedCy[mr.id + "_lt"] ?? 0);
          const cyStV = Math.abs(mergedCy[mr.id + "_st"] ?? 0);
          if (cyLt > 0.005 && Math.abs(mergedPy[mr.id + "_lt"] ?? 0) < 0.005) {
            mergedPy[mr.id + "_lt"] = pyAmt;
          } else if (cyStV > 0.005 && Math.abs(mergedPy[mr.id + "_st"] ?? 0) < 0.005) {
            mergedPy[mr.id + "_st"] = pyAmt;
          } else if (cyLt < 0.005 && cyStV < 0.005) {
            // No CY amount yet — default to ST since the user usually fills
            // ST first for current-liability provisions.
            if (Math.abs(mergedPy[mr.id + "_st"] ?? 0) < 0.005) {
              mergedPy[mr.id + "_st"] = pyAmt;
            }
          }
        } else {
          // Pattern B — single column.  Math.abs() so an existing correctly-
          // signed negative PY (written upstream by STALE-MANUAL-ROW REFRESH
          // for ledgers in STRICTLY_TB_DRIVEN_B notes) is NOT treated as
          // "empty" and overwritten with the back-fill value.
          if (_msTraceOn && mr.id === _msId) {
            _msLog("WP11  back-fill candidate (Pattern B)", {
              pyAmt,
              mergedPy_ms_before: mergedPy[mr.id],
              guardEmpty: Math.abs(mergedPy[mr.id] ?? 0) < 0.005,
            });
          }
          if (Math.abs(mergedPy[mr.id] ?? 0) < 0.005) {
            mergedPy[mr.id] = pyAmt;
          }
          if (_msTraceOn && mr.id === _msId) {
            _msLog("WP12  back-fill after", {
              mergedPy_ms_after: mergedPy[mr.id],
            });
          }
        }
      }
    }

    _msLog("WP13  post back-fill", {
      mergedPy_ms: _msId ? mergedPy[_msId] : "n/a",
    });

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
    //
    // EXCEPTION: if the static row was freshly populated by the smart-match path
    // in THIS re-sync (newCy/newPy has a non-zero value for it), KEEP the fresh
    // value. The smart-matched TB ledger amounts are distinct from the attached
    // custom row amounts — zeroing them loses legitimate TB data. Example:
    // SHIVASHRAY Other Expenses "labour" static row has smart-matched "Labour
    // Expense - URD" (54.2L) + "Labour Expense - Composition" (43.6L) = 97.8L,
    // PLUS an attached manual row "Loading - Unloading Expense". Without this
    // guard, the 97.8L smart-match amount is zeroed, and only the attached row
    // survives — losing 97.8L from the note total and the P&L face.
    const attachedStaticIds = new Set(
      [...autoRows, ...absorbedManualRows]
        .map(cr => cr.attachedTo)
        .filter((id): id is string => !!id),
    );
    for (const staticId of attachedStaticIds) {
      // Clear all variants: plain, _lt, _st
      for (const suffix of ["", "_lt", "_st"]) {
        const k = staticId + suffix;
        // Preserve freshly smart-matched values from this re-sync.
        // newCy/newPy contain ONLY amounts computed in THIS run from TB.
        if (Math.abs(newCy[k] ?? 0) < 0.005) mergedCy[k] = 0;
        if (Math.abs(newPy[k] ?? 0) < 0.005) mergedPy[k] = 0;
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
      if (_msTraceOn && _msId) {
        _msLog("WP14  pre pyNotes carry-forward", {
          mergedPy_ms: mergedPy[_msId],
          msInMergedPy: _msId in mergedPy,
          pyNotes_ms: (pyNotes[noteType] as Record<string, number>)?.[_msId],
        });
      }
      for (const [k, v] of Object.entries(pyNotes[noteType])) {
        if (!(k in mergedPy) && isCurrentlyActive(k)) mergedPy[k] = Math.abs(v);
      }
      _msLog("WP15  post pyNotes carry-forward", {
        mergedPy_ms: _msId ? mergedPy[_msId] : "n/a",
      });
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

    // ── 2026-06-05: Strip stale OPPOSITE-SIDE keys (Pattern A) ────────────
    // SHREE HARI INFRA root cause: after the user re-mapped every borrowings
    // ledger from NCE_STB → NCE_LTB, the rebuild correctly wrote each row's
    // _lt key. But the OLD _st numeric value persisted because the existing
    // purgeStale above only deletes keys whose customRow no longer exists at
    // all — a row that flipped sides keeps its base ID, so its leftover
    // counterpart survives every Re-sync and inflates BS face PY of
    // Short-term borrowings (15.86 cr ghost on SHREE HARI; same class of
    // ghost on OM REALTY / SKYLARK / every NCE re-classified ledger).
    //
    // For Pattern A notes, walk every active customRow: if data exists on
    // ONE side and NOT the other, delete the opposite-side keys. Same for
    // Pattern A static aggregate / total rows whose side has no leaves —
    // sec_total_st, unsec_total_st, total_ab_st etc. survive the existing
    // attachedStaticIds zeroing pass because those total IDs aren't
    // attachedTo any customRow.
    if (noteFs.lt || noteFs.st) {
      const nz = (v: unknown) => Math.abs(Number(v ?? 0)) > 0.005;
      const finalRows = [...autoRows, ...absorbedManualRows];
      for (const cr of finalRows) {
        const hasLt = nz(mergedCy[cr.id + "_lt"]) || nz(mergedPy[cr.id + "_lt"]);
        const hasSt = nz(mergedCy[cr.id + "_st"]) || nz(mergedPy[cr.id + "_st"]);
        if (hasLt && !hasSt) {
          delete mergedCy[cr.id + "_st"];
          delete mergedPy[cr.id + "_st"];
        } else if (hasSt && !hasLt) {
          delete mergedCy[cr.id + "_lt"];
          delete mergedPy[cr.id + "_lt"];
        }
      }
      // Static aggregate totals: drop *_lt or *_st when no customRow has
      // data on that side. These IDs come from BORROWINGS_ROWS etc. — they
      // are derived-by-formula rows whose stored value is a stale snapshot.
      const TOTAL_IDS = ["total", "total_ab", "sec_total", "unsec_total"];
      const sideHasAny = (sfx: "_lt" | "_st") =>
        finalRows.some(cr => nz(mergedCy[cr.id + sfx]) || nz(mergedPy[cr.id + sfx]));
      const ltAny = sideHasAny("_lt");
      const stAny = sideHasAny("_st");
      for (const t of TOTAL_IDS) {
        if (!ltAny) { delete mergedCy[t + "_lt"]; delete mergedPy[t + "_lt"]; }
        if (!stAny) { delete mergedCy[t + "_st"]; delete mergedPy[t + "_st"]; }
      }
    }

    // ── DUPLICATION SAFETY NET (auto-populate output) ─────────────────
    // For each static row that has both cy_sources AND a customRow attached
    // to it whose label matches one of the source ledgers, drop that ledger
    // from cy_sources and subtract its amount from cy[staticId] (+ _lt/_st).
    // Prevents the BHAKTI-style state where the renderer would otherwise
    // count the same ledger twice (once via the static aggregate, once via
    // the attached customRow). Belt-and-braces with the renderer-side
    // overlap subtract in NCEDetailedNotes.computeOverlap.
    let finalCustomRows: NCECustomRow[] = [...autoRows, ...absorbedManualRows];

    // ── CROSS-ROW DEDUP — drop manual rows whose ledger is already counted
    //    inside ANOTHER row's sources[] (DBS REALTY Note 19 fix, June 2026)
    // ────────────────────────────────────────────────────────────────────
    // BUG: an auto re-sync creates a fresh autoRow for each TB ledger
    // ("Fabrication Expense - URD", ₹30,80,000 — sources=[{ledger:"Fabrication
    // Expense - URD"}]). A pre-existing manual row labelled "Fabrication
    // Expense" — either auditor-typed long ago OR demoted from auto by a
    // legacy self-heal — survives the re-sync because (a) the ledger is still
    // mapped to this note (keepManualRowOnResync returns true), and (b) Note
    // 19 is NOT in STRICTLY_TB_DRIVEN_B so the existing tbLedgerToOwnerRow
    // dedup at line ~2422 never runs. Both rows then render in Note 19 with
    // the SAME amount → Note total double-counts → P&L "Other expenses"
    // inflates by exactly that amount.
    //
    // ROOT-CAUSE FIX (universal, every Pattern B note): a standalone manual
    // row (`sources.length === 0`, `!userMoved`) whose label's `baseHead`
    // matches the `baseHead` of ANY source ledger captured in ANOTHER row's
    // `sources[]` is, by definition, a duplicate — the canonical TB-derived
    // amount is already aggregated through that other row. Drop the manual
    // row and its cy/py keys. Auditor-typed rows that don't match any TB
    // source are left untouched.
    //
    // INVARIANT KEPT: amounts flow TB → COA → Notes → BS/PL. The notes layer
    // never double-counts the same ledger across two custom rows.
    if (finalCustomRows.length > 1) {
      const sourceBaseHeadOwners = new Map<string, string>(); // baseHead → owning row id
      // Collect base heads from every AUTO row — both single-ledger autos
      // (where the label IS the TB ledger name, no sources[]) and merged
      // autos (sources[] carries each contributing TB ledger). Without
      // including the label for single-ledger autos, the dedup misses the
      // DBS REALTY case: "Fabrication Expense - URD" lives as a SINGLE
      // auto row (no sources[]) and the manual "Fabrication Expense" row
      // sits beside it — both with the same TB amount. Both rules below
      // intentionally run only against AUTO rows so two manual rows with
      // matching base heads (auditor-typed) don't get erroneously deduped.
      for (const cr of finalCustomRows) {
        if (cr.source !== "auto") continue;
        const labelBh = deriveBaseHead(cr.label || "").toLowerCase().trim();
        if (labelBh && !sourceBaseHeadOwners.has(labelBh)) {
          sourceBaseHeadOwners.set(labelBh, cr.id);
        }
        for (const s of cr.sources ?? []) {
          const bh = deriveBaseHead(s.ledger || "").toLowerCase().trim();
          if (bh && !sourceBaseHeadOwners.has(bh)) {
            sourceBaseHeadOwners.set(bh, cr.id);
          }
        }
      }
      const dropDuplicateIds = new Set<string>();
      for (const cr of finalCustomRows) {
        if (cr.source !== "manual") continue;
        if (cr.userMoved === true) continue;
        if ((cr.sources?.length ?? 0) > 0) continue;
        const bh = deriveBaseHead(cr.label || "").toLowerCase().trim();
        if (!bh) continue;
        const ownerId = sourceBaseHeadOwners.get(bh);
        if (ownerId && ownerId !== cr.id) {
          dropDuplicateIds.add(cr.id);
        }
      }
      if (dropDuplicateIds.size > 0) {
        finalCustomRows = finalCustomRows.filter(cr => !dropDuplicateIds.has(cr.id));
        for (const id of dropDuplicateIds) {
          for (const sfx of ["", "_lt", "_st"]) {
            delete mergedCy[id + sfx];
            delete mergedPy[id + sfx];
          }
        }
        // eslint-disable-next-line no-console
        console.log(
          `[nceAutoPopulate] ${noteType}: dropped ${dropDuplicateIds.size} duplicate manual row(s) (already counted via another row's sources[]).`,
        );
      }
    }
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
    const _wantsPerLedgerBreakup =
      noteType === "borrowings" ||
      noteType === "investments" ||
      noteType === "loans_advances";
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

    // ── Split-note LT/ST normalisation ────────────────────────────────────
    // OM REALTY round 4: when the user used "Move to…" on a row in Long-Term
    // Borrowings, the moved row's amount sat under the BARE key (cr.id)
    // instead of under cr.id + "_lt" or cr.id + "_st", so extractSplitData's
    // "no suffixed amounts → include in both" rule made the SAME row appear
    // in BOTH the Long-Term and Short-Term notes (e.g. AU Small Finance
    // Bank Ltd PY 7,99,55,015 visible in Long-Term Borrowings AND Short-
    // Term Borrowings). User couldn't reconcile because the same ledger
    // was being counted twice in the breakup.
    //
    // ROOT-CAUSE FIX: for every split note (borrowings, provisions,
    // loans_advances — anything with noteFs.lt or noteFs.st), for every
    // manual customRow whose label / ejected source matches a TB ledger
    // currently mapped in CY coa_mapping to a code we own:
    //   • mapped to an LT code (noteFs.lt) → move bare-key amount to "_lt"
    //   • mapped to an ST code (noteFs.st) → move bare-key amount to "_st"
    //   • clear the OTHER side's key so no residual placeholder remains
    // extractSplitData's existing "real amount on THIS side" check then
    // shows the row only in the side COA mapping says it belongs in,
    // matching the BS face exactly. CY and PY are normalised independently
    // because a settled-in-CY loan (e.g. AU SFB) lives in PY only.
    if ((noteFs.lt && noteFs.lt.length > 0) || (noteFs.st && noteFs.st.length > 0)) {
      const ltCodes = new Set(noteFs.lt ?? []);
      const stCodes = new Set(noteFs.st ?? []);
      // Resolve ledger → code: prefer the row's own ejectedSource (more
      // reliable than label, which the auditor may have re-titled), then
      // the label itself, then nothing.
      const resolveCode = (cr: NCECustomRow): string | undefined => {
        const ejected = ((cr as any).ejectedSource as string | undefined)?.trim();
        if (ejected) {
          const m = coaMapping[ejected] ?? pyCoaMap[ejected];
          if (m?.code) return m.code;
        }
        const lbl = (cr.label || "").trim();
        if (lbl) {
          const m = coaMapping[lbl] ?? pyCoaMap[lbl];
          if (m?.code) return m.code;
        }
        return undefined;
      };
      // Pre-compute the AUTHORITATIVE TB amount for each manual row.
      // The note's breakup amount must equal the TB amount for that exact
      // ledger — the COA Mapping ledger total. CY TB first (current
      // engagement), then PY shell TB for the PY column. Previous fix
      // summed wantedV + bareV + otherV which **inflated** values when
      // prior buggy re-syncs had left stale values across multiple keys
      // (OM REALTY round 5 symptom: AU SFB PY 7,99,55,015 ballooned to
      // 39,97,75,075 = 5×, exactly the count of stale key buckets that
      // had been written over time). The TB amount, by contrast, can
      // never inflate — it's the ground truth.
      const tbAmountFor = (cr: NCECustomRow, col: "cy" | "py"): number => {
        const ejected = ((cr as any).ejectedSource as string | undefined)?.trim();
        const lbl     = (cr.label || "").trim();
        const candidates: string[] = [];
        if (ejected) candidates.push(ejected);
        if (lbl && lbl !== ejected) candidates.push(lbl);
        if (candidates.length === 0) return 0;
        const src = col === "cy" ? tb : pyTb;
        for (const name of candidates) {
          const nm = name.toLowerCase();
          const row = src.find(r => (r.ledger_name || "").trim().toLowerCase() === nm);
          if (!row) continue;
          return noteAmt(row, noteType);
        }
        return 0;
      };
      for (const cr of leakFreeCustomRows) {
        if (cr.source !== "manual") continue;
        const code = resolveCode(cr);
        if (!code) continue;            // auditor-typed row with no TB match — leave alone
        const side: "lt" | "st" | null =
          ltCodes.has(code) ? "lt" :
          stCodes.has(code) ? "st" : null;
        if (!side) continue;            // ledger no longer ours — handled by the purge above
        const wantedSfx = `_${side}`;
        const otherSfx  = side === "lt" ? "_st" : "_lt";
        const cyTb = tbAmountFor(cr, "cy");
        const pyTb = tbAmountFor(cr, "py");
        for (const [buf, tbVal] of [[mergedCy, cyTb], [mergedPy, pyTb]] as Array<[Record<string, number>, number]>) {
          // The note's row must match the TB ledger amount, not a sum of
          // whatever residue past bugs left in (bare, _lt, _st).
          if (Math.abs(tbVal) < 0.005) {
            delete buf[cr.id];
            delete buf[cr.id + wantedSfx];
            delete buf[cr.id + otherSfx];
          } else {
            buf[cr.id + wantedSfx] = tbVal;
            delete buf[cr.id];
            delete buf[cr.id + otherSfx];
          }
        }
      }
    }

    // ── Pattern-B TB-authoritative normalisation ─────────────────────────
    // OM REALTY round 6: same compounding inflation symptom on Pattern B
    // notes — Cash & Bank "Balance in current account" PY ballooned to
    // 54,64,443 even though the COA Mapping variance drill says the
    // ledger total is 38,66,927. Other Current Liabilities had the
    // "Revenue recognised on PCOS" row stored with a flipped sign so the
    // note total disagreed with COA Mapping by the row's value. Both come
    // from the same shape: stored bare-key values left over from earlier
    // buggy auto-populate cycles never get reset to the TB ground truth.
    //
    // ROOT-CAUSE FIX: for every Pattern B note (noteFs.all) — cash_bank,
    // other_cl, trade_payables, inventories, trade_receivables, etc. —
    // for every manual customRow whose ledger maps (via ejectedSource or
    // label) into one of this note's owned codes, source the row's
    // amount from the TB:
    //   • CY column → CY tally_trial_balance closing_balance
    //   • PY column → PY-shell tally_trial_balance closing_balance
    //   • Write to bare cr.id key (Pattern B is unsuffixed)
    //   • Delete the bare key entirely if the TB amount is zero
    // The note breakup then matches COA Mapping ledger-for-ledger and
    // the writeback is idempotent — running Re-sync ten times produces
    // the same value, not 10×. Sign convention: the amount is sourced via
    // noteAmt(row, noteType). With NCE_SIGNED_NOTE_AMOUNTS ON it is head-signed
    // (a Dr ledger in a Cr-natural head, or a Cr write-back in an expense head,
    // DEDUCTS — see fsSignConvention); with the flag OFF it falls back to the
    // legacy ledgerAmt magnitude (which does NOT preserve sign — that was the
    // BUG 1 defect this flag fixes).
    if (noteFs.all && noteFs.all.length > 0) {
      const ourCodes = new Set(noteFs.all);
      const resolveCodeAll = (cr: NCECustomRow): string | undefined => {
        const ejected = ((cr as any).ejectedSource as string | undefined)?.trim();
        if (ejected) {
          const m = coaMapping[ejected] ?? pyCoaMap[ejected];
          if (m?.code) return m.code;
        }
        const lbl = (cr.label || "").trim();
        if (lbl) {
          const m = coaMapping[lbl] ?? pyCoaMap[lbl];
          if (m?.code) return m.code;
        }
        return undefined;
      };
      const tbAmountForAll = (cr: NCECustomRow, col: "cy" | "py"): number => {
        const ejected = ((cr as any).ejectedSource as string | undefined)?.trim();
        const lbl     = (cr.label || "").trim();
        const candidates: string[] = [];
        if (ejected) candidates.push(ejected);
        if (lbl && lbl !== ejected) candidates.push(lbl);
        if (candidates.length === 0) return 0;
        const src = col === "cy" ? tb : pyTb;
        for (const name of candidates) {
          const nm = name.toLowerCase();
          const row = src.find(r => (r.ledger_name || "").trim().toLowerCase() === nm);
          if (!row) continue;
          return noteAmt(row, noteType);
        }
        return 0;
      };
      for (const cr of leakFreeCustomRows) {
        if (cr.source !== "manual") continue;
        const code = resolveCodeAll(cr);
        if (!code) continue;            // auditor-typed row with no TB match — leave alone
        if (!ourCodes.has(code)) continue;  // ledger no longer ours — purge above handled it
        const cyVal = tbAmountForAll(cr, "cy");
        const pyVal = tbAmountForAll(cr, "py");
        for (const [buf, v] of [[mergedCy, cyVal], [mergedPy, pyVal]] as Array<[Record<string, number>, number]>) {
          if (Math.abs(v) < 0.005) {
            delete buf[cr.id];
          } else {
            buf[cr.id] = v;
          }
        }
      }
    }

    if (_msTraceOn && _msId) {
      _msLog("WP16  final out[other_cl]", {
        mergedPy_ms_FINAL: mergedPy[_msId],
        mergedCy_ms_FINAL: mergedCy[_msId],
        msInLeakFree: leakFreeCustomRows.some(r => r.id === _msId),
        leakFreeCount: leakFreeCustomRows.length,
      });
    }
    // ── FINAL SIGN CORRECTION (2026-06-08) ─────────────────────────────────
    // For strictly-TB-driven notes (trade_payables, other_cl, other_lt_liab,
    // cogs), force EVERY custom row whose label matches a TB ledger to use
    // the SIGNED TB amount. This overrides any unsigned/stale manual values.
    // Ensures: Note Total = COA Total (Dr netted against Cr for contra).
    // Runs AFTER all restore/refresh cycles so nothing can override it.
    if (STRICTLY_TB_DRIVEN_B.has(noteType)) {
      // Build a fresh lookup from TB with signed amounts
      const signedCyLookup: Record<string, number> = {};
      const signedPyLookup: Record<string, number> = {};
      const noteCodeSet = new Set([...(noteFs.all ?? []), ...(noteFs.lt ?? []), ...(noteFs.st ?? [])]);
      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !noteCodeSet.has(mapped.code)) continue;
        const nm = String(row.ledger_name || "").trim().toLowerCase();
        if (!nm) continue;
        signedCyLookup[nm] = signedLedgerAmt(row, noteType);
        // Only set PY from CY opening when it's non-zero. P&L accounts
        // always have 0 opening — setting 0 here blocks the PY shell
        // lookup below, causing all COGS PY values to stay at 0.
        const pyFromOpening = signedLedgerOpeningAmt(row, noteType);
        if (Math.abs(pyFromOpening) > 0.005) {
          signedPyLookup[nm] = pyFromOpening;
        }
      }
      // PY shell TB provides PY for P&L accounts (whose CY opening = 0)
      for (const row of pyTb) {
        const nm = String(row.ledger_name || "").trim().toLowerCase();
        if (!nm) continue;
        if (signedPyLookup[nm] === undefined) {
          const mapped = coaMapping[row.ledger_name] ?? pyCoaMap[row.ledger_name];
          if (mapped && noteCodeSet.has(mapped.code)) {
            signedPyLookup[nm] = signedLedgerAmt(row, noteType);
          }
        }
      }
      // Overwrite custom row values with signed TB amounts.
      // DOUBLE-COUNT GUARD (2026-06-09): skip rows that have 0 sources and
      // match a TB ledger — those were already zeroed by the double-count
      // guard above (the ledger's amount is counted through another row's
      // sources aggregate). Without this skip, the final sign correction
      // undoes the zeroing by writing signedCyLookup[lbl] back.
      // Build set of IDs that are duplicates (0 sources + TB match + others
      // have sources). Computed ONCE before the loop for efficiency and to
      // ensure the check is applied consistently.
      const duplicateIds = new Set<string>();
      // Skip cogs — hierarchical structure means standalone rows aren't duplicates
      const anyRowHasSources = noteType !== "cogs" && leakFreeCustomRows.some(cr => (cr.sources ?? []).length > 0);
      if (anyRowHasSources) {
        // Build set of TB ledger names that are already owned as sources
        // by another row. Only those are true duplicates.
        const ownedBySource = new Set<string>();
        for (const cr of leakFreeCustomRows) {
          for (const s of cr.sources ?? []) {
            const sn = (s.ledger || "").trim().toLowerCase();
            if (sn) ownedBySource.add(sn);
          }
        }
        for (const cr of leakFreeCustomRows) {
          if ((cr.sources ?? []).length === 0) {
            const lbl = (cr.label || "").trim().toLowerCase();
            if (lbl && signedCyLookup[lbl] !== undefined && ownedBySource.has(lbl)) {
              duplicateIds.add(cr.id);
            }
          }
        }
      }
      for (const cr of leakFreeCustomRows) {
        if (duplicateIds.has(cr.id)) continue; // Skip duplicate rows
        const lbl = (cr.label || "").trim().toLowerCase();
        if (!lbl) continue;
        if (signedCyLookup[lbl] !== undefined) {
          mergedCy[cr.id] = signedCyLookup[lbl];
        }
        if (signedPyLookup[lbl] !== undefined) {
          mergedPy[cr.id] = signedPyLookup[lbl];
        }
      }
      // Zero out CY for duplicate rows (ensure they stay at 0).
      // Only CY — PY may hold legitimate PY-shell values.
      for (const id of duplicateIds) {
        mergedCy[id] = 0;
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
