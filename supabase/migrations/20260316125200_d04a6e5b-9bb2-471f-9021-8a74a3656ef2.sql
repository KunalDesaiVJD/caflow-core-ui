
CREATE TABLE IF NOT EXISTS public.tb_upload_sessions (
  id TEXT PRIMARY KEY,
  engagement_id UUID,
  chunk_index INTEGER,
  chunk_data TEXT,
  total_chunks INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tb_upload_sessions_created ON tb_upload_sessions(created_at);

-- RLS: Only service role should access this (edge function uses service role key)
ALTER TABLE public.tb_upload_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on tb_upload_sessions"
  ON public.tb_upload_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
