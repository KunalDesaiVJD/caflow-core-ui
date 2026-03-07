
-- Create deductees table for party autocomplete
CREATE TABLE IF NOT EXISTS public.deductees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id) ON DELETE CASCADE,
  party_name text NOT NULL,
  pan text,
  pan_valid boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now()
);

ALTER TABLE public.deductees ENABLE ROW LEVEL SECURITY;

-- Add payment_nature column to tds_entries if not exists
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS payment_nature text;
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS deductee_id uuid REFERENCES public.deductees(id);

-- Version history trigger for tds_entries
CREATE OR REPLACE FUNCTION public.log_tds_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_op text;
  v_user_name text;
  v_user_role text;
  k text;
BEGIN
  v_user_name := coalesce(current_setting('app.current_user_name', true), 'System');
  v_user_role := coalesce(current_setting('app.current_user_role', true), 'unknown');

  IF TG_OP = 'INSERT' THEN
    v_op := 'INSERT';
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_changed := ARRAY(SELECT jsonb_object_keys(v_new));
  ELSIF TG_OP = 'UPDATE' THEN
    v_op := 'UPDATE';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_changed := ARRAY(
      SELECT k FROM jsonb_object_keys(v_new) AS k
      WHERE v_old->k IS DISTINCT FROM v_new->k
    );
    IF array_length(v_changed, 1) IS NULL THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_op := 'DELETE';
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_changed := ARRAY(SELECT jsonb_object_keys(v_old));
  END IF;

  INSERT INTO version_history (operation, user_name, user_role, table_name, record_id, old_data, new_data, changed_fields)
  VALUES (v_op, v_user_name, v_user_role, TG_TABLE_NAME, coalesce(NEW.id, OLD.id), v_old, v_new, v_changed);

  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tds_entries_audit ON public.tds_entries;
CREATE TRIGGER tds_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tds_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_tds_changes();

-- RLS for deductees - firm members can access
CREATE POLICY "Users can read deductees from their firm"
  ON public.deductees FOR SELECT TO authenticated
  USING (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert deductees to their firm"
  ON public.deductees FOR INSERT TO authenticated
  WITH CHECK (firm_id IN (SELECT firm_id FROM public.users WHERE id = auth.uid()));
