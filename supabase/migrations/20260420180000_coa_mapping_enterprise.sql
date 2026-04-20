-- ─────────────────────────────────────────────────────────────────────────────
-- COA Mapping — Enterprise Rebuild
--
-- Goals
--   1. Per-engagement mappings (not just per-firm) with confidence, source,
--      reasoning and alternatives captured from the AI.
--   2. A global learning table (coa_mapping_intelligence) that accumulates
--      confirmed/overridden mappings ACROSS ALL CLIENTS & FIRMS so that the
--      auto-mapper gets smarter over time.
--   3. An audit trail row per human action so AdminAiSkills can detect
--      recurring override patterns.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend coa_mappings with richer metadata ──────────────────────────────
ALTER TABLE public.coa_mappings
  ADD COLUMN IF NOT EXISTS engagement_id     uuid REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ledger_id         uuid,
  ADD COLUMN IF NOT EXISTS entity_type       text,
  ADD COLUMN IF NOT EXISTS confidence        numeric(5,2),
  ADD COLUMN IF NOT EXISTS source            text,       -- ai | intelligence | heuristic | manual
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'suggested', -- suggested | confirmed | overridden
  ADD COLUMN IF NOT EXISTS alternatives      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reasoning         text,
  ADD COLUMN IF NOT EXISTS original_suggestion text,     -- the AI's very first suggestion (kept for learning)
  ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by        uuid;

CREATE INDEX IF NOT EXISTS idx_coa_mappings_engagement  ON public.coa_mappings(engagement_id);
CREATE INDEX IF NOT EXISTS idx_coa_mappings_firm        ON public.coa_mappings(firm_id);
CREATE INDEX IF NOT EXISTS idx_coa_mappings_status      ON public.coa_mappings(status);
CREATE INDEX IF NOT EXISTS idx_coa_mappings_raw_lower   ON public.coa_mappings(lower(raw_ledger_name));

