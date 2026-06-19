// ─────────────────────────────────────────────────────────────────────────
// nceFeatureFlags.ts — gated rollout of the sign-correctness (BUG 1) and
// re-sync rebuild (BUG 2) fixes for Notes-to-Accounts.
//
// All flags DEFAULT OFF, so production behaviour is byte-identical to the
// pre-fix code path until each flag is flipped AFTER real-data parity review
// on MAHARSH INFRA / DBS REALTY (these changes move displayed FS figures).
// This mirrors the project rule that engine switches stay flag-gated OFF until
// a real-data parity check passes.
//
// To enable after verification: flip the relevant constant to `true` (or, in a
// follow-up, source it from a per-engagement column so rollout is gradual).
// ─────────────────────────────────────────────────────────────────────────

/**
 * BUG 1 — SIGN. When true, every TB→note-amount conversion is signed per the
 * head's natural side (src/lib/fsSignConvention.ts): a Dr balance inside a
 * Cr-natural head (e.g. a debit party in Long-Term Borrowings) and a Cr
 * balance inside a Dr-natural head (e.g. a write-back inside an expense note)
 * correctly DEDUCT from the note total. When false, the legacy Math.abs
 * magnitude is used (the row is ADDED regardless of side).
 */
export const NCE_SIGNED_NOTE_AMOUNTS = false;

/**
 * BUG 1 — SIGN (corporate). Same correction for the corporate Stage-5 note
 * display totals (NoteBSLiab / NoteBSAsset signedTotal). When true, a note
 * whose breakup nets to the abnormal side displays its true signed total
 * instead of flipping to a positive magnitude.
 */
export const CORP_SIGNED_NOTE_TOTALS = false;

/**
 * BUG 2 — RENAME + RE-SYNC. When true:
 *   - a ledger rename in Notes is stored as a labelOverride (display only),
 *     NOT by mutating the row label or promoting it to manual — so re-sync
 *     keeps the row claimed by its TB ledger and never re-creates a duplicate;
 *   - re-sync does a DELETE-first rebuild of nce_financial_notes so orphan
 *     note rows are removed and the Notes total is a pure function of TB×COA
 *     plus the preserved manual overlay.
 */
export const NCE_RESYNC_DELETE_FIRST = false;

/**
 * PD-1 / D2.1 — NCE Balance-Sheet residual absorber. When false (default), any
 * residual BS imbalance is plugged into Owners' Capital (NCE_CAP) so the face
 * always balances — which HIDES a real imbalance and defeats the export gate
 * (nceBsBalanced reads the post-plug total). When true, the plug is skipped: the
 * true residual stands, so an unbalanced BS displays unbalanced AND blocks export,
 * and the displayed Owners' Capital is the real note/COA value. Figure-MOVING →
 * stays OFF until the real-data parity run in the credentialed environment.
 */
export const FS_NO_CAPITAL_PLUG = false;

/**
 * PD-6 / D2.7 — Corporate PY Balance-Sheet face source. When false (default), the
 * corporate BS PY column is sourced from the raw current-year OPENING balance
 * (exportPy) in preference to the note's PY breakup — so the PY face can diverge
 * from its own note table, and the same divergence ships into the Word BS (BUG-031).
 * When true, the PY face reads the NOTE PY total (sumNotesSubRowsPY), matching the CY
 * column and the note table. BS sections only; P&L is unaffected. Figure-MOVING →
 * stays OFF until the real-data parity run in the credentialed environment.
 */
export const FS_CORP_PY_FACE_FROM_NOTE = false;

/**
 * BUG-085/107/110 / D2.10 — Corporate export drift gate. When false (default), corporate
 * Excel/Word export is NOT blocked by note-vs-COA / note-vs-face drift (only by BS balance,
 * FA-PY and opening mismatch) — unlike NCE, which blocks on severe drift. When true, the
 * corporate three-way validator (validateCorporateFSReconciliation) is computed and a severe
 * drift (>₹100) blocks both corporate exports, matching NCE (Rule 5 parity). Behaviour change
 * only (no figure moves) → stays OFF until reviewed against real corporate engagements.
 */
export const FS_CORP_EXPORT_GATE = false;
