-- Add an `interest` column to imported client rows so the Validate & Finalise
-- reconciliation can compare Interest (one of the seven compared fields:
-- Name, PAN, Date, Amount, TDS, Interest, Section). Office data already stores
-- interest as tds_deductees.interest_amount.
ALTER TABLE public.tds_imported_rows ADD COLUMN IF NOT EXISTS interest numeric;
