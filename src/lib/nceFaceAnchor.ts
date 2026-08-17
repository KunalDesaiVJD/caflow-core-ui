/**
 * nceFaceAnchor — RC2/RC3/RC4/RC6 cure (2026-06-22): derive the NCE BS/P&L FACE
 * for every code DIRECTLY from the sign-corrected COA anchor, so the face can
 * never be moved off COA by a manual note addition, an LT/ST split that
 * disagrees with the code, a contaminated seed, or an un-reconciled note.
 *
 * Gated by FS_NO_MANUAL_NOTE_ADD (firm policy: "manual note additions are not
 * allowed"). When ON, PipelineFinancialStatements overrides each NCE code's face
 * with computeNceCoaAnchoredFace(coaTotalsByCode), then the existing residual
 * absorber credits the leftover (= the current-year result not yet in Owners'
 * Capital) to NCE_CAP — a legitimate profit transfer, not a mask, because every
 * other line now equals COA. Net effect, proven by the per-engagement
 * reconciliation harness: every COA line = Note total = Face, and the BS ties.
 *
 * Sign axis: this returns the FACE axis (Dr-POSITIVE) used by nceCyAmounts —
 * Dr-natural codes positive, Cr-natural codes NEGATIVE (matches the existing
 * `nature === "CR" ? -total : total` convention). coaTotals values are
 * natural-side-positive (the computeCOATotals output), so we flip Cr codes.
 *
 * NCE-ONLY. Corporate codes/faces are never touched here.
 */
import { FS_CODE_NATURE } from "@/lib/fsSignConvention";

/** Asset codes that roll into NCE_AST (Dr-natural). */
export const NCE_ASSET_CODES = [
  "NCE_PPE", "NCE_CWIP", "NCE_INTG", "NCE_NCINV", "NCE_LTLA", "NCE_ONCA",
  "NCE_CINV", "NCE_STCK", "NCE_TR", "NCE_CASH", "NCE_STLA", "NCE_OCA",
] as const;

/** Liability + equity codes that roll into NCE_EL (Cr-natural). */
export const NCE_LIAB_CODES = [
  "NCE_CAP", "NCE_LTB", "NCE_OLTL", "NCE_LTP", "NCE_STB", "NCE_TP", "NCE_OCL", "NCE_STP",
] as const;

export const NCE_PL_INC_CODES = ["NCE_REV_OPS", "NCE_REV_OTH"] as const;

/** P&L expense leaves. NCE_CII is special (no COA ledger → derived from stock). */
export const NCE_PL_EXP_CODES = [
  "NCE_COGS", "NCE_CII", "NCE_EMP_EXP", "NCE_FIN_COST", "NCE_DEPR", "NCE_OTH_EXP",
  "NCE_PART_REM", "NCE_CUR_TAX", "NCE_PRIOR_TAX", "NCE_DEFER_TAX", "NCE_EXCEP", "NCE_EXTORD",
] as const;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface CoaAnchoredFace {
  /** code → face value on the Dr-positive axis (Cr codes negative). */
  face: Record<string, number>;
  /** Σ assets + Σ liab(signed) = the BS imbalance = the result to credit to Capital. */
  residual: number;
  /** True when face["NCE_CII"] was genuinely derived from stock movement for
   *  this column (always true for "cy"; true for "py" only when the PY-shell
   *  TB's own opening stock was available). When false, face["NCE_CII"] is a
   *  placeholder 0 and the caller should keep the note-entered PY value instead
   *  of overriding the face with it. */
  ciiDerived: boolean;
}

/**
 * Build the COA-anchored face for one column from the corrected COA totals.
 * @param coa    computeCOATotals output: code → { cy, py } (natural-side positive).
 * @param column "cy" (default) or "py".
 */
export function computeNceCoaAnchoredFace(
  coa: Record<string, { cy: number; py: number; pyOpen?: number }> | undefined | null,
  column: "cy" | "py" = "cy",
): CoaAnchoredFace {
  const C = coa ?? {};
  const raw = (code: string) => (column === "cy" ? C[code]?.cy : C[code]?.py) ?? 0;
  // Face axis: Dr-natural positive, Cr-natural negative.
  const signed = (code: string) => {
    const nat = FS_CODE_NATURE[code] ?? "CR";
    return round2(nat === "CR" ? -raw(code) : raw(code));
  };

  const face: Record<string, number> = {};
  for (const code of [...NCE_ASSET_CODES, ...NCE_LIAB_CODES, ...NCE_PL_INC_CODES, ...NCE_PL_EXP_CODES]) {
    face[code] = signed(code);
  }

  // RC4 — Changes in Inventory has NO COA ledger; derive it from stock movement.
  // CII = opening stock − closing stock (Dr-natural: a stock increase is a
  // credit to the P&L, i.e. negative cost). column "cy": closing = C.cy,
  // opening = C.py (PY-shell closing, or signedOpening when no shell). Validated
  // to the rupee against the auditors' manual CII on DBS & SUKIRTI.
  const stkClose = (C["NCE_STCK"]?.cy) ?? 0;
  const stkOpen = (C["NCE_STCK"]?.py) ?? 0;
  let ciiDerived = false;
  if (column === "cy") { face["NCE_CII"] = round2(stkOpen - stkClose); ciiDerived = true; }

  // PY column — same stock-movement identity, one year earlier: PY's closing
  // stock is C.py (already the PY-shell TB's own closing), and PY's OPENING
  // stock is the PY-shell TB's own opening_balance (pyOpen — the balance at
  // the start of the PY period, i.e. closing two years back). pyOpen is only
  // populated when a PY shell TB was loaded (computeCOATotals); when absent,
  // leave NCE_CII at the generic signed(code) value (0, since it has no COA
  // ledger) so the caller's existing "keep the note value" fallback applies.
  if (column === "py") {
    const pyStkOpen = C["NCE_STCK"]?.pyOpen;
    if (pyStkOpen != null) {
      const pyStkClose = (C["NCE_STCK"]?.py) ?? 0;
      face["NCE_CII"] = round2(pyStkOpen - pyStkClose);
      ciiDerived = true;
    }
  }

  // Tax parent = sum of the three tax leaves (used by the profit chain).
  face["NCE_TAX"] = round2((face["NCE_CUR_TAX"] || 0) + (face["NCE_PRIOR_TAX"] || 0) + (face["NCE_DEFER_TAX"] || 0));

  // Residual: assets (positive) + liabilities (negative) = the imbalance that
  // equals the current-year result not yet carried to Owners' Capital.
  const ast = NCE_ASSET_CODES.reduce((s, c) => s + (face[c] || 0), 0);
  const el = NCE_LIAB_CODES.reduce((s, c) => s + (face[c] || 0), 0);
  const residual = round2(ast + el);

  return { face, residual, ciiDerived };
}
