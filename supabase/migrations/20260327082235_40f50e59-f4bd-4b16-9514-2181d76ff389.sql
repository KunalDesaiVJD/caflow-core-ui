-- Add missing RLS policies for note_templates (currently only has SELECT)
CREATE POLICY "note_templates_insert" ON public.note_templates
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "note_templates_update" ON public.note_templates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "note_templates_delete" ON public.note_templates
  FOR DELETE TO authenticated USING (true);