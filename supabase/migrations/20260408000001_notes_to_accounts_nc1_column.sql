-- Add note_nc_1 column to notes_to_accounts for non-corporate entities
-- This stores "Entity Information" note data (LLP, Partnership, Proprietorship, etc.)
-- Corporate entities use note_1 (Corporate Information); non-corporates use note_nc_1
ALTER TABLE public.notes_to_accounts
  ADD COLUMN IF NOT EXISTS note_nc_1 JSONB DEFAULT '{}';
