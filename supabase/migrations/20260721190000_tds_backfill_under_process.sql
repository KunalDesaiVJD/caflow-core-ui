-- One-time backfill: a filing stuck at "Not Started" that already has real
-- Data Entry or Validate & Finalise activity recorded against it (from
-- before the auto-transition-to-"Under Process" feature existed) never gets
-- flipped by that feature's forward-only trigger hooks, since those only
-- fire on NEW activity going forward. Reconcile the existing backlog once.
UPDATE public.tds_filings f
SET work_status = 'Under Process', last_updated_at = now()
WHERE f.work_status = 'Not Started'
  AND (
    EXISTS (SELECT 1 FROM public.tds_challans c WHERE c.filing_id = f.id)
    OR EXISTS (SELECT 1 FROM public.tds_deductees d WHERE d.filing_id = f.id)
    OR EXISTS (SELECT 1 FROM public.tds_recon_results r WHERE r.filing_id = f.id)
    OR EXISTS (SELECT 1 FROM public.tds_pan_verification_results p WHERE p.filing_id = f.id)
    OR EXISTS (SELECT 1 FROM public.tds_tally_results t WHERE t.filing_id = f.id)
  );
