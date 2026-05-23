-- Check the SHUBHAM BUILDCON engagement details
SELECT
  ae.id,
  ae.partner_name,
  ae.partner_membership_no,
  ae.firm_id,
  ae.audit_firm_id,
  f.name AS firm_name,
  f.membership_numbers,
  af.name AS audit_firm_name,
  af.partner_name AS af_partner_name,
  af.partner_icai_no
FROM audit_engagements ae
LEFT JOIN firms f ON f.id = ae.firm_id
LEFT JOIN audit_firms af ON af.id = ae.audit_firm_id
WHERE ae.partner_name = 'Karan R. Parekh'
   OR ae.audit_firm_id IN (SELECT id FROM audit_firms WHERE name ILIKE '%karan%')
LIMIT 5;
