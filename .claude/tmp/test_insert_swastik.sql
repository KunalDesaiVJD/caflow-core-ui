-- Simulate the INSERT the UI tries to do for SWASTIK BUILDCON FY 2025-26
-- as Soumil (staff_article) — this tells us whether RLS or column shape
-- is the problem.

DO $$
DECLARE
  v_inserted_id uuid;
  v_existing_swastik_id uuid := '1de983fa-b107-4ba2-8286-28ffc22ad457';
  v_client_id uuid;
BEGIN
  -- Get the client_id off the existing 2024-25 row
  SELECT client_id INTO v_client_id FROM audit_status WHERE id = v_existing_swastik_id;
  RAISE NOTICE 'client_id for SWASTIK = %', v_client_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', 'a1a935f6-f044-4f11-b417-efcf651a8e4c', true);

  -- Try the same shape addRow would send
  INSERT INTO audit_status (
    party_name, firm_id, financial_year, client_id,
    physical_audit_conducted, accounting_data
  ) VALUES (
    'SWASTIK BUILDCON', 'be411601-f0f5-4f74-b93d-b87a8ef1b82b', '2025-26', v_client_id,
    'Yes', 'Yes'
  )
  RETURNING id INTO v_inserted_id;

  RAISE NOTICE 'INSERT succeeded id = %', v_inserted_id;
  DELETE FROM audit_status WHERE id = v_inserted_id;
  RAISE NOTICE 'cleaned up';
  PERFORM set_config('role', 'postgres', true);
END $$;
