-- CP-FIX: Seed / reset superadmin@test.com with password = superadmin123
--
-- This migration is idempotent:
--   • If the auth user does NOT exist  → creates it with the correct password.
--   • If the auth user DOES exist      → resets the password and confirms the email.
--   • Ensures a matching row in public.users with role = 'superadmin'.
--
-- Run this in the Supabase SQL Editor (or via supabase db push).

DO $$
DECLARE
  v_user_id uuid := 'c82493cb-d42c-42a8-bd28-52779f954038';
  v_firm_id uuid := 'be411601-f0f5-4f74-b93d-b87a8ef1b82b';
  v_exists  boolean;
BEGIN
  -- ── 1. Check auth.users ──────────────────────────────────────────────────────
  SELECT EXISTS(
    SELECT 1 FROM auth.users WHERE email = 'superadmin@test.com'
  ) INTO v_exists;

  IF NOT v_exists THEN
    -- Create the auth user from scratch
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'superadmin@test.com',
      crypt('superadmin123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"role":"superadmin","name":"Super Admin"}',
      now(),
      now(),
      '',
      ''
    );
  ELSE
    -- Reset password and ensure email is confirmed
    UPDATE auth.users
    SET
      encrypted_password  = crypt('superadmin123', gen_salt('bf')),
      email_confirmed_at  = COALESCE(email_confirmed_at, now()),
      updated_at          = now(),
      -- Grab the real UUID in case it differs from our constant
      id                  = id   -- no-op; we set v_user_id below
    WHERE email = 'superadmin@test.com'
    RETURNING id INTO v_user_id;
  END IF;

  -- ── 2. Ensure public.users profile ──────────────────────────────────────────
  INSERT INTO public.users (id, email, name, role, firm_id, is_active)
  VALUES (
    v_user_id,
    'superadmin@test.com',
    'Super Admin',
    'superadmin',
    v_firm_id,
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    role      = 'superadmin',
    is_active = true,
    email     = EXCLUDED.email,
    firm_id   = COALESCE(public.users.firm_id, EXCLUDED.firm_id);

END $$;

-- Verify
SELECT id, email, email_confirmed_at IS NOT NULL AS confirmed
FROM auth.users WHERE email = 'superadmin@test.com';

SELECT id, email, role, is_active
FROM public.users WHERE email = 'superadmin@test.com';
