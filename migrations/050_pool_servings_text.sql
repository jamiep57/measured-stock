-- =====================================================================
-- 050 — Preserve fraction text for volume pool servings
-- =====================================================================
-- Authors enter pool use as a fraction of one case/SKU (e.g. 1/24, 1/12).
-- Numeric pool_servings_per_unit remains the recon field (servings per
-- stock unit); pool_servings_text keeps the typed fraction for display.
--
-- Apply: AFTER 049. Idempotent: yes.
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pool_servings_text text;

COMMENT ON COLUMN public.products.pool_servings_text IS
  'Author-entered pool fraction of one case/SKU per serving (e.g. 1/24). Numeric pool_servings_per_unit is used for calculations.';

-- Backfill text from existing servings × units_per_case when possible.
UPDATE public.products
SET pool_servings_text = CASE
  WHEN pool_servings_per_unit IS NULL THEN NULL
  WHEN COALESCE(units_per_case, 1) * pool_servings_per_unit = 1 THEN '1'
  WHEN COALESCE(units_per_case, 1) * pool_servings_per_unit > 0
    THEN '1/' || trim(to_char(COALESCE(units_per_case, 1) * pool_servings_per_unit, 'FM999999999999990.##############'))
  ELSE NULL
END
WHERE pool_name IS NOT NULL
  AND pool_servings_per_unit IS NOT NULL
  AND (pool_servings_text IS NULL OR btrim(pool_servings_text) = '');
