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
import { buildCanonicalNceCode, buildNceLiabCodeSet } from "@/lib/nceNoteRegistry";
import { FS_BLOCK_UNEXPLAINED_DRIFT } from "@/lib/nceFeatureFlags";

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
  /** PD-2 / BUG-087: true if the note actually contains a user-entered manual
   *  customRow. When status === "manual" but this is false, the Note − COA gap
   *  is an UNEXPLAINED engine divergence, not a legitimate audit addition.
   *  Optional: undefined on the corporate path (not computed there yet). */
  manualVerified?: boolean;
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
  /** PD-2 Phase-3 — when true, an unexplained Note≠COA gap (no manual row) is escalated to
   *  drift so it blocks export. Defaults to the FS_BLOCK_UNEXPLAINED_DRIFT flag; overridable
   *  for tests. */
  blockUnexplained?: boolean;
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
    const manualMag     = Math.max(Math.abs(mdCy), Math.abs(mdPy));
    const manualPresent = manualMag > tolMinor;

    // PD-2 / BUG-087: a non-zero manualDelta is only a *legitimate* manual
    // addition if the note actually carries a user-entered manual customRow.
    // Manual rows are serialised under cy_data._custom_rows (see serialiseNoteData).
    const customRowsCy = (noteRow as { cy_data?: { _custom_rows?: Array<{ source?: string }> } })?.cy_data?._custom_rows;
    const manualVerified = Array.isArray(customRowsCy) && customRowsCy.some(r => r?.source === "manual");
    // PD-2 Phase-3 enforcement (FS_BLOCK_UNEXPLAINED_DRIFT, default OFF): an unexplained
    // Note≠COA gap (no backing manual row) is engine divergence, not an audit addition —
    // escalate it to drift so it COUNTS toward severeCount and blocks export. OFF leaves
    // the status logic byte-identical (both new branches are skipped).
    const blockUnexplained = args.blockUnexplained ?? FS_BLOCK_UNEXPLAINED_DRIFT;
    const unexplained = manualPresent && !manualVerified;

    let status: ReconStatus | "manual";
    if (worst >= tolSevere)                                             status = "drift_severe";
    else if (blockUnexplained && unexplained && manualMag >= tolSevere) status = "drift_severe";
    else if (worst >= tolMinor)                                         status = "drift_minor";
    else if (blockUnexplained && unexplained && manualMag >= tolMinor)  status = "drift_minor";
    else if (manualPresent)                                             status = "manual";
    else                                                                status = "ok";

    out.push({
      code, noteType, col,
      label: NCE_NOTE_LABEL[code] || noteType,
      coaTotal,
      noteTotal:   { cy: ntCy, py: ntPy },
      bsFace:      { cy: faceCy, py: facePy },
      manualDelta: { cy: mdCy,  py: mdPy  },
      delta:       { cy: dCy,   py: dPy   },
      status,
      manualVerified,
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
  /** PD-2 Phase-3 — see ValidateArgs.blockUnexplained. */
  blockUnexplained?: boolean;
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

    // BUG-024 / D2.8: computeCOATotals keys its output by the canonical NCE code
    // (CANONICAL_NCE_CODE[mapped.code]); the corporate `code` (e.g. BS_CL_TP) must be
    // folded the SAME way or the lookup misses and the COA anchor silently equals the
    // note total (manualDelta ≡ 0 — the corporate three-way collapses to two-way).
    const coaKey = CANONICAL_NCE_CODE[code] ?? code;
    const coaTotal = args.coaTotals?.[coaKey] ?? { cy: noteCy, py: notePy };
    const mdCy = Math.round((noteCy - coaTotal.cy) * 100) / 100;
    const mdPy = Math.round((notePy - coaTotal.py) * 100) / 100;
    // PD-2 (corporate): does this note carry a user-entered manual breakup row?
    const corpBreakup = (args.corporateNotes as { [s: string]: { [k: string]: { breakup?: Array<{ source?: string }> } } } | null | undefined)?.[meta.section]?.[meta.key]?.breakup;
    const corpManualVerified = Array.isArray(corpBreakup) && corpBreakup.some(r => r?.source === "manual");

    const dCy = Math.round((noteCy - faceCy) * 100) / 100;
    const dPy = Math.round((notePy - facePy) * 100) / 100;
    const worst         = Math.max(Math.abs(dCy), Math.abs(dPy));
    const manualMag     = Math.max(Math.abs(mdCy), Math.abs(mdPy));
    const manualPresent = manualMag > tolMinor;
    // PD-2 Phase-3 enforcement (FS_BLOCK_UNEXPLAINED_DRIFT, default OFF) — see NCE validator.
    const blockUnexplained = args.blockUnexplained ?? FS_BLOCK_UNEXPLAINED_DRIFT;
    const unexplained = manualPresent && !corpManualVerified;
    let status: ReconStatus | "manual";
    if (worst >= tolSevere)                                             status = "drift_severe";
    else if (blockUnexplained && unexplained && manualMag >= tolSevere) status = "drift_severe";
    else if (worst >= tolMinor)                                         status = "drift_minor";
    else if (blockUnexplained && unexplained && manualMag >= tolMinor)  status = "drift_minor";
    else if (manualPresent)                                             status = "manual";
    else                                                                status = "ok";

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
      manualVerified: corpManualVerified,
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

/** 2026-06-12 — Legacy-code fold (RC: SWASTIK "Plot No-43" → BS_CL_STB).
 *  COA mapping on NCE engagements sometimes carries corporate codes
 *  (BS_CL_STB, PL_EXP_OTH, BS_CL_TP_MSME, ...) — the AI mapper or a human
 *  picked the corporate twin of an NCE code. nceAutoPopulate ALREADY
 *  accepts these (every NCE_NOTE_FS_MAP list includes the corporate
 *  variants), so the ledger lands in the note. But computeCOATotals used
 *  to key its output by the RAW mapped code — coaTotals["BS_CL_STB"] —
 *  while validateFSReconciliation looks up coaTotals["NCE_STB"]. The
 *  amount silently vanished from the COA anchor → phantom manual-delta /
 *  drift on the panel for any engagement using a legacy code.
 *  Fold target = the FIRST code in the same NCE_NOTE_FS_MAP list (always
 *  the canonical NCE_* code). */
// Phase 6 — DERIVED from the single-source nceNoteRegistry (was an inline IIFE
// over NCE_NOTE_FS_MAP). Equity codes are never folded; parity test asserts
// byte-for-byte equality with the prior fold.
export const CANONICAL_NCE_CODE: Record<string, string> = buildCanonicalNceCode();

export function computeCOATotals(
  tb:         TBRowLike[],
  pyTb:       TBRowLike[],
  coaMapping: COAMappingLike,
  pyCoaMap?:  COAMappingLike,
): Record<string, { cy: number; py: number }> {
  const out: Record<string, { cy: number; py: number }> = {};

  // 2026-06-12 — Hardening (latent-RC audit):
  //   • Lookup fallback: exact name → trimmed name. The CY pass previously
  //     used ONLY exact match while the PY pass trimmed — a trailing space
  //     in either the TB name or the mapping key silently dropped the
  //     ledger from one column but not the other.
  //   • Exact-duplicate dedupe: if the same ledger name appears twice in
  //     the TB rows (double sync without cleanup), only the LAST row
  //     counts — matching what Tally itself would report.
  //   • Legacy-code fold: out[] is keyed by CANONICAL_NCE_CODE so a
  //     ledger mapped to BS_CL_STB lands in coaTotals["NCE_STB"] — the
  //     key the validator actually reads.
  // 2026-06-13 — RC-16 fix (MAHIL "Gst Payable" vs mapping key "GST PAYABLE").
  // nceAutoPopulate matches ledgers CASE-INSENSITIVELY, so its note total
  // includes a case-mismatched ledger; computeCOATotals previously used only
  // exact + trimmed lookup (case-SENSITIVE) and dropped that ledger from the
  // anchor → the FsHealthPanel reported a phantom "+manual adjustment" that no
  // auditor ever entered. Build a case-insensitive index (trim+lowercase) as
  // the final fallback so the anchor resolves ledgers exactly like the note
  // auto-populate does. First-writer-wins on duplicate keys; truly conflicting
  // duplicate keys (same name, different code) are a separate data-hygiene
  // item (exact/trim match still wins for the live TB-name variant).
  const ciIndex: Record<string, { code: string }> = {};
  for (const [k, v] of Object.entries(coaMapping)) {
    if (!v?.code) continue;
    const kk = String(k).trim().toLowerCase();
    if (!(kk in ciIndex)) ciIndex[kk] = v;
  }
  const lookupMapping = (name: string) => {
    if (!name) return undefined;
    return coaMapping[name]
        ?? coaMapping[name.trim()]
        ?? ciIndex[String(name).trim().toLowerCase()];
  };
  const dedupe = (rows: TBRowLike[]): TBRowLike[] => {
    const byName = new Map<string, TBRowLike>();
    for (const r of rows) {
      const nm = String(r.ledger_name ?? "");
      if (!nm) continue;
      byName.set(nm, r); // last row wins
    }
    return [...byName.values()];
  };

  // CY pass — every CY-TB ledger contributes its signed closing balance to
  // the CY column. For PY: prefer the PY-shell TB's actual closing (computed
  // in the PY pass below); fall back to signed OPENING when there is no
  // pyTb (e.g. legacy engagements without a PY shell). signedOpening is
  // accounting-identity correct for BS codes (PY close == CY open) but is
  // ALWAYS 0 for P&L codes (income / expense ledgers always open at 0 in
  // Tally), so the fallback only carries BS values — exactly what we want.
  const hasPyTb = pyTb.length > 0;
  for (const row of dedupe(tb)) {
    const mapped = lookupMapping(String(row.ledger_name ?? ""));
    if (!mapped?.code) continue;
    const code = CANONICAL_NCE_CODE[mapped.code] ?? mapped.code;
    const noteType = CODE_TO_NOTE_TYPE[code] ?? code;
    const cy = signedBalance(row.closing_balance, row.balance_type, noteType);
    const slot = (out[code] ||= { cy: 0, py: 0 });
    slot.cy += cy;
    if (!hasPyTb) {
      slot.py += signedOpening(row.opening_balance, row.opening_type, noteType);
    }
  }

  // PY pass — when a PY-shell TB exists, it is the AUTHORITATIVE source of
  // every PY column value (BS opening = prior close, AND P&L gets the
  // proper revenue / expense figures that signedOpening can never produce).
  // Sums every PY ledger's signed closing under its mapping. The CY pass
  // above intentionally skipped PY for these so the PY pass owns it cleanly.
  // Case-insensitive index for the PY-specific mapping (when supplied) — same
  // RC-16 rationale as the CY index above.
  const pyCiIndex: Record<string, { code: string }> = {};
  if (pyCoaMap) {
    for (const [k, v] of Object.entries(pyCoaMap)) {
      if (!v?.code) continue;
      const kk = String(k).trim().toLowerCase();
      if (!(kk in pyCiIndex)) pyCiIndex[kk] = v;
    }
  }
  if (hasPyTb) {
    for (const row of dedupe(pyTb)) {
      const nm = (row.ledger_name || "").trim();
      if (!nm) continue;
      const mapped = pyCoaMap?.[nm] ?? pyCoaMap?.[row.ledger_name ?? ""]
                  ?? pyCiIndex[nm.toLowerCase()] ?? lookupMapping(nm);
      if (!mapped?.code) continue;
      const code = CANONICAL_NCE_CODE[mapped.code] ?? mapped.code;
      const noteType = CODE_TO_NOTE_TYPE[code] ?? code;
      const slot = (out[code] ||= { cy: 0, py: 0 });
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
  } catch (e) {
    // Best-effort logging — never block FS rendering on a log failure.
    // BUG-112: surface the failure (e.g. a missing fs_reconciliation_log table/column)
    // so the severe-drift audit trail (Invariant 6) does not silently no-op.
    // eslint-disable-next-line no-console
    console.warn("[fs-reconciliation] failed to write fs_reconciliation_log:", e);
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

/** Default NCE liability + income codes — every Cr-natural face value (stored
 *  NEGATIVE under the Tally credit convention) needs a sign-flip before its
 *  POSITIVE Note Total can be compared. Liability codes (BS_EQ + BS_LIAB) AND
 *  income codes (P&L revenue/other income) ALL belong here. Previously the
 *  set was BS-liability-only, so PL income codes (NCE_REV_OPS, NCE_REV_OTH)
 *  reported a phantom drift of 2× the note total on EVERY engagement that
 *  had any revenue mapped — the canonical recurring "FS Health: 2 notes have
 *  drift > ₹100" SHRI RAM symptom.
 *  Capital Account (NCE_CAP) is added so the smart-gated auto-credit doesn't
 *  surface as drift either. */
// Phase 6 — DERIVED from the single-source nceNoteRegistry (was a hand-literal).
export const NCE_LIAB_CODE_SET = buildNceLiabCodeSet();

// ─── Opening-vs-PriorClose gate — single PY source enforcement ───────────────
//
// Accounting identity: a BALANCE-SHEET ledger's CURRENT-YEAR opening balance
// MUST equal its PRIOR-YEAR closing balance. CAFlow sources PY exclusively
// from the PY-Shell trial balance closing, and the COA Mapping page is frozen
// to Tally Sync (current-year opening). This validator compares the two per
// ledger; on any mismatch > tolerance the caller BLOCKS FS generation and
// names the offending ledger(s) so the user fixes the source in Tally —
// instead of silently overwriting one number with the other.
//
// Scope = BALANCE-SHEET ledgers only. P&L ledgers always open at 0 in Tally
// while their PY-shell closing carries last year's revenue/expense, so the
// identity does not apply — they are skipped via isBSCode(). Unmapped ledgers
// are skipped too (mapping-completeness is a separate gate).
//
// Only runs when a PY-Shell TB is present; first-year / no-shell engagements
// have nothing to reconcile against and are not blocked by this check.

/** P&L note types from NCE_NOTE_FS_MAP — everything else is Balance Sheet. */
const PL_NOTE_TYPES = new Set<string>([
  "revenue_ops", "other_income", "cogs",
  "employee_exp", "finance_costs", "other_expenses",
]);

/** BS FS codes derived from the canonical note→code map (all non-P&L note
 *  types). Used to scope the opening/closing identity to Balance Sheet codes. */
const BS_CODE_SET: Set<string> = (() => {
  const s = new Set<string>();
  for (const [noteType, fs] of Object.entries(NCE_NOTE_FS_MAP)) {
    if (PL_NOTE_TYPES.has(noteType)) continue;
    for (const c of [...(fs.all ?? []), ...(fs.lt ?? []), ...(fs.st ?? [])]) s.add(c);
  }
  return s;
})();

/** Conservative BS classifier: BS_ and INV_ prefixes plus the derived NCE BS
 *  set. Anything ambiguous (depreciation, tax, partner remuneration, P&L) is
 *  NOT BS, so it is skipped and can never produce a false opening/close
 *  mismatch. */
function isBSCode(code: string | undefined | null): boolean {
  if (!code) return false;
  if (code.startsWith("BS_")) return true;
  if (code.startsWith("INV_")) return true;
  return BS_CODE_SET.has(code);
}

export interface OpeningMismatchRow {
  /** Current-year ledger name (display). */
  ledger:    string;
  /** Mapped FS code (always a BS code). */
  code:      string;
  /** Signed CY Tally opening (debit-positive). */
  cyOpening: number;
  /** Signed PY-shell closing (debit-positive). */
  pyClosing: number;
  /** cyOpening − pyClosing. */
  diff:      number;
  /** "cy_vs_py" = ledger exists both years and disagrees;
   *  "py_only"  = PY-shell ledger whose closing was never carried to CY. */
  kind:      "cy_vs_py" | "py_only";
}

export interface OpeningReconResult {
  mismatches: OpeningMismatchRow[];
  allOk:      boolean;
  /** True only when a PY-shell TB was actually present (gate active). */
  hasShell:   boolean;
  computedAt: string;
}

const normName = (s: string | null | undefined): string =>
  String(s ?? "").trim().toLowerCase();

export function validateOpeningVsPriorClose(args: {
  cyTb:       TBRowLike[];
  pyShellTb:  TBRowLike[];
  coaMapping: COAMappingLike;
  /** prior_ledger_name → current_ledger_name (handles renames). */
  aliases?:   Record<string, string>;
  tolerance?: number;
}): OpeningReconResult {
  const tol = args.tolerance ?? 100;
  const computedAt = new Date().toISOString();
  const hasShell = (args.pyShellTb?.length ?? 0) > 0;
  if (!hasShell) return { mismatches: [], allOk: true, hasShell: false, computedAt };

  // Case-insensitive mapping lookup (mirrors computeCOATotals).
  const ciIndex: Record<string, { code: string }> = {};
  for (const [k, v] of Object.entries(args.coaMapping || {})) {
    if (!v?.code) continue;
    const kk = normName(k);
    if (!(kk in ciIndex)) ciIndex[kk] = v;
  }
  const codeOf = (name: string): string | undefined =>
    (args.coaMapping?.[name] ?? args.coaMapping?.[name.trim()] ?? ciIndex[normName(name)])?.code;

  // PY-shell signed closing keyed by EFFECTIVE CURRENT name (alias-resolved)
  // so a renamed ledger lines up with its current-year counterpart.
  const aliasMap = args.aliases ?? {};
  const pyByCurrent = new Map<string, { closing: number; origName: string; effName: string }>();
  for (const r of args.pyShellTb) {
    const raw = String(r.ledger_name ?? "");
    if (!raw) continue;
    const effName = aliasMap[raw] ?? aliasMap[raw.trim()] ?? raw;
    pyByCurrent.set(normName(effName), {
      closing: signedBalance(r.closing_balance, r.balance_type, "DR"),
      origName: raw,
      effName,
    });
  }

  const mismatches: OpeningMismatchRow[] = [];
  const seenCurrent = new Set<string>();

  // Pass 1 — every CY BS ledger: signed opening must equal the PY-shell close.
  for (const r of args.cyTb) {
    const name = String(r.ledger_name ?? "");
    if (!name) continue;
    const key = normName(name);
    seenCurrent.add(key);
    const code = codeOf(name);
    if (!isBSCode(code)) continue;
    const cyOpening = signedOpening(r.opening_balance, r.opening_type, "DR");
    const pyClosing = pyByCurrent.get(key)?.closing ?? 0;
    const diff = Math.round((cyOpening - pyClosing) * 100) / 100;
    if (Math.abs(diff) > tol) {
      mismatches.push({ ledger: name, code: code!, cyOpening, pyClosing, diff, kind: "cy_vs_py" });
    }
  }

  // Pass 2 — PY-shell BS ledgers with a non-zero close that never appear in
  // the CY TB: their opening was not carried forward this year.
  for (const [key, py] of pyByCurrent) {
    if (seenCurrent.has(key)) continue;
    if (Math.abs(py.closing) <= tol) continue;
    const code = codeOf(py.effName) ?? codeOf(py.origName);
    if (!isBSCode(code)) continue;
    mismatches.push({
      ledger: py.origName, code: code!, cyOpening: 0,
      pyClosing: py.closing, diff: Math.round(-py.closing * 100) / 100,
      kind: "py_only",
    });
  }

  return {
    mismatches: mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
    allOk: mismatches.length === 0,
    hasShell: true,
    computedAt,
  };
}
