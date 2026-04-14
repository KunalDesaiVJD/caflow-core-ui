-- ─── 1. Add avatar_url to users table ────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- ─── 2. OTP requests table for password reset ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.otp_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  user_id     UUID        REFERENCES public.users(id) ON DELETE CASCADE,
  otp_code    TEXT        NOT NULL,
  purpose     TEXT        NOT NULL DEFAULT 'password_reset', -- 'password_reset' | 'email_change'
  new_email   TEXT        DEFAULT NULL,                      -- for email_change purpose
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_otp_requests_email     ON public.otp_requests(email);
CREATE INDEX IF NOT EXISTS idx_otp_requests_user_id   ON public.otp_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_requests_expires   ON public.otp_requests(expires_at);

-- RLS: only service_role can read/write OTP records (never exposed to anon)
ALTER TABLE public.otp_requests ENABLE ROW LEVEL SECURITY;

-- Service role bypass (edge functions use service role)
CREATE POLICY "service_role_all_otp"
  ON public.otp_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── 3. Storage bucket for user avatars (public read) ────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own avatar
CREATE POLICY IF NOT EXISTS "auth_users_upload_avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'user-avatars');

CREATE POLICY IF NOT EXISTS "auth_users_update_avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'user-avatars');

-- Public read for avatars
CREATE POLICY IF NOT EXISTS "public_read_avatars"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'user-avatars');
