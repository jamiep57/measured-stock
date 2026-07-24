-- =====================================================================
-- 048 — Bug report screenshots
-- =====================================================================
-- Background:
--   Admin can attach an auto-captured screenshot to a bug/feature report.
--   Images live in a public Storage bucket; the URL is stored on the row.
--
-- Safe to re-run (additive, IF NOT EXISTS / ON CONFLICT).
-- =====================================================================

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS screenshot_url text;

COMMENT ON COLUMN public.bug_reports.screenshot_url IS
  'Public URL of an optional screenshot attached to this report.';

-- Bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bug-screenshots', 'bug-screenshots', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Anon CRUD on objects in this bucket only (matches open table RLS in 004).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'bug_screenshots_anon_select'
  ) THEN
    CREATE POLICY bug_screenshots_anon_select ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'bug-screenshots');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'bug_screenshots_anon_insert'
  ) THEN
    CREATE POLICY bug_screenshots_anon_insert ON storage.objects
      FOR INSERT TO public
      WITH CHECK (bucket_id = 'bug-screenshots');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'bug_screenshots_anon_update'
  ) THEN
    CREATE POLICY bug_screenshots_anon_update ON storage.objects
      FOR UPDATE TO public
      USING (bucket_id = 'bug-screenshots')
      WITH CHECK (bucket_id = 'bug-screenshots');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'bug_screenshots_anon_delete'
  ) THEN
    CREATE POLICY bug_screenshots_anon_delete ON storage.objects
      FOR DELETE TO public
      USING (bucket_id = 'bug-screenshots');
  END IF;
END $$;
