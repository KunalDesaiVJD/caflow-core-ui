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
  other_cl: [
    { rowId: "tds_payable",  keywords: ["tds", "tax deducted"] },
    { rowId: "gst_payable",  keywords: ["gst payable", "output gst", "gst liability", "igst payable", "cgst payable", "sgst payable"] },
    { rowId: "emp_payable",  keywords: ["salary payable", "wages payable", "employee payable", "staff payable"] },
    { rowId: "inc_advance",  keywords: ["advance from customer", "income received in advance", "customer advance"] },
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

export interface NCECustomRow {
  id:       string;
  label:    string;
  source:   "auto" | "manual";
  /** For Pattern-A notes with sections: which section total to insert before.
   *  "secured" | "unsecured" → row appears under that section heading and
   *  is counted in that section's total (not the grand total directly).
   *  Absent → row is a global custom row counted only in the grand total. */
  section?: string;
}

export interface NCENoteData {
  cy:         Record<string, number>;
  py:         Record<string, number>;
  customRows: NCECustomRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCustomId(name: string, idx: number): string {
  return (
    "custom_" +
    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) +
    "_" + idx
  );
}

// tally_trial_balance stores a single closing_balance (always positive) and
// balance_type ("Dr" | "Cr"). For notes we just want the magnitude.
function ledgerAmt(closingBalance: number): number {
  return Math.abs(closingBalance ?? 0);
}

// ── Serialise / deserialise ───────────────────────────────────────────────────

export function deserialiseNoteData(
  rawCy: Record<string, any>,
  rawPy: Record<string, any>,
): NCENoteData {
  const customRows: NCECustomRow[] = Array.isArray(rawCy._custom_rows)
    ? (rawCy._custom_rows as NCECustomRow[])
    : [];

  const cy: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCy)) {
    if (k !== "_custom_rows" && typeof v === "number") cy[k] = v;
  }
  const py: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawPy)) {
    if (k !== "_custom_rows" && typeof v === "number") py[k] = v;
  }
  return { cy, py, customRows };
}

export function serialiseNoteData(
  d: NCENoteData,
): { cy_data: Record<string, any>; py_data: Record<string, number> } {
  return {
    cy_data: { ...d.cy, _custom_rows: d.customRows },
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
    .select("ledger_name, closing_balance, balance_type")
    .eq("engagement_id", engagementId);

  type TBRow = { ledger_name: string; closing_balance: number; balance_type: string };
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
  const pyNotes: Record<string, Record<string, number>> = {};
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
            if (k !== "_custom_rows" && typeof v === "number") nums[k] = v as number;
          }
          pyNotes[r.note_type] = nums;
        }
      }
    }
  }

  // ── 5. Build per-note results ───────────────────────────────────────────
  const out: Record<string, NCENoteData> = {};

  for (const [noteType, noteFs] of Object.entries(NCE_NOTE_FS_MAP)) {
    const prev = existing[noteType] ?? { cy: {}, py: {}, customRows: [] };
    const manualRows = prev.customRows.filter(r => r.source === "manual");

    const newCy:    Record<string, number> = {};
    const newPy:    Record<string, number> = {};
    const autoRows: NCECustomRow[]         = [];

    if (noteFs.all) {
      // ── Pattern B ──────────────────────────────────────────────────────
      const codeSet    = new Set(noteFs.all);
      const smartRules = NOTE_SMART_MAP[noteType] ?? [];
      let idx = 0;

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !codeSet.has(mapped.code)) continue;
        const amt = ledgerAmt(row.closing_balance);
        if (amt === 0) continue;

        const matchedRowId = smartMatch(row.ledger_name, smartRules);
        if (matchedRowId) {
          // Accumulate directly into the static row — no custom row created
          newCy[matchedRowId] = (newCy[matchedRowId] ?? 0) + amt;
          // PY: carry from prior-year cy_data for the same static key, if any
          if (!(matchedRowId in newPy)) {
            newPy[matchedRowId] = pyNotes[noteType]?.[matchedRowId] ?? 0;
          }
        } else {
          const id = makeCustomId(row.ledger_name, idx++);
          newCy[id] = amt;
          newPy[id] = pyNotes[noteType]?.[id] ?? 0;
          autoRows.push({ id, label: row.ledger_name, source: "auto" });
        }
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
      let idx = 0;
      const seen = new Set<string>();

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped) continue;
        const isLT = ltSet.has(mapped.code);
        const isST = stSet.has(mapped.code);
        if (!isLT && !isST) continue;
        const amt = ledgerAmt(row.closing_balance);
        if (amt === 0) continue;

        const matchedRowId = smartMatch(row.ledger_name, smartRules);
        if (matchedRowId) {
          // Fill static row directly with LT/ST suffix
          if (isLT) newCy[matchedRowId + "_lt"] = (newCy[matchedRowId + "_lt"] ?? 0) + amt;
          if (isST) newCy[matchedRowId + "_st"] = (newCy[matchedRowId + "_st"] ?? 0) + amt;
          // PY from prior year if available
          if (isLT && !(matchedRowId + "_lt" in newPy))
            newPy[matchedRowId + "_lt"] = pyNotes[noteType]?.[matchedRowId + "_lt"] ?? 0;
          if (isST && !(matchedRowId + "_st" in newPy))
            newPy[matchedRowId + "_st"] = pyNotes[noteType]?.[matchedRowId + "_st"] ?? 0;
        } else {
          // Create custom row — for borrowings, tag as "unsecured" since all
          // individual partner/person loans that don't match specific rows are
          // unsecured by nature
          const id = makeCustomId(row.ledger_name, idx++);
          if (isLT) { newCy[id + "_lt"] = amt; newPy[id + "_lt"] = 0; }
          if (isST) { newCy[id + "_st"] = amt; newPy[id + "_st"] = 0; }
          if (!seen.has(id)) {
            seen.add(id);
            const section = noteType === "borrowings" ? "unsecured" : undefined;
            autoRows.push({ id, label: row.ledger_name, source: "auto", section });
          }
        }
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

    // Restore existing static-row user values (non-custom keys)
    for (const [k, v] of Object.entries(prev.cy)) {
      if (!k.startsWith("custom_") && !(k in mergedCy)) mergedCy[k] = v;
    }
    for (const [k, v] of Object.entries(prev.py)) {
      if (!k.startsWith("custom_") && !(k in mergedPy)) mergedPy[k] = v;
    }

    // Apply prior-year CY as PY for static rows if not already set
    if (pyNotes[noteType]) {
      for (const [k, v] of Object.entries(pyNotes[noteType])) {
        if (!(k in mergedPy)) mergedPy[k] = v;
      }
    }

    out[noteType] = {
      cy:         mergedCy,
      py:         mergedPy,
      customRows: [...autoRows, ...manualRows],
    };
  }

  return out;
}
