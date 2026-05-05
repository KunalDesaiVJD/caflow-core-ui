-- Fix notification_log SELECT policy so that:
-- 1. Firm users see only their firm's logs
-- 2. Super admins see all logs

DO $$
BEGIN
  -- Drop existing restrictive SELECT policy if any
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notification_log'
      AND policyname = 'Users can view their firm notification logs'
  ) THEN
    DROP POLICY "Users can view their firm notification logs" ON public.notification_log;
  END IF;

  -- Create new SELECT policy that also allows superadmins
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notification_log'
      AND policyname = 'authenticated_select_notification_log'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "authenticated_select_notification_log"
      ON public.notification_log
      FOR SELECT
      TO authenticated
      USING (
        firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
        OR
        (SELECT role FROM public.users WHERE id = auth.uid()) = 'superadmin'
      )
    $policy$;
  END IF;
END $$;
