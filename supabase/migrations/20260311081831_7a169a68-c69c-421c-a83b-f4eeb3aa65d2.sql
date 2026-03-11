
-- =============================================
-- STAGE 6 & 7: Workpapers, Risk Assessment, Notes to Accounts
-- =============================================

-- audit_notes table
CREATE TABLE IF NOT EXISTS public.audit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES public.audit_engagements(id) ON DELETE CASCADE NOT NULL,
  note_number integer NOT NULL,
  note_title varchar NOT NULL,
  note_content_auto text,
  note_content_user text,
  linked_accounts jsonb DEFAULT '[]'::jsonb,
  is_locked boolean DEFAULT false,
  note_source varchar DEFAULT 'schedule_iii' CHECK (note_source IN ('docx_template','xlsx_template','schedule_iii','custom')),
  is_selected boolean DEFAULT false,
  table_data jsonb,
  user_overrides jsonb,
  note_sub_sections jsonb,
  xlsx_row_data jsonb,
  ai_suggested boolean DEFAULT false,
  is_mandatory boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_notes_firm_access" ON public.audit_notes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audit_engagements ae
      WHERE ae.id = audit_notes.engagement_id
        AND ae.firm_id = public.current_user_firm_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audit_engagements ae
      WHERE ae.id = audit_notes.engagement_id
        AND ae.firm_id = public.current_user_firm_id()
    )
  );

-- note_templates table
CREATE TABLE IF NOT EXISTS public.note_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_number integer NOT NULL,
  note_title varchar NOT NULL,
  note_type varchar DEFAULT 'narrative' CHECK (note_type IN ('narrative','tabular')),
  template_content jsonb,
  xlsx_rows jsonb,
  is_mandatory boolean DEFAULT false,
  applicable_when jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.note_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "note_templates_read" ON public.note_templates
  FOR SELECT TO authenticated USING (true);

-- Seed standard note templates (45 notes)
INSERT INTO public.note_templates (note_number, note_title, note_type, is_mandatory, template_content, applicable_when) VALUES
(1, 'Corporate Information', 'narrative', true, '{"default_text":"The Company was incorporated in India under the Companies Act. Its registered office is at [address]. The Company is engaged in [nature of business]."}', null),
(2, 'Significant Accounting Policies', 'narrative', true, '{"sub_sections":["a_ppe","b_depreciation","c_cwip","d_research","e_intangibles","f_leases","g_investments","h_inventories","i_receivables","j_cash","k_cashflow","l_revenue","m_borrowing","n_impairment","o_forex","p_employee","q_provisions","r_taxes","s_grants","t_eps","u_segments"]}', null),
(3, 'Share Capital', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"]}', '{"entity_type":["company"]}'),
(4, 'Reserves and Surplus', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"]}', '{"entity_type":["company"]}'),
(5, 'Long-term Borrowings', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(6, 'Deferred Tax Liabilities (Net)', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(7, 'Other Long-term Liabilities', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(8, 'Long-term Provisions', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(9, 'Short-term Borrowings', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(10, 'Trade Payables', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"],"includes_msme":true}', null),
(11, 'Other Current Liabilities', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(12, 'Short-term Provisions', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(13, 'Fixed Assets (Tangible)', 'tabular', true, '{"columns":["Asset Class","Gross Block Opening","Additions","Disposals","Gross Block Closing","Acc Dep Opening","Dep for Year","Disposals Dep","Acc Dep Closing","Net Block"]}', null),
(14, 'Capital Work-in-Progress', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(15, 'Non-current Investments', 'tabular', false, '{"columns":["Particulars","Face Value","Nos","CY Amount","PY Amount"]}', null),
(16, 'Deferred Tax Assets (Net)', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(17, 'Long-term Loans and Advances', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(18, 'Other Non-current Assets', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(19, 'Current Investments', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(20, 'Inventories', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(21, 'Trade Receivables', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"],"ageing_required":true}', null),
(22, 'Cash and Cash Equivalents', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(23, 'Short-term Loans and Advances', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(24, 'Other Current Assets', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(25, 'Revenue from Operations', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(26, 'Other Income', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(27, 'Cost of Materials Consumed / Purchases', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(28, 'Employee Benefits Expense', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(29, 'Other Expenses', 'tabular', true, '{"columns":["Expense Head","CY Amount","PY Amount"]}', null),
(30, 'Contingent Liabilities and Commitments', 'tabular', false, '{"columns":["Nature","CY Amount","PY Amount"]}', null),
(31, 'Capital and Other Commitments', 'tabular', false, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(32, 'Segment Reporting', 'tabular', false, '{"columns":["Segment","Revenue","Result","Assets","Liabilities"]}', '{"entity_type":["company"]}'),
(33, 'Leases', 'narrative', false, '{"default_text":"Details of operating and finance leases..."}', null),
(34, 'Employee Benefit Plans', 'tabular', false, '{"columns":["Component","CY","PY"]}', null),
(35, 'Borrowing Cost Capitalized', 'narrative', false, '{"default_text":"Amount of borrowing costs capitalised during the year..."}', null),
(36, 'Foreign Currency Transactions', 'tabular', false, '{"columns":["Particulars","CY","PY"]}', null),
(37, 'Related Party Disclosures', 'tabular', true, '{"columns":["Name","Relationship","Nature of Transaction","Amount"]}', null),
(38, 'Payment to Auditors', 'tabular', true, '{"columns":["Particulars","CY Amount","PY Amount"]}', null),
(39, 'Earnings Per Share', 'tabular', true, '{"columns":["Particulars","CY","PY"]}', '{"entity_type":["company"]}'),
(40, 'Deferred Tax Computation', 'tabular', false, '{"columns":["Timing Difference","CY","PY","Tax Effect"]}', null),
(41, 'CSR Expenditure', 'tabular', false, '{"columns":["Particulars","Amount"]}', '{"entity_type":["company"]}'),
(42, 'Details of Benami Property', 'narrative', false, '{"default_text":"No proceedings have been initiated or pending against the Company for holding any Benami property under the Benami Transactions (Prohibition) Amendment Act, 2016."}', null),
(43, 'Undisclosed Income', 'narrative', false, '{"default_text":"There is no income surrendered or disclosed as income during the current or previous year in the tax assessments under the Income Tax Act, 1961, that has not been recorded in the books of account."}', null),
(44, 'Events After Reporting Period', 'narrative', false, '{"default_text":"No significant events have occurred after the balance sheet date which require adjustments or disclosures in the financial statements."}', null),
(45, 'Previous Year Figures', 'narrative', true, '{"default_text":"Previous year figures have been regrouped / reclassified wherever necessary to conform to the current year''s classification / presentation."}', null)
ON CONFLICT DO NOTHING;

-- Create unique index on audit_notes
CREATE UNIQUE INDEX IF NOT EXISTS audit_notes_eng_notenum ON public.audit_notes (engagement_id, note_number);
