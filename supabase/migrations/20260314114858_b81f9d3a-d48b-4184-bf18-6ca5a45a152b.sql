-- Add nil_deduction_reason column to tds_entries if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tds_entries' AND column_name = 'nil_deduction_reason') THEN
    ALTER TABLE public.tds_entries ADD COLUMN nil_deduction_reason text;
  END IF;
END $$;