/* ─────────────────────────────────────────────────────────────────────────────
   Stage-2 PAN Verification — store the TRACES verified name + per-check detail on
   each audit result, so the UI can render a complete per-party audit (PAN found /
   status / name) and show "Office name vs TRACES verified name" on a mismatch.
   Idempotent; block comments only (applied by collapsing to one line).
   ───────────────────────────────────────────────────────────────────────────── */

ALTER TABLE public.tds_pan_verification_results ADD COLUMN IF NOT EXISTS verified_name text;
ALTER TABLE public.tds_pan_verification_results ADD COLUMN IF NOT EXISTS detail jsonb DEFAULT '{}'::jsonb;
