
-- Insert test client if not exists
INSERT INTO clients (name, entity_type, statutory_audit_applicable, tax_audit_type, gstin, pan, firm_id)
SELECT 'Veritas Trading Pvt Ltd', 'company', true, 'tax_audit', '{24AABCV1234A1Z5}'::text[], 'AABCV1234A', 'be411601-f0f5-4f74-b93d-b87a8ef1b82b'
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE name = 'Veritas Trading Pvt Ltd' AND firm_id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b');

-- Insert test engagement if not exists
INSERT INTO audit_engagements (client_id, firm_id, financial_year, audit_type, entity_type, status, pipeline_stage, stage_statuses, questionnaire_answers)
SELECT c.id, 'be411601-f0f5-4f74-b93d-b87a8ef1b82b', '2024-25', 'both', 'company', 'planning', 1,
  '{"1":"in_progress","2":"not_started","3":"not_started","4":"not_started","5":"not_started","6":"not_started","7":"not_started","8":"not_started","9":"not_started","10":"not_started"}'::jsonb,
  '{}'::jsonb
FROM clients c
WHERE c.name = 'Veritas Trading Pvt Ltd' AND c.firm_id = 'be411601-f0f5-4f74-b93d-b87a8ef1b82b'
AND NOT EXISTS (
  SELECT 1 FROM audit_engagements ae
  WHERE ae.client_id = c.id AND ae.financial_year = '2024-25'
);
