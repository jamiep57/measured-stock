-- =====================================================================
-- 056 — Product images (kit / library thumbnails)
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.products.image_url IS
  'Public URL of an optional product thumbnail (e.g. from Current RMS import).';

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product_images_anon_select'
  ) THEN
    CREATE POLICY product_images_anon_select ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product_images_anon_insert'
  ) THEN
    CREATE POLICY product_images_anon_insert ON storage.objects
      FOR INSERT TO public
      WITH CHECK (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product_images_anon_update'
  ) THEN
    CREATE POLICY product_images_anon_update ON storage.objects
      FOR UPDATE TO public
      USING (bucket_id = 'product-images')
      WITH CHECK (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product_images_anon_delete'
  ) THEN
    CREATE POLICY product_images_anon_delete ON storage.objects
      FOR DELETE TO public
      USING (bucket_id = 'product-images');
  END IF;
END $$;
