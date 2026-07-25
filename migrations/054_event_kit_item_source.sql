-- =====================================================================
-- 054 — event_kit_items.source (planned own vs hire-in)
-- =====================================================================

ALTER TABLE public.event_kit_items
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'own';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_kit_items_source_check'
  ) THEN
    ALTER TABLE public.event_kit_items
      ADD CONSTRAINT event_kit_items_source_check
      CHECK (source IN ('own', 'hire'));
  END IF;
END $$;

COMMENT ON COLUMN public.event_kit_items.source IS
  'Planned cover for this line: own (warehouse) or hire (external hire-in).';
