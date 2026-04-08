-- Allow users to read all team-member profiles that belong to the same firm.
--
-- Background
-- ----------
-- The existing policy "Users can read own profile" only allows a row to be
-- returned when  id = auth.uid()  — i.e. a user can only see themselves.
-- Every other table in this schema already has a firm-scoped SELECT policy
-- (using the subquery pattern below), but the users table was missing it.
-- This causes all employee-assignment dropdowns (Audit Worksheet, Special
-- Attention, Worksheet, etc.) to return an empty list even though the firm
-- has multiple staff members.
--
-- Policy logic (permissive — OR-ed with the existing own-row policy)
-- -----------------------------------------------------------------
-- A user may read any row in public.users where:
--   that row's firm_id = the currently-authenticated user's own firm_id
--
-- The sub-select is evaluated under the existing "read own profile" policy,
-- so it is always able to resolve the caller's firm_id safely.

CREATE POLICY "Users can read team members from same firm"
ON public.users
FOR SELECT
TO authenticated
USING (
  firm_id = (
    SELECT firm_id
    FROM   public.users
    WHERE  id = auth.uid()
  )
);
