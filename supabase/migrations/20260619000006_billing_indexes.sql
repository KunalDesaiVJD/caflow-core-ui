-- Phase 4 — performance indexes for the billing / ledger read paths.
-- All additive (CREATE INDEX IF NOT EXISTS); no data is changed. These back the
-- joins and filters the ledger, receivables report and reconciliation view do
-- (and the new amount_paid trigger), which were previously full table scans.

CREATE INDEX IF NOT EXISTS idx_cle_document_id   ON client_ledger_entries (document_id);
CREATE INDEX IF NOT EXISTS idx_cle_firm_client   ON client_ledger_entries (firm_id, client_id);
CREATE INDEX IF NOT EXISTS idx_cle_entry_type    ON client_ledger_entries (entry_type);

CREATE INDEX IF NOT EXISTS idx_kasars_firm_client ON billing_kasars (firm_id, client_id);
CREATE INDEX IF NOT EXISTS idx_kasars_invoice     ON billing_kasars (invoice_id);

CREATE INDEX IF NOT EXISTS idx_receipts_invoice      ON billing_receipts (invoice_id);
CREATE INDEX IF NOT EXISTS idx_receipts_firm_client  ON billing_receipts (firm_id, client_id);

CREATE INDEX IF NOT EXISTS idx_ob_firm_client ON client_billing_opening_balances (firm_id, client_id);
