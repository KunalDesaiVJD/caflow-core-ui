-- Create PY shell engagement for GROWQ PRIVATE LIMITED for FY 2024-25,
-- mirroring the structure of KWIKTEAM's PY shell (engagement
-- 2efae2fc-b0cb-48b2-94ce-daa4b8f297be). Then switch GROWQ's main
-- FY 2025-26 engagement to py_source='py_shell' so the
-- "Open PY Shell Tally Sync" button renders.

DO $$
DECLARE
  v_growq_client_id  uuid := '531ab421-4bfc-4fc2-b6ee-67b6ed27f527';
  v_growq_main_eng   uuid := 'a010dd14-8856-4a49-b95e-b110beed7ae4';
  v_firm_id          uuid := 'be411601-f0f5-4f74-b93d-b87a8ef1b82b';
  v_new_shell_id     uuid;
  v_existing_shell   uuid;
BEGIN
  -- Guard against double-run: skip if a PY shell already exists.
  SELECT id INTO v_existing_shell
  FROM audit_engagements
  WHERE client_id = v_growq_client_id
    AND financial_year = '2024-25'
    AND is_py_shell = true
  LIMIT 1;

  IF v_existing_shell IS NOT NULL THEN
    RAISE NOTICE 'PY shell already exists for GROWQ (id=%) — skipping creation', v_existing_shell;
  ELSE
    INSERT INTO audit_engagements (
      client_id, firm_id, financial_year,
      is_py_shell, py_source,
      entity_type, audit_type, audit_period_type,
      fs_preparation_mode, cash_flow_method,
      pipeline_stage, active_tabs
    ) VALUES (
      v_growq_client_id, v_firm_id, '2024-25',
      true, NULL,
      'Private Ltd', 'both', 'annual',
      'tb_mapped', 'indirect',
      3,
      '{"engagements": true, "scrutiny": true, "tb_import": true}'::jsonb
    )
    RETURNING id INTO v_new_shell_id;
    RAISE NOTICE 'Created GROWQ PY shell engagement id=%', v_new_shell_id;
  END IF;

  -- Switch main engagement to py_source='py_shell'
  UPDATE audit_engagements
  SET py_source = 'py_shell'
  WHERE id = v_growq_main_eng;
  RAISE NOTICE 'Updated GROWQ main engagement % py_source=py_shell', v_growq_main_eng;
END $$;

-- Verify the result
SELECT id, financial_year, is_py_shell, py_source, pipeline_stage, entity_type
FROM audit_engagements
WHERE client_id = '531ab421-4bfc-4fc2-b6ee-67b6ed27f527'
ORDER BY financial_year DESC;
