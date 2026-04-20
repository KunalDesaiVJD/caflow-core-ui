-- Tally Sync: make ledger drill-down work even when line_items JSONB is empty.
-- Older sync agent runs populated party_ledger/amount/dr_cr per voucher but
-- left line_items = []. This drops the ledger-vouchers RPC down to match on
-- either the JSONB array OR the legacy party_ledger column, and returns the
-- voucher's top-level amount/dr_cr/party_ledger so the frontend can synthesise
-- a line-item view.

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
  line_items     jsonb,
  party_ledger   text,
  amount         numeric,
  dr_cr          text
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    v.id,
    v.voucher_date,
    v.voucher_type,
    v.voucher_number,
    v.narration,
    COALESCE(v.line_items, '[]'::jsonb) AS line_items,
    v.party_ledger,
    v.amount,
    v.dr_cr
  FROM tally_vouchers v
  WHERE v.engagement_id = p_engagement_id
    AND (
      v.party_ledger = p_ledger_name
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(v.line_items, '[]'::jsonb)) AS elem
        WHERE elem->>'ledger_name' = p_ledger_name
      )
    )
  ORDER BY v.voucher_date, v.voucher_number;
$$;
