SELECT policyname, cmd, qual::text AS using_expr, with_check::text AS check_expr
FROM pg_policies
WHERE tablename = 'audit_status'
ORDER BY cmd, policyname;

SELECT relrowsecurity, relname
FROM pg_class
WHERE relname = 'audit_status';
