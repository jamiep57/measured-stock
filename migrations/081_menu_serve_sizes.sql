-- =====================================================================
-- 081 — Several menu prices for one product
-- =====================================================================
-- A keg is one stock product and can be sold as a pint and a half.
-- Each size is its own menu row: its own name, price and forecast.
-- portion is how much of one serve that row uses (a half is 0.5).
-- The case yield, deal cost and order override stay shared.
--
-- Apply: AFTER 080
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.event_menu_items
  ADD COLUMN IF NOT EXISTS portion numeric NOT NULL DEFAULT 1;

ALTER TABLE public.event_menu_items DROP CONSTRAINT IF EXISTS event_menu_items_portion_check;
ALTER TABLE public.event_menu_items
  ADD CONSTRAINT event_menu_items_portion_check CHECK (portion > 0);

ALTER TABLE public.event_menu_items
  ADD COLUMN IF NOT EXISTS serve_key text
  GENERATED ALWAYS AS (lower(btrim(coalesce(serve_label, '')))) STORED;

ALTER TABLE public.event_menu_items DROP CONSTRAINT IF EXISTS event_menu_items_event_product_key;
ALTER TABLE public.event_menu_items DROP CONSTRAINT IF EXISTS event_menu_items_event_product_serve_key;
ALTER TABLE public.event_menu_items
  ADD CONSTRAINT event_menu_items_event_product_serve_key
  UNIQUE (event_id, product_id, serve_key);

COMMENT ON COLUMN public.event_menu_items.portion IS
  'How much of one serve this row sells. 1 is a full serve, 0.5 is a half. Cost and ordering multiply by this.';
COMMENT ON COLUMN public.event_menu_items.serve_key IS
  'Lower-case serve name. One product can have a pint row and a half row, not two rows with the same name.';

ALTER TABLE public.saved_menu_items
  ADD COLUMN IF NOT EXISTS portion numeric NOT NULL DEFAULT 1;

ALTER TABLE public.saved_menu_items DROP CONSTRAINT IF EXISTS saved_menu_items_portion_check;
ALTER TABLE public.saved_menu_items
  ADD CONSTRAINT saved_menu_items_portion_check CHECK (portion > 0);

ALTER TABLE public.saved_menu_items
  ADD COLUMN IF NOT EXISTS serve_key text
  GENERATED ALWAYS AS (lower(btrim(coalesce(serve_label, '')))) STORED;

ALTER TABLE public.saved_menu_items DROP CONSTRAINT IF EXISTS saved_menu_items_menu_product_key;
ALTER TABLE public.saved_menu_items DROP CONSTRAINT IF EXISTS saved_menu_items_menu_product_serve_key;
ALTER TABLE public.saved_menu_items
  ADD CONSTRAINT saved_menu_items_menu_product_serve_key
  UNIQUE (menu_id, product_id, serve_key);

COMMENT ON COLUMN public.saved_menu_items.portion IS
  'How much of one serve this saved row sells. Copied onto the event with the price.';

-- Scenario prices follow the menu row, so a pint and a half can differ.
ALTER TABLE public.scenario_prices
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES public.event_menu_items(id) ON DELETE CASCADE;

-- Drop the one-price-per-product key before copying a price onto each size.
ALTER TABLE public.scenario_prices DROP CONSTRAINT IF EXISTS scenario_prices_scenario_product_key;

INSERT INTO public.scenario_prices (org_id, scenario_id, product_id, menu_item_id, price)
SELECT sp.org_id, sp.scenario_id, sp.product_id, emi.id, sp.price
  FROM public.scenario_prices sp
  JOIN public.pricing_scenarios ps ON ps.id = sp.scenario_id
  JOIN public.event_menu_items emi
    ON emi.event_id = ps.event_id
   AND emi.product_id = sp.product_id
 WHERE sp.menu_item_id IS NULL;

DELETE FROM public.scenario_prices WHERE menu_item_id IS NULL;

ALTER TABLE public.scenario_prices DROP CONSTRAINT IF EXISTS scenario_prices_scenario_item_key;
ALTER TABLE public.scenario_prices
  ALTER COLUMN menu_item_id SET NOT NULL;
ALTER TABLE public.scenario_prices
  ADD CONSTRAINT scenario_prices_scenario_item_key UNIQUE (scenario_id, menu_item_id);

