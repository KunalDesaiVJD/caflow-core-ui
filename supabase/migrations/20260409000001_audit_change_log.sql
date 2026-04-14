-- audit_change_log: field-level change history for audit_status rows
CREATE TABLE IF NOT EXISTS audit_change_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      TEXT        NOT NULL,
  record_id       UUID        NOT NULL,
  field_name      TEXT        NOT NULL,
  field_label     TEXT,
  old_value       TEXT,
  new_value       TEXT,
  changed_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acl_record ON audit_change_log (record_id);
CREATE INDEX IF NOT EXISTS idx_acl_table_record ON audit_change_log (table_name, record_id);

ALTER TABLE audit_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read change log"
  ON audit_change_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert change log"
  ON audit_change_log FOR INSERT TO authenticated WITH CHECK (true);
