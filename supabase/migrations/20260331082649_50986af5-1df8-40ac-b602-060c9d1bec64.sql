ALTER TABLE public.tds_deductees
  ADD COLUMN IF NOT EXISTS interest_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_fees_amount numeric DEFAULT 0;