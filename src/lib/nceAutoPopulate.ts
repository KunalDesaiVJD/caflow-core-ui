/**
 * nceAutoPopulate
 * ─────────────────────────────────────────────────────────────────────────
 * Reads an engagement's COA mapping + Tally Trial Balance and returns
 * auto-populated note data for every NCE note type.
 *
 * Called:
 *  (a) Automatically on first visit to NCEDetailedNotes (if no notes exist)
 *  (b) Manually when the user clicks "Re-sync from COA"
 *
 * Auto rows vs manual rows
 *  - Each matched TB ledger → one custom row (source = "auto").
 *  - On re-sync, auto rows are refreshed; manual rows are preserved verbatim.
 *  - Existing static-row CY / PY values entered by the user are also kept.
 */

import { supabase } from "@/integrations/supabase/client";

// ── FS-code map ──────────────────────────────────────────────────────────────
// Maps each NCE note type to the FS codes used in COA mapping.
// Pattern-A notes (LT/ST columns): provide lt + st arrays.
// Pattern-B notes (single CY/PY columns): provide all array.

export const NCE_NOTE_FS_MAP: Record<string, {
  lt?:  string[];   // Pattern-A long-term
  st?:  string[];   // Pattern-A short-term
  all?: string[];   // Pattern-B
}> = {
  borrowings:         { lt: ["BS_NCL_LTB"],                              st: ["BS_CL_STB"] },
  other_lt_liab:      { all: ["BS_NCL_OLT"] },
  provisions:         { lt: ["BS_NCL_LTP"],                              st: ["BS_CL_STP"] },
  trade_payables:     { all: ["BS_CL_TP"] },
  other_cl:           { all: ["BS_CL_OCL"] },
  cwip:               { all: ["BS_NCA_FA_WIP"] },
  investments:        { lt: ["BS_NCA_INV"],                              st: [] },
  loans_advances:     { lt: ["BS_NCA_LLA"],                              st: ["BS_CA_SLA"] },
  other_nc_assets:    { all: ["BS_NCA_ONA"] },
  inventories:        { all: ["BS_CA_INV"] },
  trade_receivables:  { all: ["BS_CA_TR"] },
  cash_bank:          { all: ["BS_CA_CCE"] },
  other_ca:           { all: ["BS_CA_OCA"] },
  revenue_ops:        { all: ["PL_REV_OPS"] },
  other_income:       { all: ["PL_REV_OI"] },
  cogs:               { all: ["PL_EXP_MAT", "PL_EXP_SIT", "PL_EXP_CII"] },
  employee_exp:       { all: ["PL_EXP_EMP"] },
  finance_costs:      { all: ["PL_EXP_FIN"] },
  other_expenses:     { all: ["PL_EXP_OTH", "PL_EXP_OEX"] },
};

const PL_INCOME_TYPES  = new Set(["revenue_ops", "other_income"]);
const PL_EXPENSE_TYPES = new Set(["cogs", "employee_exp", "finance_costs", "other_expenses"]);

// ── Custom row type ───────────────────────────────────────────────────────────

export interface NCECustomRow {
  id:     string;
  label:  string;
  source: "auto" | "manual";
}

export interface NCENoteData {
  cy:         Record<string, number>;
  py:         Record<string, number>;
  customRows: NCECustomRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stable row ID from a ledger name + index */
function makeCustomId(name: string, idx: number): string {
  return (
    "custom_" +
    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) +
    "_" + idx
  );
}

/** Absolute closing balance of a TB ledger, signed for the note section */
function ledgerAmt(
  dr: number,
  cr: number,
  noteType: string,
): number {
  if (PL_INCOME_TYPES.has(noteType))  return Math.max(0, cr - dr);
  if (PL_EXPENSE_TYPES.has(noteType)) return Math.max(0, dr - cr);
  // BS items — return net absolute (liability usually CR, asset usually DR)
  return Math.abs(cr - dr);
}

// ── Serialise / deserialise custom rows via cy_data ──────────────────────────

