/* ─────────────────────────────────────────────────────────────────────────────
   Stage-3 · per-ROW section on the imported Tally ledger rows.

   A client's Tally dataset is one ledger PER SECTION (194C, 194J, 194A …), spread
   across several sheets AND several files. Stage-3 previously carried a single
   section per BATCH, so a filing could only ever reconcile against one section's
   ledger — importing the 194C ledger reported every 194A/194T office record as a
   missing entry.

   The reconciler now scopes candidates to each office record's OWN section, which
   needs the section on the ROW (a single workbook can hold several sections).

   Backfill: existing rows inherit their batch's section, so nothing regresses.
   Idempotent; block comments only (applied by collapsing to one line).
   ───────────────────────────────────────────────────────────────────────────── */

ALTER TABLE public.tds_tally_rows ADD COLUMN IF NOT EXISTS section text;

UPDATE public.tds_tally_rows r
   SET section = b.section
  FROM public.tds_tally_batches b
 WHERE r.batch_id = b.id
   AND r.section IS NULL
   AND b.section IS NOT NULL;

CREATE INDEX IF NOT EXISTS tds_tally_rows_filing_section ON public.tds_tally_rows (filing_id, section);
