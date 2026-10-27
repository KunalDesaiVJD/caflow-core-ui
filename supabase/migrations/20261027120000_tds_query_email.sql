-- ─────────────────────────────────────────────────────────────────────────
-- TDS client query emails
--
-- Lets staff email a client from Validate & Finalise when a stage raises a
-- query (Stage-1 data mismatches, Stage-2 PAN / challan issues, Stage-3 Tally
-- differences, or a free-text point). Reuses the existing TDS email pipeline:
-- the row goes to tds_email_outbox with kind 'query', send-tds-email delivers
-- it from tds@vjdesai.com, and the TDS Email Settings log lists it.
--
--   * kind 'query' allowed on both tables
--   * cc_email   — optional CC list (comma-separated), set from the dialog
--   * template 'query_client' — editable on the Email Settings page
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_email_templates DROP CONSTRAINT IF EXISTS tds_email_templates_kind_check;
ALTER TABLE public.tds_email_templates
  ADD CONSTRAINT tds_email_templates_kind_check CHECK (kind IN ('reminder','confirmation','query'));

ALTER TABLE public.tds_email_outbox DROP CONSTRAINT IF EXISTS tds_email_outbox_kind_check;
ALTER TABLE public.tds_email_outbox
  ADD CONSTRAINT tds_email_outbox_kind_check CHECK (kind IN ('reminder','confirmation','query'));

ALTER TABLE public.tds_email_outbox ADD COLUMN IF NOT EXISTS cc_email text;

INSERT INTO public.tds_email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('query_client', 'Client query — information required', 'query', NULL,
 $s$Query: {{form_type}} {{quarter}} FY {{financial_year}} — information required | {{client_name}}$s$,
 $b$While preparing your {{form_type}} return for {{quarter}} FY {{financial_year}}, we came across the points listed below that need your clarification before we can proceed with the filing.

Kindly reply to this email with the clarification or the corrected details / supporting documents for each point. If you have any questions, please feel free to call us.$b$, 6)
ON CONFLICT (key) DO NOTHING;
