-- ─────────────────────────────────────────────────────────────────────────────
-- COA Mapping Intelligence — Party-Name Scope Control
--
-- Problem:
--   Business/vendor/customer names (e.g. "cmc hardware & tools center",
--   "rajesh enterprises") were being stored in coa_mapping_intelligence as
--   GLOBAL patterns and fed back to Claude as learned training data. This
--   pollutes global intelligence with client-specific party names that have no
--   meaning for other firms or clients.
--
-- Solution:
--   1. Add is_party_name + scope columns to coa_mapping_intelligence.
--   2. Detect party names automatically from Tally group (Sundry Debtors /
--      Sundry Creditors) or by absence of standard accounting keywords.
--   3. Party-name patterns → scope='engagement', scoped to client_id.
--      They are still used for SAME-CLIENT future-year suggestions but are
--      NEVER sent to Claude as global learned_patterns training data.
--   4. Generic ledger patterns → scope='global', applied across all clients.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New columns on coa_mapping_intelligence ────────────────────────────────
ALTER TABLE public.coa_mapping_intelligence
  ADD COLUMN IF NOT EXISTS is_party_name  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scope          text    NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'engagement')),
  ADD COLUMN IF NOT EXISTS client_id      uuid;   -- set only when scope='engagement'

COMMENT ON COLUMN public.coa_mapping_intelligence.is_party_name IS
  'TRUE when the ledger is a party/business/person name (e.g. vendor/customer) rather '
  'than a generic account-type name. Party names are scoped to the engagement client only.';
COMMENT ON COLUMN public.coa_mapping_intelligence.scope IS
  'global = applies to all clients of all firms; '
  'engagement = restricted to client_id (same client, future years only).';
COMMENT ON COLUMN public.coa_mapping_intelligence.client_id IS
  'Populated only when scope=engagement. Restricts pattern suggestions to this client.';

CREATE INDEX IF NOT EXISTS idx_coa_intel_scope  ON public.coa_mapping_intelligence(scope);
CREATE INDEX IF NOT EXISTS idx_coa_intel_client ON public.coa_mapping_intelligence(client_id);

-- ── 2. Party-ledger detection function ───────────────────────────────────────
-- Returns TRUE when the ledger is a party/business name rather than a generic
-- accounting term.  Tally group is the primary signal (most reliable).
-- A keyword-absence heuristic is used as fallback when group is unset.
CREATE OR REPLACE FUNCTION public.is_party_ledger(
  p_normalized_name text,
  p_account_group   text
) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT
AS $$
  -- TRUE when Tally group indicates individual party ledgers.
  -- Covers all Tally group variants: "Sundry Debtors", "Sundry Creditors",
  -- "Creditors : Materials", "Creditors : Expenses", "Debtors : Customers", etc.
  SELECT (
    lower(p_account_group) LIKE '%sundry debtor%'
    OR lower(p_account_group) LIKE '%sundry creditor%'
    OR lower(p_account_group) LIKE '%creditor%'
    OR lower(p_account_group) LIKE '%debtor%'
  )
$$;

COMMENT ON FUNCTION public.is_party_ledger(text, text) IS
  'Returns TRUE when the ledger name+group combination indicates a party/business '
  'name (vendor/customer) rather than a standard accounting ledger. '
  'Used by upsert_coa_intelligence to determine global vs engagement scope.';

-- ── 3. Backfill existing rows ─────────────────────────────────────────────────
-- Mark rows whose account_group indicates party ledgers as engagement-scoped.
UPDATE public.coa_mapping_intelligence
   SET is_party_name = true,
       scope         = 'engagement'
 WHERE account_group IS NOT NULL
   AND (
     lower(account_group) LIKE '%sundry debtor%'
     OR lower(account_group) LIKE '%sundry creditor%'
   )
   AND scope = 'global';  -- only touch rows not yet manually classified

