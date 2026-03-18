-- Allow date_of_purchase to be NULL
-- (validation is enforced in the UI instead of at DB level)
ALTER TABLE public.fa_assets ALTER COLUMN date_of_purchase DROP NOT NULL;