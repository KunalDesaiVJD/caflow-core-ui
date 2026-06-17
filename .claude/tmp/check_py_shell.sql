-- Compare GROWQ vs KWIKTEAM engagement setup
SELECT c.id AS client_id, c.name,
       e.id AS engagement_id, e.financial_year, e.is_py_shell, e.py_source,
       (e.stage_statuses->>'3') AS stage3_status, e.pipeline_stage
FROM clients c
LEFT JOIN audit_engagements e ON e.client_id = c.id
WHERE c.name ILIKE 'GROWQ%' OR c.name ILIKE 'KWIKTEAM%'
ORDER BY c.name, e.financial_year DESC;
