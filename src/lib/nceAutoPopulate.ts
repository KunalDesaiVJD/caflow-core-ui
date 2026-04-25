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
      const codeSet = new Set(noteFs.all);
      let idx = 0;

      for (const row of tb) {
        const mapped = coaMapping[row.ledger_name];
        if (!mapped || !codeSet.has(mapped.code)) continue;
        const amt = ledgerAmt(row.closing_balance);
        if (amt === 0) continue;
        const id = makeCustomId(row.ledger_name, idx++);
        newCy[id] = amt;
        newPy[id] = pyNotes[noteType]?.[id] ?? 0;
        autoRows.push({ id, label: row.ledger_name, source: "auto" });
      }

      // Fallback: if no ledger-level matches, use FS-code total
      if (autoRows.length === 0) {
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
      const ltSet = new Set(noteFs.lt ?? []);
      const stSet = new Set(noteFs.st ?? []);
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

        const id = makeCustomId(row.ledger_name, idx++);
        if (isLT) { newCy[id + "_lt"] = amt; newPy[id + "_lt"] = 0; }
        if (isST) { newCy[id + "_st"] = amt; newPy[id + "_st"] = 0; }
        if (!seen.has(id)) {
          seen.add(id);
          autoRows.push({ id, label: row.ledger_name, source: "auto" });
        }
      }

      // Fallback: use FS-code totals
      if (autoRows.length === 0) {
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
