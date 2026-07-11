-- Remove the "Not Applicable" TDS filing status entirely (UI + data + trigger).
-- 1. Convert any existing 'Not Applicable' rows to 'Not Started' (they are
--    empty placeholders for configured forms/quarters, so they are simply
--    pending returns now that the status no longer exists).
UPDATE public.tds_filings
SET work_status = 'Not Started'
WHERE work_status = 'Not Applicable';

-- 2. Drop 'Not Applicable' from the sync function's cleanup conditions so no
--    reference to the status remains anywhere. Behaviour is otherwise
--    identical (only empty, not-yet-worked placeholder rows are removed).
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

  IF v_client_id IS NULL OR v_is_tds IS NOT TRUE THEN
    RETURN;
  END IF;

  IF v_is_active IS NOT TRUE OR v_deleted_at IS NOT NULL
     OR v_start_fy IS NULL OR v_forms IS NULL
     OR array_length(v_forms, 1) IS NULL THEN
    DELETE FROM tds_filings tf
     WHERE tf.client_id = v_client_id
       AND tf.work_status = 'Not Started'
       AND tf.acknowledgment_number IS NULL
       AND tf.date_of_filing IS NULL
       AND NOT EXISTS (SELECT 1 FROM tds_challans  ch WHERE ch.filing_id = tf.id)
       AND NOT EXISTS (SELECT 1 FROM tds_deductees dd WHERE dd.filing_id = tf.id);
    RETURN;
  END IF;

  v_start_period := left(v_start_fy, 4)::int * 4
                    + (array_position(ARRAY['Q1','Q2','Q3','Q4'], COALESCE(v_start_q, 'Q1')) - 1);

  IF v_end_fy IS NOT NULL THEN
    v_end_period := left(v_end_fy, 4)::int * 4
                    + (array_position(ARRAY['Q1','Q2','Q3','Q4'], COALESCE(v_end_q, 'Q4')) - 1);
  ELSE
    v_cur_fy_start := CASE WHEN extract(month FROM now()) >= 4
                          THEN extract(year FROM now())::int
                          ELSE extract(year FROM now())::int - 1 END;
    v_end_period := v_cur_fy_start * 4 + 3;
  END IF;

  IF v_end_period < v_start_period THEN
    RETURN;
  END IF;

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

  DELETE FROM tds_filings tf
   WHERE tf.client_id = v_client_id
     AND tf.work_status = 'Not Started'
     AND tf.acknowledgment_number IS NULL
     AND tf.date_of_filing IS NULL
     AND NOT EXISTS (SELECT 1 FROM tds_challans  ch WHERE ch.filing_id = tf.id)
     AND NOT EXISTS (SELECT 1 FROM tds_deductees dd WHERE dd.filing_id = tf.id)
     AND (
       NOT (tf.tds_forms && v_forms)
       OR (
         left(tf.financial_year, 4)::int * 4
           + (array_position(ARRAY['Q1','Q2','Q3','Q4'], tf.quarter) - 1)
       ) NOT BETWEEN v_start_period AND v_end_period
     );
END;
$$;
