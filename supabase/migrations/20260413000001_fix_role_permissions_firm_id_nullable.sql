-- ═══════════════════════════════════════════════════════════════════════
-- Fix role_permissions: make firm_id nullable so global (NULL) rows work
--
-- Root cause of save error:
--   The original table was created with  firm_id UUID NOT NULL.
--   The Roles & Permissions page saves global permissions using firm_id = NULL
--   (rows that apply across all firms).  The NOT NULL constraint rejects every
--   INSERT, producing the "null value in column firm_id violates not-null
--   constraint" error before RLS even runs.
--
-- Changes:
--   1. Drop NOT NULL — FK still enforces referential integrity when non-null.
--   2. Drop the old UNIQUE(firm_id, role, module) constraint
--      (PostgreSQL treats NULL≠NULL in unique indexes, so it would allow
--       duplicate global rows).
--   3. Add two partial unique indexes that handle NULL correctly:
--        • Global rows  (firm_id IS NULL)  → unique on (role, module)
--        • Firm rows    (firm_id IS NOT NULL) → unique on (firm_id, role, module)
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Drop NOT NULL
ALTER TABLE public.role_permissions
  ALTER COLUMN firm_id DROP NOT NULL;

-- 2. Drop the old composite unique constraint
ALTER TABLE public.role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_firm_id_role_module_key;

-- 3a. Partial unique index for global rows (firm_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_global_unique_idx
  ON public.role_permissions (role, module)
  WHERE firm_id IS NULL;

-- 3b. Partial unique index for firm-specific rows (firm_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_firm_unique_idx
  ON public.role_permissions (firm_id, role, module)
  WHERE firm_id IS NOT NULL;
