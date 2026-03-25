-- Migration 5: DB function for sequential invoice numbering

CREATE OR REPLACE FUNCTION public.get_next_invoice_seq(
  p_firm_id uuid,
  p_series text,
  p_financial_year text,
  p_invoice_date date
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_date date;
  v_next_seq integer;
BEGIN
  SELECT MAX(invoice_date) INTO v_max_date
  FROM invoices
  WHERE firm_id = p_firm_id
    AND document_series = p_series
    AND financial_year = p_financial_year
    AND seq_number IS NOT NULL;

  IF v_max_date IS NOT NULL AND p_invoice_date < v_max_date THEN
    RAISE EXCEPTION 'BACKDATING_ERROR: Cannot create a document dated % because a document dated % already exists in this series. Dates must be chronological.',
      p_invoice_date, v_max_date;
  END IF;

  SELECT COALESCE(MAX(seq_number), 0) + 1 INTO v_next_seq
  FROM invoices
  WHERE firm_id = p_firm_id
    AND document_series = p_series
    AND financial_year = p_financial_year;

  RETURN v_next_seq;
END;
$$;
