-- Fix CARO: drop NOT NULL first, then set to global
ALTER TABLE public.caro_master_templates ALTER COLUMN firm_id DROP NOT NULL;
UPDATE public.caro_master_templates SET firm_id = NULL WHERE firm_id IS NOT NULL;