-- =====================================================================
-- 070 — merge_products(): carry planning + purchase order rows
-- =====================================================================
-- Background:
--   merge_products() (035, made SECURITY INVOKER in 065) predates the
--   planning tables (068) and purchase orders (069). Deleting a duplicate
--   product would cascade-delete its house / event menu prices and
--   scenario prices, and fail on purchase_order_lines (ON DELETE RESTRICT).
--
--   The existing function is renamed merge_products_core and wrapped:
--   merge_planning_refs() first folds the duplicates' rows into the keeper
--   (keeper's row wins on a clash; PO line quantities are summed so order
--   history keeps its totals), then the core merge runs unchanged.
--
--   Folding is an identity change, so it runs even on locked price years,
--   reconciled events and confirmed orders, via the transaction-local
--   app.product_merge / app.pricing_snapshot flags honoured by the 068
--   and 069 guards.
--
-- Apply: AFTER 069. Idempotent: yes. Re-applying 035 afterwards would
-- replace the wrapper — re-apply 070 after it.
-- =====================================================================

DO $$
BEGIN
  IF to_regprocedure('public.merge_products_core(uuid, uuid[], jsonb)') IS NULL THEN
    ALTER FUNCTION public.merge_products(uuid, uuid[], jsonb) RENAME TO merge_products_core;
  END IF;
END $$;

-- ---------- fold planning rows ----------------------------------------

CREATE OR REPLACE FUNCTION public.merge_planning_refs(p_keep uuid, p_dups uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid := public.current_org_id();
  v_dups uuid[];
BEGIN
  IF p_keep IS NULL THEN RETURN; END IF;

  SELECT array_agg(DISTINCT p.id) INTO v_dups
    FROM public.products p
   WHERE p.id = ANY(coalesce(p_dups, '{}'::uuid[])) AND p.id <> p_keep
     AND p.org_id = v_org;
  IF v_dups IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_keep AND org_id = v_org) THEN
    RAISE EXCEPTION 'merge_products: keeper product % does not exist', p_keep USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.product_merge', 'on', true);
  PERFORM set_config('app.pricing_snapshot', 'on', true);

  -- house_menu_prices (UNIQUE price_year_id, product_id)
  UPDATE public.house_menu_prices SET product_id = p_keep
   WHERE id IN (
     SELECT DISTINCT ON (h.price_year_id) h.id
       FROM public.house_menu_prices h
      WHERE h.product_id = ANY(v_dups)
        AND NOT EXISTS (SELECT 1 FROM public.house_menu_prices k
                         WHERE k.price_year_id = h.price_year_id AND k.product_id = p_keep)
      ORDER BY h.price_year_id, h.updated_at DESC NULLS LAST, h.id
   );
  DELETE FROM public.house_menu_prices WHERE product_id = ANY(v_dups);

  -- event_menu_items (UNIQUE event_id, product_id)
  UPDATE public.event_menu_items SET product_id = p_keep
   WHERE id IN (
     SELECT DISTINCT ON (e.event_id) e.id
       FROM public.event_menu_items e
      WHERE e.product_id = ANY(v_dups)
        AND NOT EXISTS (SELECT 1 FROM public.event_menu_items k
                         WHERE k.event_id = e.event_id AND k.product_id = p_keep)
      ORDER BY e.event_id, e.included DESC, e.updated_at DESC NULLS LAST, e.id
   );
  DELETE FROM public.event_menu_items WHERE product_id = ANY(v_dups);

  -- scenario_prices (UNIQUE scenario_id, product_id)
  UPDATE public.scenario_prices SET product_id = p_keep
   WHERE id IN (
     SELECT DISTINCT ON (s.scenario_id) s.id
       FROM public.scenario_prices s
      WHERE s.product_id = ANY(v_dups)
        AND NOT EXISTS (SELECT 1 FROM public.scenario_prices k
                         WHERE k.scenario_id = s.scenario_id AND k.product_id = p_keep)
      ORDER BY s.scenario_id, s.id
   );
  DELETE FROM public.scenario_prices WHERE product_id = ANY(v_dups);

  -- purchase_order_lines (UNIQUE po_id, product_id): quantities are summed
  UPDATE public.purchase_order_lines SET product_id = p_keep
   WHERE id IN (
     SELECT DISTINCT ON (l.po_id) l.id
       FROM public.purchase_order_lines l
      WHERE l.product_id = ANY(v_dups)
        AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines k
                         WHERE k.po_id = l.po_id AND k.product_id = p_keep)
      ORDER BY l.po_id, l.id
   );
  UPDATE public.purchase_order_lines k
     SET qty_cases = k.qty_cases + s.qty
    FROM (
      SELECT po_id, sum(qty_cases) AS qty
        FROM public.purchase_order_lines
       WHERE product_id = ANY(v_dups)
       GROUP BY po_id
    ) s
   WHERE k.po_id = s.po_id AND k.product_id = p_keep;
  DELETE FROM public.purchase_order_lines WHERE product_id = ANY(v_dups);

  -- rider_price_lines (071, UNIQUE agreement_id, product_id)
  IF to_regclass('public.rider_price_lines') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.rider_price_lines SET product_id = $1
       WHERE id IN (
         SELECT DISTINCT ON (r.agreement_id) r.id
           FROM public.rider_price_lines r
          WHERE r.product_id = ANY($2)
            AND NOT EXISTS (SELECT 1 FROM public.rider_price_lines k
                             WHERE k.agreement_id = r.agreement_id AND k.product_id = $1)
          ORDER BY r.agreement_id, r.updated_at DESC NULLS LAST, r.id
       )
    $sql$ USING p_keep, v_dups;
    EXECUTE 'DELETE FROM public.rider_price_lines WHERE product_id = ANY($1)' USING v_dups;
  END IF;

  PERFORM set_config('app.pricing_snapshot', 'off', true);
  PERFORM set_config('app.product_merge', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_planning_refs(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- ---------- wrapper ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.merge_products(
  p_keep    uuid,
  p_dups    uuid[],
  p_fields  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = ANY(coalesce(p_dups, '{}'::uuid[])) AND id <> p_keep) THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can merge products' USING ERRCODE = '42501';
    END IF;
    PERFORM public.merge_planning_refs_admin(p_keep, p_dups);
  END IF;
  RETURN public.merge_products_core(p_keep, p_dups, p_fields);
END;
$$;

-- Thin admin-checked entry so the definer helper is never callable directly.
CREATE OR REPLACE FUNCTION public.merge_planning_refs_admin(p_keep uuid, p_dups uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can merge products' USING ERRCODE = '42501';
  END IF;
  PERFORM public.merge_planning_refs(p_keep, p_dups);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_planning_refs_admin(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_planning_refs_admin(uuid, uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.merge_products(uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_products(uuid, uuid[], jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.merge_products_core(uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_products_core(uuid, uuid[], jsonb) TO authenticated, service_role;

-- =====================================================================
-- Verify:
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('merge_products', 'merge_products_core', 'merge_planning_refs');
-- =====================================================================
