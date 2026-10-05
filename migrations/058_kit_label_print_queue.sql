-- =====================================================================
-- 058 — Kit label print queue
-- Mobile counting can enqueue labels; desktop kit library prints to QL-800.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.kit_label_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  copies      integer NOT NULL DEFAULT 1
                CHECK (copies >= 1 AND copies <= 50),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  printed_at  timestamptz
);

-- One pending row per product — re-queue bumps copies instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kit_label_queue_pending_product
  ON public.kit_label_queue (product_id)
  WHERE printed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_kit_label_queue_pending
  ON public.kit_label_queue (created_at)
  WHERE printed_at IS NULL;

DO $$
BEGIN
  ALTER TABLE public.kit_label_queue ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS kit_label_queue_anon_select ON public.kit_label_queue;
  CREATE POLICY kit_label_queue_anon_select ON public.kit_label_queue
    FOR SELECT USING (true);

  DROP POLICY IF EXISTS kit_label_queue_anon_insert ON public.kit_label_queue;
  CREATE POLICY kit_label_queue_anon_insert ON public.kit_label_queue
    FOR INSERT WITH CHECK (true);

  DROP POLICY IF EXISTS kit_label_queue_anon_update ON public.kit_label_queue;
  CREATE POLICY kit_label_queue_anon_update ON public.kit_label_queue
    FOR UPDATE USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS kit_label_queue_anon_delete ON public.kit_label_queue;
  CREATE POLICY kit_label_queue_anon_delete ON public.kit_label_queue
    FOR DELETE USING (true);
END $$;

COMMENT ON TABLE public.kit_label_queue IS
  'Pending kit item labels queued from mobile (or admin) for Brother QL print.';
COMMENT ON COLUMN public.kit_label_queue.printed_at IS
  'Set when the label has been printed; null = still in queue.';
