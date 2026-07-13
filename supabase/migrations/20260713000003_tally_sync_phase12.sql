-- ===========================================================================
-- TALLY <-> BILLING SYNC -- Phase 1 (forward queue) + Phase 2 (reverse staging)
-- Created: 2026-07-13
--
-- Only the firm's own PC can reach Tally's localhost:9000 gateway, so the actual
-- Tally I/O is done by the desktop AGENT. These tables are the hand-off:
--   * tally_sync_queue      -- CAFlow -> agent: invoices/CNs queued to PUSH to Tally
--   * tally_receipt_staging -- agent -> CAFlow: bank/cash Receipts PULLED from Tally,
--                              deduped by Tally GUID, matched to a client, then
--                              imported into billing via the post_receipt RPC.
-- Both firm-scoped (RLS via tally_billing_firm_access); the agent uses the
-- service-role key and bypasses RLS.
-- ===========================================================================

-- Phase 1: forward outbound queue
CREATE TABLE IF NOT EXISTS tally_sync_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  invoice_id     uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  document_no    text,
  direction      text NOT NULL DEFAULT 'forward',
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','done','failed')),
  attempts       int  NOT NULL DEFAULT 0,
  max_attempts   int  NOT NULL DEFAULT 3,
  last_error     text,
  tally_vch_id   text,
  requested_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  UNIQUE (invoice_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_tsq_firm_status ON tally_sync_queue(firm_id, status);

-- Phase 2: reverse receipt staging
CREATE TABLE IF NOT EXISTS tally_receipt_staging (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id            uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  tally_company_name text,
  tally_guid         text NOT NULL,
  voucher_number     text,
  voucher_date       date,
  party_ledger       text,
  bank_ledger        text,
  amount             numeric NOT NULL DEFAULT 0,
  tds_amount         numeric NOT NULL DEFAULT 0,
  narration          text,
  matched_client_id  uuid REFERENCES clients(id) ON DELETE SET NULL,
  match_method       text NOT NULL DEFAULT 'unmatched'
                       CHECK (match_method IN ('gstin','name_exact','name_fuzzy','manual','unmatched')),
  match_confidence   numeric(5,2) NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','matched','imported','ignored','failed')),
  receipt_id         uuid REFERENCES billing_receipts(id) ON DELETE SET NULL,
  raw                jsonb NOT NULL DEFAULT '{}',
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  imported_at        timestamptz,
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (firm_id, tally_guid)
);
CREATE INDEX IF NOT EXISTS idx_trs_firm_status ON tally_receipt_staging(firm_id, status);

-- RLS -- firm-scoped; service role (agent) bypasses
ALTER TABLE tally_sync_queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_receipt_staging  ENABLE ROW LEVEL SECURITY;
DO $mig$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tally_sync_queue','tally_receipt_staging'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_firm_rw ON %1$s', tbl);
    EXECUTE format('CREATE POLICY %1$s_firm_rw ON %1$s FOR ALL TO authenticated USING (tally_billing_firm_access(firm_id)) WITH CHECK (tally_billing_firm_access(firm_id))', tbl);
  END LOOP;
END $mig$;
