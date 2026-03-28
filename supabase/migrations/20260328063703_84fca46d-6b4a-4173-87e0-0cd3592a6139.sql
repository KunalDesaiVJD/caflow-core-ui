-- Move all clients from Demo CA Firm to V J Desai & Co.
DO $$
DECLARE
  v_demo_firm_id uuid;
  v_vj_firm_id uuid;
BEGIN
  SELECT id INTO v_demo_firm_id
  FROM public.firms
  WHERE lower(name) = 'demo ca firm'
  LIMIT 1;

  SELECT id INTO v_vj_firm_id
  FROM public.firms
  WHERE lower(name) = 'v j desai & co.'
  LIMIT 1;

  IF v_demo_firm_id IS NULL THEN
    RAISE EXCEPTION 'Demo CA Firm not found';
  END IF;

  IF v_vj_firm_id IS NULL THEN
    RAISE EXCEPTION 'V J Desai & Co. not found';
  END IF;

  UPDATE public.clients
  SET firm_id = v_vj_firm_id
  WHERE firm_id = v_demo_firm_id;
END $$;

-- Ensure new clients default to the logged-in user's firm when firm_id is omitted
CREATE OR REPLACE FUNCTION public.set_client_firm_id_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NULL THEN
    NEW.firm_id := public.current_user_firm_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_client_firm_id_default_before_insert ON public.clients;

CREATE TRIGGER set_client_firm_id_default_before_insert
BEFORE INSERT ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.set_client_firm_id_default();