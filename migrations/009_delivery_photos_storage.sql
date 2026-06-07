-- =====================================================================
-- 009 — Delivery photo storage (Supabase Storage)
-- =====================================================================
-- Background:
--   v2.html uploads delivery note / delivery / damages photos to the
--   public `delivery-photos` bucket via DB.uploadImage() (anon key).
--   The bucket must exist AND storage.objects policies must allow anon
--   insert/update/delete (read is public when bucket.public = true).
--
-- Prerequisite: bucket row (run once if not already created):
--   insert into storage.buckets (id, name, public)
--   values ('delivery-photos', 'delivery-photos', true)
--   on conflict (id) do update set public = true;
-- =====================================================================

-- Bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-photos', 'delivery-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Anon CRUD on objects in this bucket only (matches open table RLS in 004).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'delivery_photos_anon_select'
  ) THEN
    CREATE POLICY delivery_photos_anon_select ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'delivery-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'delivery_photos_anon_insert'
  ) THEN
    CREATE POLICY delivery_photos_anon_insert ON storage.objects
      FOR INSERT TO public
      WITH CHECK (bucket_id = 'delivery-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'delivery_photos_anon_update'
  ) THEN
    CREATE POLICY delivery_photos_anon_update ON storage.objects
      FOR UPDATE TO public
      USING (bucket_id = 'delivery-photos')
      WITH CHECK (bucket_id = 'delivery-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'delivery_photos_anon_delete'
  ) THEN
    CREATE POLICY delivery_photos_anon_delete ON storage.objects
      FOR DELETE TO public
      USING (bucket_id = 'delivery-photos');
  END IF;
END $$;
