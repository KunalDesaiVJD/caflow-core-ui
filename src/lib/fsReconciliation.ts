/**
 * fsReconciliation — Runtime guarantee that NCE notes / BS face / Total
 * row all reconcile.
 *
 * Background:
 *   Money in an NCE note can be computed three independent ways:
 *     1. The renderer's parent-row aggregate (sumCustomDisplayB/A in
 *        NCEDetailedNotes.tsx)
 *     2. The Note Total row (computeDisplayData in nceNotesConfig.ts)
 *     3. The BS / P&L face value (getNCENoteFaceTotal in nceAutoPopulate.ts)
 *
 *   Historically these aggregators diverged when a new data channel was
 *   added — e.g. customRow.sources[] sub-ledger array (the SHREE HARI
 *   INFRA bug of 2026-06-04, where ₹3.39 crore went missing from the BS
 *   face but was visible in the per-row aggregate). Each divergence took
 *   hours to find and shipped to production silently because nothing ran
 *   at load-time to assert agreement.
 *
 *   This module is the runtime tripwire:
 *     • Runs on every Stage 7 mount + after every save
 *     • For each NCE note code, compares getNCENoteFaceTotal vs bsFace
 *     • Reports any |delta| > ₹1 as a reconciliation failure
 *     • Optionally persists severe drift to fs_reconciliation_log for the
 *       admin audit trail
 *     • Powers the FsHealthPanel banner at the top of the FS view
 */
import { supabase } from "@/integrations/supabase/client";
import { getNCENoteFaceTotal, NCE_CODE_TO_NOTE, NCE_NOTE_FS_MAP } from "@/lib/nceAutoPopulate";
import { signedBalance, signedOpening } from "@/lib/fsSignConvention";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReconStatus = "ok" | "drift_minor" | "drift_severe" | "skipped";

export interface ReconRow {
  /** FS code (e.g. NCE_TP, NCE_OCL) */
  code:        string;
  /** Note type for the engagement-side row (e.g. trade_payables) */
  noteType:    string;
  /** Pattern-A LT/ST column, if applicable */
  col?:        "lt" | "st";
  /** Human-readable label so the FS Health panel can name the offender */
  label:       string;
  /** 2026-06-05 Phase 4 — COA Mapping line-item total, computed fresh from
   *  TB × coa_mapping using signedBalance/signedOpening. This is the
   *  ANCHOR of the three-way reconciliation. */
  coaTotal:    { cy: number; py: number };
  /** Engagement-side note total = what getNCENoteFaceTotal returns */
  noteTotal:   { cy: number; py: number };
  /** What the BS / P&L stat card actually displays (post-applyNCENoteTotal) */
  bsFace:      { cy: number; py: number };
  /** Phase 4 — Manual delta = noteTotal - coaTotal. POSITIVE means the
   *  auditor added manual rows that aren't in COA (legitimate audit
   *  adjustments). NEGATIVE would mean the note is UNDER-reporting COA. */
  manualDelta: { cy: number; py: number };
  /** Signed BS-face deltas (noteTotal - bsFace) — direction preserved.
   *  Phase 4: this stays the "does BS match the note" check. */
  delta:       { cy: number; py: number };
  /** Worst-of-CY-and-PY classification of `delta` (note vs BS face).
   *  "manual" classifies "everything reconciles AND auditor added rows". */
  status:      ReconStatus | "manual";
}

export interface ReconResult {
  rows:        ReconRow[];
  /** True if every reconciled row is "ok" or "skipped" */
  allOk:       boolean;
  /** Total count of severe drift rows */
  severeCount: number;
  /** Total count of minor drift rows */
  minorCount:  number;
  /** Generated timestamp */
  computedAt:  string;
}

// ─── Pure validator ───────────────────────────────────────────────────────────

interface ValidateArgs {
  /** Loaded nce_financial_notes rows for the engagement, keyed by note_type */
  nceNotesByType: Record<string, { cy_data?: Record<string, any> | null; py_data?: Record<string, any> | null; note_type?: string }>;
  /** The same face value map used by buildBSRows (nceCyAmounts / ncePyAmounts) */
  bsFaceCy:       Record<string, number>;
  bsFacePy:       Record<string, number>;
  /** Codes whose face value is stored negative (Tally credit convention) — we
   *  flip sign before comparing to the note total. Liability codes typically. */
  liabCodes:      Set<string>;
  /** Tolerance — anything <= ₹1 is silently OK (rounding); >= ₹100 is severe */
  toleranceMinor?: number;
  toleranceSevere?: number;
  /** Phase 4 — pre-computed COA totals keyed by FS code. Optional; when
   *  absent the panel falls back to coaTotal = noteTotal (so manualDelta
   *  reads 0). Pass the result of computeCOATotals here to enable the
   *  three-way breakdown. */
  coaTotals?:    Record<string, { cy: number; py: number }>;
}

