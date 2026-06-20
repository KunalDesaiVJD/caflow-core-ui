// ─────────────────────────────────────────────────────────────────────────
// notesStaleness.ts — detect when the Notes-to-Accounts snapshot is older
// than the Trial Balance it was built from (i.e. a Tally re-sync happened
// after the notes were last populated).
//
// WHY THIS EXISTS
// The BS/PL face reads exclusively from the persisted nce_financial_notes
// snapshot (via getNCENoteFaceTotal), NOT live from the trial balance. The
// COA anchor (computeCOATotals) DOES read live TB. So after a Tally re-sync
// that changes balances, the face shows stale figures while the COA anchor
// moves — the reconciliation panel then flags drift and blocks export, but
// the auditor is given no signal about WHY or HOW to recover.
//
// This module computes a pure, side-effect-free "is the notes snapshot stale
// relative to the TB?" verdict from two timestamps so the FS page can surface
// a clear banner ("Trial balance re-synced after notes were built — refresh")
// instead of silently showing stale numbers behind a red drift panel.
//
// It is intentionally pure (no Supabase, no React) so it is unit-testable and
// cannot itself mutate any audit data.
// ─────────────────────────────────────────────────────────────────────────

export interface NotesStalenessInput {
  /** Most recent tally_trial_balance.synced_at for the engagement (ISO string). */
  latestTbSyncedAt: string | null | undefined;
  /** Most recent nce_financial_notes.updated_at for the engagement (ISO string). */
  latestNotesUpdatedAt: string | null | undefined;
  /** audit_engagements.notes_finalized — when true, notes are write-protected. */
  notesFinalized?: boolean | null;
  /** BUG-041 / D2.4 — fingerprint of the CURRENT (live) coa_mapping. */
  liveCoaFingerprint?: string | null;
  /** BUG-041 / D2.4 — fingerprint of the coa_mapping captured WHEN the notes
   *  snapshot was last built/saved. A mismatch means a ledger→note reassignment
   *  happened since (which does NOT advance tally_trial_balance.synced_at). */
  notesCoaFingerprint?: string | null;
}

export type NotesStalenessVerdict =
  /** No TB or no notes yet — nothing meaningful to compare. */
  | "unknown"
  /** Notes were built at/after the latest TB sync — figures reflect current TB. */
  | "fresh"
  /** TB re-synced after notes were built, and notes are editable → offer refresh. */
  | "stale_refreshable"
  /** TB re-synced after notes were built, but notes are finalized/write-protected
   *  → must NOT auto-overwrite; warn and let the auditor reconcile or unlock. */
  | "stale_locked";

export interface NotesStalenessResult {
  verdict: NotesStalenessVerdict;
  /** True for either stale_* verdict — convenience for banner visibility. */
  isStale: boolean;
  /** True only when a non-destructive refresh is safe to offer. */
  canRefresh: boolean;
  latestTbSyncedAt: string | null;
  latestNotesUpdatedAt: string | null;
  /** BUG-041 — what triggered staleness, so the banner can explain WHY:
   *  a Tally re-sync vs a COA-mapping change. null when fresh/unknown. */
  reason?: "tb_resync" | "coa_change" | null;
}

/** Parse an ISO timestamp to epoch ms, or null when absent/invalid. */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide whether the notes snapshot is stale relative to the trial balance.
 *
 * Staleness rule: the TB sync timestamp is STRICTLY greater than the notes
 * update timestamp. A tiny tolerance avoids false positives from clock skew
 * or notes being written milliseconds after the sync in the same workflow.
 */
export function evaluateNotesStaleness(
  input: NotesStalenessInput,
  toleranceMs = 1000,
): NotesStalenessResult {
  const tb = toMs(input.latestTbSyncedAt);
  const notes = toMs(input.latestNotesUpdatedAt);

  const base = {
    latestTbSyncedAt: input.latestTbSyncedAt ?? null,
    latestNotesUpdatedAt: input.latestNotesUpdatedAt ?? null,
  };

  // BUG-041 / D2.4 — a COA-mapping change does NOT advance tally_trial_balance.synced_at,
  // so a timestamp-only check is blind to a pure ledger→note reassignment. When the caller
  // supplies the fingerprint captured when the notes were last built AND the live one, a
  // mismatch means the snapshot no longer reflects the mapping → stale, even if timestamps
  // say "fresh". When the fingerprints are absent, behaviour is unchanged (legacy).
  const coaChanged = !!(
    input.liveCoaFingerprint &&
    input.notesCoaFingerprint &&
    input.liveCoaFingerprint !== input.notesCoaFingerprint
  );

  const tbIsNewer = tb != null && notes != null && tb - notes > toleranceMs;

  if (!tbIsNewer && !coaChanged) {
    // Neither signal fires. Distinguish "no timestamps to compare" from "genuinely fresh".
    if (tb == null || notes == null) {
      return { verdict: "unknown", isStale: false, canRefresh: false, reason: null, ...base };
    }
    return { verdict: "fresh", isStale: false, canRefresh: false, reason: null, ...base };
  }

  // Stale via TB re-sync and/or COA-mapping change. TB takes precedence in the message.
  const reason: "tb_resync" | "coa_change" = tbIsNewer ? "tb_resync" : "coa_change";
  if (input.notesFinalized) {
    return { verdict: "stale_locked", isStale: true, canRefresh: false, reason, ...base };
  }
  return { verdict: "stale_refreshable", isStale: true, canRefresh: true, reason, ...base };
}
