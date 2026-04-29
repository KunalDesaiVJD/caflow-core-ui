-- ─────────────────────────────────────────────────────────────────────────────
-- Required Documents Master  ·  firm-scoped CRUD list used by QueryCombobox
-- "Required Documents" dropdown in the audit Query Sheet.
--
-- Each firm gets its own master list. The first time a firm reads the table
-- with no rows, the UI seeds it from COMMON_REQUIRED_DOCS via insert. We do
-- NOT auto-seed in SQL because firm_id of new firms isn't known at migrate
-- time and we want users to manage their own list.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.required_documents_master (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       uuid        NOT NULL,
  doc_name      text        NOT NULL,
  description   text,
  category      text,                              -- e.g. Bank, GST, Tax, Audit
  is_active     boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, doc_name)
);

CREATE INDEX IF NOT EXISTS required_documents_master_firm_active
  ON public.required_documents_master (firm_id, is_active, sort_order);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.required_documents_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_required_docs"
  ON public.required_documents_master FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_firm_required_docs"
  ON public.required_documents_master FOR ALL TO authenticated
  USING (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid())
  );

-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.required_docs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS required_documents_master_updated_at ON public.required_documents_master;
CREATE TRIGGER required_documents_master_updated_at
  BEFORE UPDATE ON public.required_documents_master
  FOR EACH ROW EXECUTE FUNCTION public.required_docs_set_updated_at();
