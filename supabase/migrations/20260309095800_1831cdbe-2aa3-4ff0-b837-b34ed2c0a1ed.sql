-- Create firm-assets storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('firm-assets', 'firm-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to firm-assets
CREATE POLICY "Authenticated users can upload firm assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'firm-assets');

-- Allow authenticated users to update (upsert) firm assets
CREATE POLICY "Authenticated users can update firm assets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'firm-assets');

-- Allow public read access to firm assets
CREATE POLICY "Public read access to firm assets"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'firm-assets');

-- Allow authenticated users to delete firm assets
CREATE POLICY "Authenticated users can delete firm assets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'firm-assets');

-- Add RLS policies for narration_rules so firm users can CRUD
CREATE POLICY "Firm users can select narration_rules"
ON public.narration_rules FOR SELECT TO authenticated
USING (is_superadmin() OR firm_id IS NULL OR firm_id = current_user_firm_id());

CREATE POLICY "Firm users can insert narration_rules"
ON public.narration_rules FOR INSERT TO authenticated
WITH CHECK (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "Firm users can update narration_rules"
ON public.narration_rules FOR UPDATE TO authenticated
USING (is_superadmin() OR firm_id = current_user_firm_id());

CREATE POLICY "Firm users can delete narration_rules"
ON public.narration_rules FOR DELETE TO authenticated
USING (is_superadmin() OR firm_id = current_user_firm_id());