-- 1) NOT NULL columns on itr_profiles
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'itr_profiles'
ORDER BY ordinal_position;
