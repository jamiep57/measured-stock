-- =====================================================================
-- 056 — Kit barcodes + container contents
-- =====================================================================
-- barcode: scan codes from Current RMS (and wedge scanners via search).
-- is_container: pallet boxes / kitboxes counted as 1 unit with a contents list.
-- kit_container_contents: packing definition (child kit items + qty per container).
--
-- Safe to re-run (IF NOT EXISTS / OR REPLACE).
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_container boolean NOT NULL DEFAULT false;

-- Unique barcodes when set (empty / null allowed on many rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON public.products (barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON public.products (barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS idx_products_is_container
  ON public.products (is_container)
  WHERE is_container = true;

COMMENT ON COLUMN public.products.barcode IS
  'Optional scan code (e.g. Current RMS barcode). Used for kit library search/scan.';
COMMENT ON COLUMN public.products.is_container IS
  'When true, this kit item is a container (pallet box, kitbox): counted as 1 unit with a contents packing list.';

-- ---------- Container contents (BOM / packing list) --------------------

CREATE TABLE IF NOT EXISTS public.kit_container_contents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  child_product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty                   numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (container_product_id, child_product_id),
  CHECK (container_product_id <> child_product_id)
);

CREATE INDEX IF NOT EXISTS idx_kit_container_contents_container
  ON public.kit_container_contents(container_product_id);

CREATE INDEX IF NOT EXISTS idx_kit_container_contents_child
  ON public.kit_container_contents(child_product_id);

COMMENT ON TABLE public.kit_container_contents IS
  'Packing list for kit containers: child items (and qty) inside one container unit.';

-- ---------- RLS (open anon policies, match 004 / 051) -----------------

DO $$
BEGIN
  ALTER TABLE public.kit_container_contents ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS kit_container_contents_anon_select ON public.kit_container_contents;
  CREATE POLICY kit_container_contents_anon_select ON public.kit_container_contents
    FOR SELECT USING (true);

  DROP POLICY IF EXISTS kit_container_contents_anon_insert ON public.kit_container_contents;
  CREATE POLICY kit_container_contents_anon_insert ON public.kit_container_contents
    FOR INSERT WITH CHECK (true);

  DROP POLICY IF EXISTS kit_container_contents_anon_update ON public.kit_container_contents;
  CREATE POLICY kit_container_contents_anon_update ON public.kit_container_contents
    FOR UPDATE USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS kit_container_contents_anon_delete ON public.kit_container_contents;
  CREATE POLICY kit_container_contents_anon_delete ON public.kit_container_contents
    FOR DELETE USING (true);
END $$;

-- ---------- delete_product: clear container refs ----------------------

CREATE OR REPLACE FUNCTION public.delete_product(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'delete_product: product id is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_id) THEN
    RAISE EXCEPTION 'delete_product: product % does not exist', p_id;
  END IF;

  DELETE FROM kit_container_contents
    WHERE container_product_id = p_id OR child_product_id = p_id;
  DELETE FROM kit_movement_lines WHERE product_id = p_id;
  DELETE FROM event_kit_items    WHERE product_id = p_id;
  DELETE FROM stock_count_lines  WHERE product_id = p_id;
  DELETE FROM wastage_lines      WHERE product_id = p_id;
  DELETE FROM transfer_lines     WHERE product_id = p_id;
  DELETE FROM delivery_lines     WHERE product_id = p_id;
  DELETE FROM topup_lines        WHERE product_id = p_id;
  DELETE FROM bar_products       WHERE product_id = p_id;
  DELETE FROM distribution       WHERE product_id = p_id;
  DELETE FROM closing_stock      WHERE product_id = p_id;
  DELETE FROM event_products     WHERE product_id = p_id;
  DELETE FROM warehouse_stock    WHERE product_id = p_id;
  DELETE FROM product_suppliers  WHERE product_id = p_id;
  DELETE FROM products           WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO anon, authenticated, service_role;
