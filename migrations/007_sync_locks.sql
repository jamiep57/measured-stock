-- =====================================================================
-- 007 — Per-event sync mutex (sync_locks)
-- =====================================================================
-- Background:
--   triggerSyncEvent in V4 fires a fire-and-forget POST to /api/sync-event
--   on every blob save. With bursty edits (or two open tabs) two sync
--   runs can overlap. Each run does a wipe-then-re-insert of per-event
--   children (bars, recipients, counts, distribution, ...), so the
--   second run can delete UUIDs the first run already captured in an
--   in-memory map — yielding errors like:
--
--     INSERT stock_count_lines 409: violates foreign key constraint
--     stock_count_lines_bar_id_fkey
--
-- Fix:
--   Serialize syncEvent per legacy_id with a row in public.sync_locks.
--   Acquisition is a single INSERT with
--     Prefer: resolution=ignore-duplicates
--   (i.e. ON CONFLICT DO NOTHING). If the returned representation has
--   no rows, the lock is held by another worker and the caller bails
--   out as a no-op. Stale locks are cleaned up by checking expires_at.
--
-- Apply: AFTER 003
-- Idempotent: yes
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.sync_locks (
  scope_key    text         PRIMARY KEY,
  acquired_at  timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL DEFAULT (now() + interval '90 seconds'),
  owner        text
);

CREATE INDEX IF NOT EXISTS idx_sync_locks_expires_at
  ON public.sync_locks (expires_at);

-- Sweep expired locks. Called opportunistically by the application
-- before acquisition; also safe to schedule via cron if desired.
CREATE OR REPLACE FUNCTION public.reap_sync_locks() RETURNS integer
LANGUAGE sql AS $$
  WITH d AS (
    DELETE FROM public.sync_locks
    WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;

-- RLS: open policy mirroring the rest of the sync infrastructure.
-- The service-role key bypasses RLS anyway; this matches 003/004.
ALTER TABLE public.sync_locks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sync_locks'
      AND policyname = 'sync_locks_all'
  ) THEN
    CREATE POLICY sync_locks_all ON public.sync_locks
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END$$;
