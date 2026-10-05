-- =====================================================================
-- 076 — Saved menus
-- =====================================================================
-- A saved menu is a named product list with prices, kept once and
-- applied onto any event. It replaces the single house menu as the
-- way to reuse a menu. Applying copies products and prices onto the
-- event; projected serves, deal costs and cost snapshots stay put.
--
-- Apply: AFTER 075
-- Idempotent: yes
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.saved_menus (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organisations(id),
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_menus_org_name_key
  ON public.saved_menus (org_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.saved_menu_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organisations(id),
  menu_id         uuid NOT NULL REFERENCES public.saved_menus(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  menu_price      numeric CHECK (menu_price IS NULL OR menu_price >= 0),
  suggested_price numeric CHECK (suggested_price IS NULL OR suggested_price >= 0),
  target_gp_pct   numeric CHECK (target_gp_pct IS NULL OR (target_gp_pct > -100 AND target_gp_pct < 100)),
  serve_label     text CHECK (serve_label IS NULL OR char_length(serve_label) <= 40),
  serves_per_unit numeric CHECK (serves_per_unit IS NULL OR serves_per_unit > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_menu_items_menu_product_key UNIQUE (menu_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_menu_items_product ON public.saved_menu_items (product_id);

COMMENT ON TABLE public.saved_menus IS
  'Named menu that can be applied to any event. Each event keeps its own copy.';
COMMENT ON TABLE public.saved_menu_items IS
  'Products and selling prices on a saved menu. Event forecasts and deal costs are not stored here.';

SELECT public.tenant_enable('saved_menus', '', true);
SELECT public.tenant_enable('saved_menu_items', '''derive:menu_id:saved_menus'',''check:product_id:products''', true);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.saved_menus;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.saved_menus
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- Copy the products currently on an event menu into a named saved menu.
-- p_replace updates an existing menu of the same name; otherwise a clash
-- is rejected so the caller can confirm first.
CREATE OR REPLACE FUNCTION public.save_event_menu(
  p_event uuid,
  p_name text,
  p_replace boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name     text := btrim(p_name);
  v_org      uuid;
  v_menu     uuid;
  v_existing uuid;
  v_count    integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can save menus' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'Menu name must be 1–60 characters' USING ERRCODE = '22023';
  END IF;

  SELECT org_id INTO v_org FROM public.events WHERE id = p_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.event_menu_items
   WHERE event_id = p_event AND included;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'This event has no products on the menu' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing
    FROM public.saved_menus
   WHERE org_id = v_org AND lower(btrim(name)) = lower(v_name);

  IF v_existing IS NOT NULL AND NOT COALESCE(p_replace, false) THEN
    RAISE EXCEPTION 'A menu called % already exists', v_name USING ERRCODE = '23505';
  END IF;

  IF v_existing IS NULL THEN
    INSERT INTO public.saved_menus (name) VALUES (v_name) RETURNING id INTO v_menu;
  ELSE
    v_menu := v_existing;
    UPDATE public.saved_menus SET name = v_name WHERE id = v_menu;
    DELETE FROM public.saved_menu_items WHERE menu_id = v_menu;
  END IF;

  INSERT INTO public.saved_menu_items
    (menu_id, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit)
  SELECT v_menu, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit
    FROM public.event_menu_items
   WHERE event_id = p_event AND included;

  RETURN v_menu;
END;
$$;

-- Add a saved menu's products onto an event. Existing rows keep their
-- prices unless p_refresh_prices. Projected serves, deals and frozen
-- costs are never overwritten.
CREATE OR REPLACE FUNCTION public.apply_saved_menu(
  p_event uuid,
  p_menu uuid,
  p_refresh_prices boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_added integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can apply menus' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event) THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;
  IF public.event_pricing_locked(p_event) THEN
    RAISE EXCEPTION 'Pricing is locked for reconciled or archived events' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.saved_menus WHERE id = p_menu) THEN
    RAISE EXCEPTION 'Saved menu not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.event_menu_items
    (event_id, product_id, included, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit)
  SELECT p_event, s.product_id, true, s.menu_price, s.suggested_price, s.target_gp_pct, s.serve_label, s.serves_per_unit
    FROM public.saved_menu_items s
   WHERE s.menu_id = p_menu
  ON CONFLICT (event_id, product_id) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  UPDATE public.event_menu_items emi
     SET included = true
    FROM public.saved_menu_items s
   WHERE emi.event_id = p_event
     AND s.menu_id = p_menu
     AND s.product_id = emi.product_id
     AND emi.included IS DISTINCT FROM true;

  IF p_refresh_prices THEN
    UPDATE public.event_menu_items emi
       SET menu_price = s.menu_price,
           suggested_price = s.suggested_price,
           target_gp_pct = s.target_gp_pct,
           serve_label = s.serve_label,
           serves_per_unit = s.serves_per_unit,
           included = true
      FROM public.saved_menu_items s
     WHERE emi.event_id = p_event
       AND s.menu_id = p_menu
       AND s.product_id = emi.product_id;
  END IF;

  RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION public.save_event_menu(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_menu(uuid, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_saved_menu(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_saved_menu(uuid, uuid, boolean) TO authenticated;

-- Fold saved-menu rows when two products are merged. Keeper wins a clash.
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

  IF to_regclass('public.saved_menu_items') IS NOT NULL THEN
    UPDATE public.saved_menu_items SET product_id = p_keep
     WHERE id IN (
       SELECT DISTINCT ON (s.menu_id) s.id
         FROM public.saved_menu_items s
        WHERE s.product_id = ANY(v_dups)
          AND NOT EXISTS (SELECT 1 FROM public.saved_menu_items k
                           WHERE k.menu_id = s.menu_id AND k.product_id = p_keep)
        ORDER BY s.menu_id, s.created_at DESC NULLS LAST, s.id
     );
    DELETE FROM public.saved_menu_items WHERE product_id = ANY(v_dups);
  END IF;

  PERFORM set_config('app.pricing_snapshot', 'off', true);
  PERFORM set_config('app.product_merge', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_planning_refs(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
