-- Create storage bucket for pre-built connector binaries
INSERT INTO storage.buckets (id, name, public)
VALUES ('connector-binaries', 'connector-binaries', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to connector binaries
CREATE POLICY "Connector binaries are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'connector-binaries');

-- Only authenticated users can upload binaries (admin use)
CREATE POLICY "Authenticated users can upload connector binaries"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'connector-binaries' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update connector binaries"
ON storage.objects FOR UPDATE
USING (bucket_id = 'connector-binaries' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete connector binaries"
ON storage.objects FOR DELETE
USING (bucket_id = 'connector-binaries' AND auth.role() = 'authenticated');