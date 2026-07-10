-- Multi-form TDS selection: default 26Q for existing TDS-active clients that
-- have no tds_forms_applicable set yet (no live UI has ever written this
-- column before now — the only prior writer, ClientDetail's TDS Activate
-- modal, is unreachable dead code).

UPDATE public.client_services cs
SET tds_forms_applicable = ARRAY['26Q']
FROM public.service_categories sc
WHERE cs.service_category_id = sc.id
  AND sc.linked_module = 'tds'
  AND cs.is_active = true
  AND (cs.tds_forms_applicable IS NULL OR array_length(cs.tds_forms_applicable, 1) IS NULL);
