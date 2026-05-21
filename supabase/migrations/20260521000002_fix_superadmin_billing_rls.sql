-- Fix RLS SELECT policies for billing tables to include superadmin bypass.
-- billing_receipts, client_ledger_entries, and billing_kasars were missing the
-- is_superadmin() check, preventing the superadmin from viewing other firms' data
-- in the Report tab and Ledger tab.

-- billing_receipts
DROP POLICY IF EXISTS "firm_select_billing_receipts" ON billing_receipts;
CREATE POLICY "firm_select_billing_receipts" ON billing_receipts
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
  );

-- client_ledger_entries
DROP POLICY IF EXISTS "firm_select_ledger_entries" ON client_ledger_entries;
CREATE POLICY "firm_select_ledger_entries" ON client_ledger_entries
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
  );

-- billing_kasars
DROP POLICY IF EXISTS "Firm users can manage kasars" ON billing_kasars;
CREATE POLICY "Firm users can manage kasars" ON billing_kasars
  FOR ALL TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
  )
  WITH CHECK (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
  );
