
DROP VIEW IF EXISTS public.fa_summary_by_fy;
CREATE VIEW public.fa_summary_by_fy WITH (security_invoker = true) AS
SELECT
  a.client_id,
  a.fy,
  c.name AS category_name,
  c.useful_life_years,
  SUM(a.gross_block_opening) AS gross_block_opening,
  SUM(a.additions_during_year) AS additions,
  SUM(a.disposals_during_year) AS disposals,
  SUM(a.gross_block_opening + a.additions_during_year - a.disposals_during_year) AS gross_block_closing,
  SUM(a.accumulated_dep_opening) AS acc_dep_opening,
  SUM(COALESCE(a.depreciation_for_year, 0)) AS depreciation,
  SUM(a.accumulated_dep_opening + COALESCE(a.depreciation_for_year, 0)) AS acc_dep_closing,
  SUM((a.gross_block_opening + a.additions_during_year - a.disposals_during_year) - (a.accumulated_dep_opening + COALESCE(a.depreciation_for_year, 0))) AS net_block
FROM public.fa_assets a
JOIN public.fa_categories c ON c.id = a.category_id
GROUP BY a.client_id, a.fy, c.name, c.useful_life_years;
