-- ─────────────────────────────────────────────────────────────────────────────
-- Constrain tds_recon_results.match_status to its four valid states and retire
-- the interim "review" status (the confidence workflow was removed — Validate &
-- Finalise is now binary Matched / Mismatched, with Overridden tracked separately).
--
-- Any legacy 'review' rows are folded into 'mismatched' BEFORE the CHECK is added
-- (otherwise the constraint would reject them). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.tds_recon_results
   SET match_status = 'mismatched'
 WHERE match_status = 'review';

ALTER TABLE public.tds_recon_results
  DROP CONSTRAINT IF EXISTS tds_recon_results_match_status_chk;
ALTER TABLE public.tds_recon_results
  ADD CONSTRAINT tds_recon_results_match_status_chk
  CHECK (match_status IN ('matched', 'mismatched', 'office_only', 'imported_only'));
