-- ===========================================================================
-- TALLY <-> BILLING SYNC -- kasar / write-off (both directions)
-- Created: 2026-07-13
--
-- Reverse: a Tally receipt may write off a small balance (kasar/discount leg).
--          The agent captures that residual into tally_receipt_staging.kasar_amount
--          and, on import, books a billing_kasars row so CAFlow reduces the same.
-- Forward: a kasar booked directly in CAFlow is queued as a Tally Journal
--          (Dr Rebate/Kasar, Cr Party).
--
-- Loop guard: kasars created BY the reverse import carry "[tally-sync]" in their
-- narration; the forward trigger skips those so a Tally-origin kasar is never
-- posted back to Tally.
-- ===========================================================================

ALTER TABLE tally_receipt_staging ADD COLUMN IF NOT EXISTS kasar_amount numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION tally_sync_on_kasar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE has_company boolean;
BEGIN
  IF COALESCE(NEW.narration,'') LIKE '%[tally-sync]%' THEN RETURN NEW; END IF;  -- came from Tally, don't bounce back
  SELECT EXISTS(SELECT 1 FROM tally_firm_companies WHERE firm_id = NEW.firm_id AND is_active) INTO has_company;
  IF has_company THEN
    INSERT INTO tally_sync_queue(firm_id, invoice_id, document_no, direction, action, status, payload)
    VALUES (NEW.firm_id, NULL, 'KASAR '||left(NEW.id::text,8), 'forward', 'kasar', 'pending',
      jsonb_build_object('kasar_id', NEW.id, 'client_id', NEW.client_id, 'amount', NEW.amount,
                         'kasar_date', NEW.kasar_date, 'narration', COALESCE(NEW.narration,'Kasar')));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;   -- never block a kasar write
END; $fn$;

DROP TRIGGER IF EXISTS trg_tally_sync_kasar ON billing_kasars;
CREATE TRIGGER trg_tally_sync_kasar AFTER INSERT ON billing_kasars
  FOR EACH ROW EXECUTE FUNCTION tally_sync_on_kasar();
