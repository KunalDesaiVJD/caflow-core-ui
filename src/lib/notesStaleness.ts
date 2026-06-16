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

  // Can't compare without both sides.
  if (tb == null || notes == null) {
    return { verdict: "unknown", isStale: false, canRefresh: false, ...base };
  }

  const tbIsNewer = tb - notes > toleranceMs;
  if (!tbIsNewer) {
    return { verdict: "fresh", isStale: false, canRefresh: false, ...base };
  }

  if (input.notesFinalized) {
    return { verdict: "stale_locked", isStale: true, canRefresh: false, ...base };
  }
  return { verdict: "stale_refreshable", isStale: true, canRefresh: true, ...base };
}
