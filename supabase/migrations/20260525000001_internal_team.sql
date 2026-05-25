-- ─────────────────────────────────────────────────────────────────────────────
-- Internal Team Infrastructure
-- Adds IE (Implementation Executive) and CSE (Client Success Executive) roles
-- plus all supporting tables for onboarding and support workflows.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Allow new internal roles in the users.role column
--    (role is text — no enum constraint to modify)
--    We just document the new valid values here; RLS enforces access.

COMMENT ON COLUMN users.role IS
  'Valid values: superadmin, firm_admin, master_admin, partner_ca, manager, staff_article, client, implementation_executive, client_success_executive';

-- 2. Onboarding templates (per plan tier)
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_tier     text NOT NULL,           -- solo | studio | firm | enterprise
  task_order    int  NOT NULL,
  task_label    text NOT NULL,
  task_desc     text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed default tasks per tier
INSERT INTO onboarding_templates (plan_tier, task_order, task_label, task_desc) VALUES
  ('solo',       1, 'Verify firm details',         'Confirm GST, PAN, registered address'),
  ('solo',       2, 'Configure financial year',    'Set current and previous year'),
  ('solo',       3, 'Send welcome email',           'Send credentials + product walkthrough link'),
  ('solo',       4, 'Mark go-live',                 'Confirm firm is live and independent'),
  ('studio',     1, 'Verify firm details',         'Confirm GST, PAN, registered address'),
  ('studio',     2, 'Configure financial year',    'Set current and previous year'),
  ('studio',     3, 'Import chart of accounts',    'Upload opening trial balance'),
  ('studio',     4, 'Invite staff members',         'Create logins for up to 10 users'),
  ('studio',     5, 'Send welcome email',           'Send credentials + product walkthrough link'),
  ('studio',     6, 'Mark go-live',                 'Confirm firm is live and independent'),
  ('firm',       1, 'Verify Practice Group details','Confirm all linked firms'' GST / PAN'),
  ('firm',       2, 'Configure Practice Group',    'Create Practice Group, link firms'),
  ('firm',       3, 'Assign Master Admin',          'Create Master Admin user for the group'),
  ('firm',       4, 'Configure financial years',   'Set FY for each linked firm'),
  ('firm',       5, 'Import chart of accounts',    'Upload opening balances for each firm'),
  ('firm',       6, 'Invite all staff',             'Create logins for all users across firms'),
  ('firm',       7, 'Configure Telegram / Email',  'Connect notification channels'),
  ('firm',       8, 'Demo walkthrough call',        'Schedule 30-min onboarding call'),
  ('firm',       9, 'Hand off to Master Admin',    'Confirm Master Admin is self-sufficient'),
  ('firm',      10, 'Mark go-live',                 'Confirm Practice Group is fully live'),
  ('enterprise', 1, 'Dedicated kickoff call',       'Schedule enterprise kickoff with stakeholders'),
  ('enterprise', 2, 'Verify all entities',          'Confirm all firms in the group'),
  ('enterprise', 3, 'Configure Practice Group',    'Set up group, link all firms'),
  ('enterprise', 4, 'Assign Master Admin',          'Create Master Admin + Firm Admin per firm'),
  ('enterprise', 5, 'Configure financial years',   'Set FY for every linked firm'),
  ('enterprise', 6, 'Data migration',               'Bulk import trial balances / client data'),
  ('enterprise', 7, 'Staff onboarding',             'Invite and train all staff'),
  ('enterprise', 8, 'Telegram / Email setup',      'Connect all notification channels'),
  ('enterprise', 9, 'Custom workflow setup',        'Configure firm-specific workflows'),
  ('enterprise',10, 'UAT sign-off',                 'User acceptance testing with client'),
  ('enterprise',11, 'Hypercare period (2 weeks)',   'Daily check-ins for first 2 weeks'),
  ('enterprise',12, 'Hand off & mark go-live',      'Formal handover to Master Admin')
ON CONFLICT DO NOTHING;

