-- Chat policy recursion fix using SECURITY DEFINER helpers
create or replace function public.is_chat_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_participants cp
    where cp.conversation_id = _conversation_id
      and cp.user_id = _user_id
      and cp.left_at is null
  );
$$;

create or replace function public.is_chat_conversation_admin(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_participants cp
    where cp.conversation_id = _conversation_id
      and cp.user_id = _user_id
      and cp.left_at is null
      and cp.role = 'admin'
  );
$$;

create or replace function public.is_same_firm_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = _user_id
      and u.firm_id = public.current_user_firm_id()
  );
$$;

-- Replace recursive chat policies
DROP POLICY IF EXISTS chat_conv_select ON public.chat_conversations;
CREATE POLICY chat_conv_select
ON public.chat_conversations
FOR SELECT
TO authenticated
USING (
  is_superadmin()
  OR created_by = auth.uid()
  OR public.is_chat_conversation_member(id, auth.uid())
);

DROP POLICY IF EXISTS chat_conv_update ON public.chat_conversations;
CREATE POLICY chat_conv_update
ON public.chat_conversations
FOR UPDATE
TO authenticated
USING (
  is_superadmin()
  OR created_by = auth.uid()
  OR public.is_chat_conversation_member(id, auth.uid())
)
WITH CHECK (
  is_superadmin()
  OR firm_id = public.current_user_firm_id()
);

DROP POLICY IF EXISTS chat_part_select ON public.chat_participants;
CREATE POLICY chat_part_select
ON public.chat_participants
FOR SELECT
TO authenticated
USING (
  is_superadmin()
  OR public.is_chat_conversation_member(conversation_id, auth.uid())
);

DROP POLICY IF EXISTS chat_part_insert ON public.chat_participants;
CREATE POLICY chat_part_insert
ON public.chat_participants
FOR INSERT
TO authenticated
WITH CHECK (
  is_superadmin()
  OR (
    (
      public.is_chat_conversation_member(conversation_id, auth.uid())
      OR exists (
        select 1
        from public.chat_conversations c
        where c.id = conversation_id
          and c.created_by = auth.uid()
          and c.firm_id = public.current_user_firm_id()
      )
    )
    AND public.is_same_firm_user(user_id)
  )
);

DROP POLICY IF EXISTS chat_part_update ON public.chat_participants;
CREATE POLICY chat_part_update
ON public.chat_participants
FOR UPDATE
TO authenticated
USING (
  is_superadmin()
  OR user_id = auth.uid()
  OR public.is_chat_conversation_admin(conversation_id, auth.uid())
)
WITH CHECK (
  is_superadmin()
  OR public.is_same_firm_user(user_id)
);

DROP POLICY IF EXISTS chat_part_delete ON public.chat_participants;
CREATE POLICY chat_part_delete
ON public.chat_participants
FOR DELETE
TO authenticated
USING (
  is_superadmin()
  OR user_id = auth.uid()
  OR public.is_chat_conversation_admin(conversation_id, auth.uid())
);

DROP POLICY IF EXISTS chat_msg_select ON public.chat_messages;
CREATE POLICY chat_msg_select
ON public.chat_messages
FOR SELECT
TO authenticated
USING (
  is_superadmin()
  OR public.is_chat_conversation_member(conversation_id, auth.uid())
);

DROP POLICY IF EXISTS chat_msg_insert ON public.chat_messages;
CREATE POLICY chat_msg_insert
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  is_superadmin()
  OR (
    sender_id = auth.uid()
    AND public.is_chat_conversation_member(conversation_id, auth.uid())
  )
);

-- Backward-compatible notice_type validation for old + new notice trackers
ALTER TABLE public.demand_notices
DROP CONSTRAINT IF EXISTS demand_notices_notice_type_check;

ALTER TABLE public.demand_notices
ADD CONSTRAINT demand_notices_notice_type_check
CHECK (
  notice_type = ANY (
    ARRAY[
      'income_tax_demand_143_1'::text,
      'scrutiny_notice_143_2'::text,
      'deficiency_memo'::text,
      'gstn_notice'::text,
      'tds_mismatch_26as'::text,
      'roc_notice'::text,
      'pf_esic_notice'::text,
      'custom'::text,
      '143_1'::text,
      '148'::text,
      '139_9'::text,
      '245'::text,
      '156'::text,
      '36B'::text,
      'scrutiny'::text
    ]
  )
);