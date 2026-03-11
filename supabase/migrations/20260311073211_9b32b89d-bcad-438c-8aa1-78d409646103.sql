
-- FA Categories
CREATE TABLE public.fa_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id) ON DELETE CASCADE,
  name text NOT NULL,
  useful_life_years integer NOT NULL,
  residual_value_pct numeric NOT NULL DEFAULT 5.00,
  depreciation_method text NOT NULL DEFAULT 'WDV',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.fa_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON public.fa_categories FOR SELECT TO authenticated USING (is_superadmin() OR firm_id = current_user_firm_id() OR firm_id IS NULL);
CREATE POLICY "firm_scope_insert" ON public.fa_categories FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "firm_scope_update" ON public.fa_categories FOR UPDATE TO authenticated USING (is_superadmin() OR firm_id = current_user_firm_id());
CREATE POLICY "firm_scope_delete" ON public.fa_categories FOR DELETE TO authenticated USING (is_superadmin() OR firm_id = current_user_firm_id());

-- Seed default categories (firm_id NULL = global defaults)
INSERT INTO public.fa_categories (firm_id, name, useful_life_years) VALUES
  (NULL, 'Factory Building', 30),
  (NULL, 'Factory Office', 30),
  (NULL, 'CCTV', 10),
  (NULL, 'Plant & Machinery', 15),
  (NULL, 'Electric Installation', 10),
  (NULL, 'Furniture', 10),
  (NULL, 'Lab Equipment', 10),
  (NULL, 'Vehicle', 10),
  (NULL, 'Computer', 3),
  (NULL, 'Mobile', 3),
  (NULL, 'Borewell', 15),
  (NULL, 'Computer Software', 10);

-- FA Assets
CREATE TABLE public.fa_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES public.audit_engagements(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  category_id uuid REFERENCES public.fa_categories(id) NOT NULL,
  asset_name text NOT NULL,
  asset_code text,
  location text,
  date_of_purchase date NOT NULL,
  gross_block_opening numeric NOT NULL DEFAULT 0,
  accumulated_dep_opening numeric NOT NULL DEFAULT 0,
  additions_during_year numeric NOT NULL DEFAULT 0,
  addition_date date,
  disposals_during_year numeric NOT NULL DEFAULT 0,
  disposal_date date,
  disposal_proceeds numeric NOT NULL DEFAULT 0,
  depreciation_for_year numeric,
  is_carried_forward boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  fy text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.fa_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON public.fa_assets FOR SELECT TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_insert" ON public.fa_assets FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_update" ON public.fa_assets FOR UPDATE TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_delete" ON public.fa_assets FOR DELETE TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));

-- FA Depreciation Schedule
CREATE TABLE public.fa_depreciation_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.fa_assets(id) ON DELETE CASCADE NOT NULL,
  fy text NOT NULL,
  depreciation_rate numeric NOT NULL,
  depreciation_amount numeric NOT NULL,
  wdv_opening numeric NOT NULL,
  wdv_closing numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.fa_depreciation_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON public.fa_depreciation_schedule FOR SELECT TO authenticated USING (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));
CREATE POLICY "firm_scope_insert" ON public.fa_depreciation_schedule FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));
CREATE POLICY "firm_scope_update" ON public.fa_depreciation_schedule FOR UPDATE TO authenticated USING (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));
CREATE POLICY "firm_scope_delete" ON public.fa_depreciation_schedule FOR DELETE TO authenticated USING (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));

-- FA Asset Disposals
CREATE TABLE public.fa_asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.fa_assets(id) ON DELETE CASCADE NOT NULL,
  disposal_date date NOT NULL,
  disposal_proceeds numeric NOT NULL DEFAULT 0,
  gross_block_reversed numeric NOT NULL DEFAULT 0,
  accumulated_dep_reversed numeric NOT NULL DEFAULT 0,
  net_book_value_at_disposal numeric NOT NULL DEFAULT 0,
  profit_loss_on_disposal numeric NOT NULL DEFAULT 0,
  entry_narration text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.fa_asset_disposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON public.fa_asset_disposals FOR SELECT TO authenticated USING (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));
CREATE POLICY "firm_scope_insert" ON public.fa_asset_disposals FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));
CREATE POLICY "firm_scope_delete" ON public.fa_asset_disposals FOR DELETE TO authenticated USING (is_superadmin() OR asset_id IN (SELECT id FROM fa_assets WHERE client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id())));

-- FA Import Batches
CREATE TABLE public.fa_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  fy text NOT NULL,
  file_url text,
  row_count integer DEFAULT 0,
  processed_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  status text DEFAULT 'pending',
  imported_by uuid REFERENCES public.users(id),
  imported_at timestamptz DEFAULT now()
);

ALTER TABLE public.fa_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firm_scope_select" ON public.fa_import_batches FOR SELECT TO authenticated USING (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));
CREATE POLICY "firm_scope_insert" ON public.fa_import_batches FOR INSERT TO authenticated WITH CHECK (is_superadmin() OR client_id IN (SELECT id FROM clients WHERE firm_id = current_user_firm_id()));

-- Summary View
CREATE OR REPLACE VIEW public.fa_summary_by_fy AS
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
