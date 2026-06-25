-- =====================================================================
-- 037 fix — Expand products.stock_unit + finish case_size linking
-- =====================================================================
-- Run this if 036_037 failed on products_stock_unit_check (keg not allowed).
-- Safe to re-run. Completes product linking if case_sizes already seeded.
-- =====================================================================

-- Drop every CHECK constraint on products.stock_unit, then re-add with keg/single.
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

-- Re-link products (norm functions from 037 must already exist).
UPDATE public.products p
SET
  case_size_id = cs.id,
  case_size    = cs.label
FROM public.case_sizes cs
WHERE p.case_size IS NOT NULL
  AND trim(p.case_size) <> ''
  AND public.norm_case_size_alias(p.case_size) = public.norm_case_size_label(cs.label);

UPDATE public.products p
SET stock_unit = cs.stock_unit
FROM public.case_sizes cs
WHERE p.case_size_id = cs.id
  AND (p.stock_unit IS NULL OR trim(p.stock_unit) = '');

UPDATE public.products p
SET units_per_case = cs.units_per_case
FROM public.case_sizes cs
WHERE p.case_size_id = cs.id
  AND cs.stock_unit = 'case'
  AND (p.units_per_case IS NULL OR p.units_per_case <= 0);
