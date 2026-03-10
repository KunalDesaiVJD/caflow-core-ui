INSERT INTO itr_work_groups (firm_id, code, name, description, color) VALUES
('be411601-f0f5-4f74-b93d-b87a8ef1b82b', 'A', 'Returns With Accounts', 'Business clients with audited books', '#065F46'),
('be411601-f0f5-4f74-b93d-b87a8ef1b82b', 'B', 'Returns Without Accounts', 'Salary/investment income only', '#1E40AF'),
('be411601-f0f5-4f74-b93d-b87a8ef1b82b', 'C', 'Client Managed With Accounts', 'Client maintains books, CA only files', '#92400E'),
('be411601-f0f5-4f74-b93d-b87a8ef1b82b', 'D', 'Client Without Accounts', 'No books maintained, CA reconstructs', '#5B21B6'),
('046a5de4-11a9-425a-aaa9-4cfdd78ac6d1', 'A', 'Returns With Accounts', 'Business clients with audited books', '#065F46'),
('046a5de4-11a9-425a-aaa9-4cfdd78ac6d1', 'B', 'Returns Without Accounts', 'Salary/investment income only', '#1E40AF'),
('046a5de4-11a9-425a-aaa9-4cfdd78ac6d1', 'C', 'Client Managed With Accounts', 'Client maintains books, CA only files', '#92400E'),
('046a5de4-11a9-425a-aaa9-4cfdd78ac6d1', 'D', 'Client Without Accounts', 'No books maintained, CA reconstructs', '#5B21B6')
ON CONFLICT (firm_id, code) DO NOTHING;