
-- TDS Rate Master
CREATE TABLE IF NOT EXISTS tds_rate_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_year text NOT NULL,
  financial_year text NOT NULL,
  form_type text NOT NULL,
  section_code text NOT NULL,
  section_description text,
  nature_of_payment text,
  threshold_individual numeric DEFAULT 0,
  threshold_company numeric DEFAULT 0,
  rate_individual numeric,
  rate_company numeric,
  rate_no_pan numeric,
  surcharge_applicable boolean DEFAULT false,
  cess_applicable boolean DEFAULT false,
  is_active boolean DEFAULT true,
  effective_from date,
  effective_to date,
  notes text,
  created_at timestamptz DEFAULT now(),
  firm_id uuid REFERENCES firms(id),
  UNIQUE(assessment_year, form_type, section_code, firm_id)
);

ALTER TABLE tds_rate_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view rate master for their firm" ON tds_rate_master
  FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id() OR firm_id IS NULL);

CREATE POLICY "Users can insert rate master for their firm" ON tds_rate_master
  FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can update rate master for their firm" ON tds_rate_master
  FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can delete rate master for their firm" ON tds_rate_master
  FOR DELETE TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Superadmins can manage all rate master" ON tds_rate_master
  FOR ALL TO authenticated
  USING (public.is_superadmin());

-- TDS Challans
CREATE TABLE IF NOT EXISTS tds_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id uuid REFERENCES tds_filings(id) ON DELETE CASCADE NOT NULL,
  client_id uuid REFERENCES clients(id) NOT NULL,
  firm_id uuid REFERENCES firms(id) NOT NULL,
  form_type text NOT NULL,
  financial_year text NOT NULL,
  quarter text NOT NULL,
  bsr_code text,
  challan_serial_no text,
  deposit_date date,
  total_tax_deposited numeric DEFAULT 0,
  surcharge_deposited numeric DEFAULT 0,
  education_cess_deposited numeric DEFAULT 0,
  interest_deposited numeric DEFAULT 0,
  others_deposited numeric DEFAULT 0,
  total_challan_amount numeric DEFAULT 0,
  minor_head_of_challan text,
  is_book_entry boolean DEFAULT false,
  transfer_voucher_no text,
  cheque_dd_no text,
  bank_name text,
  section_code text,
  challan_remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tds_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage challans for their firm" ON tds_challans
  FOR ALL TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Superadmins can manage all challans" ON tds_challans
  FOR ALL TO authenticated
  USING (public.is_superadmin());

-- TDS Deductees
CREATE TABLE IF NOT EXISTS tds_deductees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id uuid REFERENCES tds_challans(id) ON DELETE CASCADE NOT NULL,
  filing_id uuid REFERENCES tds_filings(id) NOT NULL,
  client_id uuid REFERENCES clients(id) NOT NULL,
  firm_id uuid REFERENCES firms(id) NOT NULL,
  form_type text NOT NULL,
  financial_year text NOT NULL,
  quarter text NOT NULL,
  deductee_name text NOT NULL,
  deductee_pan text,
  pan_not_available boolean DEFAULT false,
  deductee_ref_no text,
  deductee_type text,
  section_code text NOT NULL,
  nature_of_payment text,
  amount_paid_credited numeric,
  date_of_payment date,
  date_of_deduction date,
  rate_of_tds numeric,
  tds_amount numeric,
  surcharge_rate numeric DEFAULT 0,
  surcharge_amount numeric DEFAULT 0,
  cess_rate numeric DEFAULT 0,
  cess_amount numeric DEFAULT 0,
  total_tax_deducted numeric,
  lower_deduction_certificate_no text,
  lower_deduction_rate numeric,
  reason_for_lower_or_nil_deduction text,
  country_of_residence text,
  email_id text,
  contact_no text,
  trc_available boolean DEFAULT false,
  treaty_section text,
  gross_salary numeric,
  standard_deduction_allowed numeric,
  professional_tax numeric,
  entertainment_allowance numeric,
  net_taxable_salary numeric,
  income_from_other_sources numeric,
  income_from_house_property numeric,
  tds_by_previous_employer numeric,
  designation text,
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tds_deductees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage deductees for their firm" ON tds_deductees
  FOR ALL TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Superadmins can manage all deductees" ON tds_deductees
  FOR ALL TO authenticated
  USING (public.is_superadmin());

-- Add new columns to tds_filings
ALTER TABLE tds_filings
  ADD COLUMN IF NOT EXISTS deductor_type text,
  ADD COLUMN IF NOT EXISTS deductor_pan text,
  ADD COLUMN IF NOT EXISTS responsible_person_pan text,
  ADD COLUMN IF NOT EXISTS responsible_person_name text,
  ADD COLUMN IF NOT EXISTS is_regular_return boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS previous_filing_token text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid;
