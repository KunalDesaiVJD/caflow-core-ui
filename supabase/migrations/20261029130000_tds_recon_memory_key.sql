/* ─────────────────────────────────────────────────────────────────────────────
   Stage-1 override memory.

   tds_recon_results is wiped on every client-file import and every row is
   recreated with new office/imported ids, so a Stage-1 override keyed by
   (office_deductee_id, imported_row_id) never survived a re-import. The
   tds-recon-compare edge function now stamps each result with memory_key — the
   record's VALUES (PAN, date, amount, TDS on each side) — and stores overrides
   in tds_override_memory under stage 'recon', re-applying them by that key.

   Existing overrides need no backfill: the next compare run carries them by id
   as before and writes them into tds_override_memory at the same time.
   Idempotent; block comments only.
   ───────────────────────────────────────────────────────────────────────────── */
ALTER TABLE public.tds_recon_results ADD COLUMN IF NOT EXISTS memory_key text;
