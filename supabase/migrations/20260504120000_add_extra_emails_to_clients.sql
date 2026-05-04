-- Add extra_emails column to clients table for multiple email IDs per client
ALTER TABLE clients ADD COLUMN IF NOT EXISTS extra_emails TEXT[] DEFAULT '{}';
