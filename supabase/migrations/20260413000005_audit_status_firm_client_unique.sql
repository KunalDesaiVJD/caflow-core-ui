-- CONFLICT-5 FIX: Re-add the UNIQUE constraint on audit_status(firm_id, client_id)
-- that was dropped when the v2 migration (20260408210000_audit_tracker_v2.sql) replaced
-- the v1 table with DROP TABLE … CASCADE.
--
-- Without this constraint the upsert in useAuditPlanning.ts:
--   .upsert({ … }, { onConflict: "firm_id,client_id", ignoreDuplicates: true })
-- cannot resolve conflicts — PostgREST requires a real DB constraint to honour
-- the onConflict clause.  The fix inserts duplicate rows instead of upserting,
-- causing phantom Audit-Status rows per client.
--
-- Strategy: deduplicate first (keep newest row per firm+client pair), then add constraint.

-- Step 1: remove duplicate rows — keep the row with the latest created_at per (firm_id, client_id)
DELETE FROM public.audit_status
WHERE id NOT IN (
  SELECT DISTINCT ON (firm_id, client_id) id
  FROM public.audit_status
  ORDER BY firm_id, client_id, created_at DESC NULLS LAST
);

-- Step 2: add the constraint (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_status'::regclass
      AND conname   = 'audit_status_firm_client_unique'
  ) THEN
    ALTER TABLE public.audit_status
      ADD CONSTRAINT audit_status_firm_client_unique UNIQUE (firm_id, client_id);
  END IF;
END $$;
