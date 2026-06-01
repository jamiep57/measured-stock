-- =====================================================================
-- 006 — Allow fractional already_in_stock on event_products
-- =====================================================================
-- V4 opening stock can be fractional (e.g. alreadyInStock: 5.8).
-- Run on dev/prod if 002 was applied with integer type.
-- =====================================================================

ALTER TABLE public.event_products
  ALTER COLUMN already_in_stock TYPE numeric
  USING already_in_stock::numeric;
