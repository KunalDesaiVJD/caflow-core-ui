-- Fix RLS SELECT policy for invoices table to include superadmin bypass.
-- Superadmin was unable to view invoices for other firms in the Report tab,
-- causing the Sundry Debtors report to show no data for non-own firms.

DROP POLICY IF EXISTS "Firm select invoices" ON invoices;
CREATE POLICY "firm_select_invoices" ON invoices
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR firm_id = public.current_user_firm_id()
  );
