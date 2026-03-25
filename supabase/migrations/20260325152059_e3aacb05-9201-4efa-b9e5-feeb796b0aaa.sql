-- Migration 10: client_ledger_entries table

CREATE TABLE client_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  entry_date date NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('invoice','credit_note','receipt','adjustment')),
  document_id uuid,
  debit_amount numeric(12,2) NOT NULL DEFAULT 0,
  credit_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  narration text,
  financial_year text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE client_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firm_select_ledger_entries" ON client_ledger_entries
  FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_insert_ledger_entries" ON client_ledger_entries
  FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_update_ledger_entries" ON client_ledger_entries
  FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id())
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "firm_delete_ledger_entries" ON client_ledger_entries
  FOR DELETE TO authenticated
  USING (firm_id = public.current_user_firm_id());