-- 3. Per-firm onboarding instance (created when firm subscribes)
CREATE TABLE IF NOT EXISTS onboarding_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  plan_tier       text NOT NULL,
  assigned_ie_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed
  progress_pct    int  NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (firm_id)
);

-- 4. Individual onboarding tasks
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES onboarding_instances(id) ON DELETE CASCADE,
  task_order      int  NOT NULL,
  task_label      text NOT NULL,
  task_desc       text,
  assignee_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending',  -- pending | in_progress | done | skipped
  due_at          timestamptz,
  done_at         timestamptz,
  done_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 5. CSE portfolio (which CSE manages which firm)
CREATE TABLE IF NOT EXISTS cse_portfolios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cse_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  firm_id         uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (cse_user_id, firm_id)
);

-- 6. Support tickets (raised by firm users, handled by CSE)
CREATE TABLE IF NOT EXISTS support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  raised_by       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cse_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  subject         text NOT NULL,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'open',  -- open | in_progress | resolved | closed
  priority        text NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 7. Support ticket replies
CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message         text NOT NULL,
  is_internal     boolean NOT NULL DEFAULT false,  -- true = CSE-only note
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 8. Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_onboarding_instances_firm     ON onboarding_instances(firm_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_instances_ie       ON onboarding_instances(assigned_ie_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_instances_status   ON onboarding_instances(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_instance     ON onboarding_tasks(instance_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_assignee     ON onboarding_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_cse_portfolios_cse            ON cse_portfolios(cse_user_id);
CREATE INDEX IF NOT EXISTS idx_cse_portfolios_firm           ON cse_portfolios(firm_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_firm          ON support_tickets(firm_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_cse           ON support_tickets(cse_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status        ON support_tickets(status);

-- 9. RLS policies
ALTER TABLE onboarding_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_instances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cse_portfolios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_replies   ENABLE ROW LEVEL SECURITY;

-- Superadmin (Platform Admin) + internal roles: full access
CREATE POLICY "internal_full_access_templates"    ON onboarding_templates    FOR ALL USING (current_setting('app.user_role', true) IN ('superadmin','implementation_executive','client_success_executive'));
CREATE POLICY "internal_full_access_instances"    ON onboarding_instances    FOR ALL USING (current_setting('app.user_role', true) IN ('superadmin','implementation_executive','client_success_executive'));
CREATE POLICY "internal_full_access_tasks"        ON onboarding_tasks        FOR ALL USING (current_setting('app.user_role', true) IN ('superadmin','implementation_executive','client_success_executive'));
CREATE POLICY "internal_full_access_portfolios"   ON cse_portfolios          FOR ALL USING (current_setting('app.user_role', true) IN ('superadmin','implementation_executive','client_success_executive'));
CREATE POLICY "internal_full_access_tickets"      ON support_tickets         FOR ALL USING (current_setting('app.user_role', true) IN ('superadmin','implementation_executive','client_success_executive'));
CREATE POLICY "internal_full_access_replies"      ON support_ticket_replies  FOR ALL USING (current_setting('app.user_role', true) IN ('superadmin','implementation_executive','client_success_executive'));

-- Firm users: can read own firm's onboarding progress (for the progress bar)
CREATE POLICY "firm_read_own_onboarding" ON onboarding_instances FOR SELECT
  USING (firm_id IN (
    SELECT id FROM firms WHERE id = (SELECT firm_id FROM users WHERE id = auth.uid())
  ));

-- Firm users: can raise and read own tickets
CREATE POLICY "firm_raise_tickets" ON support_tickets FOR INSERT
  WITH CHECK (raised_by = auth.uid());
CREATE POLICY "firm_read_own_tickets" ON support_tickets FOR SELECT
  USING (firm_id IN (
    SELECT id FROM firms WHERE id = (SELECT firm_id FROM users WHERE id = auth.uid())
  ));
CREATE POLICY "firm_read_own_replies" ON support_ticket_replies FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets
      WHERE firm_id IN (
        SELECT id FROM firms WHERE id = (SELECT firm_id FROM users WHERE id = auth.uid())
      )
    )
    AND is_internal = false
  );
