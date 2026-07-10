/**
 * Scrutiny engine selector (`run-scrutiny-v2`).
 *
 * v2 is now the DEFAULT (graduated 2026-07-10 after production verification). v2 reads the live
 * Tally Sync tables the firm actually uses (tally_trial_balance / tally_vouchers); the legacy v1
 * (`run-scrutiny`) only read file-import snapshots and therefore FAILS for Tally-synced clients.
 *
 * Opt back to the legacy v1 explicitly via:
 *   - build-time:  VITE_SCRUTINY_V2=false
 *   - per-browser: localStorage 'scrutiny_v2' = 'false'
 */

export function scrutinyV2Enabled(): boolean {
  try {
    if ((import.meta as { env?: Record<string, unknown> }).env?.VITE_SCRUTINY_V2 === "false") return false;
  } catch {
    /* import.meta.env unavailable */
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("scrutiny_v2") === "false") return false;
  } catch {
    /* localStorage unavailable (headless/SSR) */
  }
  return true;
}

/** Which edge function a scrutiny run should invoke, per the flag. */
export function scrutinyRunFunction(): "run-scrutiny" | "run-scrutiny-v2" {
  return scrutinyV2Enabled() ? "run-scrutiny-v2" : "run-scrutiny";
}
