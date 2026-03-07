
-- RLS policies for trial_balance_snapshots using firm-based isolation via clients table
CREATE POLICY "Firm select trial_balance_snapshots"
ON public.trial_balance_snapshots
FOR SELECT
TO authenticated
USING (
  is_superadmin() OR (client_id IN (
    SELECT id FROM clients WHERE firm_id = current_user_firm_id()
  ))
);

CREATE POLICY "Firm insert trial_balance_snapshots"
ON public.trial_balance_snapshots
FOR INSERT
TO authenticated
WITH CHECK (
  is_superadmin() OR (client_id IN (
    SELECT id FROM clients WHERE firm_id = current_user_firm_id()
  ))
);

CREATE POLICY "Firm update trial_balance_snapshots"
ON public.trial_balance_snapshots
FOR UPDATE
TO authenticated
USING (
  is_superadmin() OR (client_id IN (
    SELECT id FROM clients WHERE firm_id = current_user_firm_id()
  ))
);

CREATE POLICY "Firm delete trial_balance_snapshots"
ON public.trial_balance_snapshots
FOR DELETE
TO authenticated
USING (
  is_superadmin() OR (client_id IN (
    SELECT id FROM clients WHERE firm_id = current_user_firm_id()
  ))
);
