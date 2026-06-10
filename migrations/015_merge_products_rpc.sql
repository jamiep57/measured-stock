-- =====================================================================
-- 015 — merge_products(): fold duplicate library products into one
-- =====================================================================
-- The Product Library accumulates duplicate rows (same drink entered
-- more than once). This function merges a set of duplicate product ids
-- into a single keeper, re-pointing every child table that references
-- products.id and summing quantities where a unique constraint would
-- otherwise collide (e.g. the keeper and a duplicate both appear on the
-- same event / bar / warehouse). The duplicate product rows are then
-- deleted.
--
-- Child tables (all FK products.id, NO ACTION):
--   event_products   UNIQUE(event_id, product_id)        — sum quantities
--   closing_stock    UNIQUE(event_id, product_id)        — sum quantities
--   distribution     UNIQUE(event_id, bar_id, product_id)— sum qty_allocated
--   warehouse_stock  UNIQUE(warehouse_id, product_id)    — sum qty_on_hand
--   bar_products     UNIQUE(bar_id, product_id)          — dedupe
--   delivery_lines   (no unique)                         — re-point
--   topup_lines      (no unique)                         — re-point
--   transfer_lines   (no unique)                         — re-point
--   wastage_lines    (no unique)                         — re-point
--   stock_count_lines(no unique)                         — re-point
--
-- recipe_ingredients references products by TEXT name, not id, so it is
-- unaffected (the keeper keeps its name).
--
-- Apply: AFTER 014. Idempotent: yes (CREATE OR REPLACE).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.merge_products(p_keep uuid, p_dups uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_dups   uuid[];
  v_merged int;
BEGIN
  IF p_keep IS NULL THEN
    RAISE EXCEPTION 'merge_products: keeper id is required';
  END IF;

  -- Sanitise: drop nulls, the keeper itself, and duplicates from the list.
  SELECT array_agg(DISTINCT d) INTO v_dups
  FROM unnest(coalesce(p_dups, '{}'::uuid[])) AS d
  WHERE d IS NOT NULL AND d <> p_keep;

  IF v_dups IS NULL OR array_length(v_dups, 1) IS NULL THEN
    RETURN jsonb_build_object('kept', p_keep, 'merged', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_keep) THEN
    RAISE EXCEPTION 'merge_products: keeper product % does not exist', p_keep;
  END IF;

  -- ===== event_products (UNIQUE event_id, product_id) =================
  WITH affected AS (
    SELECT * FROM event_products
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT event_id,
           coalesce(min(id) FILTER (WHERE product_id = p_keep), min(id)) AS target_id
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
  )
  UPDATE event_products ep SET
    product_id       = p_keep,
    qty_ordered      = s.qty_ordered,
    damaged_qty      = s.damaged_qty,
    already_in_stock = s.already_in_stock,
    invoice_qty      = s.invoice_qty,
    delivered_qty    = s.delivered_qty
  FROM target t JOIN sums s USING (event_id)
  WHERE ep.id = t.target_id;

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
           coalesce(min(id) FILTER (WHERE product_id = p_keep), min(id)) AS target_id
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
  )
  UPDATE closing_stock cs SET
    product_id      = p_keep,
    close_count     = s.close_count,
    return_amount   = s.return_amount,
    closing_cases   = s.closing_cases,
    closing_singles = s.closing_singles,
    carried_over    = s.carried_over
  FROM target t JOIN sums s USING (event_id)
  WHERE cs.id = t.target_id;

  DELETE FROM closing_stock cs USING target t
  WHERE cs.event_id = t.event_id AND cs.id <> t.target_id
    AND cs.product_id = ANY(v_dups);

  -- ===== distribution (UNIQUE event_id, bar_id, product_id) ==========
  WITH affected AS (
    SELECT * FROM distribution
    WHERE product_id = p_keep OR product_id = ANY(v_dups)
  ),
  target AS (
    SELECT event_id, bar_id,
           coalesce(min(id) FILTER (WHERE product_id = p_keep), min(id)) AS target_id
    FROM affected GROUP BY event_id, bar_id
  ),
  sums AS (
    SELECT event_id, bar_id, sum(qty_allocated) AS qty_allocated
    FROM affected GROUP BY event_id, bar_id
  )
  UPDATE distribution d SET
    product_id    = p_keep,
    qty_allocated = s.qty_allocated
  FROM target t JOIN sums s USING (event_id, bar_id)
  WHERE d.id = t.target_id;

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
           coalesce(min(id) FILTER (WHERE product_id = p_keep), min(id)) AS target_id
    FROM affected GROUP BY warehouse_id
  ),
  sums AS (
    SELECT warehouse_id, sum(qty_on_hand) AS qty_on_hand, max(last_updated) AS last_updated
    FROM affected GROUP BY warehouse_id
  )
  UPDATE warehouse_stock w SET
    product_id   = p_keep,
    qty_on_hand  = s.qty_on_hand,
    last_updated = greatest(s.last_updated, now())
  FROM target t JOIN sums s USING (warehouse_id)
  WHERE w.id = t.target_id;

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
           coalesce(min(id) FILTER (WHERE product_id = p_keep), min(id)) AS target_id
    FROM affected GROUP BY bar_id
  )
  UPDATE bar_products bp SET product_id = p_keep
  FROM target t WHERE bp.id = t.target_id;

  DELETE FROM bar_products bp USING target t
  WHERE bp.bar_id = t.bar_id AND bp.id <> t.target_id
    AND bp.product_id = ANY(v_dups);

  -- ===== line tables with no unique constraint — re-point ============
  UPDATE delivery_lines    SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE topup_lines       SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE transfer_lines    SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE wastage_lines     SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE stock_count_lines SET product_id = p_keep WHERE product_id = ANY(v_dups);

  -- ===== finally, delete the now-orphaned duplicate products =========
  DELETE FROM products WHERE id = ANY(v_dups);
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  RETURN jsonb_build_object('kept', p_keep, 'merged', v_merged);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.merge_products(uuid, uuid[]) TO anon, authenticated, service_role;

-- =====================================================================
-- DONE. Test (read-only dry preview not provided; this mutates data):
--   SELECT public.merge_products('<keep-uuid>', ARRAY['<dup-uuid>']::uuid[]);
-- =====================================================================
