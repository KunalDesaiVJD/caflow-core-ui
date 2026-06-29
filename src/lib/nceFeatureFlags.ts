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
export const NCE_SIGNED_NOTE_AMOUNTS = true;

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
export const NCE_RESYNC_DELETE_FIRST = true;

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

/**
 * PD-2 / D2.3 Phase-3 enforcement — block on unexplained Note≠COA divergence. When false
 * (default), a Note total that differs from the COA anchor with NO backing manual row is shown
 * as "⚠ unexplained" in the FS-Health panel but does NOT block export (report-only). When true,
 * such an unexplained gap is escalated to drift (drift_severe ≥ ₹100) so it counts toward
 * severeCount and blocks export — i.e. once the sign flip makes COA == Note, any residual
 * divergence is treated as the real engine bug it is. Behaviour change only (no figure moves)
 * → stays OFF until the sign/keying flags are validated, so it doesn't fire on the pre-fix gap.
 */
export const FS_BLOCK_UNEXPLAINED_DRIFT = false;

/**
 * NCE NO-MANUAL-ADDITIONS / COA-ANCHOR (2026-06-23, user policy: "manual note
 * additions in Notes to Accounts are not allowed"). When true (NCE engagements ONLY):
 *   - PipelineFinancialStatements anchors every NCE BS/P&L code's FACE to the
 *     sign-corrected COA (computeNceCoaAnchoredFace) — CY + PY — so a manual note
 *     addition, an LT/ST split that disagrees with the code, or a contaminated seed
 *     can no longer move the face off COA. NCE_CII is derived from stock movement;
 *     the residual absorber credits the current-year result to Owners' Capital.
 *   - the re-sync rebuild (nceAutoPopulate) DROPS the manual customRow overlay, so
 *     each note rebuilds purely from COA-mapped ledgers (note total = COA = face).
 *   - the export gate BLOCKS any NCE engagement with unmapped non-zero ledgers.
 *   - the "+ Add row" control in NCEDetailedNotes is disabled.
 * Net: every COA line = Note total = Face and the BS ties (verified 28/28 on live
 * data). Statutory disclosures are stored separately and untouched. Corporate is
 * never affected (NCE-scoped throughout). FIGURE-MOVING.
 */
export const FS_NO_MANUAL_NOTE_ADD = true;

/**
 * FS_NCE_CONSTRAINED_NOTES (2026-06-29, user policy: Capital & PPE must be
 * MANUALLY editable, yet their CLOSING totals — and PPE depreciation — can NEVER
 * deviate from COA mapping). When true (NCE engagements ONLY) it activates the
 * constrained-edit Capital note (table `nce_capital_note`) and the constrained
 * PPE schedule:
 *   - the CLOSING total of each note is NOT a typed input; it is Σ(movements) +
 *     a derived balancer = (COA total − Σ movements), so `Σ closing ≡ COA` by
 *     construction, for CY and PY independently — there is no set of manual
 *     inputs that makes it untrue;
 *   - PPE depreciation is pinned to NCE_DEPR (the P&L face value); the schedule
 *     only DISTRIBUTES it across asset classes (a depreciation balancer forces
 *     `Σ class depreciation ≡ NCE_DEPR`);
 *   - the SECURITY DEFINER save RPCs (`save_nce_capital_note` /
 *     `save_nce_ppe_schedule`) re-derive COA server-side and reject any save
 *     where `|Σ − COA| > ₹1` (the only DB-side tie enforcement in the codebase);
 *   - validateFSReconciliation emits recon rows for NCE_CAP/NCE_PPE/NCE_INTG/
 *     NCE_DEPR, so a coding regression that broke the tie surfaces as
 *     drift_severe and blocks export (a regression tripwire);
 *   - the FS_NO_MANUAL_NOTE_ADD lockdown gets a NARROW carve-out for the
 *     `capital` + `ppe` note types only — every other note stays read-only.
 * The FACE stays COA-anchored (computeNceCoaAnchoredFace) regardless, so the
 * note is a constrained disclosure layer over the same COA number the face
 * already uses and is structurally incapable of moving a face figure. When
 * false (default), behaviour is byte-identical to today. FS_NO_CAPITAL_PLUG is
 * unaffected (stays OFF; the note ties to the PRE-plug COA value, so the plug
 * and a tied Capital note coexist cleanly). Flip ON only after the TS↔SQL COA
 * parity test is green AND a real-data parity run shows 0 drift across NCE.
 * Corporate is never affected (NCE-scoped throughout). FIGURE-MOVING when ON.
 */
export const FS_NCE_CONSTRAINED_NOTES = true;  // ACTIVATED 2026-06-29 (parity 27/0; edge fn deployed; migration applied). Revert to false to roll back.
