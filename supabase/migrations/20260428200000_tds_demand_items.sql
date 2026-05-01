-- ─────────────────────────────────────────────────────────────────────────────
-- Phase TDS-6: tds_demand_items
-- NOTE: RLS uses public.users.firm_id (not firm_users — doesn't exist)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_demand_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id             uuid        NOT NULL,
  financial_year      text        NOT NULL,
  flag_id             uuid        REFERENCES public.tds_recon_flags(id) ON DELETE SET NULL,
  flag_type           text        NOT NULL,
  goal_number         integer     NOT NULL,
  tb_ledger_name      text,
  tds_deductee_name   text,
  section_code        text,
  nature_of_payment   text,
  tds_shortfall       numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid         numeric(18,2),
  deductible_date     date,
  deduction_date      date,
  payment_date        date,
  computation_date    date         NOT NULL DEFAULT CURRENT_DATE,
  interest_rate_pct   numeric(5,2),
  interest_months     integer,
  interest_201_1a     numeric(18,2) NOT NULL DEFAULT 0,
  late_filing_days    integer,
  fee_234e            numeric(18,2) NOT NULL DEFAULT 0,
  total_demand        numeric(18,2) NOT NULL DEFAULT 0,
  computation_note    text,
  item_status         text NOT NULL DEFAULT 'computed'
                      CHECK (item_status IN ('computed','acknowledged','disputed','settled')),
  dispute_note        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tds_demand_items_client_fy
  ON public.tds_demand_items (client_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tds_demand_items_flag_id
  ON public.tds_demand_items (flag_id);

CREATE OR REPLACE FUNCTION public.set_tds_demand_items_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_tds_demand_items_updated_at ON public.tds_demand_items;
CREATE TRIGGER trg_tds_demand_items_updated_at
  BEFORE UPDATE ON public.tds_demand_items
  FOR EACH ROW EXECUTE FUNCTION public.set_tds_demand_items_updated_at();

ALTER TABLE public.tds_demand_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_tds_demand_items" ON public.tds_demand_items;
CREATE POLICY "service_role_full_tds_demand_items"
  ON public.tds_demand_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "firm_users_tds_demand_items" ON public.tds_demand_items;
CREATE POLICY "firm_users_tds_demand_items"
  ON public.tds_demand_items FOR ALL TO authenticated
  USING (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  );
