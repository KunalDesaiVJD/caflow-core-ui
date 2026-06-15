SELECT client_id, assessment_year, firm_id, COUNT(*) AS dupes
FROM itr_profiles
GROUP BY client_id, assessment_year, firm_id
HAVING COUNT(*) > 1
ORDER BY dupes DESC
LIMIT 10;

SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT (client_id, assessment_year, firm_id)) AS unique_combos
FROM itr_profiles;
