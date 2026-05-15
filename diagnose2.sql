-- Check existing RLS policies on clients
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'clients'
ORDER BY policyname;
