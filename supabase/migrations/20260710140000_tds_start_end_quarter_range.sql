-- TDS Compliance Start/End Quarter range.
-- Start Quarter reuses existing tds_effective_from_fy/tds_effective_from_q (mandatory).
-- End Quarter is new: optional, inclusive last-active quarter. Blank = active indefinitely.
-- Purely declarative for display/filtering — does not touch is_active or tds_filings rows
-- (that remains the job of the separate deactivation flow via tds_deactivated_from_fy/q).

ALTER TABLE public.client_services
  ADD COLUMN IF NOT EXISTS tds_end_fy text,
  ADD COLUMN IF NOT EXISTS tds_end_quarter text;

-- Backfill: existing TDS-active client_services rows with no Start Quarter set
-- default to Q1 - FY 2025-26.
UPDATE public.client_services cs
SET tds_effective_from_fy = '2025-26',
    tds_effective_from_q = 'Q1'
FROM public.service_categories sc
WHERE cs.service_category_id = sc.id
  AND sc.linked_module = 'tds'
  AND cs.is_active = true
  AND cs.tds_effective_from_fy IS NULL;