export function validateFSReconciliation(args: ValidateArgs): ReconResult {
  const tolMinor  = args.toleranceMinor  ?? 1;
  const tolSevere = args.toleranceSevere ?? 100;
  const out: ReconRow[] = [];

  for (const [code, conf] of Object.entries(NCE_CODE_TO_NOTE)) {
    const noteType = conf.note;
    const col      = conf.col;
    const noteRow  = args.nceNotesByType[noteType];
    if (!noteRow) {
      // No note row for this code — skip (engagement may not have used it).
      continue;
    }

    // For Pattern A codes (with col), the BS face is the LT or ST column total.
    // For Pattern B codes (no col), the BS face is the grand total.
    const pattern: "A" | "B" = col ? "A" : "B";

    const ntCy = getNCENoteFaceTotal(noteRow, "cy", pattern, col, conf.config) ?? 0;
    const ntPy = getNCENoteFaceTotal(noteRow, "py", pattern, col, conf.config) ?? 0;

    // BS face — flip sign for liability codes (stored negative in nceCyAmounts).
    const rawCy = args.bsFaceCy[code] ?? 0;
    const rawPy = args.bsFacePy[code] ?? 0;
    const faceCy = args.liabCodes.has(code) ? -rawCy : rawCy;
    const facePy = args.liabCodes.has(code) ? -rawPy : rawPy;

    // 2026-06-05 Phase 4 — three-way breakdown anchored on the COA Mapping
    // line-item total (computed fresh from TB × signed mapping by
    // computeCOATotals). manualDelta = noteTotal - coaTotal makes the
    // auditor's legitimate manual additions VISIBLE rather than confused
    // with drift.
    const coaTotal = args.coaTotals?.[code] ?? { cy: ntCy, py: ntPy };
    const mdCy = Math.round((ntCy - coaTotal.cy) * 100) / 100;
    const mdPy = Math.round((ntPy - coaTotal.py) * 100) / 100;

    const dCy = Math.round((ntCy - faceCy) * 100) / 100;
    const dPy = Math.round((ntPy - facePy) * 100) / 100;
    const worst         = Math.max(Math.abs(dCy), Math.abs(dPy));
    const manualPresent = Math.max(Math.abs(mdCy), Math.abs(mdPy)) > tolMinor;
    let status: ReconStatus | "manual";
    if (worst >= tolSevere)      status = "drift_severe";
    else if (worst >= tolMinor)  status = "drift_minor";
    else if (manualPresent)      status = "manual";
    else                         status = "ok";

    out.push({
      code, noteType, col,
      label: NCE_NOTE_LABEL[code] || noteType,
      coaTotal,
      noteTotal:   { cy: ntCy, py: ntPy },
      bsFace:      { cy: faceCy, py: facePy },
      manualDelta: { cy: mdCy,  py: mdPy  },
      delta:       { cy: dCy,   py: dPy   },
      status,
    });
  }

  const severeCount = out.filter(r => r.status === "drift_severe").length;
  const minorCount  = out.filter(r => r.status === "drift_minor").length;
  return {
    rows: out,
    allOk: severeCount === 0 && minorCount === 0,
    severeCount,
    minorCount,
    computedAt: new Date().toISOString(),
  };
}

// ─── Corporate FS reconciliation (Phase 6) ──────────────────────────────────
//
// Mirrors validateFSReconciliation but reads from stage5_notes (corporate
// schema) via sumNotesSubRowsCY/PY. Each entry compares:
//   • COA Total  = computeCOATotals[code]  (signed TB × coa_mapping)
//   • Note Total = Σ stage5_notes[section][key].breakup[*].amount_cy
//   • BS Face    = computedAmounts[code] / computedAmountsPY[code]
//
// Corporate face is stored with the natural-side convention (positive
// numbers irrespective of head nature) — so no sign flip is applied here,
// unlike NCE where liability codes are stored negative.

import type { Stage5Notes } from "@/lib/notesAutoPopulate";
import { sumNotesSubRowsCY, sumNotesSubRowsPY } from "@/lib/notesAutoPopulate";

/** CORP FS code → { section, key, label } used by the corporate validator.
 *  Sourced from CORP_ENTRIES in notesMismatch.ts and FS_CODE_TO_NOTE_KEY in
 *  PipelineFinancialStatements so the two surfaces always agree. PPE is
 *  excluded — its detail lives in the FA grid (bespoke structure). */
