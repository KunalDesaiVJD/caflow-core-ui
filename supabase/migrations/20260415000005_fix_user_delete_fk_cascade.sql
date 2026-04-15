-- Fix: user deletion blocked by FK constraints that lack ON DELETE SET NULL.
-- ai_usage_log, feedback, and clients all reference public.users(id) without a
-- cascade action, causing "violates foreign key constraint" when deleting a user.
-- Re-create each FK with ON DELETE SET NULL so the reference is nullified and
-- the parent row can be removed cleanly.

-- 1. ai_usage_log.user_id (confirmed blocker — "ai_usage_log_user_id_fkey")
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_user_id_fkey;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. feedback.user_id (potential next blocker)
ALTER TABLE public.feedback
  DROP CONSTRAINT IF EXISTS feedback_user_id_fkey;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- 3. clients.user_id (potential blocker for users who have a client-portal record)
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_user_id_fkey;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
