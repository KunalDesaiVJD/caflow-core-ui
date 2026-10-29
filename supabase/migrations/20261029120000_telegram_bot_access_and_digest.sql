-- ─────────────────────────────────────────────────────────────────────────
-- Telegram billing bot: who may use it, and a morning digest.
--
-- The bot answers with confidential billing data (balances, receipts, emails),
-- so only Telegram users listed here are served. Anyone else is told their
-- Telegram ID (also available with /myid) to pass to the administrator.
-- Add a user:  INSERT INTO telegram_allowed_users (telegram_user_id, name)
--              VALUES (<id>, '<name>');
--
-- Seeded with the one account that has used the bot so far.
-- Both tables are service-role only (RLS on, no policies).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telegram_allowed_users (
  telegram_user_id bigint PRIMARY KEY,
  name             text,
  active           boolean NOT NULL DEFAULT true,
  receive_digest   boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_allowed_users ENABLE ROW LEVEL SECURITY;

INSERT INTO public.telegram_allowed_users (telegram_user_id, name)
VALUES (7945611993, 'Owner (first bot user)')
ON CONFLICT (telegram_user_id) DO NOTHING;

-- Key the daily cron presents to the bot, so nobody else can trigger the digest.
CREATE TABLE IF NOT EXISTS public.telegram_bot_settings (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  digest_key text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text) || md5(random()::text),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_bot_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.telegram_bot_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Morning digest at 09:00 IST (03:30 UTC) every day.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'telegram-billing-digest') THEN
    PERFORM cron.unschedule('telegram-billing-digest');
  END IF;
END $$;

SELECT cron.schedule('telegram-billing-digest', '30 3 * * *', $cron$
  select net.http_post(
    url := 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/telegram-bot?digest=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Digest-Key', (select digest_key from public.telegram_bot_settings where id = 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
