-- =====================================================================
-- 049 — Event image (workspace selector mark)
-- =====================================================================
-- Background:
--   Event setup can attach an image shown on the left of the admin
--   workspace / event selector. Images live in a public Storage bucket;
--   the URL is stored on events.image_url.
--
-- Safe to re-run (additive, IF NOT EXISTS / ON CONFLICT).
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.events.image_url IS
  'Public URL of an optional event image shown in the admin workspace selector.';

-- Bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Anon CRUD on objects in this bucket only (matches open table RLS in 004).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'event_images_anon_select'
  ) THEN
    CREATE POLICY event_images_anon_select ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'event-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'event_images_anon_insert'
  ) THEN
    CREATE POLICY event_images_anon_insert ON storage.objects
      FOR INSERT TO public
      WITH CHECK (bucket_id = 'event-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'event_images_anon_update'
  ) THEN
    CREATE POLICY event_images_anon_update ON storage.objects
      FOR UPDATE TO public
      USING (bucket_id = 'event-images')
      WITH CHECK (bucket_id = 'event-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'event_images_anon_delete'
  ) THEN
    CREATE POLICY event_images_anon_delete ON storage.objects
      FOR DELETE TO public
      USING (bucket_id = 'event-images');
  END IF;
END $$;
