-- =====================================================================
-- 035 — merge_products(): fold supplier_return_lines on duplicate merge
-- =====================================================================
-- Migration 027 added supplier_return_lines (Financial Recon) but
-- merge_products() (020) predates it. Deleting duplicate products then
-- fails with supplier_return_lines_product_id_fkey (23503).
--
-- Apply: AFTER 034. Idempotent: yes.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.merge_products(
  p_keep    uuid,
  p_dups    uuid[],
  p_fields  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_dups       uuid[];
  v_merged     int;
  v_pref_row   uuid;
BEGIN
  IF p_keep IS NULL THEN
    RAISE EXCEPTION 'merge_products: keeper id is required';
  END IF;

  SELECT array_agg(DISTINCT d) INTO v_dups
  FROM unnest(coalesce(p_dups, '{}'::uuid[])) AS d
  WHERE d IS NOT NULL AND d <> p_keep;

  IF v_dups IS NULL OR array_length(v_dups, 1) IS NULL THEN
    RETURN jsonb_build_object('kept', p_keep, 'merged', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_keep) THEN
    RAISE EXCEPTION 'merge_products: keeper product % does not exist', p_keep;
  END IF;

  -- Materialise legacy-only suppliers (with pack_size from the product).
  INSERT INTO product_suppliers (
    product_id, supplier_id, sku, case_price, unit_price, is_preferred,
    pack_size, units_per_case
  )
  SELECT
    p.id, p.supplier_id, coalesce(p.sku, ''), p.case_price, p.unit_price, true,
    coalesce(nullif(trim(p.case_size), ''), ''), p.units_per_case
  FROM products p
  LEFT JOIN (
    SELECT DISTINCT product_id FROM product_suppliers
     WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ) ps ON ps.product_id = p.id
  WHERE (p.id = p_keep OR p.id = ANY(v_dups))
    AND p.supplier_id IS NOT NULL
    AND ps.product_id IS NULL
  ON CONFLICT ON CONSTRAINT product_suppliers_offer_key DO NOTHING;

  -- Ensure every offer row names its pack size (from the source product).
  UPDATE product_suppliers ps
     SET pack_size = coalesce(
           nullif(trim(ps.pack_size), ''),
           nullif(trim(p.case_size), ''),
           ''
         ),
         units_per_case = coalesce(ps.units_per_case, p.units_per_case),
         sku = coalesce(ps.sku, '')
    FROM products p
   WHERE ps.product_id = p.id
     AND (ps.product_id = p_keep OR ps.product_id = ANY(v_dups));

  -- ===== event_products (UNIQUE event_id, product_id) =================
  WITH affected AS (
    SELECT * FROM event_products
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT event_id,
           coalesce(min(id::text) FILTER (WHERE product_id = p_keep), min(id::text))::uuid AS target_id
    FROM affected GROUP BY event_id
  ),
  sums AS (
    SELECT event_id,
           sum(qty_ordered)      AS qty_ordered,
           sum(damaged_qty)      AS damaged_qty,
           sum(already_in_stock) AS already_in_stock,
           sum(invoice_qty)      AS invoice_qty,
           sum(delivered_qty)    AS delivered_qty
    FROM affected GROUP BY event_id
  ),
  upd AS (
    UPDATE event_products ep SET
      product_id       = p_keep,
      qty_ordered      = s.qty_ordered,
      damaged_qty      = s.damaged_qty,
      already_in_stock = s.already_in_stock,
      invoice_qty      = s.invoice_qty,
      delivered_qty    = s.delivered_qty
    FROM target t JOIN sums s USING (event_id)
    WHERE ep.id = t.target_id
    RETURNING ep.id
  )
  DELETE FROM event_products ep USING target t
  WHERE ep.event_id = t.event_id AND ep.id <> t.target_id
    AND ep.product_id = ANY(v_dups);

  -- ===== closing_stock (UNIQUE event_id, product_id) =================
  WITH affected AS (
    SELECT * FROM closing_stock
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT event_id,
           coalesce(min(id::text) FILTER (WHERE product_id = p_keep), min(id::text))::uuid AS target_id
    FROM affected GROUP BY event_id
  ),
  sums AS (
    SELECT event_id,
           sum(close_count)     AS close_count,
           sum(return_amount)   AS return_amount,
           sum(closing_cases)   AS closing_cases,
           sum(closing_singles) AS closing_singles,
           sum(carried_over)    AS carried_over
    FROM affected GROUP BY event_id
  ),
  upd AS (
    UPDATE closing_stock cs SET
      product_id      = p_keep,
      close_count     = s.close_count,
      return_amount   = s.return_amount,
      closing_cases   = s.closing_cases,
      closing_singles = s.closing_singles,
      carried_over    = s.carried_over
    FROM target t JOIN sums s USING (event_id)
    WHERE cs.id = t.target_id
    RETURNING cs.id
  )
  DELETE FROM closing_stock cs USING target t
  WHERE cs.event_id = t.event_id AND cs.id <> t.target_id
    AND cs.product_id = ANY(v_dups);


  -- ===== supplier_return_lines (per event + supplier) ===============
  WITH affected AS (
    SELECT * FROM supplier_return_lines
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT event_id, supplier_id,
           coalesce(min(id::text) FILTER (WHERE product_id = p_keep), min(id::text))::uuid AS target_id
    FROM affected GROUP BY event_id, supplier_id
  ),
  sums AS (
    SELECT event_id, supplier_id,
           sum(qty)     AS qty,
           sum(singles) AS singles
    FROM affected GROUP BY event_id, supplier_id
  ),
  upd AS (
    UPDATE supplier_return_lines srl SET
      product_id = p_keep,
      qty        = s.qty,
      singles    = s.singles
    FROM target t JOIN sums s USING (event_id, supplier_id)
    WHERE srl.id = t.target_id
    RETURNING srl.id
  )
  DELETE FROM supplier_return_lines srl USING target t
  WHERE srl.event_id = t.event_id
    AND srl.supplier_id IS NOT DISTINCT FROM t.supplier_id
    AND srl.id <> t.target_id
    AND srl.product_id = ANY(v_dups);

  -- ===== distribution (UNIQUE event_id, bar_id, product_id) ==========
  WITH affected AS (
    SELECT * FROM distribution
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT event_id, bar_id,
           coalesce(min(id::text) FILTER (WHERE product_id = p_keep), min(id::text))::uuid AS target_id
    FROM affected GROUP BY event_id, bar_id
  ),
  sums AS (
    SELECT event_id, bar_id, sum(qty_allocated) AS qty_allocated
    FROM affected GROUP BY event_id, bar_id
  ),
  upd AS (
    UPDATE distribution d SET
      product_id    = p_keep,
      qty_allocated = s.qty_allocated
    FROM target t JOIN sums s USING (event_id, bar_id)
    WHERE d.id = t.target_id
    RETURNING d.id
  )
  DELETE FROM distribution d USING target t
  WHERE d.event_id = t.event_id AND d.bar_id = t.bar_id AND d.id <> t.target_id
    AND d.product_id = ANY(v_dups);

  -- ===== warehouse_stock (UNIQUE warehouse_id, product_id) ===========
  WITH affected AS (
    SELECT * FROM warehouse_stock
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT warehouse_id,
           coalesce(min(id::text) FILTER (WHERE product_id = p_keep), min(id::text))::uuid AS target_id
    FROM affected GROUP BY warehouse_id
  ),
  sums AS (
    SELECT warehouse_id, sum(qty_on_hand) AS qty_on_hand
    FROM affected GROUP BY warehouse_id
  ),
  upd AS (
    UPDATE warehouse_stock w SET
      product_id   = p_keep,
      qty_on_hand  = s.qty_on_hand,
      last_updated = now()
    FROM target t JOIN sums s USING (warehouse_id)
    WHERE w.id = t.target_id
    RETURNING w.id
  )
  DELETE FROM warehouse_stock w USING target t
  WHERE w.warehouse_id = t.warehouse_id AND w.id <> t.target_id
    AND w.product_id = ANY(v_dups);

  -- ===== bar_products (UNIQUE bar_id, product_id) — dedupe ===========
  WITH affected AS (
    SELECT * FROM bar_products
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT bar_id,
           coalesce(min(id::text) FILTER (WHERE product_id = p_keep), min(id::text))::uuid AS target_id
    FROM affected GROUP BY bar_id
  ),
  upd AS (
    UPDATE bar_products bp SET product_id = p_keep
    FROM target t WHERE bp.id = t.target_id
    RETURNING bp.id
  )
  DELETE FROM bar_products bp USING target t
  WHERE bp.bar_id = t.bar_id AND bp.id <> t.target_id
    AND bp.product_id = ANY(v_dups);

  -- ===== product_suppliers — keep EVERY purchase offer ================
  -- Remember which row was preferred (keeper's wins).
  SELECT id INTO v_pref_row
  FROM product_suppliers
  WHERE (product_id = p_keep OR product_id = ANY(v_dups)) AND is_preferred
  ORDER BY (product_id = p_keep) DESC, created_at ASC
  LIMIT 1;

  UPDATE product_suppliers SET is_preferred = false
  WHERE (product_id = p_keep OR product_id = ANY(v_dups)) AND is_preferred;

  -- Exact offer collisions (same supplier + pack + sku): merge prices
  -- into the keeper's row, then drop the duplicate's row.
  UPDATE product_suppliers k SET
    case_price       = coalesce(k.case_price, d.case_price),
    unit_price       = coalesce(k.unit_price, d.unit_price),
    units_per_case   = coalesce(k.units_per_case, d.units_per_case)
  FROM product_suppliers d
  WHERE d.product_id = ANY(v_dups)
    AND k.product_id = p_keep
    AND k.supplier_id = d.supplier_id
    AND k.pack_size = d.pack_size
    AND k.sku = d.sku;

  DELETE FROM product_suppliers d
  WHERE d.product_id = ANY(v_dups)
    AND EXISTS (
      SELECT 1 FROM product_suppliers k
       WHERE k.product_id = p_keep
         AND k.supplier_id = d.supplier_id
         AND k.pack_size = d.pack_size
         AND k.sku = d.sku
    );

  -- De-dupe within each duplicate product (same offer listed twice).
  DELETE FROM product_suppliers ps
  USING (
    SELECT id,
           row_number() OVER (
             PARTITION BY product_id, supplier_id, pack_size, sku
             ORDER BY created_at ASC, id::text
           ) AS rn
    FROM product_suppliers
    WHERE product_id = ANY(v_dups)
  ) r
  WHERE ps.id = r.id AND r.rn > 1;

  -- Carry every surviving offer over to the keeper.
  UPDATE product_suppliers SET product_id = p_keep WHERE product_id = ANY(v_dups);

  -- De-dupe on the keeper (identical offers from two merged products).
  WITH ranked AS (
    SELECT id,
           first_value(id) OVER (
             PARTITION BY supplier_id, pack_size, sku
             ORDER BY created_at ASC, id::text
           ) AS survivor_id,
           row_number() OVER (
             PARTITION BY supplier_id, pack_size, sku
             ORDER BY created_at ASC, id::text
           ) AS rn
    FROM product_suppliers
    WHERE product_id = p_keep
  )
  UPDATE product_suppliers k SET
    case_price     = coalesce(k.case_price, d.case_price),
    unit_price     = coalesce(k.unit_price, d.unit_price),
    units_per_case = coalesce(k.units_per_case, d.units_per_case)
  FROM product_suppliers d
  JOIN ranked r ON d.id = r.id AND r.rn > 1
  WHERE k.id = r.survivor_id;

  DELETE FROM product_suppliers ps
  USING (
    SELECT id,
           row_number() OVER (
             PARTITION BY supplier_id, pack_size, sku
             ORDER BY created_at ASC, id::text
           ) AS rn
    FROM product_suppliers
    WHERE product_id = p_keep
  ) r
  WHERE ps.id = r.id AND r.rn > 1;

  -- Restore the single preferred row.
  IF v_pref_row IS NOT NULL AND EXISTS (
    SELECT 1 FROM product_suppliers WHERE id = v_pref_row AND product_id = p_keep
  ) THEN
    UPDATE product_suppliers SET is_preferred = true WHERE id = v_pref_row;
  END IF;

  -- ===== line tables — re-point ======================================
  UPDATE delivery_lines    SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE topup_lines       SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE transfer_lines    SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE wastage_lines     SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE stock_count_lines SET product_id = p_keep WHERE product_id = ANY(v_dups);

  -- ===== delete duplicate products ===================================
  DELETE FROM products WHERE id = ANY(v_dups);
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  -- Apply per-field choices from the merge UI (name, category, size…).
  IF p_fields IS NOT NULL AND p_fields <> '{}'::jsonb THEN
    UPDATE products SET
      name = CASE WHEN p_fields ? 'name' THEN nullif(p_fields->>'name', '') ELSE name END,
      category_id = CASE
        WHEN p_fields ? 'category_id' THEN nullif(p_fields->>'category_id', '')::uuid
        ELSE category_id END,
      case_size = CASE WHEN p_fields ? 'case_size' THEN coalesce(p_fields->>'case_size', '') ELSE case_size END,
      units_per_case = CASE
        WHEN p_fields ? 'units_per_case' AND p_fields->>'units_per_case' <> '' THEN (p_fields->>'units_per_case')::numeric
        WHEN p_fields ? 'units_per_case' THEN 1
        ELSE units_per_case END,
      sku = CASE WHEN p_fields ? 'sku' THEN coalesce(p_fields->>'sku', '') ELSE sku END,
      abv = CASE
        WHEN p_fields ? 'abv' AND p_fields->>'abv' <> '' THEN (p_fields->>'abv')::numeric
        WHEN p_fields ? 'abv' THEN NULL
        ELSE abv END
    WHERE id = p_keep;
  END IF;

  PERFORM public.sync_product_preferred_supplier(p_keep);

  RETURN jsonb_build_object('kept', p_keep, 'merged', v_merged);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.merge_products(uuid, uuid[], jsonb) TO anon, authenticated, service_role;
