-- Add 'kasar' to client_ledger_entries entry_type CHECK constraint
ALTER TABLE client_ledger_entries
  DROP CONSTRAINT IF EXISTS client_ledger_entries_entry_type_check;

ALTER TABLE client_ledger_entries
  ADD CONSTRAINT client_ledger_entries_entry_type_check
  CHECK (entry_type IN ('invoice', 'credit_note', 'receipt', 'adjustment', 'kasar'));

-- Fix RLS delete policy: allow superadmin to delete any ledger entry,
-- firm users can only delete entries belonging to their own firm
DROP POLICY IF EXISTS "firm_delete_ledger_entries" ON client_ledger_entries;

CREATE POLICY "firm_delete_ledger_entries"
  ON client_ledger_entries
  FOR DELETE
  TO authenticated
  USING (
    -- superadmin (no firm_id in users table) can delete any
    (SELECT firm_id FROM users WHERE id = auth.uid()) IS NULL
    OR
    firm_id = (SELECT firm_id FROM users WHERE id = auth.uid())
  );
