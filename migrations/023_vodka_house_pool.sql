-- =====================================================================
-- 023 — Convert Finlandia vodka to the "House Vodka" volume pool
-- =====================================================================
-- The six vodka recipes pointed at the single product "Finlandia Vodka"
-- (6x700ml) using case-fraction quantities that were actually entered as
-- fractions of ONE BOTTLE (single = 1/24, double = 1/12). The projection
-- treats recipe qty as a fraction of a full 6-bottle CASE, so every vodka
-- sale pulled ~6x too much stock (projected 555.6 cases vs 40.8 available).
-- The 1L SKU ("Finlandia Vodka (1L)") was also invisible to the projection
-- because it is a separate product name with no pool linking it.
--
-- This migration moves vodka onto a volume pool (per migration 022):
--   1. Tags both Finlandia SKUs into the "House Vodka" pool, declaring how
--      many 25ml servings each bottle yields (700ml -> 28, 1L -> 40).
--   2. Rewrites the six vodka recipe ingredients to reference the pool
--      instead of the product, with qty = SERVINGS per sale
--      (single / shot = 1, double = 2).
--
-- Apply: AFTER 022_volume_pools. Idempotent: yes (re-running is a no-op).
-- =====================================================================

-- ---------- 1. pool membership --------------------------------------
UPDATE public.products
  SET pool_name = 'House Vodka', pool_servings_per_unit = 28
  WHERE name = 'Finlandia Vodka' AND case_size = '6x700ml';

UPDATE public.products
  SET pool_name = 'House Vodka', pool_servings_per_unit = 40
  WHERE name = 'Finlandia Vodka (1L)';

-- ---------- 2. recipes: product -> pool servings --------------------
-- Doubles pull 2 servings; singles and shots pull 1.
UPDATE public.recipe_ingredients ri
  SET pool_name    = 'House Vodka',
      product_name = NULL,
      qty          = CASE WHEN r.till_item ILIKE '%(double)%' THEN 2 ELSE 1 END
  FROM public.recipes r
  WHERE ri.recipe_id = r.id
    AND ri.product_name = 'Finlandia Vodka';

-- =====================================================================
-- DONE. Verify:
--   SELECT name, case_size, pool_name, pool_servings_per_unit
--     FROM products WHERE pool_name = 'House Vodka';
--   SELECT r.till_item, ri.pool_name, ri.qty
--     FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id
--     WHERE ri.pool_name = 'House Vodka' ORDER BY r.till_item;
-- =====================================================================
