-- =====================================================================
-- 008 — Event venue postcode + event-details cutover marker
-- =====================================================================
-- Background:
--   The merged app (v2.html → Event Setup) makes the event details
--   editable directly against the v2 relational tables. As part of that
--   cutover, the blob sync (lib/sync-engine.js → ensureEventRow) no longer
--   overwrites name / venue / start_date / end_date / status once an event
--   exists in v2 — those fields are now v2-owned.
--
--   The blob never carried a structured venue, so we split the address from
--   its postcode: `venue` holds the full (multi-line) address and the new
--   `venue_postcode` column holds the postcode on its own.
--
-- Safe to re-run (additive, IF NOT EXISTS).
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS venue_postcode text;

COMMENT ON COLUMN public.events.venue IS
  'Full venue address (multi-line). v2-owned; only seeded on first sync insert, never overwritten after.';
COMMENT ON COLUMN public.events.venue_postcode IS
  'Venue postcode. v2-owned; never written by the blob sync.';
