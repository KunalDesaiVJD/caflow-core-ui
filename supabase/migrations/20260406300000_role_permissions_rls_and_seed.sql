-- ═══════════════════════════════════════════════════════════════════════
-- Role Permissions — comprehensive RLS fix + default seed
-- Issue 6: "Roles and Permissions Module — Not working at all"
--
-- Root cause: the original rp_insert / rp_update policies required
-- current_user_role() = 'firm_admin' at INSERT time.  current_user_role()
-- reads a session variable that is SET by set_user_context(), which fires
-- asynchronously before each request — but the variable is not reliably
-- available when the first INSERT hits the policy evaluator.
--
-- Fix:
--   1. Drop the broken policies (idempotent).
--   2. Replace with simple same-firm scoping that does not depend on the
--      session variable.
--   3. Seed default permissions for every existing firm that has no rows,
--      so the page loads data on first visit without the front-end having
--      to INSERT anything.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Drop old INSERT / UPDATE policies ─────────────────────────────────
DROP POLICY IF EXISTS "rp_insert" ON public.role_permissions;
DROP POLICY IF EXISTS "rp_update" ON public.role_permissions;

-- ── 2. Recreate without role check ───────────────────────────────────────
CREATE POLICY "rp_insert" ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "rp_update" ON public.role_permissions
  FOR UPDATE TO authenticated
  USING  (is_superadmin() OR firm_id = current_user_firm_id())
  WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

-- ── 3. Seed default permissions for all firms that have no rows yet ───────
-- This runs once at migration time and ensures every firm starts with a
-- fully-populated matrix, preventing the front-end seed from being the
-- first writer (where RLS race conditions used to fire).
DO $$
DECLARE
  v_firm  RECORD;
  v_role  TEXT;
  v_mod   TEXT;
  v_view  BOOLEAN;
  v_creat BOOLEAN;
  v_edit  BOOLEAN;
  v_del   BOOLEAN;
  v_exp   BOOLEAN;
BEGIN
  FOR v_firm IN SELECT id FROM public.firms LOOP
    -- Only seed if this firm has no rows at all
    IF (SELECT COUNT(*) FROM public.role_permissions WHERE firm_id = v_firm.id) = 0 THEN
      -- Loop over all role × module combinations and insert defaults
      -- Mirrors DEFAULT_PERMISSIONS from usePermissions.tsx
      FOR v_role, v_mod, v_view, v_creat, v_edit, v_del, v_exp IN VALUES
        -- superadmin — FULL everywhere
        ('superadmin','Firm Management',     TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Client Management',   TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Service Masters',     TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','IT Returns',          TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','TDS',                 TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Billing',             TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Depreciation',        TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Audit Intelligence',  TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Chat',                TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Settings',            TRUE,TRUE,TRUE,TRUE,TRUE),
        ('superadmin','Theme Studio',        TRUE,TRUE,TRUE,TRUE,TRUE),
        -- firm_admin — FULL everywhere
        ('firm_admin','Firm Management',     TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Client Management',   TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Service Masters',     TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','IT Returns',          TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','TDS',                 TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Billing',             TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Depreciation',        TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Audit Intelligence',  TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Chat',                TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Settings',            TRUE,TRUE,TRUE,TRUE,TRUE),
        ('firm_admin','Theme Studio',        TRUE,TRUE,TRUE,TRUE,TRUE),
        -- partner_ca
        ('partner_ca','Firm Management',     TRUE, FALSE,FALSE,FALSE,FALSE),
        ('partner_ca','Client Management',   TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','Service Masters',     TRUE, FALSE,FALSE,FALSE,FALSE),
        ('partner_ca','IT Returns',          TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','TDS',                 TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','Billing',             TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','Depreciation',        TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','Audit Intelligence',  TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','Chat',                TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('partner_ca','Settings',            TRUE, FALSE,FALSE,FALSE,FALSE),
        ('partner_ca','Theme Studio',        FALSE,FALSE,FALSE,FALSE,FALSE),
        -- manager
        ('manager','Firm Management',        FALSE,FALSE,FALSE,FALSE,FALSE),
        ('manager','Client Management',      TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('manager','Service Masters',        TRUE, FALSE,FALSE,FALSE,FALSE),
        ('manager','IT Returns',             TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('manager','TDS',                    TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('manager','Billing',                TRUE, FALSE,FALSE,FALSE,FALSE),
        ('manager','Depreciation',           TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('manager','Audit Intelligence',     TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('manager','Chat',                   TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('manager','Settings',               FALSE,FALSE,FALSE,FALSE,FALSE),
        ('manager','Theme Studio',           FALSE,FALSE,FALSE,FALSE,FALSE),
        -- staff_article
        ('staff_article','Firm Management',     FALSE,FALSE,FALSE,FALSE,FALSE),
        ('staff_article','Client Management',   TRUE, TRUE, FALSE,FALSE,FALSE),
        ('staff_article','Service Masters',     FALSE,FALSE,FALSE,FALSE,FALSE),
        ('staff_article','IT Returns',          TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('staff_article','TDS',                 TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('staff_article','Billing',             TRUE, FALSE,FALSE,FALSE,FALSE),
        ('staff_article','Depreciation',        TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('staff_article','Audit Intelligence',  TRUE, TRUE, TRUE, FALSE,TRUE ),
        ('staff_article','Chat',                TRUE, TRUE, TRUE, TRUE, TRUE ),
        ('staff_article','Settings',            FALSE,FALSE,FALSE,FALSE,FALSE),
        ('staff_article','Theme Studio',        FALSE,FALSE,FALSE,FALSE,FALSE),
        -- client
        ('client','Firm Management',        FALSE,FALSE,FALSE,FALSE,FALSE),
        ('client','Client Management',      TRUE, FALSE,FALSE,FALSE,FALSE),
        ('client','Service Masters',        FALSE,FALSE,FALSE,FALSE,FALSE),
        ('client','IT Returns',             TRUE, FALSE,FALSE,FALSE,FALSE),
        ('client','TDS',                    FALSE,FALSE,FALSE,FALSE,FALSE),
        ('client','Billing',                TRUE, FALSE,FALSE,FALSE,FALSE),
        ('client','Depreciation',           FALSE,FALSE,FALSE,FALSE,FALSE),
        ('client','Audit Intelligence',     TRUE, FALSE,TRUE, FALSE,FALSE),
        ('client','Chat',                   TRUE, FALSE,FALSE,FALSE,FALSE),
        ('client','Settings',               FALSE,FALSE,FALSE,FALSE,FALSE),
        ('client','Theme Studio',           FALSE,FALSE,FALSE,FALSE,FALSE)
      LOOP
        INSERT INTO public.role_permissions
          (firm_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
        VALUES
          (v_firm.id, v_role, v_mod, v_view, v_creat, v_edit, v_del, v_exp)
        ON CONFLICT (firm_id, role, module) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
