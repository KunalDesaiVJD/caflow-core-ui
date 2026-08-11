-- MSME 43B(h) — make a run survive a browser refresh in full.
--
-- Until now a saved run kept only the computed report. Three things that cost
-- real time to produce were held in React state and died with the tab:
--
--   * the EXTRACTED LEDGERS. Every PDF is read by Claude — a firm-sized batch is
--     thirty-odd API calls and several minutes. Losing them means the accuracy
--     panel and the calibration loop disappear after a refresh, and the only way
--     back is to re-upload and pay for the extraction again.
--
--   * the REVIEW PANEL. Four model turns, about two minutes, and the transcript
--     is the record of why an interpretation was accepted. It belongs on the
--     run, not in a tab.
--
--   * nothing recorded WHICH run the reviewer was working on, so even a saved
--     run had to be found and re-loaded by hand.
--
-- Also adds the UPDATE policy the base table never had. Renaming a run called
-- UPDATE against a table with no UPDATE policy, so RLS matched no rows and the
-- rename silently did nothing — no error, and the old label came back on the
-- next refresh.
--
-- SAFETY: additive + idempotent (ADD COLUMN IF NOT EXISTS / guarded policy).

ALTER TABLE public.msme_43b_runs
  ADD COLUMN IF NOT EXISTS cy_ledgers jsonb;

ALTER TABLE public.msme_43b_runs
  ADD COLUMN IF NOT EXISTS fy_ledgers jsonb;

-- The four-turn Claude ↔ GPT transcript as returned, so the reasoning on file
-- is the reasoning that was actually given — not a re-run that may differ.
ALTER TABLE public.msme_43b_runs
  ADD COLUMN IF NOT EXISTS panel_review jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'msme_43b_runs' AND policyname = 'Users can update their firm MSME 43B runs'
  ) THEN
    CREATE POLICY "Users can update their firm MSME 43B runs"
      ON public.msme_43b_runs FOR UPDATE
      TO authenticated
      USING (firm_id = public.current_user_firm_id() OR public.is_superadmin())
      WITH CHECK (firm_id = public.current_user_firm_id() OR public.is_superadmin());
  END IF;
END $$;
