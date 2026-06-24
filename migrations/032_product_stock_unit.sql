-- =====================================================================
-- 032 — Product stock unit (how stock is counted globally)
-- =====================================================================
-- Each product declares how quantities are entered and displayed:
--   case   — whole cases + loose singles (default)
--   bottle — decimal bottles (spirits)
--   unit   — decimal individual units (kegs, singles, etc.)
--
-- NULL = auto-detect in the app (legacy spirits heuristic until set).
-- Apply: AFTER 031. Idempotent: yes.
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_unit text
    CHECK (stock_unit IS NULL OR stock_unit IN ('case', 'bottle', 'unit'));

COMMENT ON COLUMN public.products.stock_unit IS
  'How stock is counted: case (cases+singles), bottle (decimal bottles), unit (decimal units). NULL = auto-detect.';

-- =====================================================================
-- DONE. Verify:
--   SELECT name, case_size, stock_unit FROM products ORDER BY name LIMIT 20;
-- =====================================================================
