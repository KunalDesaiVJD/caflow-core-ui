
-- FIX 1: Create update_overdue_invoices function
CREATE OR REPLACE FUNCTION public.update_overdue_invoices(p_firm_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE invoices
  SET status = 'overdue'
  WHERE firm_id = p_firm_id
    AND status IN ('finalized', 'sent')
    AND due_date IS NOT NULL
    AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- FIX 3: Update RLS on invoice_item_masters to allow shared (null firm_id) items
DROP POLICY IF EXISTS "firm_scope_select" ON public.invoice_item_masters;
CREATE POLICY "firm_scope_select" ON public.invoice_item_masters
  FOR SELECT
  TO authenticated
  USING (is_superadmin() OR firm_id IS NULL OR firm_id = current_user_firm_id());
