SELECT policyname, cmd, qual::text AS using_expr, with_check::text AS check_expr
FROM pg_policies
WHERE tablename = 'itr_profiles'
ORDER BY cmd, policyname;
