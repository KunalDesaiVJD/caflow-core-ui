-- Create service_tasks table for auto-generated tasks from service activation
CREATE TABLE IF NOT EXISTS public.service_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_category_id uuid NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL REFERENCES public.firms(id),
  task_title text NOT NULL,
  task_description text,
  frequency text NOT NULL,
  due_date date,
  period_label text,
  status text NOT NULL DEFAULT 'pending',
  assigned_to uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.service_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view service tasks in their firm"
  ON public.service_tasks FOR SELECT TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can insert service tasks in their firm"
  ON public.service_tasks FOR INSERT TO authenticated
  WITH CHECK (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can update service tasks in their firm"
  ON public.service_tasks FOR UPDATE TO authenticated
  USING (firm_id = public.current_user_firm_id());

CREATE POLICY "Users can delete service tasks in their firm"
  ON public.service_tasks FOR DELETE TO authenticated
  USING (firm_id = public.current_user_firm_id());