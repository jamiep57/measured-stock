-- =====================================================================
-- 021 — Event target revenue
-- =====================================================================
-- Background:
--   The merged app (v2.html → Event Setup) lets the user set a revenue
--   target for a show. The Square panel scales the mapped till sales mix
--   to that target to project per-product consumption, then flags which
--   products run out before the target revenue is reached.
--
--   target_revenue is v2-owned (edited in Event Setup, saved straight to
--   this column). It is a plain numeric in £, NULL when unset.
--
-- Safe to re-run (additive, IF NOT EXISTS).
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS target_revenue numeric;

COMMENT ON COLUMN public.events.target_revenue IS
  'Revenue target for the show (£). v2-owned; drives the Square run-out projection. Never written by the blob sync.';
