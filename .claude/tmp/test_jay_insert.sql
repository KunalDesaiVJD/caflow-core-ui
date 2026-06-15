-- Test Jay Bhanderi (staff_article) INSERT under permissive policy
DO $$
DECLARE
  v_client_id uuid;
  v_inserted_id uuid;
BEGIN
  SELECT id INTO v_client_id FROM clients WHERE name = 'AARTH INDUSTRIES' LIMIT 1;
  RAISE NOTICE 'client_id = %', v_client_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '698efc5a-88d6-4a44-9f82-2a0f90e49a95', true);

  INSERT INTO itr_profiles (client_id, firm_id, assessment_year, financial_year, filing_status)
  VALUES (v_client_id, 'be411601-f0f5-4f74-b93d-b87a8ef1b82b', '2025-26', '2024-25', 'Ready for Review')
  RETURNING id INTO v_inserted_id;

  RAISE NOTICE 'INSERT succeeded id = %', v_inserted_id;
  DELETE FROM itr_profiles WHERE id = v_inserted_id;
  PERFORM set_config('role', 'postgres', true);
END $$;
