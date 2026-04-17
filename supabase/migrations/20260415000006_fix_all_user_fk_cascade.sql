-- Comprehensive fix: every FK on public.users(id) that lacks ON DELETE SET NULL.
-- Deleting a user was failing with "violates foreign key constraint" as each
-- referencing table was hit one by one.  This migration re-creates all 39
-- constraints with ON DELETE SET NULL so Postgres nullifies them automatically.
--
-- Tables where the user column is the PRIMARY owner (chat_participants) use
-- ON DELETE CASCADE instead so orphan rows are cleaned up.
--
-- Run once in Supabase SQL Editor. The edge-function pre-nullification added in
-- the previous deploy is belt-and-suspenders until this migration is applied.

-- ── ai_usage_log ─────────────────────────────────────────────────────────────
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_user_id_fkey;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── audit_engagements ────────────────────────────────────────────────────────
ALTER TABLE public.audit_engagements
  DROP CONSTRAINT IF EXISTS audit_engagements_manager_id_fkey;
ALTER TABLE public.audit_engagements
  ADD CONSTRAINT audit_engagements_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_engagements
  DROP CONSTRAINT IF EXISTS audit_engagements_partner_id_fkey;
ALTER TABLE public.audit_engagements
  ADD CONSTRAINT audit_engagements_partner_id_fkey
    FOREIGN KEY (partner_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_engagements
  DROP CONSTRAINT IF EXISTS audit_engagements_sign_off_by_fkey;
ALTER TABLE public.audit_engagements
  ADD CONSTRAINT audit_engagements_sign_off_by_fkey
    FOREIGN KEY (sign_off_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_engagements
  DROP CONSTRAINT IF EXISTS audit_engagements_signed_by_fkey;
ALTER TABLE public.audit_engagements
  ADD CONSTRAINT audit_engagements_signed_by_fkey
    FOREIGN KEY (signed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── audit_firms ──────────────────────────────────────────────────────────────
ALTER TABLE public.audit_firms
  DROP CONSTRAINT IF EXISTS audit_firms_created_by_fkey;
ALTER TABLE public.audit_firms
  ADD CONSTRAINT audit_firms_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── billing_receipts ─────────────────────────────────────────────────────────
ALTER TABLE public.billing_receipts
  DROP CONSTRAINT IF EXISTS billing_receipts_created_by_fkey;
ALTER TABLE public.billing_receipts
  ADD CONSTRAINT billing_receipts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── carry_forward_queries ────────────────────────────────────────────────────
ALTER TABLE public.carry_forward_queries
  DROP CONSTRAINT IF EXISTS carry_forward_queries_carried_by_fkey;
ALTER TABLE public.carry_forward_queries
  ADD CONSTRAINT carry_forward_queries_carried_by_fkey
    FOREIGN KEY (carried_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── chat_conversations ───────────────────────────────────────────────────────
ALTER TABLE public.chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_created_by_fkey;
ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── chat_messages ────────────────────────────────────────────────────────────
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_sender_id_fkey;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── chat_participants — CASCADE: orphan rows have no meaning without the user
ALTER TABLE public.chat_participants
  DROP CONSTRAINT IF EXISTS chat_participants_user_id_fkey;
ALTER TABLE public.chat_participants
  ADD CONSTRAINT chat_participants_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ── client_auditor_assignments ───────────────────────────────────────────────
ALTER TABLE public.client_auditor_assignments
  DROP CONSTRAINT IF EXISTS client_auditor_assignments_created_by_fkey;
ALTER TABLE public.client_auditor_assignments
  ADD CONSTRAINT client_auditor_assignments_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── client_group_memberships ─────────────────────────────────────────────────
ALTER TABLE public.client_group_memberships
  DROP CONSTRAINT IF EXISTS client_group_memberships_added_by_fkey;
ALTER TABLE public.client_group_memberships
  ADD CONSTRAINT client_group_memberships_added_by_fkey
    FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── client_groups ────────────────────────────────────────────────────────────
ALTER TABLE public.client_groups
  DROP CONSTRAINT IF EXISTS client_groups_created_by_fkey;
ALTER TABLE public.client_groups
  ADD CONSTRAINT client_groups_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── clients ──────────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_responsible_person_id_fkey;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_responsible_person_id_fkey
    FOREIGN KEY (responsible_person_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_user_id_fkey;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── demand_notice_status_history ─────────────────────────────────────────────
ALTER TABLE public.demand_notice_status_history
  DROP CONSTRAINT IF EXISTS demand_notice_status_history_changed_by_fkey;
ALTER TABLE public.demand_notice_status_history
  ADD CONSTRAINT demand_notice_status_history_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── demand_notices ───────────────────────────────────────────────────────────
ALTER TABLE public.demand_notices
  DROP CONSTRAINT IF EXISTS demand_notices_assigned_to_fkey;
ALTER TABLE public.demand_notices
  ADD CONSTRAINT demand_notices_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.demand_notices
  DROP CONSTRAINT IF EXISTS demand_notices_created_by_fkey;
ALTER TABLE public.demand_notices
  ADD CONSTRAINT demand_notices_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── documents ────────────────────────────────────────────────────────────────
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_signed_by_fkey;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_signed_by_fkey
    FOREIGN KEY (signed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── fa_asset_additions ───────────────────────────────────────────────────────
ALTER TABLE public.fa_asset_additions
  DROP CONSTRAINT IF EXISTS fa_asset_additions_created_by_fkey;
ALTER TABLE public.fa_asset_additions
  ADD CONSTRAINT fa_asset_additions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── fa_asset_disposals ───────────────────────────────────────────────────────
ALTER TABLE public.fa_asset_disposals
  DROP CONSTRAINT IF EXISTS fa_asset_disposals_created_by_fkey;
ALTER TABLE public.fa_asset_disposals
  ADD CONSTRAINT fa_asset_disposals_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── fa_assets ────────────────────────────────────────────────────────────────
ALTER TABLE public.fa_assets
  DROP CONSTRAINT IF EXISTS fa_assets_created_by_fkey;
ALTER TABLE public.fa_assets
  ADD CONSTRAINT fa_assets_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── fa_import_batches ────────────────────────────────────────────────────────
ALTER TABLE public.fa_import_batches
  DROP CONSTRAINT IF EXISTS fa_import_batches_imported_by_fkey;
ALTER TABLE public.fa_import_batches
  ADD CONSTRAINT fa_import_batches_imported_by_fkey
    FOREIGN KEY (imported_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── feedback ─────────────────────────────────────────────────────────────────
ALTER TABLE public.feedback
  DROP CONSTRAINT IF EXISTS feedback_user_id_fkey;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── itr_profiles ─────────────────────────────────────────────────────────────
ALTER TABLE public.itr_profiles
  DROP CONSTRAINT IF EXISTS itr_profiles_assigned_to_fkey;
ALTER TABLE public.itr_profiles
  ADD CONSTRAINT itr_profiles_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.itr_profiles
  DROP CONSTRAINT IF EXISTS itr_profiles_checked_by_fkey;
ALTER TABLE public.itr_profiles
  ADD CONSTRAINT itr_profiles_checked_by_fkey
    FOREIGN KEY (checked_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.itr_profiles
  DROP CONSTRAINT IF EXISTS itr_profiles_prepared_by_fkey;
ALTER TABLE public.itr_profiles
  ADD CONSTRAINT itr_profiles_prepared_by_fkey
    FOREIGN KEY (prepared_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.itr_profiles
  DROP CONSTRAINT IF EXISTS itr_profiles_upload_by_fkey;
ALTER TABLE public.itr_profiles
  ADD CONSTRAINT itr_profiles_upload_by_fkey
    FOREIGN KEY (upload_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── role_permission_audit_log ────────────────────────────────────────────────
ALTER TABLE public.role_permission_audit_log
  DROP CONSTRAINT IF EXISTS role_permission_audit_log_changed_by_fkey;
ALTER TABLE public.role_permission_audit_log
  ADD CONSTRAINT role_permission_audit_log_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── role_permissions ─────────────────────────────────────────────────────────
ALTER TABLE public.role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_updated_by_fkey;
ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── scrutiny_rules ───────────────────────────────────────────────────────────
ALTER TABLE public.scrutiny_rules
  DROP CONSTRAINT IF EXISTS scrutiny_rules_created_by_fkey;
ALTER TABLE public.scrutiny_rules
  ADD CONSTRAINT scrutiny_rules_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── service_categories ───────────────────────────────────────────────────────
ALTER TABLE public.service_categories
  DROP CONSTRAINT IF EXISTS service_categories_created_by_fkey;
ALTER TABLE public.service_categories
  ADD CONSTRAINT service_categories_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── tds_filing_audit_log ─────────────────────────────────────────────────────
ALTER TABLE public.tds_filing_audit_log
  DROP CONSTRAINT IF EXISTS tds_filing_audit_log_changed_by_fkey;
ALTER TABLE public.tds_filing_audit_log
  ADD CONSTRAINT tds_filing_audit_log_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── tds_filings ──────────────────────────────────────────────────────────────
ALTER TABLE public.tds_filings
  DROP CONSTRAINT IF EXISTS tds_filings_approver_id_fkey;
ALTER TABLE public.tds_filings
  ADD CONSTRAINT tds_filings_approver_id_fkey
    FOREIGN KEY (approver_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.tds_filings
  DROP CONSTRAINT IF EXISTS tds_filings_checker_id_fkey;
ALTER TABLE public.tds_filings
  ADD CONSTRAINT tds_filings_checker_id_fkey
    FOREIGN KEY (checker_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.tds_filings
  DROP CONSTRAINT IF EXISTS tds_filings_created_by_fkey;
ALTER TABLE public.tds_filings
  ADD CONSTRAINT tds_filings_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.tds_filings
  DROP CONSTRAINT IF EXISTS tds_filings_preparer_id_fkey;
ALTER TABLE public.tds_filings
  ADD CONSTRAINT tds_filings_preparer_id_fkey
    FOREIGN KEY (preparer_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── timesheets ───────────────────────────────────────────────────────────────
ALTER TABLE public.timesheets
  DROP CONSTRAINT IF EXISTS timesheets_user_id_fkey;
ALTER TABLE public.timesheets
  ADD CONSTRAINT timesheets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
