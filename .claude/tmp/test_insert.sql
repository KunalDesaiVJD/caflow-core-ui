-- Simulate an INSERT as Soumil to confirm RLS evaluates correctly.
-- If this succeeds → RLS is fine, the frontend / Vercel deploy is the problem.
-- If this fails → RLS is still blocking and we need to dig further.

DO $$
DECLARE
  v_client_id uuid;
  v_inserted_id uuid;
BEGIN
  -- pick any real client in Soumil's firm to attach the test row to
  SELECT id INTO v_client_id
  FROM clients
  WHERE firm_id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b'
  LIMIT 1;

  RAISE NOTICE 'using client_id = %', v_client_id;

  -- Impersonate Soumil
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', 'a1a935f6-f044-4f11-b417-efcf651a8e4c', true);

  INSERT INTO itr_profiles (client_id, firm_id, assessment_year, financial_year, filing_status)
  VALUES (v_client_id, 'be411601-f0f5-4f74-b93d-b87a8ef1b82b', '2025-26', '2024-25', 'Ready for Review')
  RETURNING id INTO v_inserted_id;

  RAISE NOTICE 'INSERT succeeded — id = %', v_inserted_id;

  -- Clean up the test row so it doesn't pollute the live grid
  DELETE FROM itr_profiles WHERE id = v_inserted_id;
  RAISE NOTICE 'cleaned up';

  -- Back to superuser role for safety
  PERFORM set_config('role', 'postgres', true);
END $$;
