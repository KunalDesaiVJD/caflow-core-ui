-- ===========================================================================
-- TALLY <-> BILLING SYNC -- correction/deletion propagation + kasar
-- Created: 2026-07-13
--
-- Keeps Tally in step when a document that was ALREADY synced is edited, voided,
-- or deleted in CAFlow:
--   * meaningful edit  -> re-queue an 'upsert' (agent delete-by-REMOTEID + recreate)
--   * void / delete    -> queue a 'delete'  (agent delete-by-REMOTEID)
-- The trigger only acts on docs that already reached Tally (a tally_voucher_log
-- row exists), so brand-new docs still wait for the user's manual Sync. It is
-- exception-guarded so a sync-queue hiccup can NEVER block an invoice write.
-- ===========================================================================

-- queue: support a delete action + a payload that survives the invoice row
ALTER TABLE tally_sync_queue ADD COLUMN IF NOT EXISTS action  text NOT NULL DEFAULT 'upsert';
ALTER TABLE tally_sync_queue DROP CONSTRAINT IF EXISTS tally_sync_queue_action_chk;
ALTER TABLE tally_sync_queue ADD CONSTRAINT tally_sync_queue_action_chk CHECK (action IN ('upsert','delete','kasar'));
ALTER TABLE tally_sync_queue ADD COLUMN IF NOT EXISTS payload jsonb;
-- a delete queued just before the invoice row disappears must survive it
ALTER TABLE tally_sync_queue ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE tally_sync_queue DROP CONSTRAINT IF EXISTS tally_sync_queue_invoice_id_fkey;
ALTER TABLE tally_sync_queue ADD CONSTRAINT tally_sync_queue_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION tally_sync_on_invoice_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE synced boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.document_type NOT IN ('invoice','credit_note') THEN RETURN OLD; END IF;
    SELECT EXISTS(SELECT 1 FROM tally_voucher_log WHERE invoice_id = OLD.id AND tally_vch_id IS NOT NULL) INTO synced;
    IF synced THEN
      DELETE FROM tally_sync_queue WHERE invoice_id = OLD.id AND direction = 'forward';
      INSERT INTO tally_sync_queue(firm_id, invoice_id, document_no, direction, action, status, payload)
      VALUES (OLD.firm_id, OLD.id, OLD.invoice_no, 'forward', 'delete', 'pending',
        jsonb_build_object('remote_id','CAFLOW-'||OLD.id, 'voucher_number',OLD.invoice_no,
                           'invoice_date',OLD.invoice_date, 'document_type',OLD.document_type));
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.document_type NOT IN ('invoice','credit_note') THEN RETURN NEW; END IF;
    SELECT EXISTS(SELECT 1 FROM tally_voucher_log WHERE invoice_id = NEW.id AND tally_vch_id IS NOT NULL) INTO synced;
    IF NOT synced THEN RETURN NEW; END IF;
    IF NEW.status = 'voided' AND COALESCE(OLD.status,'') <> 'voided' THEN
      INSERT INTO tally_sync_queue(firm_id, invoice_id, document_no, direction, action, status, payload)
      VALUES (NEW.firm_id, NEW.id, NEW.invoice_no, 'forward','delete','pending',
        jsonb_build_object('remote_id','CAFLOW-'||NEW.id,'voucher_number',NEW.invoice_no,
                           'invoice_date',NEW.invoice_date,'document_type',NEW.document_type))
      ON CONFLICT (invoice_id, direction) DO UPDATE SET action='delete', status='pending', attempts=0, payload=EXCLUDED.payload;
    ELSIF (NEW.total_amount   IS DISTINCT FROM OLD.total_amount
        OR NEW.line_items     IS DISTINCT FROM OLD.line_items
        OR NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date
        OR NEW.client_id      IS DISTINCT FROM OLD.client_id
        OR NEW.total_cgst     IS DISTINCT FROM OLD.total_cgst
        OR NEW.total_sgst     IS DISTINCT FROM OLD.total_sgst
        OR NEW.total_igst     IS DISTINCT FROM OLD.total_igst) THEN
      INSERT INTO tally_sync_queue(firm_id, invoice_id, document_no, direction, action, status)
      VALUES (NEW.firm_id, NEW.id, NEW.invoice_no, 'forward','upsert','pending')
      ON CONFLICT (invoice_id, direction) DO UPDATE SET action='upsert', status='pending', attempts=0, last_error=null;
    END IF;
    RETURN NEW;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- never block the underlying invoice write because of a sync-queue problem
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tally_sync_invoice ON invoices;
CREATE TRIGGER trg_tally_sync_invoice AFTER UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION tally_sync_on_invoice_change();
