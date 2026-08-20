/**
 * Scrutiny engine selector.
 *
 * v2 is the ONLY engine now. The legacy v1 (`run-scrutiny`) only read file-import snapshots and
 * FAILED for Tally-synced clients; it graduated to v2-by-default on 2026-07-10 and was retired
 * (function deleted, `narration_rules` ported into v2's narration routing step) once every caller
 * was confirmed to route through v2. These two functions are kept as the single call site for
 * "which scrutiny function/view to use" so callers (e.g. AuditScrutiny.tsx's v2-view branch)
 * don't need to change if a v3 ever replaces this.
 */

export function scrutinyV2Enabled(): boolean {
  return true;
}

/** Which edge function a scrutiny run should invoke. */
export function scrutinyRunFunction(): "run-scrutiny-v2" {
  return "run-scrutiny-v2";
}
