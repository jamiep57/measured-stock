-- =====================================================================
-- 034 — Convert multi-pack spirits to per-bottle units (70cl / 1L)
-- =====================================================================
-- Spirits were stored as supplier cases (e.g. 6x700ml = 168 shots) while
-- stock counts and recipes work better in individual bottles (70cl = 28
-- shots). This migration:
--   1. Rewrites product case_size to the bottle size (70cl, 1L …)
--   2. Sets stock_unit = 'bottle' and units_per_case = 1
--   3. Scales all stored quantities × bottles-per-case so totals are unchanged
--   4. Converts per-bottle pricing on the product row
--   5. Rewrites recipe ingredient qty from case- or legacy bottle-fractions
--      to bottle fractions (1/28 per single for 700ml)
--
-- Supplier pack sizes on product_suppliers are left unchanged (still 6x700ml).
-- Apply: AFTER 033. Idempotent: yes (skips products already at bottle size).
-- =====================================================================

-- ---------- 1. Identify multi-pack spirit bottles to migrate ------------
CREATE TEMP TABLE IF NOT EXISTS _spirit_bottle_migrate ON COMMIT DROP AS
SELECT
  p.id,
  p.name,
  p.case_size AS old_case_size,
  coalesce(
    (regexp_match(lower(trim(p.case_size)), '^(\d+(?:\.\d+)?)\s*x'))[1]::numeric,
    nullif(p.units_per_case, 0),
    1
  )::numeric AS bpc,
  CASE
    WHEN lower(p.case_size) ~ '1\s*l|100cl|1\s*litre' THEN '1L'
    WHEN lower(p.case_size) ~ '700\s*ml|70\s*cl'     THEN '70cl'
    WHEN lower(p.case_size) ~ '750\s*ml|75\s*cl'     THEN '75cl'
    ELSE '70cl'
  END AS new_case_size,
  CASE
    WHEN lower(p.case_size) ~ '1\s*l|100cl|1\s*litre' THEN 40
    WHEN lower(p.case_size) ~ '750\s*ml|75\s*cl'     THEN 30
    ELSE 28
  END::numeric AS spb
FROM public.products p
JOIN public.categories c ON c.id = p.category_id
WHERE c.colour_key = 'spirits'
  AND lower(trim(coalesce(p.case_size, ''))) ~ '^\d+\s*x\s*\d'
  AND lower(p.case_size) !~ 'x\s*250|x\s*330|x\s*200|x\s*275';

-- Nothing to do on empty catalogues.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _spirit_bottle_migrate) THEN
    RAISE NOTICE '034: no multi-pack spirit products to migrate';
    RETURN;
  END IF;
END $$;

-- Ensure loose-singles columns exist (021 / 022 / 031 — no-op if already applied).
ALTER TABLE public.delivery_lines ADD COLUMN IF NOT EXISTS singles numeric NOT NULL DEFAULT 0;
ALTER TABLE public.transfer_lines ADD COLUMN IF NOT EXISTS singles numeric NOT NULL DEFAULT 0;
ALTER TABLE public.wastage_lines  ADD COLUMN IF NOT EXISTS singles numeric NOT NULL DEFAULT 0;

-- ---------- 2. Scale stored quantities (stored unit → bottles) ----------
-- Helper: combined stored cases = qty + singles / units_per_case

UPDATE public.event_products ep SET
  qty_ordered        = ep.qty_ordered        * m.bpc,
  invoice_qty        = ep.invoice_qty        * m.bpc,
  delivered_qty      = ep.delivered_qty      * m.bpc,
  damaged_qty        = ep.damaged_qty        * m.bpc,
  already_in_stock   = ep.already_in_stock   * m.bpc,
  order_price_override = CASE WHEN ep.order_price_override IS NOT NULL
                         THEN ep.order_price_override / m.bpc ELSE NULL END
FROM _spirit_bottle_migrate m
WHERE ep.product_id = m.id;

UPDATE public.distribution d SET
  qty_allocated = d.qty_allocated * m.bpc
FROM _spirit_bottle_migrate m
WHERE d.product_id = m.id;

UPDATE public.stock_count_lines scl SET
  cases = (scl.cases + coalesce(scl.singles, 0) / nullif(p.units_per_case, 0)) * m.bpc,
  singles = 0
FROM _spirit_bottle_migrate m
JOIN public.products p ON p.id = m.id
WHERE scl.product_id = m.id;

UPDATE public.closing_stock cs SET
  closing_cases = (cs.closing_cases + coalesce(cs.closing_singles, 0) / nullif(p.units_per_case, 0)) * m.bpc,
  closing_singles = 0,
  close_count = cs.close_count * m.bpc,
  return_amount = cs.return_amount * m.bpc,
  carried_over = cs.carried_over * m.bpc
