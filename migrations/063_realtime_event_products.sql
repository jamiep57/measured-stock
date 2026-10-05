-- Enable Realtime on event_products for collaborative Products ordered edits.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'event_products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_products;
  END IF;
END $$;

-- Filters on event_id need FULL replica identity.
ALTER TABLE public.event_products REPLICA IDENTITY FULL;
