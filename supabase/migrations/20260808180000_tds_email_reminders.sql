-- ─────────────────────────────────────────────────────────────────────────
-- TDS data-pending reminders + filing confirmation (email via tds@vjdesai.com)
--
-- Mirrors the GST reminders feature (a sibling app) with one structural
-- difference: GST reminders re-send on a STAFF-CONFIGURABLE interval
-- (interval_days/escalate/max_reminders); TDS reminders are anchored to a
-- FIXED quarterly calendar the firm already follows, so there is nothing to
-- configure per client beyond on/off — see queue-tds-reminders for the exact
-- dates (8th/11th/14th of the month after quarter-end for Q1-Q3, 1st/5th/
-- 10th May for Q4).
--
-- Three tables:
--   tds_email_templates          — editable copy for reminders + confirmations
--   tds_client_reminder_settings — per-client on/off (staff-set)
--   tds_email_outbox             — every email we intend to send (status queue)
--
-- The actual SEND is deferred: rows land in tds_email_outbox with status
-- 'pending'; send-tds-email flips them to 'sent'/'failed'.
--
-- RLS: open to public — this app authenticates through its own localStorage
-- session and talks to Postgres with the anon key, so auth.uid() is always
-- NULL at runtime. Staff-only routing is the real gate (matches every other
-- table in this project).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. tds_email_templates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_email_templates (
  key         text PRIMARY KEY,                 -- stable id: 'reminder_1' etc.
  name        text NOT NULL,                     -- human label in the editor
  kind        text NOT NULL CHECK (kind IN ('reminder','confirmation')),
  step        int,                               -- ladder position (1/2/3) for reminders
  subject     text NOT NULL,
  body        text NOT NULL,                     -- plain text with {{variables}}
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- ── 2. tds_client_reminder_settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_client_reminder_settings (
  client_id         uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT false,   -- the on/off switch
  send_confirmation boolean NOT NULL DEFAULT true,    -- email on 'Filed'/'NIL'
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

-- ── 3. tds_email_outbox ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_email_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  to_email       text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('reminder','confirmation')),
  template_key   text NOT NULL REFERENCES public.tds_email_templates(key),
  form_type      text,                              -- '26Q'/'24Q'/'27Q'/'27EQ'
  financial_year text,                              -- 'YYYY-YY'
  quarter        text,                              -- 'Q1'..'Q4'
  subject        text NOT NULL,
  body           text NOT NULL,                     -- rendered (variables filled)
  render_vars    jsonb,                             -- snapshot for the send-time HTML shell
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sending','sent','failed','skipped','cancelled')),
  error          text,
  reminder_step  int,
  filing_id      uuid REFERENCES public.tds_filings(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  sent_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tds_email_outbox_status ON public.tds_email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_tds_email_outbox_client ON public.tds_email_outbox(client_id);
-- One confirmation per (client, form, FY, quarter) — never double-confirm a filing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tds_email_outbox_confirmation
  ON public.tds_email_outbox(client_id, form_type, financial_year, quarter)
  WHERE kind = 'confirmation';

-- ── RLS: open to public (app-layer gate, see header) ────────────────────
ALTER TABLE public.tds_email_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_client_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tds_email_outbox             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app manage tds_email_templates" ON public.tds_email_templates;
CREATE POLICY "app manage tds_email_templates"
  ON public.tds_email_templates FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app manage tds_client_reminder_settings" ON public.tds_client_reminder_settings;
CREATE POLICY "app manage tds_client_reminder_settings"
  ON public.tds_client_reminder_settings FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app manage tds_email_outbox" ON public.tds_email_outbox;
CREATE POLICY "app manage tds_email_outbox"
  ON public.tds_email_outbox FOR ALL TO public USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_email_templates          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_client_reminder_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tds_email_outbox             TO anon, authenticated;

-- ── Seed the 5 templates (idempotent — only inserts if the key is new) ──
INSERT INTO public.tds_email_templates (key, name, kind, step, subject, body, sort_order) VALUES
('reminder_1', 'Reminder 1 — First (cordial)', 'reminder', 1,
 $s$TDS data due — {{form_type}} {{quarter}} FY {{financial_year}} | {{client_name}}$s$,
 $b$This is a gentle reminder that we are awaiting your records to prepare and file your {{form_type}} return for {{quarter}} FY {{financial_year}}.

To ensure timely and accurate filing, kindly share your deductee-wise TDS data and challan details at your earliest convenience. If you have already sent these, please treat this note as acknowledged.$b$, 1),

('reminder_2', 'Reminder 2 — Follow-up', 'reminder', 2,
 $s$Follow-up: awaiting TDS data — {{form_type}} {{quarter}} FY {{financial_year}} | {{client_name}}$s$,
 $b$Following our earlier note, we have not yet received your data for {{form_type}} — {{quarter}} FY {{financial_year}}. To keep your filing on schedule, we request the details below at the earliest.

Kindly share your deductee-wise TDS data and challan details so we can proceed. If already sent, please disregard this reminder.$b$, 2),

('reminder_final', 'Reminder 3 — Final / urgent', 'reminder', 3,
 $s$Urgent: {{form_type}} {{quarter}} FY {{financial_year}} — data pending | {{client_name}}$s$,
 $b$The filing due date for your {{form_type}} — {{quarter}} FY {{financial_year}} is approaching and your data is still pending with us. Late filing attracts late fees and interest under the Income Tax Act, which we would like to help you avoid.

Please share your data today so we can file within time. If it has just been sent, kindly ignore this notice and accept our thanks.$b$, 3),

('confirmation_filed', 'Confirmation — Return filed', 'confirmation', NULL,
 $s$Filed - {{form_type}} for {{quarter}} FY {{financial_year}} | {{client_name}}$s$,
 $b$We are pleased to confirm that your {{form_type}} return for {{quarter}} FY {{financial_year}} has been successfully filed on {{filing_date}}.

No action is needed from your side — this is a confirmation of filing only. The acknowledgment can be requested from us any time.

Thank you for your cooperation.$b$, 4),

('confirmation_nil', 'Confirmation — Nil return filed', 'confirmation', NULL,
 $s$Filed - NIL {{form_type}} for {{quarter}} FY {{financial_year}} | {{client_name}}$s$,
 $b$This confirms that a NIL {{form_type}} return for {{quarter}} FY {{financial_year}} has been recorded on {{filing_date}}. No tax was deducted and no action is required from your side.

Thank you for your continued association.$b$, 5)
ON CONFLICT (key) DO NOTHING;
