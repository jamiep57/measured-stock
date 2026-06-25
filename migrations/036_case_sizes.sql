-- =====================================================================
-- 036 — Global case sizes catalogue
-- =====================================================================
-- Standard pack/case definitions (e.g. 24x330ml, 6x700ml, 70cl) shared
-- across the product library. Products may link via case_size_id; the
-- legacy case_size text column remains the denormalised label.
--
-- Apply: AFTER 035. Idempotent: yes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.case_sizes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text        NOT NULL UNIQUE,
  units_per_case      numeric     NOT NULL DEFAULT 1 CHECK (units_per_case > 0),
  stock_unit          text        NOT NULL DEFAULT 'case'
                        CHECK (stock_unit IN ('case', 'single', 'bottle', 'keg', 'unit')),
  servings_per_unit   numeric     CHECK (servings_per_unit IS NULL OR servings_per_unit > 0),
  notes               text,
  sort_order          integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.case_sizes IS
  'Global catalogue of standard pack/case sizes used by products.';

COMMENT ON COLUMN public.case_sizes.label IS
  'Display label, e.g. 24x330ml, 6x700ml, 70cl, 50L keg.';

COMMENT ON COLUMN public.case_sizes.units_per_case IS
  'Individual units (cans, bottles, etc.) in one supplier case/SKU.';

COMMENT ON COLUMN public.case_sizes.stock_unit IS
  'How stock is counted for products using this size: case, single, bottle, keg, unit.';

COMMENT ON COLUMN public.case_sizes.servings_per_unit IS
  'Servings one unit yields (e.g. 1 per can, 28 shots per 70cl bottle, 88 pints per keg).';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS case_size_id uuid REFERENCES public.case_sizes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_case_size ON public.products(case_size_id);

-- Row-level security (matches migration 004 pattern).
ALTER TABLE public.case_sizes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_sizes_anon_select ON public.case_sizes;
CREATE POLICY case_sizes_anon_select ON public.case_sizes FOR SELECT USING (true);

DROP POLICY IF EXISTS case_sizes_anon_insert ON public.case_sizes;
CREATE POLICY case_sizes_anon_insert ON public.case_sizes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS case_sizes_anon_update ON public.case_sizes;
CREATE POLICY case_sizes_anon_update ON public.case_sizes FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS case_sizes_anon_delete ON public.case_sizes;
CREATE POLICY case_sizes_anon_delete ON public.case_sizes FOR DELETE USING (true);

-- =====================================================================
-- DONE. Verify:
--   SELECT * FROM case_sizes ORDER BY sort_order, label;
--   SELECT name, case_size, case_size_id FROM products LIMIT 10;
-- =====================================================================