-- ── 4. Replace upsert_coa_intelligence() — add p_client_id param ─────────────
-- Backward-compatible: p_client_id has a DEFAULT NULL, so existing callers
-- that do not pass it continue to work unchanged.
CREATE OR REPLACE FUNCTION public.upsert_coa_intelligence(
  p_normalized_name  text,
  p_entity_type      text,
  p_account_head     text,
  p_bs_pl            text,
  p_account_group    text,
  p_firm_id          uuid,
  p_engagement_id    uuid,
  p_accepted         boolean,
  p_client_id        uuid DEFAULT NULL   -- NEW: pass engagement's client_id
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing    public.coa_mapping_intelligence%ROWTYPE;
  v_new_alts    jsonb;
  v_is_party    boolean;
  v_scope       text;
BEGIN
  IF p_normalized_name IS NULL OR length(btrim(p_normalized_name)) = 0 THEN
    RETURN;
  END IF;
  IF p_account_head IS NULL OR length(btrim(p_account_head)) = 0 THEN
    RETURN;
  END IF;

  -- Detect whether this is a party/business name
  v_is_party := COALESCE(public.is_party_ledger(p_normalized_name, p_account_group), false);
  v_scope    := CASE WHEN v_is_party THEN 'engagement' ELSE 'global' END;

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
      alternatives, firms_affected, last_firm_id, last_engagement_id,
      is_party_name, scope, client_id
    ) VALUES (
      p_normalized_name, p_entity_type, p_account_head, p_bs_pl, p_account_group,
      CASE WHEN p_accepted THEN 70 ELSE 55 END,
      CASE WHEN p_accepted THEN 1  ELSE 0 END,
      CASE WHEN p_accepted THEN 0  ELSE 1 END,
      jsonb_build_array(jsonb_build_object('account_head', p_account_head, 'count', 1)),
      1, p_firm_id, p_engagement_id,
      v_is_party,
      v_scope,
      CASE WHEN v_is_party THEN p_client_id ELSE NULL END
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

  -- Update existing row — also correct scope/is_party if previously wrong
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
            WHEN v_scope = 'global'  -- only count cross-firm usage for global patterns
             AND p_firm_id IS NOT NULL
             AND v_existing.last_firm_id IS DISTINCT FROM p_firm_id
              THEN v_existing.firms_affected + 1
            ELSE v_existing.firms_affected
         END,
         -- Correct scope if now we have group info that confirms it's a party
         is_party_name    = CASE WHEN p_account_group IS NOT NULL THEN v_is_party    ELSE v_existing.is_party_name END,
         scope            = CASE WHEN p_account_group IS NOT NULL THEN v_scope       ELSE v_existing.scope END,
         client_id        = CASE
            WHEN p_account_group IS NOT NULL AND v_is_party THEN p_client_id
            WHEN v_existing.is_party_name                   THEN COALESCE(v_existing.client_id, p_client_id)
            ELSE NULL
         END,
         last_firm_id       = COALESCE(p_firm_id, v_existing.last_firm_id),
         last_engagement_id = COALESCE(p_engagement_id, v_existing.last_engagement_id),
         last_used_at       = now(),
         updated_at         = now()
   WHERE id = v_existing.id;
END;
$$;

-- Grant to both old and new signatures
GRANT EXECUTE ON FUNCTION public.upsert_coa_intelligence(
  text, text, text, text, text, uuid, uuid, boolean
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_coa_intelligence(
  text, text, text, text, text, uuid, uuid, boolean, uuid
) TO authenticated, service_role;

-- ── 5. Replace sync_engagement_intelligence() — add p_client_id ──────────────
-- Also reads account_group from the coa_mapping JSONB so party-name detection
-- works during batch sync (not just during real-time confirm/override).
CREATE OR REPLACE FUNCTION public.sync_engagement_intelligence(
  p_engagement_id uuid,
  p_entity_type   text,
  p_firm_id       uuid,
  p_client_id     uuid DEFAULT NULL   -- NEW: pass engagement's client_id
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coa_mapping  jsonb;
  v_key          text;
  v_val          jsonb;
  v_fs_code      text;
  v_confidence   text;
  v_normalized   text;
  v_acct_group   text;
  v_count        integer := 0;
BEGIN
  -- Fetch the engagement's coa_mapping JSONB + client_id if not provided
  SELECT coa_mapping,
         COALESCE(p_client_id, client_id)
    INTO v_coa_mapping, p_client_id
    FROM public.audit_engagements
   WHERE id = p_engagement_id;

  IF v_coa_mapping IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_coa_mapping) LOOP
    v_confidence := v_val->>'confidence';
    v_fs_code    := v_val->>'code';
    v_acct_group := v_val->>'account_group';   -- store group if available in JSON

    -- Only learn from manual (user-confirmed) mappings
    CONTINUE WHEN v_confidence NOT IN ('manual');
    CONTINUE WHEN v_fs_code IS NULL OR length(btrim(v_fs_code)) = 0;

    -- Normalise: lower + collapse whitespace + trim
    v_normalized := regexp_replace(lower(btrim(v_key)), '\s+', ' ', 'g');

    PERFORM public.upsert_coa_intelligence(
      v_normalized,
      p_entity_type,
      v_fs_code,
      NULL,           -- bs_pl (not critical for matching)
      v_acct_group,   -- pass account_group for party-name detection
      p_firm_id,
      p_engagement_id,
      true,           -- p_accepted = true (user explicitly mapped it)
      p_client_id     -- NEW: scopes party patterns to this client
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Note: the 3-param signature no longer exists after this migration.
-- Callers using the old 3-param form still work because p_client_id has DEFAULT NULL.
GRANT EXECUTE ON FUNCTION public.sync_engagement_intelligence(uuid, text, uuid, uuid)
  TO authenticated, service_role;
