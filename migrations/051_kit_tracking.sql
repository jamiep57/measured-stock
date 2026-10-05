-- =====================================================================
-- 051 — Kit tracking (equipment library, event kit, warehouse kit)
-- =====================================================================
-- Adds product/category kind flags, event kit catalogue + movements,
-- and updates delete_product to clear kit references.
--
-- Safe to re-run (IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------- Kind flags -------------------------------------------------

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'stock';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_kind text NOT NULL DEFAULT 'stock';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_kind_check'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_kind_check
      CHECK (kind IN ('stock', 'kit'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_product_kind_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_product_kind_check
      CHECK (product_kind IN ('stock', 'kit'));
  END IF;
END $$;

-- Allow the same category name in stock vs kit libraries.
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_kind_name_key'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_kind_name_key UNIQUE (kind, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_product_kind ON public.products(product_kind);
CREATE INDEX IF NOT EXISTS idx_categories_kind ON public.categories(kind);

-- ---------- Seed kit categories ---------------------------------------

INSERT INTO public.categories (name, colour_key, sort_order, kind)
VALUES
  ('Structures', 'rtd', 0, 'kit'),
  ('Power', 'rtd', 1, 'kit'),
  ('AV & Lighting', 'rtd', 2, 'kit'),
  ('Staging', 'rtd', 3, 'kit'),
  ('Furniture', 'rtd', 4, 'kit'),
  ('Fencing', 'rtd', 5, 'kit'),
  ('Consumables', 'rtd', 6, 'kit'),
  ('Safety', 'rtd', 7, 'kit'),
  ('Signage', 'rtd', 8, 'kit'),
  ('Other', 'rtd', 9, 'kit')
ON CONFLICT (kind, name) DO NOTHING;

-- ---------- Event kit catalogue ---------------------------------------

CREATE TABLE IF NOT EXISTS public.event_kit_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id),
  qty_planned  numeric NOT NULL DEFAULT 0 CHECK (qty_planned >= 0),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_event_kit_items_event ON public.event_kit_items(event_id);
CREATE INDEX IF NOT EXISTS idx_event_kit_items_product ON public.event_kit_items(product_id);

-- ---------- Kit movements ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.kit_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  moved_at     timestamptz NOT NULL DEFAULT now(),
  movement_type text NOT NULL
    CHECK (movement_type IN (
      'warehouse_in', 'warehouse_out', 'hire_in', 'hire_return', 'write_off', 'adjust'
    )),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kit_movements_event ON public.kit_movements(event_id);
CREATE INDEX IF NOT EXISTS idx_kit_movements_moved_at ON public.kit_movements(moved_at DESC);

CREATE TABLE IF NOT EXISTS public.kit_movement_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id   uuid NOT NULL REFERENCES public.kit_movements(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES public.products(id),
  qty           numeric NOT NULL CHECK (qty > 0),
  warehouse_id  uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  supplier_id   uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  hire_company  text,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_kit_movement_lines_movement ON public.kit_movement_lines(movement_id);
CREATE INDEX IF NOT EXISTS idx_kit_movement_lines_product ON public.kit_movement_lines(product_id);

-- ---------- RLS (open anon policies, match 004) -----------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['event_kit_items', 'kit_movements', 'kit_movement_lines'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_select ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_select ON public.%I FOR SELECT USING (true);',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_insert ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_insert ON public.%I FOR INSERT WITH CHECK (true);',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_update ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_update ON public.%I FOR UPDATE USING (true) WITH CHECK (true);',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_delete ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_delete ON public.%I FOR DELETE USING (true);',
      t, t
    );
  END LOOP;
END $$;

-- ---------- delete_product: clear kit refs ----------------------------

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

COMMENT ON COLUMN public.products.product_kind IS
  'stock = beverage catalogue; kit = event equipment catalogue.';
COMMENT ON COLUMN public.categories.kind IS
  'stock = beverage categories; kit = equipment categories.';
COMMENT ON TABLE public.event_kit_items IS
  'Kit items planned / assigned to an event (event-level, not per-bar).';
COMMENT ON TABLE public.kit_movements IS
  'Header for kit movements: warehouse in/out, hire in/return, write-off, adjust.';
