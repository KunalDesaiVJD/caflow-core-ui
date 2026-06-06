-- APPEND-ONLY correction for SHRI RAM PRODUCTS Note 19 (Other Expenses).
-- Adds the 3 ledgers that were mapped to NCE_OTH_EXP after the last note
-- populate but never re-synced (sessionStorage bug, fixed in v3):
--   Web Developing Fees Exp  ₹1,84,000  → custom row
--   Water Exp                ₹6,000     → custom row
--   Vehicle Rep & Petrol Exp ₹10,750    → travel static row
-- Nothing is deleted. Uses jsonb || merge (add/overwrite keys only).
-- Self-heals on next v3 auto-sync (purgeStale rebuilds with proper IDs).

UPDATE nce_financial_notes nfn
SET
  cy_data = nfn.cy_data
    || jsonb_build_object('travel', 10750)
    || jsonb_build_object('custom_web_developing_fees_exp_90', 184000)
    || jsonb_build_object('custom_water_exp_91', 6000)
    || jsonb_build_object('_custom_rows',
         COALESCE(nfn.cy_data->'_custom_rows','[]'::jsonb)
         || jsonb_build_array(
              jsonb_build_object('id','custom_web_developing_fees_exp_90','label','Web Developing Fees Exp','source','auto','tbDerived',true),
              jsonb_build_object('id','custom_water_exp_91','label','Water Exp','source','auto','tbDerived',true)
            )
       ),
  py_data = nfn.py_data
    || jsonb_build_object('travel', 0)
    || jsonb_build_object('custom_web_developing_fees_exp_90', 0)
    || jsonb_build_object('custom_water_exp_91', 0),
  updated_at = now()
FROM audit_engagements e
JOIN clients c ON c.id = e.client_id
WHERE nfn.engagement_id = e.id
  AND c.name ILIKE '%Shri Ram Products%'
  AND e.financial_year = '2025-26'
  AND (e.is_py_shell IS NULL OR e.is_py_shell = false)
  AND nfn.note_type = 'other_expenses'
  AND nfn.financial_year = '2025-26';
