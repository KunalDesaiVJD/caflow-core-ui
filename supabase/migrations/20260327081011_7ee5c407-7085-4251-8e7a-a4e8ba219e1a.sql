-- Delete note_templates that are NOT in the 19-note set used by Notes to Accounts
DELETE FROM note_templates WHERE note_number NOT IN (1, 2, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45);

-- Update titles to match the STANDARD_NOTES in EngagementNotesToAccounts
UPDATE note_templates SET note_title = 'Finance Costs' WHERE note_number = 29;
UPDATE note_templates SET note_title = 'Depreciation and Amortisation' WHERE note_number = 30;
UPDATE note_templates SET note_title = 'Other Expenses' WHERE note_number = 31;
UPDATE note_templates SET note_title = 'Exceptional Items' WHERE note_number = 32;
UPDATE note_templates SET note_title = 'Tax Expense' WHERE note_number = 33;
UPDATE note_templates SET note_title = 'Earnings Per Share' WHERE note_number = 34;
UPDATE note_templates SET note_title = 'Contingent Liabilities and Commitments' WHERE note_number = 35;
UPDATE note_templates SET note_title = 'Related Party Disclosures' WHERE note_number = 36;
UPDATE note_templates SET note_title = 'Segment Reporting' WHERE note_number = 37;
UPDATE note_templates SET note_title = 'Leases' WHERE note_number = 38;
UPDATE note_templates SET note_title = 'Foreign Currency Transactions' WHERE note_number = 39;
UPDATE note_templates SET note_title = 'Government Grants' WHERE note_number = 40;
UPDATE note_templates SET note_title = 'Deferred Tax' WHERE note_number = 41;
UPDATE note_templates SET note_title = 'CSR Expenditure' WHERE note_number = 42;
UPDATE note_templates SET note_title = 'Details of Benami Property' WHERE note_number = 43;
UPDATE note_templates SET note_title = 'Events After Reporting Period' WHERE note_number = 44;
UPDATE note_templates SET note_title = 'Previous Year Figures' WHERE note_number = 45;

-- Insert missing notes that don't exist yet (29-45 range)
INSERT INTO note_templates (note_number, note_title, template_content, is_mandatory)
SELECT n.num, n.title, '{}'::jsonb, false
FROM (VALUES
  (29, 'Finance Costs'), (30, 'Depreciation and Amortisation'), (31, 'Other Expenses'),
  (32, 'Exceptional Items'), (33, 'Tax Expense'), (34, 'Earnings Per Share'),
  (35, 'Contingent Liabilities and Commitments'), (36, 'Related Party Disclosures'),
  (37, 'Segment Reporting'), (38, 'Leases'), (39, 'Foreign Currency Transactions'),
  (40, 'Government Grants'), (41, 'Deferred Tax'), (42, 'CSR Expenditure'),
  (43, 'Details of Benami Property'), (44, 'Events After Reporting Period'),
  (45, 'Previous Year Figures')
) AS n(num, title)
WHERE NOT EXISTS (SELECT 1 FROM note_templates WHERE note_number = n.num);