-- Saved menus copy each size, not one row per product.
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
  v_name      text := btrim(p_name);
  v_org       uuid;
  v_menu      uuid;
  v_existing  uuid;
  v_count     integer;
  v_cocktails integer;
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
  SELECT count(*) INTO v_cocktails
    FROM public.event_cocktails
   WHERE event_id = p_event AND included;
  IF v_count = 0 AND v_cocktails = 0 THEN
    RAISE EXCEPTION 'This event has nothing on the menu' USING ERRCODE = '22023';
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
    DELETE FROM public.saved_menu_cocktails WHERE menu_id = v_menu;
  END IF;

  INSERT INTO public.saved_menu_items
    (menu_id, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit, portion)
  SELECT v_menu, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit, portion
    FROM public.event_menu_items
   WHERE event_id = p_event AND included;

  INSERT INTO public.saved_menu_cocktails
    (menu_id, name, serve_label, menu_price, suggested_price, target_gp_pct, square_item_name, square_variation, drink_kind)
  SELECT v_menu, name, serve_label, menu_price, suggested_price, target_gp_pct, square_item_name, square_variation, drink_kind
    FROM public.event_cocktails
   WHERE event_id = p_event AND included;

  INSERT INTO public.saved_menu_cocktail_ingredients
    (cocktail_id, product_id, measures, position)
  SELECT smc.id, eci.product_id, eci.measures, eci.position
    FROM public.event_cocktails ec
    JOIN public.event_cocktail_ingredients eci ON eci.cocktail_id = ec.id
    JOIN public.saved_menu_cocktails smc
      ON smc.menu_id = v_menu
     AND lower(btrim(smc.name)) = lower(btrim(ec.name))
   WHERE ec.event_id = p_event AND ec.included;

  RETURN v_menu;
END;
$$;

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
  v_added     integer := 0;
  v_cocktails integer := 0;
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
    (event_id, product_id, included, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit, portion)
  SELECT p_event, s.product_id, true, s.menu_price, s.suggested_price, s.target_gp_pct, s.serve_label, s.serves_per_unit, s.portion
    FROM public.saved_menu_items s
   WHERE s.menu_id = p_menu
  ON CONFLICT (event_id, product_id, serve_key) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  UPDATE public.event_menu_items emi
     SET included = true
    FROM public.saved_menu_items s
   WHERE emi.event_id = p_event
     AND s.menu_id = p_menu
     AND s.product_id = emi.product_id
     AND emi.serve_key = s.serve_key
     AND emi.included IS DISTINCT FROM true;

  IF p_refresh_prices THEN
    UPDATE public.event_menu_items emi
       SET menu_price = s.menu_price,
           suggested_price = s.suggested_price,
           target_gp_pct = s.target_gp_pct,
           serve_label = s.serve_label,
           serves_per_unit = s.serves_per_unit,
           portion = s.portion,
           included = true
      FROM public.saved_menu_items s
     WHERE emi.event_id = p_event
       AND s.menu_id = p_menu
       AND s.product_id = emi.product_id
       AND emi.serve_key = s.serve_key;
  END IF;

  UPDATE public.event_cocktails ec
     SET included = true
    FROM public.saved_menu_cocktails s
   WHERE ec.event_id = p_event
     AND s.menu_id = p_menu
     AND lower(btrim(ec.name)) = lower(btrim(s.name))
     AND ec.included IS DISTINCT FROM true;

  INSERT INTO public.event_cocktails
    (event_id, name, included, serve_label, menu_price, suggested_price, target_gp_pct, square_item_name, square_variation, drink_kind)
  SELECT p_event, s.name, true, s.serve_label, s.menu_price, s.suggested_price, s.target_gp_pct, s.square_item_name, s.square_variation, s.drink_kind
    FROM public.saved_menu_cocktails s
   WHERE s.menu_id = p_menu
     AND NOT EXISTS (
       SELECT 1 FROM public.event_cocktails ec
        WHERE ec.event_id = p_event
          AND lower(btrim(ec.name)) = lower(btrim(s.name))
     );
  GET DIAGNOSTICS v_cocktails = ROW_COUNT;

  INSERT INTO public.event_cocktail_ingredients (cocktail_id, product_id, measures, position)
  SELECT ec.id, si.product_id, si.measures, si.position
    FROM public.saved_menu_cocktails s
    JOIN public.saved_menu_cocktail_ingredients si ON si.cocktail_id = s.id
    JOIN public.event_cocktails ec
      ON ec.event_id = p_event
     AND lower(btrim(ec.name)) = lower(btrim(s.name))
   WHERE s.menu_id = p_menu
     AND NOT EXISTS (
       SELECT 1 FROM public.event_cocktail_ingredients eci WHERE eci.cocktail_id = ec.id
     );

  IF p_refresh_prices THEN
    UPDATE public.event_cocktails ec
       SET menu_price = s.menu_price,
           suggested_price = s.suggested_price,
           target_gp_pct = s.target_gp_pct,
           serve_label = s.serve_label,
           square_item_name = s.square_item_name,
           square_variation = s.square_variation,
           drink_kind = s.drink_kind,
           included = true
      FROM public.saved_menu_cocktails s
     WHERE ec.event_id = p_event
       AND s.menu_id = p_menu
       AND lower(btrim(ec.name)) = lower(btrim(s.name));

    DELETE FROM public.event_cocktail_ingredients eci
     USING public.event_cocktails ec, public.saved_menu_cocktails s
     WHERE eci.cocktail_id = ec.id
       AND ec.event_id = p_event
       AND s.menu_id = p_menu
       AND lower(btrim(ec.name)) = lower(btrim(s.name));

    INSERT INTO public.event_cocktail_ingredients (cocktail_id, product_id, measures, position)
    SELECT ec.id, si.product_id, si.measures, si.position
      FROM public.saved_menu_cocktails s
      JOIN public.saved_menu_cocktail_ingredients si ON si.cocktail_id = s.id
      JOIN public.event_cocktails ec
        ON ec.event_id = p_event
       AND lower(btrim(ec.name)) = lower(btrim(s.name))
     WHERE s.menu_id = p_menu;
  END IF;

  RETURN v_added + v_cocktails;
