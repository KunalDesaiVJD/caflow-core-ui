-- ─────────────────────────────────────────────────────────────────────────────
-- Phase TDS-6: tds_demand_items
--
-- Stores per-flag demand computations:
--   • TDS shortfall (from Goal 2 short-deduction + Goal 3 missing TDS flags)
--   • Section 201(1A) interest
--   • Section 234E late filing fee
--   • Grand total demand
-- Idempotent: re-running the calculator deletes and re-inserts all rows
-- for the same client + FY.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_demand_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id             uuid        NOT NULL,
  financial_year      text        NOT NULL,

  -- Source flag
  flag_id             uuid        REFERENCES public.tds_recon_flags(id) ON DELETE SET NULL,
  flag_type           text        NOT NULL,   -- short_deduction | missing_tds_obligation
  goal_number         integer     NOT NULL,   -- 2 or 3

  -- Parties
  tb_ledger_name      text,
  tds_deductee_name   text,
  section_code        text,
  nature_of_payment   text,

  -- Base amounts
  tds_shortfall       numeric(18,2) NOT NULL DEFAULT 0,   -- amount of TDS not deducted/short-deducted
  amount_paid         numeric(18,2),                      -- underlying transaction amount

  -- 201(1A) interest inputs
  deductible_date     date,        -- date TDS was/should have been deducted
  deduction_date      date,        -- actual date deducted (null if not deducted at all)
  payment_date        date,        -- date TDS deposited to govt (null if not deposited)
  computation_date    date         NOT NULL DEFAULT CURRENT_DATE,

  -- 201(1A) computed
  interest_rate_pct   numeric(5,2),   -- 1.00 or 1.50 (% per month)
  interest_months     integer,        -- number of whole months (ceiling)
  interest_201_1a     numeric(18,2) NOT NULL DEFAULT 0,

  -- 234E late filing fee
  late_filing_days    integer,
  fee_234e            numeric(18,2) NOT NULL DEFAULT 0,

  -- Grand total
  total_demand        numeric(18,2) NOT NULL DEFAULT 0,

  -- Notes
  computation_note    text,
  item_status         text NOT NULL DEFAULT 'computed'
                      CHECK (item_status IN ('computed','acknowledged','disputed','settled')),
  dispute_note        text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tds_demand_items_client_fy
  ON public.tds_demand_items (client_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tds_demand_items_flag_id
  ON public.tds_demand_items (flag_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_tds_demand_items_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_tds_demand_items_updated_at ON public.tds_demand_items;
CREATE TRIGGER trg_tds_demand_items_updated_at
  BEFORE UPDATE ON public.tds_demand_items
  FOR EACH ROW EXECUTE FUNCTION public.set_tds_demand_items_updated_at();

-- RLS
ALTER TABLE public.tds_demand_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_tds_demand_items"
  ON public.tds_demand_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "firm_users_tds_demand_items"
  ON public.tds_demand_items
  FOR ALL TO authenticated
  USING (
    firm_id IN (
      SELECT firm_id FROM public.firm_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    firm_id IN (
      SELECT firm_id FROM public.firm_users WHERE user_id = auth.uid()
    )
  );
