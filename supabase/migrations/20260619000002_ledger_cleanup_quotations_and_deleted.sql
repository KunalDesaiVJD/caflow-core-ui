-- Phase 1 / Q3 + Q5 — purge client_ledger_entries rows that should not exist.
--
-- These rows were created by two now-fixed bugs:
--   Q3  NewInvoice posted a ledger debit for ANY finalized document, so
--       finalized quotations/proformas landed in the ledger as "Invoice"
--       debits (e.g. VISHVAS POLYPACK, SHREEJIKRUPA).
--   Q5  Invoice deletion did not remove the invoice's ledger entry, so a
--       deleted invoice (e.g. Tamnna Infra 46/2026-27, Rs.88,500) kept
--       appearing in client ledgers and outstanding balances.

-- Q3: drop ledger rows that point at a quotation / proforma document.
DELETE FROM client_ledger_entries cle
USING invoices i
WHERE cle.document_id = i.id
  AND cle.entry_type IN ('invoice', 'credit_note')
  AND i.document_type IN ('quotation', 'proforma');

-- Q5: drop invoice/credit-note ledger rows whose source document no longer
-- exists (the invoice was deleted). NOT EXISTS avoids the NOT IN/NULL trap.
DELETE FROM client_ledger_entries cle
WHERE cle.entry_type IN ('invoice', 'credit_note')
  AND cle.document_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM invoices i WHERE i.id = cle.document_id
  );

DO $$
DECLARE v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM client_ledger_entries
   WHERE entry_type IN ('invoice', 'credit_note');
  RAISE NOTICE 'Ledger cleanup complete: % invoice/credit-note ledger rows remain.', v_rows;
END $$;
