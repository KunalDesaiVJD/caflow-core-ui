-- Migration 20260416000001
-- 1. Add partner_name TEXT to audit_engagements (fetch from firms.membership_numbers)
-- 2. Create audit_worksheet_history table for version history tracking

-- ── 1. audit_engagements.partner_name ─────────────────────────────────────────
ALTER TABLE public.audit_engagements
  ADD COLUMN IF NOT EXISTS partner_name TEXT;

-- ── 2. audit_worksheet_history ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_worksheet_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id    UUID NOT NULL REFERENCES public.audit_engagements(id) ON DELETE CASCADE,
  section_name     TEXT NOT NULL,
  page_label       TEXT,
  field_name       TEXT,
  old_value        TEXT,
  new_value        TEXT,
  changed_by       UUID REFERENCES public.users(id),
  changed_by_name  TEXT,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_worksheet_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_awh_engagement_at
  ON public.audit_worksheet_history(engagement_id, changed_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_worksheet_history' AND policyname = 'awh_select'
  ) THEN
    CREATE POLICY "awh_select" ON public.audit_worksheet_history
      FOR SELECT TO authenticated
      USING (
        is_superadmin() OR
        engagement_id IN (
          SELECT id FROM public.audit_engagements
          WHERE firm_id = current_user_firm_id()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_worksheet_history' AND policyname = 'awh_insert'
  ) THEN
    CREATE POLICY "awh_insert" ON public.audit_worksheet_history
      FOR INSERT TO authenticated
      WITH CHECK (
        is_superadmin() OR
        engagement_id IN (
          SELECT id FROM public.audit_engagements
          WHERE firm_id = current_user_firm_id()
        )
      );
  END IF;
END $$;
