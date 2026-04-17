-- Migration: gstin_states
-- Per-GSTIN registered state map stored as JSONB on the clients table.
-- Key = GSTIN string, Value = state name string.
-- Auto-populated from GSTIN prefix (2-digit state code) in the UI;
-- can be overridden manually per GSTIN.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS gstin_states jsonb NOT NULL DEFAULT '{}'::jsonb;
