-- =====================================================================
-- 022 — Volume pools (combine interchangeable SKUs for till mapping)
-- =====================================================================
-- Multiple products (e.g. Vodka 70cl + Vodka 1L) can share a pool_name.
-- Each product declares pool_servings_per_unit (servings one bottle yields).
-- Recipe ingredients can reference a pool instead of a single product;
-- qty on a pool row is servings consumed per till sale.
--
-- Apply: AFTER 021. Idempotent: yes.
-- =====================================================================

-- ---------- products: pool membership ---------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pool_name text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pool_servings_per_unit numeric
    CHECK (pool_servings_per_unit IS NULL OR pool_servings_per_unit > 0);

-- ---------- recipe_ingredients: pool or product -----------------------

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS pool_name text;

ALTER TABLE public.recipe_ingredients
  ALTER COLUMN product_name DROP NOT NULL;

ALTER TABLE public.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_ingredients_product_or_pool_chk;

ALTER TABLE public.recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_product_or_pool_chk
  CHECK (
    (product_name IS NOT NULL AND pool_name IS NULL)
    OR (pool_name IS NOT NULL AND product_name IS NULL)
  );

-- =====================================================================
-- DONE. Verify:
--   SELECT name, pool_name, pool_servings_per_unit FROM products
--     WHERE pool_name IS NOT NULL ORDER BY pool_name, name;
--   SELECT pool_name, product_name, qty FROM recipe_ingredients
--     WHERE pool_name IS NOT NULL;
-- =====================================================================
