-- Create tds-templates storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('tds-templates', 'tds-templates', false);

-- Allow authenticated users to upload/read templates
CREATE POLICY "auth_upload_tds_templates" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'tds-templates');
CREATE POLICY "auth_read_tds_templates" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'tds-templates');
CREATE POLICY "auth_update_tds_templates" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'tds-templates');
CREATE POLICY "auth_delete_tds_templates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'tds-templates');

-- Add migrated flag to tds_entries for legacy migration tracking
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS migrated boolean DEFAULT false;
ALTER TABLE public.tds_entries ADD COLUMN IF NOT EXISTS migrated_at timestamptz;