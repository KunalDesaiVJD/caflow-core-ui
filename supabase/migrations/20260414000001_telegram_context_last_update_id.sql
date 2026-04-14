-- Add last_update_id to telegram_context for webhook deduplication.
-- Telegram resends a webhook if the bot doesn't respond within ~15 s.
-- Slow operations (e.g. PDF generation via Gotenberg) can exceed this threshold,
-- causing the same message to be processed twice and the same PDF to be sent twice.
-- Storing the last seen update_id lets the bot skip duplicates instantly.

ALTER TABLE public.telegram_context
  ADD COLUMN IF NOT EXISTS last_update_id BIGINT DEFAULT 0;

COMMENT ON COLUMN telegram_context.last_update_id IS
  'Most-recently processed Telegram update_id for this user. Used to skip duplicate webhook deliveries.';
