-- =====================================================================
-- 006 — All fractional quantity columns on event_products
-- =====================================================================
-- Run on dev/prod if backfill fails with:
--   invalid input syntax for type integer: "5.8"
-- Safe to re-run (ALTER … TYPE is idempotent when already numeric).
-- =====================================================================

ALTER TABLE public.event_products
  ALTER COLUMN qty_ordered       TYPE numeric USING qty_ordered::numeric,
  ALTER COLUMN invoice_qty       TYPE numeric USING invoice_qty::numeric,
  ALTER COLUMN delivered_qty     TYPE numeric USING delivered_qty::numeric,
  ALTER COLUMN damaged_qty       TYPE numeric USING damaged_qty::numeric,
  ALTER COLUMN already_in_stock  TYPE numeric USING already_in_stock::numeric;

-- Verify:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'event_products'
--   AND column_name IN ('qty_ordered','invoice_qty','delivered_qty','damaged_qty','already_in_stock');
