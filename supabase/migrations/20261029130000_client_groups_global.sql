-- ─────────────────────────────────────────────────────────────────────────
-- Client groups apply to every firm.
--
-- Nine groups were saved with firm_id = V J Desai & Co. LLP. Row-level security
-- then hid them (and their memberships) from anyone whose home firm is another
-- firm — e.g. Dixita Desai — so those clients showed as "Not in any group".
-- A group is a set of clients, and a client's balances with every firm belong
-- to the same group, so all client groups are made global (firm_id NULL), and
-- any staff user may create a global group.
-- Work groups are unchanged (still per firm).
-- ─────────────────────────────────────────────────────────────────────────

UPDATE public.client_groups SET firm_id = NULL WHERE firm_id IS NOT NULL;

DROP POLICY IF EXISTS firm_scope_insert ON public.client_groups;
CREATE POLICY firm_scope_insert ON public.client_groups
  FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR firm_id IS NULL OR firm_id = current_user_firm_id());
