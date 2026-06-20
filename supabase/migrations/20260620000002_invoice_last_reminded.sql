-- Phase 5 — reminder de-duplication (audit C4).
-- Track when a payment reminder was last sent for an invoice so "Run Now"
-- (and any future scheduler) can skip invoices reminded very recently, instead
-- of re-emailing every open invoice on every click. Additive, nullable.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;
