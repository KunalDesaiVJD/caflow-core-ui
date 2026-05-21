-- Clean up orphaned client_ledger_entries whose receipts have been deleted.
-- When a receipt was deleted before the cascade-delete fix was deployed,
-- its ledger entries (receipt + TDS/adjustment rows) were left behind.

DELETE FROM client_ledger_entries
WHERE entry_type IN ('receipt', 'adjustment', 'kasar')
  AND document_id IS NOT NULL
  AND document_id NOT IN (SELECT id FROM billing_receipts);
