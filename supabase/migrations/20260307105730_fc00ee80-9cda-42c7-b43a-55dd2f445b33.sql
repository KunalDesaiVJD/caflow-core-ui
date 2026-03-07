
CREATE OR REPLACE FUNCTION public.log_tds_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_op text;
  v_user_name text;
  v_user_role text;
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
      SELECT col_key FROM jsonb_object_keys(v_new) AS col_key
      WHERE v_old->col_key IS DISTINCT FROM v_new->col_key
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
$function$;
