
-- Chat conversations table
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID REFERENCES public.firms(id) NOT NULL,
  type TEXT NOT NULL DEFAULT 'individual' CHECK (type IN ('individual', 'group')),
  name TEXT,
  avatar_url TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_message_preview VARCHAR(200)
);

-- Chat participants table
CREATE TABLE public.chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  left_at TIMESTAMP WITH TIME ZONE,
  notification_muted BOOLEAN DEFAULT false,
  UNIQUE(conversation_id, user_id)
);

-- Chat messages table
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  content TEXT,
  file_url TEXT,
  file_name TEXT,
  file_size_bytes INTEGER,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'image', 'system')),
  reply_to_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  is_pinned BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP WITH TIME ZONE,
  read_by JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS policies
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Conversations: users can only see conversations they participate in
CREATE POLICY "chat_conv_select" ON public.chat_conversations FOR SELECT TO authenticated
USING (is_superadmin() OR id IN (SELECT conversation_id FROM public.chat_participants WHERE user_id = auth.uid() AND left_at IS NULL));

CREATE POLICY "chat_conv_insert" ON public.chat_conversations FOR INSERT TO authenticated
WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "chat_conv_update" ON public.chat_conversations FOR UPDATE TO authenticated
USING (is_superadmin() OR id IN (SELECT conversation_id FROM public.chat_participants WHERE user_id = auth.uid() AND left_at IS NULL));

CREATE POLICY "chat_conv_delete" ON public.chat_conversations FOR DELETE TO authenticated
USING (is_superadmin() OR created_by = auth.uid());

-- Participants: can see participants of conversations they belong to
CREATE POLICY "chat_part_select" ON public.chat_participants FOR SELECT TO authenticated
USING (is_superadmin() OR conversation_id IN (SELECT conversation_id FROM public.chat_participants cp WHERE cp.user_id = auth.uid() AND cp.left_at IS NULL));

CREATE POLICY "chat_part_insert" ON public.chat_participants FOR INSERT TO authenticated
WITH CHECK (is_superadmin() OR conversation_id IN (SELECT id FROM public.chat_conversations WHERE firm_id = current_user_firm_id()));

CREATE POLICY "chat_part_update" ON public.chat_participants FOR UPDATE TO authenticated
USING (is_superadmin() OR user_id = auth.uid() OR conversation_id IN (SELECT conversation_id FROM public.chat_participants cp WHERE cp.user_id = auth.uid() AND cp.role = 'admin' AND cp.left_at IS NULL));

CREATE POLICY "chat_part_delete" ON public.chat_participants FOR DELETE TO authenticated
USING (is_superadmin() OR user_id = auth.uid());

-- Messages: can see messages in conversations they participate in
CREATE POLICY "chat_msg_select" ON public.chat_messages FOR SELECT TO authenticated
USING (is_superadmin() OR conversation_id IN (SELECT conversation_id FROM public.chat_participants WHERE user_id = auth.uid() AND left_at IS NULL));

CREATE POLICY "chat_msg_insert" ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (is_superadmin() OR conversation_id IN (SELECT conversation_id FROM public.chat_participants WHERE user_id = auth.uid() AND left_at IS NULL));

CREATE POLICY "chat_msg_update" ON public.chat_messages FOR UPDATE TO authenticated
USING (is_superadmin() OR sender_id = auth.uid());

CREATE POLICY "chat_msg_delete" ON public.chat_messages FOR DELETE TO authenticated
USING (is_superadmin() OR sender_id = auth.uid());

-- Enable realtime for chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;

-- Indexes
CREATE INDEX idx_chat_messages_conversation ON public.chat_messages(conversation_id, created_at DESC);
CREATE INDEX idx_chat_participants_user ON public.chat_participants(user_id) WHERE left_at IS NULL;
CREATE INDEX idx_chat_conversations_firm ON public.chat_conversations(firm_id, last_message_at DESC);
