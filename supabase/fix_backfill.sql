-- Backfill partner_membership_no using audit_firm_id (same UUID in both audit_firms and firms)
UPDATE audit_engagements ae
SET partner_membership_no = mn.membership_no
FROM (
  SELECT ae2.id AS eng_id, (mn.value->>'membership_no') AS membership_no
  FROM audit_engagements ae2
  JOIN firms f ON f.id = ae2.audit_firm_id
  JOIN LATERAL jsonb_array_elements(f.membership_numbers) AS mn ON TRUE
  WHERE ae2.partner_name IS NOT NULL
    AND ae2.partner_membership_no IS NULL
    AND lower(mn.value->>'partner_name') = lower(ae2.partner_name)
) mn
WHERE ae.id = mn.eng_id;
