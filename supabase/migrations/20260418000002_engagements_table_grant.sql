-- Grant frontend access to engagements table.
-- The table was created with RLS but no SELECT policy for anon/authenticated,
-- so the frontend could not resolve engagements.id for tally data lookup.

CREATE POLICY IF NOT EXISTS "eng_select" ON engagements FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "eng_insert" ON engagements FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "eng_update" ON engagements FOR UPDATE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON engagements TO anon, authenticated;
