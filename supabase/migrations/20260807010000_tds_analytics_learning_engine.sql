-- ═══════════════════════════════════════════════════════════════════════════
-- TDS Analytics — persistent, per-client AI learning engine (Phase 1: foundation)
--
-- Three tables:
--
--   tds_learning_events           append-only capture of every manual action
--                                  in the TDS Analytics module (mapping change,
--                                  section override, voucher classification,
--                                  reconciliation correction, calculation
--                                  adjustment, AI-suggestion accept/reject, …).
--                                  No UPDATE/DELETE policy — the audit trail
--                                  is immutable by design (mirrors
--                                  msme_43b_rule_changes, 20260729090000).
--
--   tds_client_learned_patterns   the actual "AI memory" — one row per
--                                  distinct pattern PER CLIENT (never pooled
--                                  across clients — deliberately NOT the
--                                  coa_mapping_intelligence model, which is
--                                  global by design; TDS must never mix one
--                                  client's accounting behaviour into
--                                  another's). Maintained automatically by a
--                                  trigger on tds_learning_events, so learning
--                                  requires no separate app-level call beyond
--                                  logging the event.
--
--   tds_ai_recommendation_log     what was suggested to the user and what
--                                  they did about it — closes the loop so
--                                  every accept/modify/reject becomes a new
--                                  learning event (Phase 4).
--
-- This migration only adds tables, a trigger, and RLS. Nothing in the app
-- calls into it yet (Phase 2 wires the capture side; Phase 3 the
-- recommendation UI) — additive and inert until then, zero regression risk.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. tds_learning_events — append-only capture ────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_learning_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id             uuid        NOT NULL,
  financial_year      text        NOT NULL,
  engagement_id       uuid,
  event_type          text        NOT NULL CHECK (event_type IN (
                         'party_mapping_change', 'ledger_mapping_change',
                         'section_override', 'voucher_classification',
                         'reconciliation_correction', 'calculation_adjustment',
                         'vendor_treatment_change', 'entry_booking_correction',
                         'ai_suggestion_accepted', 'ai_suggestion_rejected',
                         'ai_suggestion_modified', 'manual_override'
                       )),
  entity_type         text        NOT NULL,   -- e.g. 'tds_tb_party_mappings' | 'tds_voucher_classification'
  entity_id           uuid,                   -- row in entity_type this event was raised against
  pattern_type        text        NOT NULL CHECK (pattern_type IN (
                         'party_section_mapping', 'ledger_selection',
                         'vendor_treatment', 'voucher_classification_rule',
                         'reconciliation_approach', 'calculation_preference'
                       )),
  pattern_key         text        NOT NULL,   -- normalized dedupe key, e.g. 'vendor:jency infotech llp:section'
  before_value        jsonb,
  after_value         jsonb       NOT NULL,
  ai_suggested_value  jsonb,                  -- what the AI proposed, if anything (captures accept vs override)
  ai_confidence        integer    CHECK (ai_confidence BETWEEN 0 AND 100),
  ai_method            text,
  source               text       NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_accepted', 'ai_overridden')),
  created_by           uuid,
  created_by_name      text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Normalize pattern_key defensively at the DB layer (defense in depth — the
-- app is expected to pass an already-normalized key, but a stray case/space
-- difference must not fragment the same pattern into two rows).
CREATE OR REPLACE FUNCTION public.tds_learning_events_normalize()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.pattern_key := lower(regexp_replace(btrim(NEW.pattern_key), '\s+', ' ', 'g'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tds_learning_events_normalize_trg ON public.tds_learning_events;
CREATE TRIGGER tds_learning_events_normalize_trg
  BEFORE INSERT ON public.tds_learning_events
  FOR EACH ROW EXECUTE FUNCTION public.tds_learning_events_normalize();

CREATE INDEX IF NOT EXISTS idx_tds_learning_events_client_fy
  ON public.tds_learning_events (client_id, financial_year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tds_learning_events_pattern
  ON public.tds_learning_events (client_id, pattern_type, pattern_key);

-- ── 2. tds_client_learned_patterns — the AI memory, isolated per client ─────

CREATE TABLE IF NOT EXISTS public.tds_client_learned_patterns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id           uuid        NOT NULL,
  pattern_type      text        NOT NULL CHECK (pattern_type IN (
                       'party_section_mapping', 'ledger_selection',
                       'vendor_treatment', 'voucher_classification_rule',
                       'reconciliation_approach', 'calculation_preference'
                     )),
  pattern_key       text        NOT NULL,
  current_value     jsonb       NOT NULL,     -- the winning / recommended value
  reasoning         text,
  confidence_score  numeric(5,2) NOT NULL DEFAULT 50,
  times_seen        integer     NOT NULL DEFAULT 0,
  times_confirmed   integer     NOT NULL DEFAULT 0,
  times_overridden  integer     NOT NULL DEFAULT 0,
  alternatives      jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{value, count, last_seen_at}]
  last_event_id     uuid        REFERENCES public.tds_learning_events(id) ON DELETE SET NULL,
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  is_active         boolean     NOT NULL DEFAULT true,   -- soft-disable = rollback without losing history
  disabled_reason   text,
  disabled_by       uuid,
  disabled_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, pattern_type, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_tds_learned_patterns_client_active
  ON public.tds_client_learned_patterns (client_id, is_active, confidence_score DESC);

DROP TRIGGER IF EXISTS tds_client_learned_patterns_updated_at ON public.tds_client_learned_patterns;
CREATE TRIGGER tds_client_learned_patterns_updated_at
  BEFORE UPDATE ON public.tds_client_learned_patterns
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- ── 3. tds_ai_recommendation_log — closes the loop ──────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_ai_recommendation_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id           uuid        NOT NULL,
  financial_year    text        NOT NULL,
  pattern_id        uuid        REFERENCES public.tds_client_learned_patterns(id) ON DELETE SET NULL,
  entity_type       text,
  entity_id         uuid,
  suggested_value   jsonb       NOT NULL,
  confidence_score  numeric(5,2),
  reasoning         text,
  alternatives      jsonb       DEFAULT '[]'::jsonb,
  shown_at          timestamptz NOT NULL DEFAULT now(),
  user_decision     text        CHECK (user_decision IN ('accepted', 'modified', 'rejected', 'ignored')),
  decided_value     jsonb,
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_recommendation_log_client_fy
  ON public.tds_ai_recommendation_log (client_id, financial_year, shown_at DESC);

CREATE INDEX IF NOT EXISTS idx_tds_recommendation_log_pattern
  ON public.tds_ai_recommendation_log (pattern_id);

DROP TRIGGER IF EXISTS tds_ai_recommendation_log_updated_at ON public.tds_ai_recommendation_log;
CREATE TRIGGER tds_ai_recommendation_log_updated_at
  BEFORE UPDATE ON public.tds_ai_recommendation_log
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- ── 4. Learning pipeline — SECURITY DEFINER trigger, single indexed upsert ──
--
-- Fires once per inserted learning event. No batch job, no ML model: a
-- diminishing-returns confidence curve identical in shape to
-- upsert_coa_intelligence (20260420180000), keyed per-client instead of
-- globally. A challenger value only replaces current_value once it has been
-- corroborated at least twice AND has more corroboration than the incumbent
-- — a one-off correction nudges alternatives but cannot flip the
-- recommendation by itself (regression guard, cheap alternative to a
-- golden-set replay).
CREATE OR REPLACE FUNCTION public.apply_tds_learning_event()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing        public.tds_client_learned_patterns%ROWTYPE;
  v_alts            jsonb;
  v_matches_current boolean;
  v_new_count       integer;
  v_incumbent_count integer;
  v_confirmed       integer;
  v_overridden      integer;
BEGIN
  IF NEW.after_value IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_existing
    FROM public.tds_client_learned_patterns
   WHERE client_id    = NEW.client_id
     AND pattern_type  = NEW.pattern_type
     AND pattern_key   = NEW.pattern_key
   FOR UPDATE;

  -- First time we see this (client, pattern_type, pattern_key)
  IF v_existing.id IS NULL THEN
    INSERT INTO public.tds_client_learned_patterns (
      client_id, firm_id, pattern_type, pattern_key,
      current_value, confidence_score, times_seen, times_confirmed, times_overridden,
      alternatives, last_event_id, last_seen_at
    ) VALUES (
      NEW.client_id, NEW.firm_id, NEW.pattern_type, NEW.pattern_key,
      NEW.after_value, 50, 1,
      CASE WHEN NEW.source = 'ai_accepted' THEN 1 ELSE 0 END,
      CASE WHEN NEW.source = 'ai_overridden' THEN 1 ELSE 0 END,
      jsonb_build_array(jsonb_build_object('value', NEW.after_value, 'count', 1, 'last_seen_at', NEW.created_at)),
      NEW.id, NEW.created_at
    );
    RETURN NEW;
  END IF;

  v_matches_current := v_existing.current_value = NEW.after_value;

  -- Merge into alternatives (keyed by value equality)
  v_alts := COALESCE(v_existing.alternatives, '[]'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_alts) e WHERE e->'value' = NEW.after_value) THEN
    v_alts := v_alts || jsonb_build_array(jsonb_build_object('value', NEW.after_value, 'count', 1, 'last_seen_at', NEW.created_at));
  ELSE
    v_alts := (
      SELECT jsonb_agg(
        CASE WHEN e->'value' = NEW.after_value
          THEN jsonb_set(jsonb_set(e, '{count}', to_jsonb(COALESCE((e->>'count')::int, 0) + 1)), '{last_seen_at}', to_jsonb(NEW.created_at))
          ELSE e
        END
      )
      FROM jsonb_array_elements(v_alts) e
    );
  END IF;

  v_new_count       := COALESCE((SELECT (e->>'count')::int FROM jsonb_array_elements(v_alts) e WHERE e->'value' = NEW.after_value LIMIT 1), 1);
  v_incumbent_count := COALESCE((SELECT (e->>'count')::int FROM jsonb_array_elements(v_alts) e WHERE e->'value' = v_existing.current_value LIMIT 1), 0);

  v_confirmed  := v_existing.times_confirmed  + CASE WHEN v_matches_current THEN 1 ELSE 0 END;
  v_overridden := v_existing.times_overridden + CASE WHEN v_matches_current THEN 0 ELSE 1 END;

  UPDATE public.tds_client_learned_patterns
     SET times_seen       = v_existing.times_seen + 1,
         times_confirmed  = v_confirmed,
         times_overridden = v_overridden,
         alternatives     = v_alts,
         -- Promote the challenger only once it has ≥2 corroborating events
         -- AND strictly more corroboration than the current incumbent.
         current_value    = CASE
            WHEN NOT v_matches_current AND v_new_count >= 2 AND v_new_count > v_incumbent_count
              THEN NEW.after_value
            ELSE v_existing.current_value
         END,
         confidence_score = LEAST(99, 50 + 49.0 * v_confirmed::numeric / NULLIF(v_confirmed + v_overridden, 0)),
         last_event_id    = NEW.id,
         last_seen_at     = NEW.created_at
   WHERE id = v_existing.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tds_learning_events_apply_trg ON public.tds_learning_events;
CREATE TRIGGER tds_learning_events_apply_trg
  AFTER INSERT ON public.tds_learning_events
  FOR EACH ROW EXECUTE FUNCTION public.apply_tds_learning_event();

-- ── 5. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_learning_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_client_learned_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_ai_recommendation_log   ENABLE ROW LEVEL SECURITY;

-- Service role bypass (edge functions) — idempotent
DROP POLICY IF EXISTS "service_role_all_learning_events" ON public.tds_learning_events;
CREATE POLICY "service_role_all_learning_events"
  ON public.tds_learning_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_learned_patterns" ON public.tds_client_learned_patterns;
CREATE POLICY "service_role_all_learned_patterns"
  ON public.tds_client_learned_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_recommendation_log" ON public.tds_ai_recommendation_log;
CREATE POLICY "service_role_all_recommendation_log"
  ON public.tds_ai_recommendation_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- tds_learning_events: append-only for authenticated users — SELECT + INSERT,
-- deliberately NO update/delete policy (audit integrity, mirrors
-- msme_43b_rule_changes, 20260729090000).
DROP POLICY IF EXISTS "auth_select_learning_events" ON public.tds_learning_events;
CREATE POLICY "auth_select_learning_events"
  ON public.tds_learning_events FOR SELECT TO authenticated
  USING (public.is_superadmin() OR firm_id = public.current_user_firm_id());

DROP POLICY IF EXISTS "auth_insert_learning_events" ON public.tds_learning_events;
CREATE POLICY "auth_insert_learning_events"
  ON public.tds_learning_events FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin() OR firm_id = public.current_user_firm_id());

-- tds_client_learned_patterns: read-only for authenticated users — all writes
-- happen through the SECURITY DEFINER trigger above, except the Phase 5
-- "disable a bad pattern" admin action, which is a narrow UPDATE.
DROP POLICY IF EXISTS "auth_select_learned_patterns" ON public.tds_client_learned_patterns;
CREATE POLICY "auth_select_learned_patterns"
  ON public.tds_client_learned_patterns FOR SELECT TO authenticated
  USING (public.is_superadmin() OR firm_id = public.current_user_firm_id());

DROP POLICY IF EXISTS "auth_update_learned_patterns" ON public.tds_client_learned_patterns;
CREATE POLICY "auth_update_learned_patterns"
  ON public.tds_client_learned_patterns FOR UPDATE TO authenticated
  USING (public.is_superadmin() OR firm_id = public.current_user_firm_id())
  WITH CHECK (public.is_superadmin() OR firm_id = public.current_user_firm_id());

-- tds_ai_recommendation_log: authenticated users log what was shown and
-- update it with the user's decision.
DROP POLICY IF EXISTS "auth_select_recommendation_log" ON public.tds_ai_recommendation_log;
CREATE POLICY "auth_select_recommendation_log"
  ON public.tds_ai_recommendation_log FOR SELECT TO authenticated
  USING (public.is_superadmin() OR firm_id = public.current_user_firm_id());

DROP POLICY IF EXISTS "auth_insert_recommendation_log" ON public.tds_ai_recommendation_log;
CREATE POLICY "auth_insert_recommendation_log"
  ON public.tds_ai_recommendation_log FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin() OR firm_id = public.current_user_firm_id());

DROP POLICY IF EXISTS "auth_update_recommendation_log" ON public.tds_ai_recommendation_log;
CREATE POLICY "auth_update_recommendation_log"
  ON public.tds_ai_recommendation_log FOR UPDATE TO authenticated
  USING (public.is_superadmin() OR firm_id = public.current_user_firm_id())
  WITH CHECK (public.is_superadmin() OR firm_id = public.current_user_firm_id());

GRANT EXECUTE ON FUNCTION public.apply_tds_learning_event() TO authenticated, service_role;
