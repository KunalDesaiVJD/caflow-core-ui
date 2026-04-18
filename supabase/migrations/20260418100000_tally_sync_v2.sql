-- Tally Sync v2: add debit/credit to trial balance, line_items to vouchers, RPC for ledger drill-down

-- 1. Trial Balance: debit and credit amount columns
ALTER TABLE tally_trial_balance
  ADD COLUMN IF NOT EXISTS debit_amount  numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_amount numeric(15,2) DEFAULT 0;

-- 2. Vouchers: JSONB line_items for all ledger entries per voucher
ALTER TABLE tally_vouchers
  ADD COLUMN IF NOT EXISTS line_items jsonb DEFAULT '[]'::jsonb;

-- 3. GIN index for efficient ledger-name search inside line_items
CREATE INDEX IF NOT EXISTS idx_tally_vouchers_line_items
  ON tally_vouchers USING gin(line_items);

-- 4. RPC: fetch all vouchers containing a given ledger name (for drill-down view)
CREATE OR REPLACE FUNCTION get_ledger_vouchers(
  p_engagement_id uuid,
  p_ledger_name   text
)
RETURNS TABLE(
  id             uuid,
  voucher_date   date,
  voucher_type   text,
  voucher_number text,
  narration      text,
  line_items     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    v.id,
    v.voucher_date,
    v.voucher_type,
    v.voucher_number,
    v.narration,
    v.line_items
  FROM tally_vouchers v
  WHERE v.engagement_id = p_engagement_id
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v.line_items) AS elem
      WHERE elem->>'ledger_name' = p_ledger_name
    )
  ORDER BY v.voucher_date, v.voucher_number;
$$;
