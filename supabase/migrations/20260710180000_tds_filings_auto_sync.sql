-- ════════════════════════════════════════════════════════════════════════
-- TDS Compliance → tds_filings AUTO-SYNC (single source of truth)
-- ════════════════════════════════════════════════════════════════════════
-- The TDS module must be driven entirely by the TDS Compliance selected in
-- Edit Client → Service Specific (client_services.tds_forms_applicable +
-- tds_effective_from_fy/q + tds_end_fy/q). Previously, filing records were
-- created only by a lazy, per-FY, client-side backfill that (a) silently
-- threw after a partial unique index made its ON CONFLICT upsert invalid
-- (Postgres 42P10), and (b) never covered FYs other than the one on screen.
-- Result: adding a form (e.g. 24Q) to a client never generated its filing
-- rows, so the client was invisible under that form.
--
-- This makes the DATABASE the single source of truth: a trigger on
-- client_services regenerates tds_filings automatically on every TDS config
-- change, from ANY code path (wizard save, ClientDetail modal, API sync).
-- Creation uses INSERT..SELECT WHERE NOT EXISTS (never ON CONFLICT), so the
-- partial unique index is irrelevant. Deselecting a form removes only its
-- EMPTY placeholder rows; rows carrying real data (challans/deductees, or a
-- non-initial status/ack/filing date) are always preserved.

CREATE OR REPLACE FUNCTION public.sync_tds_filings_for_service(p_cs_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id   uuid;
  v_firm_id     uuid;
  v_is_active   boolean;
  v_is_tds      boolean;
  v_forms       text[];
  v_start_fy    text;
  v_start_q     text;
  v_end_fy      text;
  v_end_q       text;
  v_tan         text;
  v_deleted_at  timestamptz;
  v_start_period int;
  v_end_period   int;
  v_cur_fy_start int;
BEGIN
  SELECT cs.client_id, cs.is_active, cs.tds_forms_applicable,
         cs.tds_effective_from_fy, cs.tds_effective_from_q,
         cs.tds_end_fy, cs.tds_end_quarter,
         (sc.linked_module = 'tds'),
         c.firm_id, c.tan_number, c.deleted_at
    INTO v_client_id, v_is_active, v_forms, v_start_fy, v_start_q,
         v_end_fy, v_end_q, v_is_tds, v_firm_id, v_tan, v_deleted_at
    FROM client_services cs
    JOIN service_categories sc ON sc.id = cs.service_category_id
    JOIN clients c             ON c.id  = cs.client_id
   WHERE cs.id = p_cs_id;

  -- Not a TDS service → nothing to do.
  IF v_client_id IS NULL OR v_is_tds IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Inactive service / deleted client / no forms / no start quarter →
  -- generate nothing and clean up this client's empty placeholder rows.
  IF v_is_active IS NOT TRUE OR v_deleted_at IS NOT NULL
     OR v_start_fy IS NULL OR v_forms IS NULL
     OR array_length(v_forms, 1) IS NULL THEN
    DELETE FROM tds_filings tf
     WHERE tf.client_id = v_client_id
       AND tf.work_status IN ('Not Started', 'Not Applicable')
       AND tf.acknowledgment_number IS NULL
       AND tf.date_of_filing IS NULL
       AND NOT EXISTS (SELECT 1 FROM tds_challans  ch WHERE ch.filing_id = tf.id)
       AND NOT EXISTS (SELECT 1 FROM tds_deductees dd WHERE dd.filing_id = tf.id);
    RETURN;
  END IF;

  -- Period number = fy_start_year * 4 + quarter_index (Q1=0 … Q4=3).
  v_start_period := left(v_start_fy, 4)::int * 4
                    + (array_position(ARRAY['Q1','Q2','Q3','Q4'], COALESCE(v_start_q, 'Q1')) - 1);

  IF v_end_fy IS NOT NULL THEN
    -- Explicit End Quarter: honour it, even if it is in the future.
    v_end_period := left(v_end_fy, 4)::int * 4
                    + (array_position(ARRAY['Q1','Q2','Q3','Q4'], COALESCE(v_end_q, 'Q4')) - 1);
  ELSE
    -- Indefinite: generate through the end of the current financial year.
    v_cur_fy_start := CASE WHEN extract(month FROM now()) >= 4
                          THEN extract(year FROM now())::int
                          ELSE extract(year FROM now())::int - 1 END;
    v_end_period := v_cur_fy_start * 4 + 3;  -- Q4 of the current FY
  END IF;

  IF v_end_period < v_start_period THEN
    RETURN;  -- empty/invalid range
  END IF;

  -- Create one missing row per (configured form × in-range period). Never
  -- ON CONFLICT (partial unique index can't be an arbiter) — diff explicitly.
  INSERT INTO tds_filings (client_id, firm_id, financial_year, quarter, tds_forms, work_status, tan)
  SELECT v_client_id, v_firm_id,
         (p / 4)::text || '-' || lpad(((p / 4 + 1) % 100)::text, 2, '0'),
         'Q' || ((p % 4) + 1)::text,
         ARRAY[form],
         'Not Started',
         v_tan
    FROM generate_series(v_start_period, v_end_period) AS p
    CROSS JOIN unnest(v_forms) AS form
   WHERE NOT EXISTS (
     SELECT 1 FROM tds_filings tf
      WHERE tf.client_id = v_client_id
        AND tf.financial_year = (p / 4)::text || '-' || lpad(((p / 4 + 1) % 100)::text, 2, '0')
        AND tf.quarter        = 'Q' || ((p % 4) + 1)::text
        AND tf.tds_forms      @> ARRAY[form]
   );

  -- Deselecting a form: remove only its EMPTY placeholder rows (rows for a
  -- form no longer in tds_forms_applicable). Rows with real data are kept —
  -- they are already hidden from the UI by the app's compliance filter.
  DELETE FROM tds_filings tf
   WHERE tf.client_id = v_client_id
     AND NOT (tf.tds_forms && v_forms)         -- row's form(s) not configured
     AND tf.work_status IN ('Not Started', 'Not Applicable')
     AND tf.acknowledgment_number IS NULL
     AND tf.date_of_filing IS NULL
     AND NOT EXISTS (SELECT 1 FROM tds_challans  ch WHERE ch.filing_id = tf.id)
     AND NOT EXISTS (SELECT 1 FROM tds_deductees dd WHERE dd.filing_id = tf.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_tds_filings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.sync_tds_filings_for_service(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_tds_filings_after_change ON public.client_services;
CREATE TRIGGER sync_tds_filings_after_change
AFTER INSERT OR UPDATE OF
  tds_forms_applicable, tds_effective_from_fy, tds_effective_from_q,
  tds_end_fy, tds_end_quarter, is_active, service_category_id
ON public.client_services
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_tds_filings();
