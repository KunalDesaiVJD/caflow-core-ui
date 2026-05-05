-- Allow authenticated users to INSERT into notification_log
-- (service_role already bypasses RLS; this enables frontend logging as a fallback)
-- Also allow authenticated users to SELECT their own firm's logs (already works via SELECT policy)

DO $$
BEGIN
  -- Add INSERT policy if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notification_log'
      AND policyname = 'authenticated_insert_notification_log'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "authenticated_insert_notification_log"
      ON public.notification_log
      FOR INSERT
      TO authenticated
      WITH CHECK (true)
    $policy$;
  END IF;
END $$;