export const CORP_CODE_TO_NOTE: Record<string, { section: "bs_liab" | "bs_asset" | "pl"; key: string; label: string }> = {
  BS_EQ_SC:    { section: "bs_liab",  key: "share_capital",        label: "Share Capital" },
  BS_EQ_RS:    { section: "bs_liab",  key: "reserves_surplus",     label: "Reserves and Surplus" },
  BS_NCL_LTB:  { section: "bs_liab",  key: "lt_borrowings",        label: "Long-term Borrowings" },
  BS_NCL_DTL:  { section: "bs_liab",  key: "deferred_tax_liab",    label: "Deferred Tax Liab (Net)" },
  BS_NCL_OLT:  { section: "bs_liab",  key: "other_lt_liab",        label: "Other LT Liabilities" },
  BS_NCL_LTP:  { section: "bs_liab",  key: "lt_provisions",        label: "Long-term Provisions" },
  BS_CL_STB:   { section: "bs_liab",  key: "st_borrowings",        label: "Short-term Borrowings" },
  BS_CL_TP:    { section: "bs_liab",  key: "trade_payables",       label: "Trade Payables" },
  BS_CL_OCL:   { section: "bs_liab",  key: "other_current_liab",   label: "Other Current Liabilities" },
  BS_CL_STP:   { section: "bs_liab",  key: "st_provisions",        label: "Short-term Provisions" },
  BS_NCA_INV:  { section: "bs_asset", key: "nc_investments",       label: "Non-current Investments" },
  BS_NCA_DTA:  { section: "bs_asset", key: "deferred_tax_assets",  label: "Deferred Tax Assets (Net)" },
  BS_NCA_LLA:  { section: "bs_asset", key: "lt_loans_advances",    label: "LT Loans and Advances" },
  BS_NCA_ONA:  { section: "bs_asset", key: "other_nc_assets",      label: "Other Non-current Assets" },
  BS_CA_CI:    { section: "bs_asset", key: "current_investments",  label: "Current Investments" },
  BS_CA_INV:   { section: "bs_asset", key: "inventories",          label: "Inventories" },
  BS_CA_TR:    { section: "bs_asset", key: "trade_receivables",    label: "Trade Receivables" },
  BS_CA_CCE:   { section: "bs_asset", key: "cash_bank",            label: "Cash and Bank" },
  BS_CA_SLA:   { section: "bs_asset", key: "st_loans_advances",    label: "ST Loans and Advances" },
  BS_CA_OCA:   { section: "bs_asset", key: "other_current_assets", label: "Other Current Assets" },
  PL_REV_OPS:  { section: "pl",       key: "revenue_from_ops",     label: "Revenue from Operations" },
  PL_REV_OI:   { section: "pl",       key: "other_income",         label: "Other Income" },
  PL_EXP_MAT:  { section: "pl",       key: "cost_materials",       label: "Cost of Materials Consumed" },
  PL_EXP_SIT:  { section: "pl",       key: "purchases_stock",      label: "Purchases of Stock-in-Trade" },
  PL_EXP_CII:  { section: "pl",       key: "changes_inventories",  label: "Changes in Inventories" },
  PL_EXP_EMP:  { section: "pl",       key: "employee_benefits",    label: "Employee Benefits" },
  PL_EXP_FIN:  { section: "pl",       key: "finance_costs",        label: "Finance Costs" },
  PL_EXP_DEP:  { section: "pl",       key: "depreciation",         label: "Depreciation" },
  PL_EXP_OTH:  { section: "pl",       key: "other_expenses",       label: "Other Expenses" },
};

interface ValidateCorporateArgs {
  corporateNotes:    Stage5Notes | null | undefined;
  bsFaceCy:          Record<string, number>;
  bsFacePy:          Record<string, number>;
  coaTotals?:        Record<string, { cy: number; py: number }>;
  toleranceMinor?:   number;
  toleranceSevere?:  number;
}

