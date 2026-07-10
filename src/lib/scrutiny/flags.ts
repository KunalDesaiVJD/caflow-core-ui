/**
 * Feature flag for the rebuilt scrutiny engine (`run-scrutiny-v2`).
 *
 * OFF by default — current behaviour (`run-scrutiny`) is unchanged unless explicitly enabled via:
 *   - build-time:  VITE_SCRUTINY_V2=true
 *   - per-browser: localStorage 'scrutiny_v2' = 'true'
 *
 * No flag infrastructure exists in this repo, so this mirrors the existing
 * import.meta.env.VITE_* + localStorage patterns used elsewhere.
 */

export function scrutinyV2Enabled(): boolean {
  try {
    if ((import.meta as { env?: Record<string, unknown> }).env?.VITE_SCRUTINY_V2 === "true") return true;
  } catch {
    /* import.meta.env unavailable */
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("scrutiny_v2") === "true") return true;
  } catch {
    /* localStorage unavailable (headless/SSR) */
  }
  return false;
}

/** Which edge function a scrutiny run should invoke, per the flag. */
export function scrutinyRunFunction(): "run-scrutiny" | "run-scrutiny-v2" {
  return scrutinyV2Enabled() ? "run-scrutiny-v2" : "run-scrutiny";
}
