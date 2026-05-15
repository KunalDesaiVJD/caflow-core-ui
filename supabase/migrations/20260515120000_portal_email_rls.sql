-- Portal multi-entity RLS fix
--
-- Problem: clients.email is populated for many records sharing one login email
-- (family / group-company accounts). The existing RLS only allows reading rows
-- where user_id = auth.uid(), so the email-based lookup in PortalClientContext
-- is silently returning 0 rows even though many clients have the matching email.
--
-- Fix: add SELECT policies so any authenticated portal user can:
--   1. Read clients whose email matches their JWT email (case-insensitive)
--   2. Read audit_client_queries for all those clients
--   3. Read + insert portal_query_messages for those queries

-- ── 1. clients: allow SELECT by email ────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clients'
      AND policyname = 'portal_clients_by_email'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "portal_clients_by_email"
      ON public.clients
      FOR SELECT
      TO authenticated
      USING (
        email IS NOT NULL
        AND lower(email) = lower(auth.jwt() ->> 'email')
        AND is_active IS NOT FALSE
        AND deleted_at IS NULL
      )
    $policy$;
  END IF;
END $$;

-- ── 2. audit_client_queries: allow SELECT by client email ─────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_client_queries'
      AND policyname = 'portal_queries_by_client_email'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "portal_queries_by_client_email"
      ON public.audit_client_queries
      FOR SELECT
      TO authenticated
      USING (
        client_id IN (
          SELECT id FROM public.clients
          WHERE email IS NOT NULL
            AND lower(email) = lower(auth.jwt() ->> 'email')
            AND is_active IS NOT FALSE
            AND deleted_at IS NULL
        )
      )
    $policy$;
  END IF;
END $$;

-- ── 3. portal_query_messages: allow SELECT + INSERT by client email ───────────

DO $$
BEGIN
  -- SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_query_messages'
      AND policyname = 'portal_query_messages_select_by_email'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "portal_query_messages_select_by_email"
      ON public.portal_query_messages
      FOR SELECT
      TO authenticated
      USING (
        query_id IN (
          SELECT q.id FROM public.audit_client_queries q
          JOIN public.clients c ON c.id = q.client_id
          WHERE c.email IS NOT NULL
            AND lower(c.email) = lower(auth.jwt() ->> 'email')
            AND c.is_active IS NOT FALSE
            AND c.deleted_at IS NULL
        )
      )
    $policy$;
  END IF;

  -- INSERT (portal user replies)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_query_messages'
      AND policyname = 'portal_query_messages_insert_by_email'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "portal_query_messages_insert_by_email"
      ON public.portal_query_messages
      FOR INSERT
      TO authenticated
      WITH CHECK (
        sender_role = 'client'
        AND query_id IN (
          SELECT q.id FROM public.audit_client_queries q
          JOIN public.clients c ON c.id = q.client_id
          WHERE c.email IS NOT NULL
            AND lower(c.email) = lower(auth.jwt() ->> 'email')
            AND c.is_active IS NOT FALSE
            AND c.deleted_at IS NULL
        )
      )
    $policy$;
  END IF;
END $$;

-- ── 4. audit_client_queries: allow UPDATE (status/reply) by client email ─────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_client_queries'
      AND policyname = 'portal_queries_update_by_email'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "portal_queries_update_by_email"
      ON public.audit_client_queries
      FOR UPDATE
      TO authenticated
      USING (
        client_id IN (
          SELECT id FROM public.clients
          WHERE email IS NOT NULL
            AND lower(email) = lower(auth.jwt() ->> 'email')
            AND is_active IS NOT FALSE
            AND deleted_at IS NULL
        )
      )
      WITH CHECK (
        client_id IN (
          SELECT id FROM public.clients
          WHERE email IS NOT NULL
            AND lower(email) = lower(auth.jwt() ->> 'email')
            AND is_active IS NOT FALSE
            AND deleted_at IS NULL
        )
      )
    $policy$;
  END IF;
END $$;
