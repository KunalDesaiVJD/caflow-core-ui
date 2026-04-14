-- ============================================================
-- Tax Audit Templates: storage bucket, tables, RLS, triggers
-- Migration: 20260412000001_tax_audit_templates
-- ============================================================

-- ── 1. Storage bucket (private) ──────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tax_audit_templates',
  'tax_audit_templates',
  false,
  52428800,  -- 50 MB
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: service-role only for writes; authenticated for reads
CREATE POLICY "tax_audit_templates_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'tax_audit_templates');

CREATE POLICY "tax_audit_templates_insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'tax_audit_templates');

CREATE POLICY "tax_audit_templates_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'tax_audit_templates');

CREATE POLICY "tax_audit_templates_delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'tax_audit_templates');

-- ── 2. tax_audit_form ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_audit_form (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id    uuid NOT NULL,
  form_type        text NOT NULL CHECK (form_type IN ('3CA-3CD', '3CB-3CD')),
  template_version text NOT NULL DEFAULT 'v1',
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'in_progress', 'review', 'signed', 'filed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tax_audit_form ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_audit_form_firm_access"
  ON tax_audit_form FOR ALL
  TO authenticated
  USING (
    engagement_id IN (
      SELECT e.id FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE c.firm_id IN (
        SELECT firm_id FROM user_firms WHERE user_id = auth.uid()
      )
    )
  );

-- ── 3. tax_audit_cell_map ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_audit_cell_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text    NOT NULL CHECK (template_name IN ('3CA-3CD', '3CB-3CD')),
  sheet         text    NOT NULL,
  cell_address  text    NOT NULL,
  field_key     text    NOT NULL,
  data_type     text    NOT NULL DEFAULT 'text',
  source        text,
  formula_cell  boolean NOT NULL DEFAULT false,
  UNIQUE (template_name, sheet, cell_address)
);

ALTER TABLE tax_audit_cell_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_audit_cell_map_read"
  ON tax_audit_cell_map FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "tax_audit_cell_map_write"
  ON tax_audit_cell_map FOR ALL
  TO service_role
  USING (true);

-- ── 4. tax_audit_values ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_audit_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid    NOT NULL,
  field_key     text    NOT NULL,
  current_value text,
  data_type     text    NOT NULL DEFAULT 'text',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id),
  UNIQUE (engagement_id, field_key)
);

ALTER TABLE tax_audit_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_audit_values_access"
  ON tax_audit_values FOR ALL
  TO authenticated
  USING (
    engagement_id IN (
      SELECT e.id FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE c.firm_id IN (
        SELECT firm_id FROM user_firms WHERE user_id = auth.uid()
      )
    )
  );

-- ── 5. tax_audit_3cd_clauses ──────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_audit_3cd_clauses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id    uuid    NOT NULL,
  clause_no        text    NOT NULL,
  sub_clause        text,
  response         text,
  applicability    text    NOT NULL DEFAULT 'applicable'
                     CHECK (applicability IN ('applicable', 'not_applicable', 'partial')),
  annexure_ref     text,
  sequence_order   integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id),
  UNIQUE (engagement_id, clause_no, COALESCE(sub_clause, ''))
);

ALTER TABLE tax_audit_3cd_clauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_audit_3cd_clauses_access"
  ON tax_audit_3cd_clauses FOR ALL
  TO authenticated
  USING (
    engagement_id IN (
      SELECT e.id FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE c.firm_id IN (
        SELECT firm_id FROM user_firms WHERE user_id = auth.uid()
      )
    )
  );

-- ── 6. tax_audit_annexures ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_audit_annexures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id    uuid    NOT NULL,
  annexure_id      text    NOT NULL,
  clause_link      text,
  title            text,
  rows_json        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  is_deleted       boolean NOT NULL DEFAULT false,
  display_sequence integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id),
  UNIQUE (engagement_id, annexure_id)
);

ALTER TABLE tax_audit_annexures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_audit_annexures_access"
  ON tax_audit_annexures FOR ALL
  TO authenticated
  USING (
    engagement_id IN (
      SELECT e.id FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE c.firm_id IN (
        SELECT firm_id FROM user_firms WHERE user_id = auth.uid()
      )
    )
  );

-- ── 7. tax_audit_versions (history log) ───────────────────────
CREATE TABLE IF NOT EXISTS tax_audit_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid    NOT NULL,
  element_type  text    NOT NULL,  -- 'value', 'clause', 'annexure'
  element_id    uuid    NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  user_id       uuid REFERENCES auth.users(id),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  change_reason text
);

ALTER TABLE tax_audit_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_audit_versions_access"
  ON tax_audit_versions FOR ALL
  TO authenticated
  USING (
    engagement_id IN (
      SELECT e.id FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE c.firm_id IN (
        SELECT firm_id FROM user_firms WHERE user_id = auth.uid()
      )
    )
  );

-- ── 8. Version-history triggers ───────────────────────────────

-- Trigger function: copies OLD row to tax_audit_versions on UPDATE
CREATE OR REPLACE FUNCTION tax_audit_log_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_element_type text;
BEGIN
  v_element_type := TG_ARGV[0];

  INSERT INTO tax_audit_versions (
    engagement_id, element_type, element_id,
    old_value, new_value,
    user_id, changed_at
  ) VALUES (
    OLD.engagement_id,
    v_element_type,
    OLD.id,
    to_jsonb(OLD),
    to_jsonb(NEW),
    auth.uid(),
    now()
  );

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Trigger on tax_audit_values
CREATE TRIGGER tax_audit_values_version
  BEFORE UPDATE ON tax_audit_values
  FOR EACH ROW EXECUTE FUNCTION tax_audit_log_version('value');

-- Trigger on tax_audit_3cd_clauses
CREATE TRIGGER tax_audit_clauses_version
  BEFORE UPDATE ON tax_audit_3cd_clauses
  FOR EACH ROW EXECUTE FUNCTION tax_audit_log_version('clause');

-- Trigger on tax_audit_annexures
CREATE TRIGGER tax_audit_annexures_version
  BEFORE UPDATE ON tax_audit_annexures
  FOR EACH ROW EXECUTE FUNCTION tax_audit_log_version('annexure');

-- ── 9. Helper indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tax_audit_values_engagement
  ON tax_audit_values (engagement_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_clauses_engagement
  ON tax_audit_3cd_clauses (engagement_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_annexures_engagement
  ON tax_audit_annexures (engagement_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_versions_engagement
  ON tax_audit_versions (engagement_id, element_type, element_id);
CREATE INDEX IF NOT EXISTS idx_tax_audit_cell_map_template
  ON tax_audit_cell_map (template_name);
