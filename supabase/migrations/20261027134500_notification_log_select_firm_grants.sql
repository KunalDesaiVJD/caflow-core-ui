-- Email Log: staff working in another firm through the firm switcher
-- (user_firm_access grant) could not see that firm's notification_log rows —
-- the SELECT policy only allowed the home firm or superadmin. Emails sent for a
-- granted firm (e.g. Dixita Desai ledgers sent from a V J Desai login) went out
-- but never appeared in the log. Match the invoices / receipts policy.
DROP POLICY IF EXISTS "authenticated_select_notification_log" ON public.notification_log;
CREATE POLICY "authenticated_select_notification_log"
  ON public.notification_log
  FOR SELECT
  TO authenticated
  USING (is_superadmin() OR firm_id = current_user_firm_id() OR user_firm_can(firm_id, 'view'::text));
