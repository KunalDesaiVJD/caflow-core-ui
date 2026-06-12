SELECT ae.id, ae.financial_year, coalesce(ae.is_py_shell,false) as is_py_shell,
       c.name, c.entity_type,
       (SELECT count(*) FROM nce_financial_notes n WHERE n.engagement_id = ae.id)  AS nce_notes,
       (ae.stage5_notes IS NOT NULL) AS has_corporate_notes,
       (SELECT count(*) FROM tally_ledgers t WHERE t.engagement_id = ae.id)        AS tb_rows,
       (SELECT count(*) FROM jsonb_object_keys(coalesce(ae.coa_mapping,'{}'::jsonb))) AS mapped_ledgers
FROM audit_engagements ae JOIN clients c ON c.id = ae.client_id
ORDER BY c.name, ae.financial_year