FROM _spirit_bottle_migrate m
JOIN public.products p ON p.id = m.id
WHERE cs.product_id = m.id;

UPDATE public.delivery_lines dl SET
  qty = (dl.qty + coalesce(dl.singles, 0) / nullif(p.units_per_case, 0)) * m.bpc,
  singles = 0,
  damaged_qty = dl.damaged_qty * m.bpc
FROM _spirit_bottle_migrate m
JOIN public.products p ON p.id = m.id
WHERE dl.product_id = m.id;

UPDATE public.transfer_lines tl SET
  qty = (tl.qty + coalesce(tl.singles, 0) / nullif(p.units_per_case, 0)) * m.bpc,
  singles = 0
FROM _spirit_bottle_migrate m
JOIN public.products p ON p.id = m.id
WHERE tl.product_id = m.id;

UPDATE public.wastage_lines wl SET
  qty = (wl.qty + coalesce(wl.singles, 0) / nullif(p.units_per_case, 0)) * m.bpc,
  singles = 0
FROM _spirit_bottle_migrate m
JOIN public.products p ON p.id = m.id
WHERE wl.product_id = m.id;

UPDATE public.topup_lines tl SET
  qty = tl.qty * m.bpc,
  damaged_qty = tl.damaged_qty * m.bpc
FROM _spirit_bottle_migrate m
WHERE tl.product_id = m.id;

UPDATE public.warehouse_stock ws SET
  qty_on_hand = ws.qty_on_hand * m.bpc
FROM _spirit_bottle_migrate m
WHERE ws.product_id = m.id;

UPDATE public.supplier_return_lines srl SET
  qty = (srl.qty + coalesce(srl.singles, 0) / nullif(p.units_per_case, 0)) * m.bpc,
  singles = 0
FROM _spirit_bottle_migrate m
JOIN public.products p ON p.id = m.id
WHERE srl.product_id = m.id;

-- ---------- 3. Products: bottle size, stock unit, per-bottle pricing ---
UPDATE public.products p SET
  case_size       = m.new_case_size,
  units_per_case  = 1,
  stock_unit      = 'bottle',
  case_price      = CASE WHEN p.case_price IS NOT NULL THEN p.case_price / m.bpc ELSE NULL END,
  unit_price      = CASE
                      WHEN p.unit_price IS NOT NULL THEN p.unit_price / m.bpc
                      WHEN p.case_price IS NOT NULL THEN p.case_price / m.bpc
                      ELSE NULL
                    END
FROM _spirit_bottle_migrate m
WHERE p.id = m.id;

-- ---------- 4. Recipe ingredients: case/legacy fractions → bottle ------
-- Case-fraction (qty < 0.015, e.g. 1/168): servings = qty × bpc × spb
-- Legacy 24-shot bottle fraction (qty ≥ 0.015, e.g. 1/24): servings = qty × 24
UPDATE public.recipe_ingredients ri SET
  qty = CASE
    WHEN ri.qty > 0 AND ri.qty < 0.015
         AND abs(ri.qty * m.bpc * m.spb - round(ri.qty * m.bpc * m.spb)) < 0.001
    THEN round(ri.qty * m.bpc * m.spb) / m.spb
    WHEN ri.qty > 0
         AND abs(ri.qty * 24 - round(ri.qty * 24)) < 0.001
    THEN round(ri.qty * 24) / m.spb
    ELSE ri.qty * m.bpc
  END
FROM _spirit_bottle_migrate m
WHERE ri.pool_name IS NULL
  AND ri.product_name IS NOT NULL
  AND lower(trim(ri.product_name)) = lower(trim(m.name));

-- ---------- 5. Spirits already at bottle size (e.g. Smirnoff 70cl) --------
UPDATE public.products p SET stock_unit = 'bottle'
FROM public.categories c
WHERE c.id = p.category_id
  AND c.colour_key = 'spirits'
  AND p.stock_unit IS NULL
  AND lower(trim(coalesce(p.case_size, ''))) !~ '^\d+\s*x\s*\d'
  AND lower(p.case_size) ~ '70\s*cl|75\s*cl|^1\s*l|100cl';

-- =====================================================================
-- DONE. Verify:
--   SELECT name, case_size, units_per_case, stock_unit, case_price
--     FROM products WHERE stock_unit = 'bottle' ORDER BY name;
--   SELECT ri.product_name, ri.qty, p.case_size
--     FROM recipe_ingredients ri JOIN products p ON p.name = ri.product_name
--     WHERE p.stock_unit = 'bottle' AND ri.pool_name IS NULL LIMIT 20;
-- =====================================================================
