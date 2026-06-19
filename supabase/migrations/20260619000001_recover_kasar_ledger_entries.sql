-- Phase 0 / C1 — Recover kasar ledger entries wiped by the orphan cleanup.
--
-- 20260521000003_cleanup_orphaned_ledger_entries.sql deleted EVERY
-- client_ledger_entries row of entry_type 'kasar' because it matched them
-- against billing_receipts:
--     document_id NOT IN (SELECT id FROM billing_receipts)
-- A kasar ledger row's document_id is a billing_kasars.id (never a receipt
-- id), so all kasar rows matched and were destroyed. This silently inflated
-- every affected client's outstanding balance by the written-off amount.
--
-- The source rows in billing_kasars were untouched, so the lost ledger
-- entries are fully re-derivable. This migration re-inserts the missing
-- 'kasar' ledger rows, exactly as ReceiptsTab.handleSaveKasar would have.
--
-- IDEMPOTENT: only inserts a kasar ledger row where one does not already
-- exist for that billing_kasars.id, so it is safe to run more than once and
-- safe on a fresh database (billing_kasars is empty there → no-op).

INSERT INTO client_ledger_entries
  (firm_id, client_id, entry_date, entry_type, document_id,
   debit_amount, credit_amount, balance, narration, financial_year)
SELECT
  bk.firm_id,
  bk.client_id,
  bk.kasar_date,
  'kasar',
  bk.id,
  0,
  bk.amount,
  0,
  COALESCE(bk.narration, 'Kasar settlement'),
  bk.financial_year
FROM billing_kasars bk
WHERE NOT EXISTS (
  SELECT 1 FROM client_ledger_entries cle
  WHERE cle.entry_type = 'kasar'
    AND cle.document_id = bk.id
);

-- Report how many were recovered (visible in migration output / logs).
DO $$
DECLARE
  v_total   integer;
  v_present integer;
BEGIN
  SELECT count(*) INTO v_total FROM billing_kasars;
  SELECT count(*) INTO v_present
    FROM client_ledger_entries WHERE entry_type = 'kasar';
  RAISE NOTICE 'Kasar recovery complete: % billing_kasars rows, % kasar ledger entries now present.',
    v_total, v_present;
END $$;
