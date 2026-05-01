-- ============================================================================
-- clients.tax_audit_applicable — promote the toggle to a real column
-- ============================================================================
--
-- Background
-- ──────────
-- The "Tax Audit Applicable" toggle in the Audit Setup tab had no canonical
-- column to land in:
--
--   * clients.tax_audit_type     — TEXT ("3CA"/"3CB"/null) — only the SUB-TYPE
--   * clients.tax_audit_applicable — DID NOT EXIST until this migration
--   * client_fy_audit_setup.tax_audit_applicable — boolean, but FY-keyed
--
-- ClientDetail.saveAuditSetup() persisted only `tax_audit_type`. If the user
-- toggled "Tax Audit Applicable" ON without picking a 3CA/3CB sub-type, the
-- boolean intent was silently lost. The displayed ✓ on the Audit Setup card
-- only persisted because of an FY-specific row in client_fy_audit_setup that
-- some earlier flow (NewClientWizard) had written.
--
-- Downstream filters (AuditPipeline eligible-clients query, etc.) tried to
-- merge across both sources but could disagree with the display logic, so a
-- client could show ✓ on the Audit Setup tab yet be hidden from the Create
-- Engagement dropdown — exactly the SHREEYAM INFRA / Dhanani symptom.
--
-- This migration introduces a real boolean column on `clients` and
-- BACKFILLS it from every existing source so no client loses their setup:
--
--   tax_audit_applicable := TRUE if any of:
--     * clients.tax_audit_type IS NOT NULL AND tax_audit_type <> ''
--     * EXISTS (
--         SELECT 1 FROM client_fy_audit_setup s
--         WHERE s.client_id = clients.id AND s.tax_audit_applicable = TRUE
--       )
-- ============================================================================

-- ── 1. Add column ────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tax_audit_applicable BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Backfill from legacy tax_audit_type ───────────────────────────────────
-- Any client that has a non-empty 3CA/3CB sub-type already has tax audit.
UPDATE public.clients
   SET tax_audit_applicable = TRUE
 WHERE tax_audit_applicable = FALSE
   AND tax_audit_type IS NOT NULL
   AND TRIM(tax_audit_type) <> '';

-- ── 3. Backfill from client_fy_audit_setup ───────────────────────────────────
-- Any client that has at least one FY row with tax_audit_applicable = TRUE
-- in the FY-specific setup table is treated as having tax audit applicable.
UPDATE public.clients c
   SET tax_audit_applicable = TRUE
  FROM (
    SELECT DISTINCT client_id
      FROM public.client_fy_audit_setup
     WHERE tax_audit_applicable = TRUE
  ) s
 WHERE c.id = s.client_id
   AND c.tax_audit_applicable = FALSE;

-- ── 4. Helpful index for the Create Engagement dropdown filter ───────────────
CREATE INDEX IF NOT EXISTS idx_clients_tax_audit_applicable
  ON public.clients (tax_audit_applicable)
  WHERE tax_audit_applicable = TRUE;