-- ── 2. Global cross-client learning table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coa_mapping_intelligence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name     text NOT NULL,        -- lower+trimmed+collapsed-spaces ledger name
  entity_type         text NOT NULL,        -- corporate | llp | nce
  account_head        text NOT NULL,        -- current winning head
  bs_pl               text,
  account_group       text,
  confidence_score    numeric(5,2) NOT NULL DEFAULT 50,
  times_confirmed     integer NOT NULL DEFAULT 0,
  times_overridden    integer NOT NULL DEFAULT 0,
  alternatives        jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{account_head, count}]
  firms_affected      integer NOT NULL DEFAULT 1,
  last_firm_id        uuid,
  last_engagement_id  uuid,
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(normalized_name, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_coa_intel_norm   ON public.coa_mapping_intelligence(normalized_name);
CREATE INDEX IF NOT EXISTS idx_coa_intel_entity ON public.coa_mapping_intelligence(entity_type);
CREATE INDEX IF NOT EXISTS idx_coa_intel_conf   ON public.coa_mapping_intelligence(confidence_score DESC);

ALTER TABLE public.coa_mapping_intelligence ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can READ the intelligence (cross-firm knowledge).
DROP POLICY IF EXISTS "read coa_mapping_intelligence"        ON public.coa_mapping_intelligence;
CREATE POLICY "read coa_mapping_intelligence"
  ON public.coa_mapping_intelligence FOR SELECT
  TO authenticated
  USING (true);

-- Writes happen via the edge function (service role) OR by authenticated
-- users during confirm/override actions.
DROP POLICY IF EXISTS "write coa_mapping_intelligence"       ON public.coa_mapping_intelligence;
CREATE POLICY "write coa_mapping_intelligence"
  ON public.coa_mapping_intelligence FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- ── 3. Upsert helper for the intelligence table ──────────────────────────────
--   p_accepted  = true   → user confirmed the suggested head
--   p_accepted  = false  → user overrode; the new head is the override
CREATE OR REPLACE FUNCTION public.upsert_coa_intelligence(
  p_normalized_name  text,
  p_entity_type      text,
  p_account_head     text,
  p_bs_pl            text,
  p_account_group    text,
  p_firm_id          uuid,
  p_engagement_id    uuid,
  p_accepted         boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.coa_mapping_intelligence%ROWTYPE;
  v_new_alts jsonb;
BEGIN
  IF p_normalized_name IS NULL OR length(btrim(p_normalized_name)) = 0 THEN
    RETURN;
  END IF;
  IF p_account_head IS NULL OR length(btrim(p_account_head)) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing
    FROM public.coa_mapping_intelligence
   WHERE normalized_name = p_normalized_name
     AND entity_type     = p_entity_type
   FOR UPDATE;

  IF v_existing.id IS NULL THEN
    -- First time we see this (name, entity_type)
    INSERT INTO public.coa_mapping_intelligence (
      normalized_name, entity_type, account_head, bs_pl, account_group,
      confidence_score, times_confirmed, times_overridden,
      alternatives, firms_affected, last_firm_id, last_engagement_id
    ) VALUES (
      p_normalized_name, p_entity_type, p_account_head, p_bs_pl, p_account_group,
      CASE WHEN p_accepted THEN 70 ELSE 55 END,
      CASE WHEN p_accepted THEN 1 ELSE 0 END,
      CASE WHEN p_accepted THEN 0 ELSE 1 END,
      jsonb_build_array(jsonb_build_object('account_head', p_account_head, 'count', 1)),
      1, p_firm_id, p_engagement_id
    );
    RETURN;
  END IF;

  -- Merge alternatives count
  v_new_alts := COALESCE(v_existing.alternatives, '[]'::jsonb);
  IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_new_alts) e
       WHERE e->>'account_head' = p_account_head
  ) THEN
    v_new_alts := v_new_alts || jsonb_build_array(
      jsonb_build_object('account_head', p_account_head, 'count', 1)
    );
  ELSE
    v_new_alts := (
      SELECT jsonb_agg(
        CASE
          WHEN e->>'account_head' = p_account_head
            THEN jsonb_set(e, '{count}',
                 to_jsonb(COALESCE((e->>'count')::int, 0) + 1))
          ELSE e
        END
      )
      FROM jsonb_array_elements(v_new_alts) e
    );
  END IF;

  -- Determine winning head: the one with the highest count.
  UPDATE public.coa_mapping_intelligence
     SET times_confirmed  = v_existing.times_confirmed  + CASE WHEN p_accepted THEN 1 ELSE 0 END,
         times_overridden = v_existing.times_overridden + CASE WHEN p_accepted THEN 0 ELSE 1 END,
         alternatives     = v_new_alts,
         account_head     = (
            SELECT e->>'account_head'
              FROM jsonb_array_elements(v_new_alts) e
             ORDER BY (e->>'count')::int DESC
             LIMIT 1
         ),
         bs_pl            = COALESCE(p_bs_pl, v_existing.bs_pl),
         account_group    = COALESCE(p_account_group, v_existing.account_group),
         confidence_score = LEAST(99,
            50 + 50.0 * (
               (v_existing.times_confirmed + CASE WHEN p_accepted THEN 1 ELSE 0 END)::numeric
               / NULLIF(
                   v_existing.times_confirmed + v_existing.times_overridden
                   + 1, 0)
            )
         ),
         firms_affected   = CASE
            WHEN p_firm_id IS NOT NULL AND v_existing.last_firm_id IS DISTINCT FROM p_firm_id
              THEN v_existing.firms_affected + 1
            ELSE v_existing.firms_affected
         END,
         last_firm_id       = COALESCE(p_firm_id, v_existing.last_firm_id),
         last_engagement_id = COALESCE(p_engagement_id, v_existing.last_engagement_id),
         last_used_at       = now(),
         updated_at         = now()
   WHERE id = v_existing.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_coa_intelligence(
  text, text, text, text, text, uuid, uuid, boolean
) TO authenticated, service_role;
