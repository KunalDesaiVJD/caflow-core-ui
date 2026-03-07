-- Add owner column to clients
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS user_id uuid;

-- Keep ownership linked to app-level users table (mirrors auth user id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_user_id_fkey'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients(user_id);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Remove prior policies
DROP POLICY IF EXISTS "Users can view their clients" ON public.clients;
DROP POLICY IF EXISTS "Users can insert their clients" ON public.clients;
DROP POLICY IF EXISTS "Users can update their clients" ON public.clients;
DROP POLICY IF EXISTS "Users can delete their clients" ON public.clients;
DROP POLICY IF EXISTS "Users can read clients for their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can insert clients for their firm" ON public.clients;
DROP POLICY IF EXISTS "Users can update clients for their firm" ON public.clients;

-- Enforce owner-only access
CREATE POLICY "Users can view their clients"
ON public.clients
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their clients"
ON public.clients
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their clients"
ON public.clients
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their clients"
ON public.clients
FOR DELETE
USING (auth.uid() = user_id);

-- Align client_profiles ownership checks with clients.user_id so wizard final submit succeeds
DROP POLICY IF EXISTS "Users can read client_profiles for their firm clients" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can insert client_profiles for their firm clients" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can update client_profiles for their firm clients" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can read their client_profiles" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can insert their client_profiles" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can update their client_profiles" ON public.client_profiles;
DROP POLICY IF EXISTS "Users can delete their client_profiles" ON public.client_profiles;

CREATE POLICY "Users can read their client_profiles"
ON public.client_profiles
FOR SELECT
USING (
  client_id IN (
    SELECT c.id
    FROM public.clients c
    WHERE c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert their client_profiles"
ON public.client_profiles
FOR INSERT
WITH CHECK (
  client_id IN (
    SELECT c.id
    FROM public.clients c
    WHERE c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update their client_profiles"
ON public.client_profiles
FOR UPDATE
USING (
  client_id IN (
    SELECT c.id
    FROM public.clients c
    WHERE c.user_id = auth.uid()
  )
)
WITH CHECK (
  client_id IN (
    SELECT c.id
    FROM public.clients c
    WHERE c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their client_profiles"
ON public.client_profiles
FOR DELETE
USING (
  client_id IN (
    SELECT c.id
    FROM public.clients c
    WHERE c.user_id = auth.uid()
  )
);