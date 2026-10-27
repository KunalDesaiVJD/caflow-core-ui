-- Billing email log: filter by client and by client group.
-- notification_log had no reliable client link — recipient_id is the client only
-- for client sends, a user id for responsible-person sends, and NULL for every
-- direct_email send (ledgers, group statements). Record the client / group explicitly.

ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_group_id uuid REFERENCES public.client_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_log_client_id ON public.notification_log (client_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_client_group_id ON public.notification_log (client_group_id);

-- Backfill 1: client sends logged the client id as recipient_id.
UPDATE public.notification_log n
   SET client_id = n.recipient_id
  FROM public.clients c
 WHERE n.client_id IS NULL AND c.id = n.recipient_id;

-- Backfill 2: group statements — subject names exactly one group (client_groups are often global).
UPDATE public.notification_log n
   SET client_group_id = g.id
  FROM public.client_groups g
 WHERE n.client_group_id IS NULL AND n.client_id IS NULL
   AND n.type = 'ledger_statement'
   AND (n.content->>'subject') ILIKE '%— ' || g.name || '%'
   AND (SELECT count(*) FROM public.client_groups g2
         WHERE (n.content->>'subject') ILIKE '%— ' || g2.name || '%') = 1;

-- Backfill 3: single-client ledgers — subject names exactly one client of that firm.
UPDATE public.notification_log n
   SET client_id = c.id
  FROM public.clients c
 WHERE n.client_id IS NULL AND n.client_group_id IS NULL
   AND n.type = 'ledger_statement'
   AND c.firm_id = n.firm_id
   AND (n.content->>'subject') ILIKE '%— ' || c.name || ' —%'
   AND (SELECT count(*) FROM public.clients c2
         WHERE c2.firm_id = n.firm_id
           AND (n.content->>'subject') ILIKE '%— ' || c2.name || ' —%') = 1;

-- Backfill 4: the "To" address belongs to exactly one client of that firm.
UPDATE public.notification_log n
   SET client_id = c.id
  FROM public.clients c
 WHERE n.client_id IS NULL AND n.client_group_id IS NULL
   AND n.type IN ('invoice_generated','quotation_sent','proforma_sent','credit_note_issued',
                  'payment_reminder','ledger_statement')
   AND c.firm_id = n.firm_id
   AND lower(trim(c.email)) = lower(trim(n.content->>'to'))
   AND (SELECT count(*) FROM public.clients c2
         WHERE c2.firm_id = n.firm_id
           AND lower(trim(c2.email)) = lower(trim(n.content->>'to'))) = 1;

-- Group filter: rows sent to the group itself, or to any client in the group.
-- Set-returning RPC so the UI can still filter / order / paginate / count on it
-- without putting hundreds of member ids in the URL. SECURITY INVOKER keeps RLS.
CREATE OR REPLACE FUNCTION public.notification_log_in_group(p_group_id uuid)
RETURNS SETOF public.notification_log
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT n.*
    FROM public.notification_log n
   WHERE n.client_group_id = p_group_id
      OR n.client_id IN (SELECT m.client_id FROM public.client_group_memberships m
                          WHERE m.group_id = p_group_id);
$$;

GRANT EXECUTE ON FUNCTION public.notification_log_in_group(uuid) TO authenticated;
