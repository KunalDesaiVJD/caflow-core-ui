-- Client billing opening balances
-- Stores one opening-balance record per (firm, client).
-- balance_date = the "as of" date for the balance.
-- amount > 0 = client owes the firm (debit), amount < 0 = advance paid (credit).

CREATE TABLE IF NOT EXISTS client_billing_opening_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  balance_date  date NOT NULL,
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  narration     text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (firm_id, client_id)
);

ALTER TABLE client_billing_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ob_select" ON client_billing_opening_balances FOR SELECT
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "ob_insert" ON client_billing_opening_balances FOR INSERT
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "ob_update" ON client_billing_opening_balances FOR UPDATE
  USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "ob_delete" ON client_billing_opening_balances FOR DELETE
  USING (is_superadmin() OR firm_id = current_user_firm_id());
