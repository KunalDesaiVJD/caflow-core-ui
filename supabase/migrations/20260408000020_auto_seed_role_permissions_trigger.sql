-- ═══════════════════════════════════════════════════════════════════════
-- Issue 1: Auto-seed role_permissions for NEW firms
-- Root cause: 20260406300000 seeded all EXISTING firms but new firms
-- created after that migration had no rows in role_permissions.  The
-- front-end fallback to code defaults is unreliable and only kicks in
-- when someone opens the Roles & Permissions page.
--
-- Fix: PostgreSQL AFTER INSERT trigger on the firms table that seeds
-- default permissions for every newly created firm.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Seed function (idempotent — uses ON CONFLICT DO NOTHING) ────────
CREATE OR REPLACE FUNCTION public.seed_default_role_permissions(p_firm_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.role_permissions
    (firm_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
  VALUES
    -- superadmin — FULL everywhere
    (p_firm_id,'superadmin','Firm Management',     TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Client Management',   TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Service Masters',     TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','IT Returns',          TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','TDS',                 TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Billing',             TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Depreciation',        TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Audit Intelligence',  TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Chat',                TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Settings',            TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'superadmin','Theme Studio',        TRUE,TRUE,TRUE,TRUE,TRUE),
    -- firm_admin — FULL everywhere
    (p_firm_id,'firm_admin','Firm Management',     TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Client Management',   TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Service Masters',     TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','IT Returns',          TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','TDS',                 TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Billing',             TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Depreciation',        TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Audit Intelligence',  TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Chat',                TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Settings',            TRUE,TRUE,TRUE,TRUE,TRUE),
    (p_firm_id,'firm_admin','Theme Studio',        TRUE,TRUE,TRUE,TRUE,TRUE),
    -- partner_ca
    (p_firm_id,'partner_ca','Firm Management',     TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'partner_ca','Client Management',   TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','Service Masters',     TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'partner_ca','IT Returns',          TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','TDS',                 TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','Billing',             TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','Depreciation',        TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','Audit Intelligence',  TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','Chat',                TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'partner_ca','Settings',            TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'partner_ca','Theme Studio',        FALSE,FALSE,FALSE,FALSE,FALSE),
    -- manager
    (p_firm_id,'manager','Firm Management',        FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'manager','Client Management',      TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'manager','Service Masters',        TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'manager','IT Returns',             TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'manager','TDS',                    TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'manager','Billing',                TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'manager','Depreciation',           TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'manager','Audit Intelligence',     TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'manager','Chat',                   TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'manager','Settings',               FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'manager','Theme Studio',           FALSE,FALSE,FALSE,FALSE,FALSE),
    -- staff_article
    (p_firm_id,'staff_article','Firm Management',     FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'staff_article','Client Management',   TRUE, TRUE, FALSE,FALSE,FALSE),
    (p_firm_id,'staff_article','Service Masters',     FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'staff_article','IT Returns',          TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'staff_article','TDS',                 TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'staff_article','Billing',             TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'staff_article','Depreciation',        TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'staff_article','Audit Intelligence',  TRUE, TRUE, TRUE, FALSE,TRUE ),
    (p_firm_id,'staff_article','Chat',                TRUE, TRUE, TRUE, TRUE, TRUE ),
    (p_firm_id,'staff_article','Settings',            FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'staff_article','Theme Studio',        FALSE,FALSE,FALSE,FALSE,FALSE),
    -- client
    (p_firm_id,'client','Firm Management',        FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Client Management',      TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Service Masters',        FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','IT Returns',             TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','TDS',                    FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Billing',                TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Depreciation',           FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Audit Intelligence',     TRUE, FALSE,TRUE, FALSE,FALSE),
    (p_firm_id,'client','Chat',                   TRUE, FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Settings',               FALSE,FALSE,FALSE,FALSE,FALSE),
    (p_firm_id,'client','Theme Studio',           FALSE,FALSE,FALSE,FALSE,FALSE)
  ON CONFLICT (firm_id, role, module) DO NOTHING;
END;
$$;

-- ── 2. Trigger function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_seed_role_permissions_on_firm_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.seed_default_role_permissions(NEW.id);
  RETURN NEW;
END;
$$;

-- ── 3. Attach trigger to firms table ──────────────────────────────────
DROP TRIGGER IF EXISTS seed_role_permissions_on_firm_insert ON public.firms;
CREATE TRIGGER seed_role_permissions_on_firm_insert
  AFTER INSERT ON public.firms
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seed_role_permissions_on_firm_insert();

-- ── 4. Back-fill any firms still missing rows (idempotent) ───────────
DO $$
DECLARE v_firm RECORD;
BEGIN
  FOR v_firm IN
    SELECT id FROM public.firms f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp WHERE rp.firm_id = f.id LIMIT 1
    )
  LOOP
    PERFORM public.seed_default_role_permissions(v_firm.id);
  END LOOP;
END;
$$;

-- ── 5. Verify ─────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.firms) AS total_firms,
  (SELECT COUNT(DISTINCT firm_id) FROM public.role_permissions) AS firms_with_permissions;
