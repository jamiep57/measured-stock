-- 027 — Per-supplier return lines (Financial Recon)
-- Lets a product return stock to multiple suppliers at different case prices.

CREATE TABLE IF NOT EXISTS public.supplier_return_lines (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.products(id),
  supplier_id  uuid        REFERENCES public.suppliers(id) ON DELETE SET NULL,
  qty          numeric     NOT NULL DEFAULT 0 CHECK (qty >= 0),
  singles      numeric     NOT NULL DEFAULT 0 CHECK (singles >= 0),
  case_price   numeric,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_return_lines_event
  ON public.supplier_return_lines(event_id);
CREATE INDEX IF NOT EXISTS idx_supplier_return_lines_product
  ON public.supplier_return_lines(event_id, product_id);

COMMENT ON TABLE public.supplier_return_lines IS
  'Per-supplier return qty for Financial Recon — closing_stock.return_amount is the sum.';
COMMENT ON COLUMN public.supplier_return_lines.case_price IS
  'Case price for this return line; NULL = use product_suppliers price for that supplier.';

-- RLS (same open anon model as other v2 tables)
ALTER TABLE public.supplier_return_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_return_lines_anon_select ON public.supplier_return_lines;
CREATE POLICY supplier_return_lines_anon_select ON public.supplier_return_lines FOR SELECT USING (true);
DROP POLICY IF EXISTS supplier_return_lines_anon_insert ON public.supplier_return_lines;
CREATE POLICY supplier_return_lines_anon_insert ON public.supplier_return_lines FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS supplier_return_lines_anon_update ON public.supplier_return_lines;
CREATE POLICY supplier_return_lines_anon_update ON public.supplier_return_lines FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS supplier_return_lines_anon_delete ON public.supplier_return_lines;
CREATE POLICY supplier_return_lines_anon_delete ON public.supplier_return_lines FOR DELETE USING (true);

-- delete_product() cleanup
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

  DELETE FROM stock_count_lines      WHERE product_id = p_id;
  DELETE FROM wastage_lines          WHERE product_id = p_id;
  DELETE FROM transfer_lines         WHERE product_id = p_id;
  DELETE FROM delivery_lines         WHERE product_id = p_id;
  DELETE FROM topup_lines            WHERE product_id = p_id;
  DELETE FROM bar_products           WHERE product_id = p_id;
  DELETE FROM distribution           WHERE product_id = p_id;
  DELETE FROM closing_stock          WHERE product_id = p_id;
  DELETE FROM supplier_return_lines  WHERE product_id = p_id;
  DELETE FROM event_products         WHERE product_id = p_id;
  DELETE FROM warehouse_stock        WHERE product_id = p_id;
  DELETE FROM product_suppliers      WHERE product_id = p_id;
  DELETE FROM products               WHERE id = p_id;
END;
$$;
