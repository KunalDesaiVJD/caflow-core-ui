-- Phase 1 / Q4 — allow per-(firm, client, GSTIN) opening balances.
--
-- The table originally declared UNIQUE (firm_id, client_id), which permitted
-- only ONE opening balance per client. Multi-state clients (e.g. SHREEJIKRUPA
-- BUILDCON) need one opening balance per GSTIN/state; the old constraint
-- blocked or overwrote the additional states. The `gstin` column already
-- exists (20260518184021); here we widen uniqueness to include it.

-- 1) Collapse any exact duplicates on the NEW key (keep the most recent), so
--    the unique index can be created even if the old constraint was not
--    actually enforced in this database. Different GSTINs are NOT duplicates
--    and are preserved.
DELETE FROM client_billing_opening_balances a
USING client_billing_opening_balances b
WHERE a.firm_id   = b.firm_id
  AND a.client_id = b.client_id
  AND COALESCE(a.gstin, '') = COALESCE(b.gstin, '')
  AND (
        a.balance_date < b.balance_date
     OR (a.balance_date = b.balance_date AND a.ctid < b.ctid)
  );

-- 2) Drop the old UNIQUE(firm_id, client_id) constraint by introspection
--    (its auto-generated name can vary), regardless of column order.
DO $$
DECLARE v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'client_billing_opening_balances'
    AND con.contype = 'u'
    AND (
      SELECT array_agg(att.attname ORDER BY att.attname)
      FROM unnest(con.conkey) AS k
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k
    ) = ARRAY['client_id', 'firm_id']
  LIMIT 1;

  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE client_billing_opening_balances DROP CONSTRAINT %I', v_name);
    RAISE NOTICE 'Dropped old opening-balance unique constraint: %', v_name;
  END IF;
END $$;

-- 3) New uniqueness: one opening balance per (firm, client, GSTIN). COALESCE
--    makes the single "no specific GSTIN" (NULL) row unique too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ob_firm_client_gstin
  ON client_billing_opening_balances (firm_id, client_id, COALESCE(gstin, ''));
