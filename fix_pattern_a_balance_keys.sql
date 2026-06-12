-- RC-10 fix: coa_reconcile_balance on Pattern A notes (borrowings, provisions,
-- loans_advances, investments) was written as a BARE key. The canonical
-- aggregator (computeNoteTotals lookupSuffixed) reads it via the bare-key
-- fallback, so the BS face and FsHealthPanel showed "reconciled" — but the
-- Notes UI renderer reads ONLY _lt/_st suffixed keys for Pattern A rows, so
-- the row displayed blank and the on-screen note total excluded it
-- (BHAKTI INFRA: displayed ₹3,74,94,223 vs face ₹73,30,715).
--
-- Migration: move the bare value into the _lt suffixed key (all current
-- adjustments belong to the LT column — the note rows they offset are LT-
-- classified). Idempotent: skips rows already migrated.
WITH pattern_a AS (
  SELECT id, note_type,
    (cy_data->>'coa_reconcile_balance')::numeric as cy_bal,
    (py_data->>'coa_reconcile_balance')::numeric as py_bal
  FROM nce_financial_notes
  WHERE note_type IN ('borrowings','provisions','loans_advances','investments')
    AND (cy_data ? 'coa_reconcile_balance' OR py_data ? 'coa_reconcile_balance')
),
updated AS (
  UPDATE nce_financial_notes n SET
    cy_data = (n.cy_data - 'coa_reconcile_balance')
              || jsonb_build_object('coa_reconcile_balance_lt', coalesce(p.cy_bal, 0)),
    py_data = (n.py_data - 'coa_reconcile_balance')
              || jsonb_build_object('coa_reconcile_balance_lt', coalesce(p.py_bal, 0)),
    updated_at = now()
  FROM pattern_a p
  WHERE n.id = p.id
  RETURNING n.id, n.note_type
)
SELECT count(*) as rows_migrated,
       (SELECT string_agg(DISTINCT note_type, ', ') FROM updated) as note_types
FROM updated
