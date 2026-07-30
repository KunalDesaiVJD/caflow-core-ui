// MSME 43B(h) — surviving a browser refresh.
//
// The database is where a run BELONGS, and it is the authority. This file is
// the second line: a local snapshot of what is on screen, written on every
// change, so the work is still there after Ctrl+Shift+R even when the run could
// not be saved to Supabase at all — no client selected, retention not deployed,
// the network out, or a hard refresh landing mid-save.
//
// Two things are kept:
//
//   * a POINTER — which client, which saved run, which window. Tiny, always
//     written. On reload the run is re-read from Supabase, which is the copy
//     that other people can see and that survives this browser.
//
//   * a SNAPSHOT — the report, the extracted ledgers, and the review-panel
//     transcript. Written when it fits. This is what makes an UNSAVED run
//     survive, which is the case the pointer cannot cover.
//
// The snapshot is dropped in stages when it is too big for localStorage (~5 MB
// in every browser): ledgers first, since they are the bulk and are also in the
// run row, then the whole snapshot, leaving the pointer. Losing the snapshot is
// silent by design — the pointer still restores the run from the database, and
// a scary message about storage quota would say nothing the user can act on.

import type { Msme43bReport, VendorLedger } from './types';
import type { PanelReview } from './panelReview';

const KEY = 'msme43b:session:v1';

/** Chrome/Firefox/Safari all cap localStorage near 5 MB for the whole origin. */
const MAX_BYTES = 3_500_000;

/** A run nobody has come back to in a month is not what the reviewer wants restored. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Msme43bSnapshot {
  report: Msme43bReport;
  cyLedgers: VendorLedger[];
  fyLedgers: VendorLedger[];
  panelReview: PanelReview | null;
}

export interface Msme43bSession {
  clientId: string;
  clientName?: string;
  /** the saved run this screen came from, when there is one */
  runId: string | null;
  windowDays: number;
  /** ISO — shown to the user so a restored run is never mistaken for a fresh one */
  savedAt: string;
  snapshot: Msme43bSnapshot | null;
  /** set when the snapshot was too large to keep locally */
  snapshotDropped?: boolean;
}

export interface WriteOutcome {
  /** false when nothing at all could be written (storage disabled or full) */
  stored: boolean;
  /** true when the pointer was kept but the on-screen figures were not */
  snapshotDropped: boolean;
}

function storage(): Storage | null {
  try {
    // Private-mode Safari throws on access, not on use.
    const s = window.localStorage;
    const probe = '__msme43b_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function tryWrite(s: Storage, session: Msme43bSession): boolean {
  const json = JSON.stringify(session);
  if (json.length > MAX_BYTES) return false;
  try {
    s.setItem(KEY, json);
    return true;
  } catch {
    // QuotaExceededError — something else on the origin is using the space.
    return false;
  }
}

/**
 * Remember the current screen. Degrades rather than fails: full snapshot →
 * snapshot without ledgers → pointer only.
 */
export function writeSession(session: Msme43bSession): WriteOutcome {
  const s = storage();
  if (!s) return { stored: false, snapshotDropped: true };

  if (tryWrite(s, session)) return { stored: true, snapshotDropped: !session.snapshot };

  // The ledgers are the bulk of it, and a saved run has them in the database.
  if (session.snapshot) {
    const lean: Msme43bSession = {
      ...session,
      snapshot: { ...session.snapshot, cyLedgers: [], fyLedgers: [] },
    };
    if (tryWrite(s, lean)) return { stored: true, snapshotDropped: false };
  }

  const pointerOnly: Msme43bSession = { ...session, snapshot: null, snapshotDropped: true };
  if (tryWrite(s, pointerOnly)) return { stored: true, snapshotDropped: true };
  return { stored: false, snapshotDropped: true };
}

/** What was on screen when this browser was last used, if it is still fresh. */
export function readSession(): Msme43bSession | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Msme43bSession;
    if (!parsed || typeof parsed !== 'object' || !parsed.savedAt) return null;
    if (Date.now() - new Date(parsed.savedAt).getTime() > MAX_AGE_MS) {
      s.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    // A snapshot written by an older shape of the code — start clean.
    s.removeItem(KEY);
    return null;
  }
}

export function clearSession(): void {
  storage()?.removeItem(KEY);
}
