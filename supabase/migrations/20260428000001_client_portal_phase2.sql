-- ─────────────────────────────────────────────────────────────────────────────
-- Client Portal Phase 2
--   1. portal_query_messages  — conversation thread per audit query
--   2. audit_client_queries   — add required_documents, ledger_name, group_name
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Conversation messages ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal_query_messages (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  query_id        UUID        NOT NULL REFERENCES audit_client_queries(id) ON DELETE CASCADE,
  sender_role     TEXT        NOT NULL CHECK (sender_role IN ('auditor','client')),
  sender_name     TEXT,
  message         TEXT        NOT NULL DEFAULT '',
  attachment_path TEXT,           -- Supabase Storage path (firm-assets bucket)
  attachment_name TEXT,           -- original filename for display
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE portal_query_messages ENABLE ROW LEVEL SECURITY;

-- Auditors (firm staff) + superadmin can see all messages in their firm's queries
CREATE POLICY "pqm_firm_select" ON portal_query_messages
  FOR SELECT USING (
    query_id IN (
      SELECT id FROM audit_client_queries
      WHERE is_superadmin() OR firm_id = current_user_firm_id()
    )
  );

-- Client users can see messages for their own queries
CREATE POLICY "pqm_client_select" ON portal_query_messages
  FOR SELECT USING (
    query_id IN (
      SELECT q.id FROM audit_client_queries q
      JOIN clients c ON c.id = q.client_id
      WHERE c.user_id = auth.uid()
    )
  );

-- Auditors can insert messages
CREATE POLICY "pqm_firm_insert" ON portal_query_messages
  FOR INSERT WITH CHECK (
    sender_role = 'auditor' AND
    query_id IN (
      SELECT id FROM audit_client_queries
      WHERE is_superadmin() OR firm_id = current_user_firm_id()
    )
  );

-- Clients can insert their own messages
CREATE POLICY "pqm_client_insert" ON portal_query_messages
  FOR INSERT WITH CHECK (
    sender_role = 'client' AND
    query_id IN (
      SELECT q.id FROM audit_client_queries q
      JOIN clients c ON c.id = q.client_id
      WHERE c.user_id = auth.uid()
    )
  );

-- Service role bypass
GRANT ALL ON portal_query_messages TO service_role;
GRANT SELECT, INSERT ON portal_query_messages TO authenticated;

-- ── 2. Enrich audit_client_queries ──────────────────────────────────────────

ALTER TABLE audit_client_queries
  ADD COLUMN IF NOT EXISTS required_documents TEXT,
  ADD COLUMN IF NOT EXISTS ledger_name        TEXT,
  ADD COLUMN IF NOT EXISTS group_name         TEXT;
