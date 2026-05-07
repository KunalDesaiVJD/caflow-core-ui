-- ─────────────────────────────────────────────────────────────────────────────
-- COA Mapping Rules (Manual Instructions)
--
-- Allows firm admins and users to define custom mapping rules that take
-- highest priority during auto-mapping — above Tally parent-group heuristics
-- and keyword rules.
--
-- Also adds sync_engagement_intelligence() — a server-side function that
-- batch-updates coa_mapping_intelligence from all "manual" confidence
-- mappings in a single engagement (called on period save).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. coa_mapping_rules ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coa_mapping_rules (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid    NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  client_id    uuid    REFERENCES public.clients(id) ON DELETE CASCADE, -- NULL = all clients in firm
  entity_type  text,                                                    -- NULL = all; 'corporate'|'nce'
  match_type   text    NOT NULL DEFAULT 'contains',                     -- contains|exact|starts_with|ends_with|tally_group
  match_value  text    NOT NULL,
  fs_code      text    NOT NULL,
  fs_name      text,
  note         text,
  priority     integer NOT NULL DEFAULT 10,  -- higher = applied first
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid    REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_match_type CHECK (
    match_type IN ('contains','exact','starts_with','ends_with','tally_group')
  )
);

CREATE INDEX IF NOT EXISTS idx_coa_rules_firm   ON public.coa_mapping_rules(firm_id);
CREATE INDEX IF NOT EXISTS idx_coa_rules_client ON public.coa_mapping_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_coa_rules_prio   ON public.coa_mapping_rules(priority DESC);

ALTER TABLE public.coa_mapping_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm members read mapping rules"  ON public.coa_mapping_rules;
CREATE POLICY "firm members read mapping rules"
  ON public.coa_mapping_rules FOR SELECT TO authenticated
  USING (
    firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "firm members write mapping rules" ON public.coa_mapping_rules;
CREATE POLICY "firm members write mapping rules"
  ON public.coa_mapping_rules FOR ALL TO authenticated
  USING (
    firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    firm_id IN (
      SELECT firm_id FROM public.users WHERE id = auth.uid()
    )
  );

-- ── 2. sync_engagement_intelligence() ────────────────────────────────────────
-- Batch-syncs all "manual" confidence mappings from an engagement into the
-- coa_mapping_intelligence table.  Called on period save / finalize.
-- Normalisation matches what the frontend uses:  lower + trim + collapse spaces.

CREATE OR REPLACE FUNCTION public.sync_engagement_intelligence(
  p_engagement_id uuid,
  p_entity_type   text,   -- 'corporate' | 'nce'
  p_firm_id       uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coa_mapping      jsonb;
  v_key              text;
  v_val              jsonb;
  v_fs_code          text;
  v_confidence       text;
  v_normalized       text;
  v_count            integer := 0;
BEGIN
  -- Fetch the engagement's coa_mapping JSONB
  SELECT coa_mapping INTO v_coa_mapping
    FROM public.audit_engagements
   WHERE id = p_engagement_id;

  IF v_coa_mapping IS NULL THEN
    RETURN 0;
  END IF;

  -- Iterate over every ledger → mapping entry
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_coa_mapping) LOOP
    v_confidence := v_val->>'confidence';
    v_fs_code    := v_val->>'code';

    -- Only learn from manual (user-confirmed) mappings
    CONTINUE WHEN v_confidence NOT IN ('manual');
    CONTINUE WHEN v_fs_code IS NULL OR length(btrim(v_fs_code)) = 0;

    -- Normalise the ledger name (lower + collapse whitespace + trim)
    v_normalized := regexp_replace(lower(btrim(v_key)), '\s+', ' ', 'g');

    PERFORM public.upsert_coa_intelligence(
      v_normalized,
      p_entity_type,
      v_fs_code,
      NULL,           -- bs_pl  (not critical for matching)
      NULL,           -- account_group
      p_firm_id,
      p_engagement_id,
      true            -- p_accepted = true (user explicitly mapped it)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_engagement_intelligence(uuid, text, uuid)
  TO authenticated, service_role;

-- ── 3. Updated_at trigger for coa_mapping_rules ───────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_coa_rules_updated_at ON public.coa_mapping_rules;
CREATE TRIGGER trg_coa_rules_updated_at
  BEFORE UPDATE ON public.coa_mapping_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
