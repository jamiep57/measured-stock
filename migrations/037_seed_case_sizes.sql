-- =====================================================================
-- 037 — Seed case_sizes from product library + link products
-- =====================================================================
-- Populates the global case_sizes catalogue from every distinct pack size
-- found on products, then sets products.case_size_id. Normalises spacing
-- and casing so "12 x 330ml" and "12x330ml" map to the same entry.
--
-- Apply: AFTER 036. Idempotent: yes.
-- =====================================================================

-- Expand products.stock_unit if migration 033 was not applied yet.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'products'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%stock_unit%'
  LOOP
    EXECUTE format('ALTER TABLE public.products DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.products
  ADD CONSTRAINT products_stock_unit_check
  CHECK (stock_unit IS NULL OR stock_unit IN ('case', 'single', 'bottle', 'keg', 'unit'));

-- Normalise pack-size labels for matching (lowercase, strip spaces, × → x).
CREATE OR REPLACE FUNCTION public.norm_case_size_label(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(trim(coalesce(t, '')), '\s+', '', 'g'),
      '×', 'x', 'g'
    )
  );
$$;

-- Optional aliases where product text differs from catalogue label norm.
CREATE OR REPLACE FUNCTION public.norm_case_size_alias(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE public.norm_case_size_label(t)
    WHEN '50l' THEN '50lkeg'
    WHEN '17.27' THEN '17.27l'
    ELSE public.norm_case_size_label(t)
  END;
$$;

-- ---------- Catalogue entries (every norm seen on products as of 2026-06) --
INSERT INTO public.case_sizes (label, units_per_case, stock_unit, servings_per_unit, sort_order, notes)
VALUES
  -- Packaged beer / cider / RTD cans
  ('24×330ml',           24, 'case',   1,  10, 'Standard soft drink / beer can case'),
  ('24×330ml Cans',      24, 'case',   1,  11, 'Alias label — same as 24×330ml'),
  ('12×330ml',           12, 'case',   1,  20, '12-pack cans'),
  ('12×440ml Cans',      12, 'case',   1,  21, 'Large can format'),
  ('24×440ml Cans',      24, 'case',   1,  22, '24 large cans'),
  ('24×500ml Cans',      24, 'case',   1,  23, 'Cider / large format cans'),
  ('12×250ml',           12, 'case',   1,  30, 'Small cans / RTD'),
  ('12×250ml Cans',      12, 'case',   1,  31, 'RTD spirit mixers / seltzers'),
  ('24×250ml',           24, 'case',   1,  32, '24 small cans'),
  ('24×200ml',           24, 'case',   1,  33, NULL),
  ('24×150ml',           24, 'case',   1,  34, 'Small juice / mixer'),
  ('12×125ml Cans',      12, 'case',   1,  35, 'Cocktail cans'),
  ('12×500ml',           12, 'case',   1,  36, 'Large bottle case'),
  ('12×1L',              12, 'case',   1,  37, '1L bottle case'),
  ('8×1L',                8, 'case',   1,  38, 'Juice / smoothie case'),
  ('4×1L',                4, 'case',   1,  39, 'Cocktail batching'),
  ('4×1000ml',            4, 'case',   1,  40, 'Same as 4×1L — alternate label'),
  ('4×2.5L',              4, 'case',   1,  41, 'Batch cocktail'),
  ('5×1kg',               5, 'case',   1,  50, 'Bulk ingredients'),
  -- Wine
  ('12×187ml Cans',      12, 'case',   1,  60, 'Wine cans'),
  ('12×187ml PET',       12, 'case',   1,  61, 'Wine PET bottles'),
  ('16×750ml',           16, 'case',  30,  62, 'Wine bottles — servings per 750ml bottle'),
  ('6×750ml',             6, 'case',  30,  63, 'Wine 6-pack'),
  ('12',                 12, 'case',   1,  64, 'Generic 12-count (wine)'),
  ('24',                 24, 'case',   1,  65, 'Generic 24-count'),
  -- Spirits (per bottle)
  ('70cl',                1, 'bottle', 28,  70, 'Standard 700ml spirit bottle — 28 × 25ml shots'),
  ('1L',                  1, 'bottle', 40,  71, '1 litre spirit bottle — 40 × 25ml shots'),
  ('750ml',               1, 'bottle', 30,  72, 'Wine / spirit 750ml'),
  ('6×700ml',             6, 'case',    28,  73, 'Supplier case of 6 × 700ml bottles'),
  ('6×1L',                6, 'case',    40,  74, 'Supplier case of 6 × 1L bottles'),
  ('6',                   6, 'case',    28,  75, 'Generic 6-pack spirits'),
  -- Kegs / draught
  ('50L Keg',             1, 'keg',    88,  80, 'Standard 50L keg — ~88 UK pints'),
  ('30L Keg',             1, 'keg',    52,  81, '30L keg — ~52 UK pints'),
  ('9 Gal',               1, 'keg',    72,  82, 'Traditional cask — 9 gallon'),
  ('20L KeyKeg',          1, 'keg',    35,  83, '20L KeyKeg'),
  ('20Ltr BIB',           1, 'unit',   NULL, 84, 'Bag-in-box 20L'),
  ('5L BIB',              1, 'unit',   NULL, 85, 'Bag-in-box 5L'),
  ('10L',                 1, 'unit',   NULL, 86, 'Beer gas / small vessel'),
  ('20L',                 1, 'unit',   NULL, 87, 'Water container / bulk liquid'),
  -- Singles / garnish / consumables
  ('150ml',               1, 'bottle',  6,  90, 'Small cocktail bottle'),
  ('360ml',               1, 'unit',   NULL, 91, 'Cocktail component'),
  ('1kg',                 1, 'unit',   NULL, 92, 'Garnish / dry goods'),
  ('12kg',                1, 'unit',   NULL, 93, 'Ice block'),
  ('1,000 Half Pint Cups',1000,'unit', NULL, 94, 'Disposable cups'),
  ('17.27L',              1, 'unit',   NULL, 95, 'Batch cocktail volume')
ON CONFLICT (label) DO UPDATE SET
  units_per_case    = EXCLUDED.units_per_case,
  stock_unit        = EXCLUDED.stock_unit,
  servings_per_unit = EXCLUDED.servings_per_unit,
  sort_order        = EXCLUDED.sort_order,
  notes             = COALESCE(EXCLUDED.notes, public.case_sizes.notes);

-- Link products to catalogue entries (normalised match + aliases).
UPDATE public.products p
SET
  case_size_id = cs.id,
  case_size    = cs.label
FROM public.case_sizes cs
WHERE p.case_size IS NOT NULL
  AND trim(p.case_size) <> ''
  AND public.norm_case_size_alias(p.case_size) = public.norm_case_size_label(cs.label);

-- Align stock_unit from catalogue where product has no explicit unit.
UPDATE public.products p
SET stock_unit = cs.stock_unit
FROM public.case_sizes cs
WHERE p.case_size_id = cs.id
  AND (p.stock_unit IS NULL OR trim(p.stock_unit) = '');

-- Align units_per_case when unset or clearly wrong (0 / null) for case-sized packs.
UPDATE public.products p
SET units_per_case = cs.units_per_case
FROM public.case_sizes cs
WHERE p.case_size_id = cs.id
  AND cs.stock_unit = 'case'
  AND (p.units_per_case IS NULL OR p.units_per_case <= 0);

-- =====================================================================
-- DONE. Verify:
--   SELECT label, units_per_case, stock_unit, servings_per_unit FROM case_sizes ORDER BY sort_order, label;
--   SELECT COUNT(*) FILTER (WHERE case_size_id IS NOT NULL) AS linked,
--          COUNT(*) FILTER (WHERE case_size IS NOT NULL AND trim(case_size) <> '') AS with_text
--   FROM products;
-- =====================================================================