export function validateCorporateFSReconciliation(args: ValidateCorporateArgs): ReconResult {
  const tolMinor  = args.toleranceMinor  ?? 1;
  const tolSevere = args.toleranceSevere ?? 100;
  const out: ReconRow[] = [];

  for (const [code, meta] of Object.entries(CORP_CODE_TO_NOTE)) {
    const ntCy = sumNotesSubRowsCY(args.corporateNotes ?? null, meta.section, meta.key);
    const ntPy = sumNotesSubRowsPY(args.corporateNotes ?? null, meta.section, meta.key);
    // Corporate face is stored on the natural side (already positive); no
    // liab-flip needed. Skip codes whose note is unpopulated AND whose face
    // is also zero — silent unused notes shouldn't clutter the panel.
    const faceCy = args.bsFaceCy[code] ?? 0;
    const facePy = args.bsFacePy[code] ?? 0;
    if (ntCy == null && ntPy == null && Math.abs(faceCy) < 0.005 && Math.abs(facePy) < 0.005) continue;

    const noteCy = ntCy ?? 0;
    const notePy = ntPy ?? 0;

    const coaTotal = args.coaTotals?.[code] ?? { cy: noteCy, py: notePy };
    const mdCy = Math.round((noteCy - coaTotal.cy) * 100) / 100;
    const mdPy = Math.round((notePy - coaTotal.py) * 100) / 100;

    const dCy = Math.round((noteCy - faceCy) * 100) / 100;
    const dPy = Math.round((notePy - facePy) * 100) / 100;
    const worst         = Math.max(Math.abs(dCy), Math.abs(dPy));
    const manualPresent = Math.max(Math.abs(mdCy), Math.abs(mdPy)) > tolMinor;
    let status: ReconStatus | "manual";
    if (worst >= tolSevere)      status = "drift_severe";
    else if (worst >= tolMinor)  status = "drift_minor";
    else if (manualPresent)      status = "manual";
    else                         status = "ok";

    out.push({
      code,
      noteType:    meta.key,
      label:       meta.label,
      coaTotal,
      noteTotal:   { cy: noteCy, py: notePy },
      bsFace:      { cy: faceCy, py: facePy },
      manualDelta: { cy: mdCy,  py: mdPy  },
      delta:       { cy: dCy,   py: dPy   },
      status,
    });
  }

  const severeCount = out.filter(r => r.status === "drift_severe").length;
  const minorCount  = out.filter(r => r.status === "drift_minor").length;
  return {
    rows: out,
    allOk: severeCount === 0 && minorCount === 0,
    severeCount,
    minorCount,
    computedAt: new Date().toISOString(),
  };
}

// ─── computeCOATotals — anchor for the three-way reconciliation ─────────────
//
// Sums the signed TB amount of every ledger mapped to each FS code, using
// the canonical signedBalance / signedOpening from fsSignConvention. The
// returned totals are what the COA Mapping page displays at the bottom of
// each line item — i.e. the "truth" extracted directly from Tally.
//
// The function is pure (no DB calls) — pass the engagement's trial balance
// rows and coa_mapping object. The caller (PipelineFinancialStatements)
// already loads both for other purposes, so this just rehashes them.
//
// Pattern A codes: codes that own LT/ST splits (NCE_LTB/NCE_STB etc.) are
// computed independently from the ledgers whose mapping.code matches. The
// caller picks the right key — for borrowings we expose BOTH NCE_LTB and
// NCE_STB so the panel can display each row separately.
//
// Sign convention follows the FS code's natural side (FS_CODE_NATURE).
// Liabilities and equity stay positive when the ledger is Cr; the BS face
// flip-sign step in validateFSReconciliation already brings them onto the
// same axis as the note total.

export interface TBRowLike {
  ledger_name:      string;
  closing_balance?: number | null;
  balance_type?:    string | null;
  opening_balance?: number | null;
  opening_type?:    string | null;
}

export interface COAMappingLike {
  [ledger_name: string]: { code: string } | undefined;
}

/** Build a code → noteType reverse index from NCE_NOTE_FS_MAP so each
 *  ledger's contribution is signed under the NOTE's natural side (the
 *  same convention nceAutoPopulate uses everywhere).
 *  PERF: computed once at module load (pure static data). */
const CODE_TO_NOTE_TYPE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [noteType, fs] of Object.entries(NCE_NOTE_FS_MAP)) {
    for (const code of (fs.all ?? [])) out[code] = noteType;
    for (const code of (fs.lt  ?? [])) out[code] = noteType;
    for (const code of (fs.st  ?? [])) out[code] = noteType;
  }
  return out;
})();

