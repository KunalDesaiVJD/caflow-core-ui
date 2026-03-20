
-- Fix 1: Make firm_id nullable in client_groups and work_groups (groups are global)
ALTER TABLE public.client_groups ALTER COLUMN firm_id DROP NOT NULL;
ALTER TABLE public.work_groups ALTER COLUMN firm_id DROP NOT NULL;

-- Fix 2: Add missing columns to itr_profiles for staff assignments
ALTER TABLE public.itr_profiles 
  ADD COLUMN IF NOT EXISTS upload_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS remarks text;
