/**
 * fsSignConvention — the SINGLE source of truth for "what sign should a TB
 * ledger contribute to its FS code / note total?"
 *
 * Phase 1 of the FS Re-Architecture extracted this from nceAutoPopulate.ts
 * (signedLedgerAmt / signedLedgerOpeningAmt) and from PipelineStage3.tsx
 * (~14 inlined `isDr ? cb : -cb` callsites). Every NEW sign-derivation
 * callsite anywhere in the codebase must call signedBalance / signedOpening
 * from this module — never reach for `balance_type === "DR" ? ... : ...`
 * inline. That convention is what keeps the BS / P&L / Notes triangle
 * reconciled across all NCE + Corporate engagements.
 *
 * Sign rule (the only one):
 *   POSITIVE when the TB row's balance_type matches the note's natural side
 *   (Cr ledger inside a Cr-natural head, or Dr inside a Dr-natural head).
 *   NEGATIVE for opposite-side balances (contra entry, advance from a
 *   creditor sitting Dr, sundry debtor sitting Cr, etc.) — these REDUCE
 *   the group total, mirroring how the underlying accounting works.
 *
 * Why noteType (not the FS code) drives the lookup:
 *   NCE engagements use the NCE_* code namespace that doesn't follow the
 *   corporate BS_CL_/BS_NCL_/PL_EXP_ prefix convention, so we can't infer
 *   nature from a code prefix universally. Every NCE customer of this
 *   module knows its noteType, and the noteType ↔ codes mapping is
 *   one-to-many — keyed off noteType lets one switch govern all codes
 *   that aggregate into the same note.
 *
 * For non-note callers (PipelineStage3's debit-positive TB normalisation),
 * the helpers accept a literal "DR" or "CR" nature in place of noteType,
 * so the same function services both paths.
 */

// ─── Note nature ─────────────────────────────────────────────────────────────
//
// Every noteType used by the NCE financial statements maps to "DR" or "CR".
// Liabilities / Equity / Income are Cr-natural; Assets / Expenses are Dr-
// natural. This is identical to NOTE_NATURE in nceAutoPopulate.ts (which
// now re-exports from here for backward compatibility).

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

// ─── FS code nature ──────────────────────────────────────────────────────────
//
// Every NCE + Corporate FS code used by COA mapping / FS face value.
// Phase 2 will reconcile this against COA mapping line-item totals — so
// the table here must be exhaustive. New codes added later MUST register
// here AND in NOTE_NATURE (if they own a noteType) at the same time.

export const FS_CODE_NATURE: Record<string, "DR" | "CR"> = {
  // ── NCE — Equity / Capital Account (Cr-natural) ──────────────────────────
  NCE_PCAP:    "CR",
  NCE_RES:     "CR",
  NCE_NCB:     "CR",
  NCE_CAP:     "CR",
  // ── NCE — Liabilities (Cr-natural) ───────────────────────────────────────
  NCE_LTB:     "CR",
  NCE_STB:     "CR",
  NCE_OLTL:    "CR",
  NCE_LTP:     "CR",
  NCE_STP:     "CR",
  NCE_TP:      "CR",
  NCE_OCL:     "CR",
  // ── NCE — Assets (Dr-natural) ────────────────────────────────────────────
  NCE_CWIP:    "DR",
  NCE_NCINV:   "DR",
  NCE_CINV:    "DR",
  NCE_LTLA:    "DR",
  NCE_STLA:    "DR",
  NCE_ONCA:    "DR",
  NCE_STCK:    "DR",
  NCE_TR:      "DR",
  NCE_CASH:    "DR",
  NCE_OCA:     "DR",
  // ── NCE — Income (Cr-natural) ────────────────────────────────────────────
  NCE_REV_OPS: "CR",
  NCE_REV_OTH: "CR",
  // ── NCE — Expenses (Dr-natural) ──────────────────────────────────────────
  NCE_COGS:     "DR",
  NCE_CII:      "DR",
  NCE_EMP_EXP:  "DR",
  NCE_FIN_COST: "DR",
  NCE_OTH_EXP:  "DR",
  // ── Corporate — Equity (Cr-natural) ──────────────────────────────────────
  BS_EQ_SC:     "CR",
  BS_EQ_RES:    "CR",
  BS_EQ_MI:     "CR",
  // ── Corporate — Non-current liabilities (Cr-natural) ─────────────────────
  BS_NCL_LTB:   "CR",
  BS_NCL_DTL:   "CR",
  BS_NCL_OLT:   "CR",
  BS_NCL_LTP:   "CR",
  // ── Corporate — Current liabilities (Cr-natural) ─────────────────────────
  BS_CL_STB:    "CR",
  BS_CL_TP:     "CR",
  BS_CL_OCL:    "CR",
  BS_CL_STP:    "CR",
  // ── Corporate — Non-current assets (Dr-natural) ──────────────────────────
  BS_NCA_FA_TAN:  "DR",
  BS_NCA_FA_INT:  "DR",
  BS_NCA_FA_WIP:  "DR",
  BS_NCA_FA_IAD:  "DR",
  BS_NCA_INV:     "DR",
  BS_NCA_LLA:     "DR",
  BS_NCA_ONA:     "DR",
  BS_NCA_DTA:     "DR",
  // ── Corporate — Current assets (Dr-natural) ──────────────────────────────
  BS_CA_INV:    "DR",
  BS_CA_CINV:   "DR",
  BS_CA_TR:     "DR",
  BS_CA_CCE:    "DR",
  BS_CA_SLA:    "DR",
  BS_CA_OCA:    "DR",
  // ── Corporate — P&L Income (Cr-natural) ──────────────────────────────────
  PL_REV_OPS:   "CR",
  PL_REV_OI:    "CR",
  // ── Corporate — P&L Expense (Dr-natural) ─────────────────────────────────
  PL_EXP_MAT:   "DR",
  PL_EXP_SIT:   "DR",
  PL_EXP_CII:   "DR",
  PL_EXP_EMP:   "DR",
  PL_EXP_FIN:   "DR",
  PL_EXP_DEP:   "DR",
  PL_EXP_OTH:   "DR",
  PL_EXP_OEX:   "DR",
  PL_EXP_TAX:   "DR",
};

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Resolve a noteType string or a literal "DR"/"CR" into the natural side.
 *  Falls back to "CR" when neither matches (the historic default). */