export function computeCOATotals(
  tb:         TBRowLike[],
  pyTb:       TBRowLike[],
  coaMapping: COAMappingLike,
  pyCoaMap?:  COAMappingLike,
): Record<string, { cy: number; py: number }> {
  const out: Record<string, { cy: number; py: number }> = {};

  // CY pass — every CY-TB ledger contributes signed closing under the
  // CURRENT mapping. Captured into out[mapping.code] = { cy: Σ, py: Σ_opening }.
  for (const row of tb) {
    const mapped = coaMapping[row.ledger_name];
    if (!mapped?.code) continue;
    const noteType = CODE_TO_NOTE_TYPE[mapped.code] ?? mapped.code;
    const cy = signedBalance(row.closing_balance, row.balance_type, noteType);
    // PY for a CY ledger = its signed OPENING balance (= prior-year close
    // by accounting identity). When the engagement also has a PY-shell TB,
    // the PY pass below overrides with the shell's actual closing.
    const py = signedOpening(row.opening_balance, row.opening_type, noteType);
    const slot = (out[mapped.code] ||= { cy: 0, py: 0 });
    slot.cy += cy;
    slot.py += py;
  }

  // PY pass — for ledgers present ONLY in PY shell (CLOSED in CY), feed
  // their PY contribution. Pre-CY ledgers handled above; here we just
  // augment the PY column for ledgers whose CY mapping is absent (the CY
  // pass would have written nothing for them).
  if (pyTb.length > 0) {
    const cySeen = new Set(tb.map(r => (r.ledger_name || "").trim().toLowerCase()));
    for (const row of pyTb) {
      const nm = (row.ledger_name || "").trim();
      if (!nm) continue;
      if (cySeen.has(nm.toLowerCase())) continue; // already paired by the CY pass
      const mapped = pyCoaMap?.[nm] ?? coaMapping[nm];
      if (!mapped?.code) continue;
      const noteType = CODE_TO_NOTE_TYPE[mapped.code] ?? mapped.code;
      const slot = (out[mapped.code] ||= { cy: 0, py: 0 });
      slot.py += signedBalance(row.closing_balance, row.balance_type, noteType);
    }
  }

  // Round each total to 2 decimals so the panel comparison aligns with the
  // signed-TB display elsewhere.
  for (const k of Object.keys(out)) {
    out[k].cy = Math.round(out[k].cy * 100) / 100;
    out[k].py = Math.round(out[k].py * 100) / 100;
  }
  return out;
}

// ─── Optional: persist severe drift to fs_reconciliation_log ──────────────────
//
// Only severe drift is persisted (|delta| >= ₹100) to keep the log table
// noise-free. Use this to build an admin "FS Drift History" view.

export async function logReconciliationDrift(
  engagementId: string,
  userId: string | null,
  result: ReconResult,
): Promise<void> {
  const drifts = result.rows.filter(r => r.status === "drift_severe");
  if (drifts.length === 0) return;
  try {
    const rows = drifts.map(d => ({
      engagement_id: engagementId,
      code:          d.code,
      note_type:     d.noteType,
      col:           d.col ?? null,
      note_total_cy: d.noteTotal.cy,
      note_total_py: d.noteTotal.py,
      bs_face_cy:    d.bsFace.cy,
      bs_face_py:    d.bsFace.py,
      delta_cy:      d.delta.cy,
      delta_py:      d.delta.py,
      changed_by:    userId,
    }));
    await (supabase as any).from("fs_reconciliation_log").insert(rows);
  } catch {
    // Best-effort logging — never block FS rendering on a log failure.
  }
}

// ─── Human-readable labels for the FS Health panel ────────────────────────────

const NCE_NOTE_LABEL: Record<string, string> = {
  NCE_LTB:     "Long-Term Borrowings",
  NCE_STB:     "Short-Term Borrowings",
  NCE_OLTL:    "Other LT Liabilities",
  NCE_LTP:     "Long-Term Provisions",
  NCE_STP:     "Short-Term Provisions",
  NCE_TP:      "Trade Payables",
  NCE_OCL:     "Other Current Liabilities",
  NCE_CWIP:    "Capital WIP",
  NCE_NCINV:   "Long-Term Investments",
  NCE_CINV:    "Current Investments",
  NCE_LTLA:    "Long-Term Loans & Advances",
  NCE_STLA:    "Short-Term Loans & Advances",
  NCE_ONCA:    "Other Non-Current Assets",
  NCE_STCK:    "Inventories",
  NCE_TR:      "Trade Receivables",
  NCE_CASH:    "Cash & Bank Balances",
  NCE_OCA:     "Other Current Assets",
  NCE_REV_OPS: "Revenue from Operations",
  NCE_REV_OTH: "Other Income",
  NCE_EMP_EXP: "Employee Benefits Expense",
  NCE_FIN_COST:"Finance Costs",
  NCE_OTH_EXP: "Other Expenses",
};

/** Default NCE liability codes (face stored negative — sign-flip before comparing). */
export const NCE_LIAB_CODE_SET = new Set([
  "NCE_PCAP", "NCE_RES", "NCE_NCB", "NCE_LTB", "NCE_LTP", "NCE_OLTL",
  "NCE_STB",  "NCE_TP",  "NCE_OCL", "NCE_STP",
]);
