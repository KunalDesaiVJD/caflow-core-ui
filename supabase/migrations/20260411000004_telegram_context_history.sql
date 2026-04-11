-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: telegram_context — per-user conversation history for the bot
--
-- Used by handleWithClaude() to maintain multi-turn conversation state.
-- The `history` column stores the raw messages array passed to Claude API
-- (last 20 entries = 10 exchanges, pruned on every write).
--
-- Accessed ONLY by the telegram-bot edge function via service role key.
-- No authenticated user ever touches this table directly.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS telegram_context (
  user_id    BIGINT      PRIMARY KEY,           -- Telegram numeric user ID
  history    JSONB       NOT NULL DEFAULT '[]', -- Claude message history array
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  telegram_context              IS 'Per-user Claude conversation history for the Telegram billing bot.';
COMMENT ON COLUMN telegram_context.user_id      IS 'Telegram user ID (integer). Matches message.from.id in webhook payload.';
COMMENT ON COLUMN telegram_context.history      IS 'JSON array of {role, content} message pairs. Capped at 20 entries by the bot.';
COMMENT ON COLUMN telegram_context.updated_at   IS 'Set to now() on every bot reply. Used to prune stale sessions.';

-- Index for cleanup queries (e.g. DELETE WHERE updated_at < now() - interval '30 days')
CREATE INDEX IF NOT EXISTS idx_telegram_context_updated
  ON telegram_context (updated_at DESC);

-- RLS: service role bypasses this; no authenticated user access needed
ALTER TABLE telegram_context ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE policies for authenticated role — bot uses service key only.
-- If you ever need superadmin visibility, add a policy here.