function resolveNature(noteTypeOrNature: string): "DR" | "CR" {
  const up = String(noteTypeOrNature ?? "").toUpperCase();
  if (up === "DR" || up === "CR") return up;
  return NOTE_NATURE[noteTypeOrNature] ?? "CR";
}

/** Strip "Dr"/"Cr" → "DR"/"CR" and tolerate any case + surrounding whitespace. */
function normaliseSide(s: unknown): "DR" | "CR" | "" {
  const v = String(s ?? "").trim().toUpperCase();
  if (v === "DR" || v === "CR") return v;
  return "";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Signed contribution of a TB ledger's CLOSING balance to a note / FS code
 *  total. Positive when the row's balance_type matches the note's natural
 *  side; negative when opposite (the row reduces the group total).
 *
 *  Third argument:
 *    - A noteType from NOTE_NATURE ("borrowings", "trade_payables", ...) —
 *      the normal path for note-aware callers (nceAutoPopulate's per-note
 *      walks).
 *    - A literal "DR" or "CR" — when the caller wants a fixed nature
 *      regardless of note (e.g. PipelineStage3's debit-positive TB
 *      normalisation always passes "DR").
 *
 *  Any other string falls back to "CR" (the historic default — matches
 *  the prior signedLedgerAmt behaviour for unrecognised noteTypes).
 *
 *  Zero closing balance → 0 (no sign work needed). */
export function signedBalance(
  amount: number | null | undefined,
  balanceType: string | null | undefined,
  noteTypeOrNature: string,
): number {
  const cb = Math.abs(Number(amount ?? 0));
  if (cb === 0) return 0;
  const nature = resolveNature(noteTypeOrNature);
  const side = normaliseSide(balanceType);
  // Default: when balance_type is missing, treat as the row's natural side
  // so we don't silently flip its contribution. Matches the prior behaviour
  // where `isDr = false` paired with nature="CR" would return +cb.
  if (!side) return nature === "CR" ? +cb : -cb;
  return side === nature ? +cb : -cb;
}

/** Signed contribution of a TB ledger's OPENING balance — same sign rule
 *  as signedBalance(), applied to opening_balance / opening_type instead
 *  of closing_balance / balance_type.
 *
 *  Used to compute the PY column of BS notes from CY's opening balances
 *  under the CURRENT COA mapping classification (so a ledger reclassified
 *  this year — e.g. NCE_STB → NCE_LTB — shows the PY in the new column,
 *  not the old). */
export function signedOpening(
  openingBalance: number | null | undefined,
  openingType: string | null | undefined,
  noteTypeOrNature: string,
): number {
  const ob = Math.abs(Number(openingBalance ?? 0));
  if (ob === 0) return 0;
  const nature = resolveNature(noteTypeOrNature);
  const side = normaliseSide(openingType);
  if (!side) return nature === "CR" ? +ob : -ob;
  return side === nature ? +ob : -ob;
}
