-- Phase 2 (foundation) — billing reconciliation guard (read-only).
--
-- Computes every client's closing balance TWO independent ways and exposes the
-- difference, so a wrong ledger can never silently reach a client statement
-- (the billing analogue of the FS module's FsHealthPanel):
--
--   canonical_closing = opening + invoices - credit_notes - receipts - kasars
--                       (derived straight from the source tables)
--   ledger_closing    = opening + Σ(debit - credit) of client_ledger_entries
--                       (what the Ledger screen actually renders)
--
-- If they disagree (> Rs.1) the ledger has a double-post, orphan or missing
-- entry. `is_balanced` flags the healthy rows. Read-only — changes nothing.

CREATE OR REPLACE VIEW public.v_billing_reconciliation AS
WITH ob AS (
  SELECT firm_id, client_id, SUM(COALESCE(amount, 0)) AS opening
  FROM client_billing_opening_balances
  GROUP BY firm_id, client_id
),
inv AS (
  SELECT firm_id, client_id,
         SUM(CASE WHEN document_type = 'invoice'     THEN COALESCE(total_amount, 0) ELSE 0 END) AS invoiced,
         SUM(CASE WHEN document_type = 'credit_note' THEN COALESCE(total_amount, 0) ELSE 0 END) AS credit_notes
  FROM invoices
  WHERE document_type IN ('invoice', 'credit_note')
    AND status IN ('finalized', 'sent', 'overdue', 'paid')
  GROUP BY firm_id, client_id
),
rcpt AS (
  SELECT firm_id, client_id,
         SUM(COALESCE(amount_received, 0) + COALESCE(tds_amount, 0) + COALESCE(gst_tds_amount, 0)) AS received
  FROM billing_receipts
  GROUP BY firm_id, client_id
),
ksr AS (
  SELECT firm_id, client_id, SUM(COALESCE(amount, 0)) AS kasar
  FROM billing_kasars
  GROUP BY firm_id, client_id
),
led AS (
  SELECT firm_id, client_id, SUM(COALESCE(debit_amount, 0) - COALESCE(credit_amount, 0)) AS ledger_sum
  FROM client_ledger_entries
  GROUP BY firm_id, client_id
),
keys AS (
  SELECT firm_id, client_id FROM ob
  UNION SELECT firm_id, client_id FROM inv
  UNION SELECT firm_id, client_id FROM rcpt
  UNION SELECT firm_id, client_id FROM ksr
  UNION SELECT firm_id, client_id FROM led
)
SELECT
  k.firm_id,
  k.client_id,
  COALESCE(ob.opening, 0)        AS opening,
  COALESCE(inv.invoiced, 0)      AS invoiced,
  COALESCE(inv.credit_notes, 0)  AS credit_notes,
  COALESCE(rcpt.received, 0)     AS received,
  COALESCE(ksr.kasar, 0)         AS kasar,
  COALESCE(ob.opening, 0) + COALESCE(inv.invoiced, 0) - COALESCE(inv.credit_notes, 0)
    - COALESCE(rcpt.received, 0) - COALESCE(ksr.kasar, 0)        AS canonical_closing,
  COALESCE(ob.opening, 0) + COALESCE(led.ledger_sum, 0)         AS ledger_closing,
  (COALESCE(inv.invoiced, 0) - COALESCE(inv.credit_notes, 0) - COALESCE(rcpt.received, 0)
    - COALESCE(ksr.kasar, 0)) - COALESCE(led.ledger_sum, 0)     AS drift,
  (abs(
     (COALESCE(inv.invoiced, 0) - COALESCE(inv.credit_notes, 0) - COALESCE(rcpt.received, 0)
       - COALESCE(ksr.kasar, 0)) - COALESCE(led.ledger_sum, 0)
   ) <= 1.00)                                                   AS is_balanced
FROM keys k
LEFT JOIN ob   ON ob.firm_id   = k.firm_id AND ob.client_id   = k.client_id
LEFT JOIN inv  ON inv.firm_id  = k.firm_id AND inv.client_id  = k.client_id
LEFT JOIN rcpt ON rcpt.firm_id = k.firm_id AND rcpt.client_id = k.client_id
LEFT JOIN ksr  ON ksr.firm_id  = k.firm_id AND ksr.client_id  = k.client_id
LEFT JOIN led  ON led.firm_id  = k.firm_id AND led.client_id  = k.client_id;

-- The view is governed by the underlying tables' RLS (security_invoker keeps
-- each caller scoped to their own firm's rows).
ALTER VIEW public.v_billing_reconciliation SET (security_invoker = on);

COMMENT ON VIEW public.v_billing_reconciliation IS
  'Phase 2 reconciliation guard: per-client canonical vs ledger closing balance with drift flag.';
