-- ═══════════════════════════════════════════════════════════════════════════
-- TALLY ⇄ BILLING SYNC — voucher log (idempotency + audit trail)
-- Created: 2026-07-13   (applied to prod same day)
--
-- One row per CAFlow document pushed to (or pulled from) Tally. The UNIQUE
-- (invoice_id, tally_company_name, direction) key is what makes forward sync
-- idempotent — a re-run skips documents already logged as posted, so vouchers
-- are never duplicated in Tally.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tally_voucher_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  invoice_id         uuid REFERENCES invoices(id) ON DELETE SET NULL,
  tally_company_name text NOT NULL,
  voucher_number     text,              -- CAFlow invoice_no / Tally voucher no
  tally_vch_id       text,              -- Tally LASTVCHID returned on import
  tally_guid         text,              -- Tally voucher GUID (if captured)
  direction          text NOT NULL DEFAULT 'forward',  -- forward | reverse
  status             text NOT NULL DEFAULT 'created',   -- created | altered | failed
  error              text,
  posted_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, tally_company_name, direction)
);
CREATE INDEX IF NOT EXISTS idx_tvl_firm ON tally_voucher_log(firm_id);

ALTER TABLE tally_voucher_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tvl_firm_rw ON tally_voucher_log;
CREATE POLICY tvl_firm_rw ON tally_voucher_log FOR ALL TO authenticated
  USING (tally_billing_firm_access(firm_id))
  WITH CHECK (tally_billing_firm_access(firm_id));
