-- Fix clients with NULL firm_id - assign to Demo CA Firm
UPDATE clients 
SET firm_id = '046a5de4-11a9-425a-aaa9-4cfdd78ac6d1' 
WHERE firm_id IS NULL AND is_draft = false AND deleted_at IS NULL;