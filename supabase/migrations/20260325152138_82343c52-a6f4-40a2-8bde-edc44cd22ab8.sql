-- Migration 11: Remove banking data from client_profiles + approve_week_timesheets function

-- Null out data first
UPDATE client_profiles SET banking_data = NULL, loan_data = NULL;

-- Drop columns
ALTER TABLE client_profiles DROP COLUMN IF EXISTS banking_data;
ALTER TABLE client_profiles DROP COLUMN IF EXISTS loan_data;

-- Timesheet approval function
CREATE OR REPLACE FUNCTION public.approve_week_timesheets(
  p_user_id uuid,
  p_from_date date,
  p_to_date date,
  p_approved_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE timesheets
  SET approved_by = p_approved_by, approved_at = now()
  WHERE user_id = p_user_id
    AND work_date BETWEEN p_from_date AND p_to_date
    AND approved_by IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
