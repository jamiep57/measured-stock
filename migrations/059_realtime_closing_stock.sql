-- 059 — Enable Realtime on closing_stock for collaborative Closing edits.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'closing_stock'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.closing_stock;
  END IF;
END $$;
