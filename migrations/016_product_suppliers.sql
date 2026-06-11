-- =====================================================================
-- 016 — Multiple suppliers & prices per product
-- =====================================================================
-- Until now a product had at most ONE supplier (products.supplier_id)
-- and a single case_price / unit_price. This migration introduces a
-- product_suppliers join table so a product can be sourced from several
-- suppliers, each with its own case price, unit price and supplier SKU.
--
-- One row per product is flagged is_preferred = true. The legacy columns
-- products.supplier_id / case_price / unit_price are KEPT and are
-- automatically synced to the preferred supplier's values by a trigger,
-- so every existing report / COGS calc keeps working unchanged.
--
-- Apply: AFTER 001..015
-- Idempotent: yes (CREATE … IF NOT EXISTS, DROP … IF EXISTS, ON CONFLICT)
-- =====================================================================

-- ---------- Table ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_suppliers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid        NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
  supplier_id   uuid        NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  sku           text,
  case_price    numeric,
  unit_price    numeric,
  is_preferred  boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_product  ON public.product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON public.product_suppliers(supplier_id);

-- At most one preferred supplier per product.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_suppliers_preferred
  ON public.product_suppliers(product_id)
  WHERE is_preferred;

-- ---------- Sync the preferred row → products legacy columns ----------
-- Picks the preferred row (or, if none is flagged, the oldest row) and
-- copies its supplier_id / case_price / unit_price onto products. When a
-- product has no supplier rows at all, the legacy columns are nulled.

CREATE OR REPLACE FUNCTION public.sync_product_preferred_supplier(p_product uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  SELECT supplier_id, case_price, unit_price
    INTO r
    FROM public.product_suppliers
   WHERE product_id = p_product
   ORDER BY is_preferred DESC, created_at ASC
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.products
       SET supplier_id = r.supplier_id,
           case_price  = r.case_price,
           unit_price  = r.unit_price
     WHERE id = p_product;
  ELSE
    UPDATE public.products
       SET supplier_id = NULL,
           case_price  = NULL,
           unit_price  = NULL
     WHERE id = p_product;
  END IF;
END;
$$;

-- ---------- Trigger: enforce a single preferred row -------------------
-- Before a row is marked preferred, clear the flag on its siblings so
-- the partial unique index is never violated.

CREATE OR REPLACE FUNCTION public.product_suppliers_enforce_preferred()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_preferred THEN
    UPDATE public.product_suppliers
       SET is_preferred = false
     WHERE product_id = NEW.product_id
       AND id <> NEW.id
       AND is_preferred;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_suppliers_preferred ON public.product_suppliers;
CREATE TRIGGER trg_product_suppliers_preferred
  BEFORE INSERT OR UPDATE OF is_preferred ON public.product_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.product_suppliers_enforce_preferred();

-- ---------- Trigger: keep products legacy columns in sync -------------

CREATE OR REPLACE FUNCTION public.product_suppliers_after_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_product_preferred_supplier(OLD.product_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_product_preferred_supplier(NEW.product_id);
  -- If a row was re-pointed to a different product, refresh the old one too.
  IF TG_OP = 'UPDATE' AND NEW.product_id <> OLD.product_id THEN
    PERFORM public.sync_product_preferred_supplier(OLD.product_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_suppliers_sync ON public.product_suppliers;
CREATE TRIGGER trg_product_suppliers_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.product_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.product_suppliers_after_change();

-- ---------- Backfill from existing single-supplier products -----------
-- Every product that already names a supplier becomes that supplier's
-- preferred row, carrying its current prices + SKU forward.

INSERT INTO public.product_suppliers (product_id, supplier_id, sku, case_price, unit_price, is_preferred)
SELECT id, supplier_id, sku, case_price, unit_price, true
  FROM public.products
 WHERE supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;

-- ---------- Row Level Security (mirror migration 004) -----------------

ALTER TABLE public.product_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_suppliers_anon_select ON public.product_suppliers;
CREATE POLICY product_suppliers_anon_select ON public.product_suppliers FOR SELECT USING (true);

DROP POLICY IF EXISTS product_suppliers_anon_insert ON public.product_suppliers;
CREATE POLICY product_suppliers_anon_insert ON public.product_suppliers FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS product_suppliers_anon_update ON public.product_suppliers;
CREATE POLICY product_suppliers_anon_update ON public.product_suppliers FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_suppliers_anon_delete ON public.product_suppliers;
CREATE POLICY product_suppliers_anon_delete ON public.product_suppliers FOR DELETE USING (true);

-- =====================================================================
-- Verification
-- =====================================================================
--   SELECT p.name, s.name AS supplier, ps.case_price, ps.unit_price, ps.is_preferred
--     FROM public.product_suppliers ps
--     JOIN public.products  p ON p.id = ps.product_id
--     JOIN public.suppliers s ON s.id = ps.supplier_id
--    ORDER BY p.name, ps.is_preferred DESC;
--
-- Confirm legacy columns match the preferred row:
--   SELECT name, supplier_id, case_price, unit_price FROM public.products ORDER BY name;
-- =====================================================================
