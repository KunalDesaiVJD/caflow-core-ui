-- ─── user_notifications ─────────────────────────────────────────────────────
-- Stores per-user in-app notifications (e.g. "You are scheduled for audit at X").
-- Rows are inserted by server-side logic (useAuditPlanning.addEntry) and read
-- by the dashboard for the logged-in user.

CREATE TABLE IF NOT EXISTS user_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    uuid        REFERENCES firms(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text        NOT NULL DEFAULT 'audit_scheduled',
  title      text        NOT NULL,
  message    text        NOT NULL,
  link       text,
  is_read    boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast per-user unread fetches
CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications (user_id, is_read, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "own_notifications_select"
  ON user_notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated clients can insert (needed so browser-side code can fan out to employees)
CREATE POLICY "authenticated_insert"
  ON user_notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Users can update (mark as read) their own notifications
CREATE POLICY "own_notifications_update"
  ON user_notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own notifications (optional dismissal)
CREATE POLICY "own_notifications_delete"
  ON user_notifications FOR DELETE
  USING (auth.uid() = user_id);
