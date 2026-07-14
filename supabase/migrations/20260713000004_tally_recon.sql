-- ===========================================================================
-- TALLY <-> BILLING SYNC -- Phase 3: closing-balance reconciliation
-- Created: 2026-07-13
--
-- A snapshot (one row per mapped client, replaced each recon run by the agent)
-- comparing the client's Tally party-ledger CLOSING balance against their CAFlow
-- outstanding (sum of invoice amount_due). Drift beyond a small tolerance is
-- flagged so the firm can investigate a missing voucher / receipt on either side.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS tally_recon (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id           uuid REFERENCES clients(id) ON DELETE CASCADE,
  tally_company_name  text,
  tally_ledger_name   text,
  tally_closing       numeric NOT NULL DEFAULT 0,   -- +ve = receivable (Dr)
  caflow_outstanding  numeric NOT NULL DEFAULT 0,
  diff                numeric NOT NULL DEFAULT 0,    -- tally_closing - caflow_outstanding
  status              text NOT NULL DEFAULT 'ok'     -- ok | mismatch
                        CHECK (status IN ('ok','mismatch')),
  as_of               date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_tally_recon_firm ON tally_recon(firm_id, status);

ALTER TABLE tally_recon ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tally_recon_firm_rw ON tally_recon;
CREATE POLICY tally_recon_firm_rw ON tally_recon FOR ALL TO authenticated
  USING (tally_billing_firm_access(firm_id))
  WITH CHECK (tally_billing_firm_access(firm_id));
