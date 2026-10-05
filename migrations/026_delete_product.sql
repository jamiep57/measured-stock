-- 026 — delete_product(): remove a library product and all references
-- Needed because event_products (and other child tables) reference
-- products without ON DELETE CASCADE.

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

  DELETE FROM stock_count_lines WHERE product_id = p_id;
  DELETE FROM wastage_lines     WHERE product_id = p_id;
  DELETE FROM transfer_lines    WHERE product_id = p_id;
  DELETE FROM delivery_lines    WHERE product_id = p_id;
  DELETE FROM topup_lines       WHERE product_id = p_id;
  DELETE FROM bar_products      WHERE product_id = p_id;
  DELETE FROM distribution      WHERE product_id = p_id;
  DELETE FROM closing_stock     WHERE product_id = p_id;
  DELETE FROM event_products    WHERE product_id = p_id;
  DELETE FROM warehouse_stock   WHERE product_id = p_id;
  -- product_suppliers has ON DELETE CASCADE; explicit delete is harmless.
  DELETE FROM product_suppliers WHERE product_id = p_id;
  DELETE FROM products          WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO anon, authenticated, service_role;
