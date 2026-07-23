-- =====================================================================
-- 043 — V5 pack authority: case_sizes extensions + stock/purchase FKs
-- =====================================================================
-- Non-breaking to V4. Adds catalogue fields and FK columns; backfills
-- from existing case_size_id / pack_size text. Apply BEFORE V5 code.
-- Idempotent: yes.
-- =====================================================================

-- ---------- Extend case_sizes ----------------------------------------

ALTER TABLE public.case_sizes
  ADD COLUMN IF NOT EXISTS cases_per_pallet numeric CHECK (cases_per_pallet IS NULL OR cases_per_pallet > 0);

ALTER TABLE public.case_sizes
  ADD COLUMN IF NOT EXISTS layers_per_pallet integer CHECK (layers_per_pallet IS NULL OR layers_per_pallet > 0);

ALTER TABLE public.case_sizes
  ADD COLUMN IF NOT EXISTS cases_per_layer numeric CHECK (cases_per_layer IS NULL OR cases_per_layer > 0);

-- stock = assignable as product stock pack; purchase = supplier offers only; both = either
ALTER TABLE public.case_sizes
  ADD COLUMN IF NOT EXISTS pack_usage text NOT NULL DEFAULT 'both'
    CHECK (pack_usage IN ('stock', 'purchase', 'both'));

COMMENT ON COLUMN public.case_sizes.pack_usage IS
  'stock = product stock pack only; purchase = supplier purchase pack only; both = either role.';

-- Mark multi-pack spirit supplier SKUs as purchase-only (never product stock).
UPDATE public.case_sizes
SET pack_usage = 'purchase'
WHERE lower(label) ~ '^\d+\s*[×x]\s*\d'
  AND stock_unit = 'case'
  AND lower(label) ~ '700|70\s*cl|750|75\s*cl|1\s*l|100cl';

-- Expand stock_unit on case_sizes to include cylinder
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'case_sizes'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%stock_unit%'
  LOOP
    EXECUTE format('ALTER TABLE public.case_sizes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.case_sizes
  ADD CONSTRAINT case_sizes_stock_unit_check
  CHECK (stock_unit IN ('case', 'single', 'bottle', 'keg', 'unit', 'cylinder'));

-- ---------- Products: stock_case_size_id -------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_case_size_id uuid REFERENCES public.case_sizes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_stock_case_size ON public.products(stock_case_size_id);

COMMENT ON COLUMN public.products.stock_case_size_id IS
  'V5: canonical pack for stock counts (how we count). Prefer bottle rows for spirits/wine.';

-- Backfill from case_size_id first, then text match
UPDATE public.products p
SET stock_case_size_id = p.case_size_id
WHERE p.stock_case_size_id IS NULL
  AND p.case_size_id IS NOT NULL;

-- Ensure norm helpers exist (from 036_037)
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

UPDATE public.products p
SET stock_case_size_id = cs.id
FROM public.case_sizes cs
WHERE p.stock_case_size_id IS NULL
  AND p.case_size IS NOT NULL
  AND trim(p.case_size) <> ''
  AND public.norm_case_size_alias(p.case_size) = public.norm_case_size_label(cs.label)
  AND cs.pack_usage IN ('stock', 'both');

-- ---------- Product suppliers: purchase_case_size_id -------------------

ALTER TABLE public.product_suppliers
  ADD COLUMN IF NOT EXISTS purchase_case_size_id uuid REFERENCES public.case_sizes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_suppliers_purchase_case_size
  ON public.product_suppliers(purchase_case_size_id);

COMMENT ON COLUMN public.product_suppliers.purchase_case_size_id IS
  'V5: supplier purchase pack (replaces pack_size text over time).';

UPDATE public.product_suppliers ps
SET purchase_case_size_id = cs.id
FROM public.case_sizes cs
WHERE ps.purchase_case_size_id IS NULL
  AND coalesce(trim(ps.pack_size), '') <> ''
  AND public.norm_case_size_alias(ps.pack_size) = public.norm_case_size_label(cs.label);

-- Fall back to product case_size when offer pack_size empty
UPDATE public.product_suppliers ps
SET purchase_case_size_id = cs.id
FROM public.products p
JOIN public.case_sizes cs ON public.norm_case_size_alias(p.case_size) = public.norm_case_size_label(cs.label)
WHERE ps.product_id = p.id
  AND ps.purchase_case_size_id IS NULL
  AND coalesce(trim(ps.pack_size), '') = ''
  AND p.case_size IS NOT NULL
  AND trim(p.case_size) <> '';

-- ---------- Sync trigger: stock_case_size_id → legacy columns for V4 ---

CREATE OR REPLACE FUNCTION public.sync_product_from_stock_case_size()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cs record;
BEGIN
  IF NEW.stock_case_size_id IS NOT NULL THEN
    SELECT label, units_per_case, stock_unit, servings_per_unit
      INTO cs
      FROM public.case_sizes
     WHERE id = NEW.stock_case_size_id;
    IF FOUND THEN
      NEW.case_size_id := NEW.stock_case_size_id;
      NEW.case_size := cs.label;
      NEW.units_per_case := cs.units_per_case;
      NEW.stock_unit := cs.stock_unit;
    END IF;
  ELSIF NEW.case_size_id IS NOT NULL AND NEW.stock_case_size_id IS NULL THEN
    NEW.stock_case_size_id := NEW.case_size_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_sync_stock_case_size ON public.products;
CREATE TRIGGER trg_products_sync_stock_case_size
  BEFORE INSERT OR UPDATE OF stock_case_size_id, case_size_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_from_stock_case_size();

-- =====================================================================
-- Audit (run manually before/after):
--   SELECT name, case_size, stock_case_size_id, case_size_id FROM products
--     WHERE stock_case_size_id IS NULL AND case_size IS NOT NULL LIMIT 20;
--   SELECT ps.id, ps.pack_size, ps.purchase_case_size_id FROM product_suppliers ps
--     WHERE purchase_case_size_id IS NULL AND pack_size <> '' LIMIT 20;
-- =====================================================================
