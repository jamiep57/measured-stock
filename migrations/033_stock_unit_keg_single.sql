-- =====================================================================
-- 033 — Expand stock_unit options (keg, single)
-- =====================================================================
-- Apply: AFTER 032. Idempotent: yes.
-- =====================================================================

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_unit_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_stock_unit_check
  CHECK (stock_unit IS NULL OR stock_unit IN ('case', 'single', 'bottle', 'keg', 'unit'));

COMMENT ON COLUMN public.products.stock_unit IS
  'How stock is counted: case, single, bottle, keg, or unit. NULL = auto-detect.';
