CREATE INDEX IF NOT EXISTS idx_invoices_client_firm ON invoices(client_id, firm_id);
CREATE INDEX IF NOT EXISTS idx_invoices_fy_series ON invoices(firm_id, document_series, financial_year);
CREATE INDEX IF NOT EXISTS idx_ledger_client ON client_ledger_entries(client_id, firm_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON billing_reminders(firm_id, next_due_date, status);
CREATE INDEX IF NOT EXISTS idx_clients_draft ON clients(is_draft, deleted_at, firm_id);