END;
$$;

-- House prices still match one serve name, so a pint already on the event is left alone.
CREATE OR REPLACE FUNCTION public.seed_event_menu(p_event uuid, p_refresh_prices boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year  uuid;
  v_count integer := 0;
  v_n     integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can edit event menus' USING ERRCODE = '42501';
  END IF;
  SELECT price_year_id INTO v_year FROM public.events WHERE id = p_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_year IS NOT NULL THEN
    INSERT INTO public.event_menu_items
      (event_id, product_id, included, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit)
    SELECT p_event, h.product_id, true, h.menu_price, h.suggested_price, h.target_gp_pct, h.serve_label, h.serves_per_unit
      FROM public.house_menu_prices h
     WHERE h.price_year_id = v_year
    ON CONFLICT (event_id, product_id, serve_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_count := v_count + v_n;

    IF p_refresh_prices THEN
      UPDATE public.event_menu_items emi
         SET menu_price = h.menu_price,
             suggested_price = h.suggested_price,
             target_gp_pct = COALESCE(h.target_gp_pct, emi.target_gp_pct)
        FROM public.house_menu_prices h
       WHERE emi.event_id = p_event
         AND h.price_year_id = v_year
         AND h.product_id = emi.product_id
         AND emi.serve_key = lower(btrim(coalesce(h.serve_label, '')));
    END IF;
  END IF;

  INSERT INTO public.event_menu_items (event_id, product_id, included)
  SELECT p_event, ep.product_id, true
    FROM public.event_products ep
   WHERE ep.event_id = p_event
  ON CONFLICT (event_id, product_id, serve_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_count + v_n;
END;
$$;

-- Keep every serve when two products are merged. A clashing serve name stays with the keeper.
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

  UPDATE public.event_menu_items e
     SET product_id = p_keep
   WHERE e.product_id = ANY(v_dups)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_menu_items k
        WHERE k.event_id = e.event_id
          AND k.product_id = p_keep
          AND k.serve_key = e.serve_key
     );
  DELETE FROM public.event_menu_items WHERE product_id = ANY(v_dups);

  UPDATE public.scenario_prices SET product_id = p_keep
   WHERE product_id = ANY(v_dups);

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
    UPDATE public.saved_menu_items s
       SET product_id = p_keep
     WHERE s.product_id = ANY(v_dups)
       AND NOT EXISTS (
         SELECT 1 FROM public.saved_menu_items k
          WHERE k.menu_id = s.menu_id
            AND k.product_id = p_keep
            AND k.serve_key = s.serve_key
       );
    DELETE FROM public.saved_menu_items WHERE product_id = ANY(v_dups);
  END IF;

  IF to_regclass('public.event_cocktail_ingredients') IS NOT NULL THEN
    INSERT INTO public.event_cocktail_ingredients (cocktail_id, product_id, measures, position)
    SELECT cocktail_id, p_keep, sum(measures), min(position)
      FROM public.event_cocktail_ingredients
     WHERE product_id = p_keep OR product_id = ANY(v_dups)
     GROUP BY cocktail_id
    HAVING bool_or(product_id = ANY(v_dups))
    ON CONFLICT (cocktail_id, product_id) DO UPDATE
      SET measures = EXCLUDED.measures;
    DELETE FROM public.event_cocktail_ingredients WHERE product_id = ANY(v_dups);
  END IF;

  IF to_regclass('public.saved_menu_cocktail_ingredients') IS NOT NULL THEN
    INSERT INTO public.saved_menu_cocktail_ingredients (cocktail_id, product_id, measures, position)
    SELECT cocktail_id, p_keep, sum(measures), min(position)
      FROM public.saved_menu_cocktail_ingredients
     WHERE product_id = p_keep OR product_id = ANY(v_dups)
     GROUP BY cocktail_id
    HAVING bool_or(product_id = ANY(v_dups))
    ON CONFLICT (cocktail_id, product_id) DO UPDATE
      SET measures = EXCLUDED.measures;
    DELETE FROM public.saved_menu_cocktail_ingredients WHERE product_id = ANY(v_dups);
  END IF;

  PERFORM set_config('app.pricing_snapshot', 'off', true);
  PERFORM set_config('app.product_merge', 'off', true);
END;
$$;
