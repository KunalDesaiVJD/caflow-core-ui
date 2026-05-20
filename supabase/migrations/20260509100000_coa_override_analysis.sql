-- ─────────────────────────────────────────────────────────────────────────────
-- COA Override Analysis: AI learns WHY humans override mappings
-- Adds alias storage to coa_mapping_intelligence +
-- creates coa_alias_index for fast fuzzy lookup
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend coa_mapping_intelligence with analysis columns
ALTER TABLE coa_mapping_intelligence
  ADD COLUMN IF NOT EXISTS aliases         jsonb   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS override_reason text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_analysis     text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at  timestamptz DEFAULT NULL;

COMMENT ON COLUMN coa_mapping_intelligence.aliases IS
  'Array of normalized alias ledger names that should resolve to the same account_head. '
  'Populated by analyze-coa-override edge function after a human overrides an AI suggestion.';

COMMENT ON COLUMN coa_mapping_intelligence.override_reason IS
  'Why the human overrode: SPELLING_VARIANT | ABBREVIATION | ALIAS | CONCEPTUAL_CORRECTION | ERROR_CORRECTION | CONFIRMED (no prior AI suggestion)';

COMMENT ON COLUMN coa_mapping_intelligence.ai_analysis IS
  'Claude''s plain-English explanation of the override reasoning.';

-- 2. Alias index table — one row per alias — enables O(1) lookup by alias name
CREATE TABLE IF NOT EXISTS coa_alias_index (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_normalized text       NOT NULL,                   -- lowercase trimmed alias
  canonical_id    uuid        NOT NULL REFERENCES coa_mapping_intelligence(id) ON DELETE CASCADE,
  account_head    text        NOT NULL,                   -- denormalized for fast read
  entity_type     text        NOT NULL,                   -- nce | corporate | llp
  reason_type     text        NOT NULL,                   -- SPELLING_VARIANT etc.
  confidence_score float      NOT NULL DEFAULT 80,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alias_normalized, entity_type)                  -- one canonical mapping per alias+entity
);

CREATE INDEX IF NOT EXISTS coa_alias_index_alias_entity
  ON coa_alias_index (alias_normalized, entity_type);

COMMENT ON TABLE coa_alias_index IS
  'Fast alias lookup index. Populated by analyze-coa-override edge function. '
  'Each row says: "this alias ledger name maps to this account_head for this entity type".';

-- 3. RLS — same pattern as coa_mapping_intelligence (accessible to authenticated users)
ALTER TABLE coa_alias_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read alias index"
  ON coa_alias_index FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert aliases"
  ON coa_alias_index FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update aliases"
  ON coa_alias_index FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete aliases"
  ON coa_alias_index FOR DELETE
  TO authenticated USING (true);
