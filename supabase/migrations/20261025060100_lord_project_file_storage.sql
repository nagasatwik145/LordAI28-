-- Private storage for project uploads. Every object path starts with the
-- authenticated owner's ID and the project must also belong to that owner.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-files',
  'project-files',
  false,
  20971520,
  ARRAY['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- CREATE POLICY has no IF NOT EXISTS clause. Drop these named policies first
-- so this migration can be safely rerun after a partial manual application.
DROP POLICY IF EXISTS "Project owners upload their files" ON storage.objects;
DROP POLICY IF EXISTS "Project owners read their files" ON storage.objects;
DROP POLICY IF EXISTS "Project owners update their files" ON storage.objects;
DROP POLICY IF EXISTS "Project owners delete their files" ON storage.objects;

CREATE POLICY "Project owners upload their files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners read their files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners update their files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'project-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners delete their files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[2]
      AND p.user_id = auth.uid()
  )
);
