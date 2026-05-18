-- Add gstin column to client_billing_opening_balances
-- Allows per-GSTIN opening balances for multi-GSTIN clients
ALTER TABLE client_billing_opening_balances
  ADD COLUMN IF NOT EXISTS gstin TEXT;

-- Add gstin column to billing_receipts
-- Allows tagging receipts to a specific GSTIN state for multi-GSTIN clients
ALTER TABLE billing_receipts
  ADD COLUMN IF NOT EXISTS gstin TEXT;
