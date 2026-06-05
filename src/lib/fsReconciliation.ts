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
import { getNCENoteFaceTotal, NCE_CODE_TO_NOTE } from "@/lib/nceAutoPopulate";

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
  /** Engagement-side note total = what getNCENoteFaceTotal returns */
  noteTotal:   { cy: number; py: number };
  /** What the BS / P&L stat card actually displays (post-applyNCENoteTotal) */
  bsFace:      { cy: number; py: number };
  /** Signed deltas (noteTotal - bsFace) — direction is preserved */
  delta:       { cy: number; py: number };
  /** Worst-of-CY-and-PY classification */
  status:      ReconStatus;
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

    const ntCy = getNCENoteFaceTotal(noteRow, "cy", pattern, col) ?? 0;
    const ntPy = getNCENoteFaceTotal(noteRow, "py", pattern, col) ?? 0;

    // BS face — flip sign for liability codes (stored negative in nceCyAmounts).
    const rawCy = args.bsFaceCy[code] ?? 0;
    const rawPy = args.bsFacePy[code] ?? 0;
    const faceCy = args.liabCodes.has(code) ? -rawCy : rawCy;
    const facePy = args.liabCodes.has(code) ? -rawPy : rawPy;

    const dCy = Math.round((ntCy - faceCy) * 100) / 100;
    const dPy = Math.round((ntPy - facePy) * 100) / 100;
    const worst = Math.max(Math.abs(dCy), Math.abs(dPy));
    const status: ReconStatus =
      worst < tolMinor   ? "ok"
    : worst < tolSevere  ? "drift_minor"
                         : "drift_severe";

    out.push({
      code, noteType, col,
      label: NCE_NOTE_LABEL[code] || noteType,
      noteTotal: { cy: ntCy, py: ntPy },
      bsFace:    { cy: faceCy, py: facePy },
      delta:     { cy: dCy,   py: dPy   },
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
