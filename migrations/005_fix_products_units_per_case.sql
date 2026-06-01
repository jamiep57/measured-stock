-- =====================================================================
-- 005 — Allow fractional units_per_case on products
-- =====================================================================
-- V4 stores unitsPerSku as a float (e.g. 52.8 for partial-keg pours).
-- Run this on dev/prod if 001 was already applied with integer type.
-- Idempotent: ALTER TYPE is safe to re-run.
-- =====================================================================

ALTER TABLE public.products
  ALTER COLUMN units_per_case TYPE numeric
  USING units_per_case::numeric;
