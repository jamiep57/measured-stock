-- =====================================================================
-- 019 — merge_products(): never lose a legacy-only supplier
-- =====================================================================
-- Migration 016 introduced product_suppliers and backfilled a row for
-- every product that had a supplier AT THAT TIME. But products added or
-- synced afterwards through paths that only set the legacy
-- products.supplier_id column (e.g. legacy-app sync, quick imports) never
-- got a product_suppliers row. For those products the supplier lived ONLY
-- in products.supplier_id.
--
-- merge_products() (migration 018) folds suppliers by moving the
-- duplicates' product_suppliers rows onto the keeper. A duplicate whose
-- supplier existed only in the legacy column had no row to move, so when
-- the duplicate product was deleted its supplier vanished — e.g. merging a
-- "measured" rose into a "Vinca" rose dropped the "measured" link.
--
-- This migration:
--   1. Backfills a product_suppliers row from the legacy supplier_id /
--      case_price / unit_price / sku for every product still missing one.
--   2. Rebuilds merge_products() so it ALSO synthesises a row from the
--      legacy column for the keeper and every duplicate before folding —
--      belt-and-braces so a legacy-only supplier can never be lost again.
--
-- Apply: AFTER 018. Idempotent: yes (ON CONFLICT / CREATE OR REPLACE).
-- =====================================================================

-- ---------- 1. One-off backfill of existing legacy-only products ------

INSERT INTO public.product_suppliers (product_id, supplier_id, sku, case_price, unit_price, is_preferred)
SELECT p.id, p.supplier_id, p.sku, p.case_price, p.unit_price, true
  FROM public.products p
  LEFT JOIN (SELECT DISTINCT product_id FROM public.product_suppliers) ps
         ON ps.product_id = p.id
 WHERE p.supplier_id IS NOT NULL
   AND ps.product_id IS NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;

-- ---------- 2. Hardened merge_products() ------------------------------

CREATE OR REPLACE FUNCTION public.merge_products(p_keep uuid, p_dups uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_dups          uuid[];
  v_merged        int;
  v_pref_supplier uuid;
BEGIN
  IF p_keep IS NULL THEN
    RAISE EXCEPTION 'merge_products: keeper id is required';
  END IF;

  -- Sanitise: drop nulls, the keeper itself, and repeats from the list.
  SELECT array_agg(DISTINCT d) INTO v_dups
  FROM unnest(coalesce(p_dups, '{}'::uuid[])) AS d
  WHERE d IS NOT NULL AND d <> p_keep;

  IF v_dups IS NULL OR array_length(v_dups, 1) IS NULL THEN
    RETURN jsonb_build_object('kept', p_keep, 'merged', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_keep) THEN
    RAISE EXCEPTION 'merge_products: keeper product % does not exist', p_keep;
  END IF;

  -- Rescue legacy-only suppliers: for the keeper and every duplicate that
  -- still names a supplier solely in products.supplier_id, materialise a
  -- product_suppliers row now so the folding below carries it over.
  INSERT INTO product_suppliers (product_id, supplier_id, sku, case_price, unit_price, is_preferred)
  SELECT p.id, p.supplier_id, p.sku, p.case_price, p.unit_price, true
    FROM products p
    LEFT JOIN (
      SELECT DISTINCT product_id FROM product_suppliers
       WHERE product_id = p_keep OR product_id = ANY(v_dups)
    ) ps ON ps.product_id = p.id
   WHERE (p.id = p_keep OR p.id = ANY(v_dups))
     AND p.supplier_id IS NOT NULL
     AND ps.product_id IS NULL
  ON CONFLICT (product_id, supplier_id) DO NOTHING;

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

  -- ===== product_suppliers (UNIQUE product_id, supplier_id) ==========
  -- Fold the duplicates' supplier/price rows onto the keeper instead of
  -- letting the final product delete cascade them away.

  -- Which supplier stays preferred? Keeper's preferred wins; else a dup's.
  SELECT supplier_id INTO v_pref_supplier
  FROM product_suppliers
  WHERE (product_id = p_keep OR product_id = ANY(v_dups)) AND is_preferred
  ORDER BY (product_id = p_keep) DESC, created_at ASC
  LIMIT 1;

  -- Clear every preferred flag in the affected set first so the re-pointing
  -- below can never trip the "one preferred per product" partial unique index.
  UPDATE product_suppliers SET is_preferred = false
  WHERE (product_id = p_keep OR product_id = ANY(v_dups)) AND is_preferred;

  -- Suppliers present on both: fill any gaps on the keeper's row from a
  -- duplicate, then drop the colliding duplicate rows.
  UPDATE product_suppliers k SET
    case_price = coalesce(k.case_price, d.case_price),
    unit_price = coalesce(k.unit_price, d.unit_price),
    sku        = coalesce(k.sku, d.sku)
  FROM (
    SELECT DISTINCT ON (supplier_id) supplier_id, case_price, unit_price, sku
    FROM product_suppliers
    WHERE product_id = ANY(v_dups)
    ORDER BY supplier_id, created_at ASC
  ) d
  WHERE k.product_id = p_keep AND k.supplier_id = d.supplier_id;

  DELETE FROM product_suppliers
  WHERE product_id = ANY(v_dups)
    AND supplier_id IN (SELECT supplier_id FROM product_suppliers WHERE product_id = p_keep);

  -- Among duplicates, keep only the earliest row per supplier.
  DELETE FROM product_suppliers ps
  USING (
    SELECT id, row_number() OVER (PARTITION BY supplier_id ORDER BY created_at ASC, id::text) AS rn
    FROM product_suppliers WHERE product_id = ANY(v_dups)
  ) r
  WHERE ps.id = r.id AND r.rn > 1;

  -- Carry the surviving duplicate supplier rows over to the keeper.
  UPDATE product_suppliers SET product_id = p_keep WHERE product_id = ANY(v_dups);

  -- Restore a single preferred row (the remembered supplier, if it survived).
  IF v_pref_supplier IS NOT NULL THEN
    UPDATE product_suppliers SET is_preferred = true
    WHERE product_id = p_keep AND supplier_id = v_pref_supplier;
  END IF;

  -- ===== line tables with no unique constraint — re-point ============
  UPDATE delivery_lines    SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE topup_lines       SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE transfer_lines    SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE wastage_lines     SET product_id = p_keep WHERE product_id = ANY(v_dups);
  UPDATE stock_count_lines SET product_id = p_keep WHERE product_id = ANY(v_dups);

  -- ===== finally, delete the now-orphaned duplicate products =========
  DELETE FROM products WHERE id = ANY(v_dups);
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  -- Make sure the keeper's legacy supplier/price columns reflect its
  -- (possibly new) preferred supplier row.
  PERFORM public.sync_product_preferred_supplier(p_keep);

  RETURN jsonb_build_object('kept', p_keep, 'merged', v_merged);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.merge_products(uuid, uuid[]) TO anon, authenticated, service_role;

-- =====================================================================
-- DONE. Confirm no product still hides a supplier in the legacy column:
--   SELECT count(*) FROM products p
--     LEFT JOIN (SELECT DISTINCT product_id FROM product_suppliers) ps
--            ON ps.product_id = p.id
--    WHERE p.supplier_id IS NOT NULL AND ps.product_id IS NULL;  -- expect 0
-- =====================================================================
