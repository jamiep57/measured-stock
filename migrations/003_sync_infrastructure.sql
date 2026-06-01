-- =====================================================================
-- 003 — Sync infrastructure
-- =====================================================================
-- Adds the bookkeeping tables that let the api/sync-event.js function
-- project changes from stock_events (the legacy V4 blob table) into the
-- v2 relational tables continuously and idempotently.
--
-- Adds:
--   - public.legacy_id_map        — maps V4 short ids (e.g. "p16",
--                                   "mo95nl29jb46o") to v2 uuids
--   - public.system_sync_state    — singleton-ish row for global syncs
--                                   like __recipes__
--   - events.synced_at            — when this event was last successfully
--                                   rebuilt from its blob
--   - events.source_updated_at    — the stock_events.updated_at that the
--                                   current v2 rows reflect (used by the
--                                   catch-up worker to find stale rows)
--   - events.legacy_id            — the original V4 short id, so the
--                                   sync function can find this row by it
--
-- Apply: AFTER 001 and 002
-- Idempotent: yes
-- =====================================================================

-- ---------- legacy_id_map -------------------------------------------
-- v2_table: destination table name ('products', 'bars', 'recipients',
--           'event_products', 'stock_counts', 'transfers', etc.)
-- legacy_id: the V4 short id from inside the blob (e.g. "p16")
-- scope_id:  the legacy event id when the legacy id is only unique
--            within one event; '__global__' for cross-event uniqueness
--            (products, categories, suppliers, recipes)
-- new_id:    the uuid that landed in the destination table

CREATE TABLE IF NOT EXISTS public.legacy_id_map (
  v2_table    text         NOT NULL,
  legacy_id   text         NOT NULL,
  scope_id    text         NOT NULL DEFAULT '__global__',
  new_id      uuid         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (v2_table, legacy_id, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_id_map_scope
  ON public.legacy_id_map (v2_table, scope_id);

-- ---------- system_sync_state ---------------------------------------
-- For global syncs that aren't event-scoped (e.g. the global recipes
-- library, bug reports). One row per "system" key.

CREATE TABLE IF NOT EXISTS public.system_sync_state (
  key                 text        PRIMARY KEY,
  synced_at           timestamptz,
  source_updated_at   timestamptz,
  last_error          text,
  last_error_at       timestamptz
);

-- ---------- events: sync bookkeeping columns ------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS legacy_id           text,
  ADD COLUMN IF NOT EXISTS synced_at           timestamptz,
  ADD COLUMN IF NOT EXISTS source_updated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error     text,
  ADD COLUMN IF NOT EXISTS last_sync_error_at  timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_legacy_id
  ON public.events (legacy_id)
  WHERE legacy_id IS NOT NULL;

-- =====================================================================
-- Enable Row Level Security on the new tables (policies added by 004).
-- =====================================================================
ALTER TABLE public.legacy_id_map     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_sync_state ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Sync-lag monitor query (run anytime to spot stale events):
--
--   SELECT e.legacy_id, e.name, e.synced_at, e.source_updated_at,
--          se.updated_at AS blob_updated_at,
--          se.updated_at - COALESCE(e.source_updated_at, 'epoch'::timestamptz)
--            AS lag
--   FROM public.events e
--   LEFT JOIN public.stock_events se ON se.id = e.legacy_id
--   WHERE e.legacy_id IS NOT NULL
--   ORDER BY lag DESC NULLS FIRST;
--
-- A healthy system shows lag < a few seconds.
-- =====================================================================