/**
 * Extract NCENoteData from raw Supabase JSONB rows.
 * Custom rows are stored inside cy_data under the "_custom_rows" key so we
 * don't need a schema migration.
 */
export function deserialiseNoteData(
  rawCy: Record<string, any>,
  rawPy: Record<string, any>,
): NCENoteData {
  const customRows: NCECustomRow[] = Array.isArray(rawCy._custom_rows)
    ? (rawCy._custom_rows as NCECustomRow[])
    : [];

  // Strip _custom_rows from numeric maps
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

/**
 * Serialise NCENoteData back to plain JSONB objects for Supabase.
 * _custom_rows is embedded inside cy_data.
 */
export function serialiseNoteData(
  d: NCENoteData,
): { cy_data: Record<string, any>; py_data: Record<string, number> } {
  return {
    cy_data: { ...d.cy, _custom_rows: d.customRows },
    py_data: d.py,
  };
}

// ── Main auto-populate ────────────────────────────────────────────────────────

/**
 * Auto-populate NCE notes from Tally TB + COA mapping.
 *
 * @param engagementId  Target engagement
 * @param existing      Previously saved NCENoteData map (keyed by noteType).
 *                      If provided, manual custom rows and user-entered static
 *                      row values are preserved across re-syncs.
 */
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
  const { data: tbRows } = await supabase
    .from("tally_trial_balance")
    .select("ledger_name, closing_dr, closing_cr")
    .eq("engagement_id", engagementId);

  type TBRow = { ledger_name: string; closing_dr: number; closing_cr: number };
  const tb: TBRow[] = (tbRows ?? []) as TBRow[];

  // ── 3. Load PY (= prior year CY) from previous engagement ──────────────
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
        const { data: prevRows } = await supabase
          .from("nce_financial_notes")
          .select("note_type, cy_data")
          .eq("engagement_id", (prevEng as any).id);
        for (const r of (prevRows ?? [])) {
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

  // ── 4. Build per-note results ───────────────────────────────────────────
  const out: Record<string, NCENoteData> = {};

  for (const [noteType, fsMap] of Object.entries(NCE_NOTE_FS_MAP)) {
    const prev = existing[noteType] ?? { cy: {}, py: {}, customRows: [] };
    const manualRows = prev.customRows.filter(r => r.source === "manual");

    const newCy:    Record<string, number> = {};
    const newPy:    Record<string, number> = {};
    const autoRows: NCECustomRow[]         = [];

    if (fsMap.all) {
      // ── Pattern B ──────────────────────────────────────────────────────
      const codeSet = new Set(fsMap.all);
      let idx = 0;
      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !codeSet.has(mapped.code)) continue;
        const amt = ledgerAmt(row.closing_dr, row.closing_cr, noteType);
        if (amt === 0) continue;
        const id = makeCustomId(row.ledger_name, idx++);
        newCy[id] = amt;
        newPy[id] = 0;
        autoRows.push({ id, label: row.ledger_name, source: "auto" });
      }
    } else {
      // ── Pattern A (LT / ST columns) ────────────────────────────────────
      const ltSet = new Set(fsMap.lt ?? []);
      const stSet = new Set(fsMap.st ?? []);
      let idx = 0;
      const seen = new Set<string>();

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped) continue;
        const isLT = ltSet.has(mapped.code);
        const isST = stSet.has(mapped.code);
        if (!isLT && !isST) continue;
        const amt = ledgerAmt(row.closing_dr, row.closing_cr, noteType);
        if (amt === 0) continue;

        const id = makeCustomId(row.ledger_name, idx++);
        if (isLT) { newCy[id + "_lt"] = amt; newPy[id + "_lt"] = 0; }
        if (isST) { newCy[id + "_st"] = amt; newPy[id + "_st"] = 0; }
        if (!seen.has(id)) { seen.add(id); autoRows.push({ id, label: row.ledger_name, source: "auto" }); }
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

    // Use prior-year CY as PY for static rows (if not already set)
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
