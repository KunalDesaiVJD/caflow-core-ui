-- billing_kasars: track kasar (write-off / discount) entries per client
CREATE TABLE IF NOT EXISTS billing_kasars (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kasar_date     DATE NOT NULL,
  amount         NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  narration      TEXT,
  invoice_id     UUID REFERENCES invoices(id) ON DELETE SET NULL,
  financial_year TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_kasars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Firm users can manage kasars"
  ON billing_kasars
  FOR ALL
  TO authenticated
  USING (
    firm_id IN (
      SELECT firm_id FROM users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    firm_id IN (
      SELECT firm_id FROM users WHERE id = auth.uid()
    )
  );
