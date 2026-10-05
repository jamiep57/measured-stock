-- =====================================================================
-- 077 — Cocktails on the event menu
-- =====================================================================
-- A cocktail is sold as one drink. Its cost is the stock products in
-- the recipe: each ingredient is a number of that product's serves
-- (a double is 2). Saved menus keep the recipe so it can be applied
-- to another event. Projected serves and deal costs stay on the event.
--
-- Apply: AFTER 076
-- Idempotent: yes
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.event_cocktails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organisations(id),
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  included         boolean NOT NULL DEFAULT true,
  serve_label      text CHECK (serve_label IS NULL OR char_length(serve_label) <= 40),
  menu_price       numeric CHECK (menu_price IS NULL OR menu_price >= 0),
  suggested_price  numeric CHECK (suggested_price IS NULL OR suggested_price >= 0),
  target_gp_pct    numeric CHECK (target_gp_pct IS NULL OR (target_gp_pct > -100 AND target_gp_pct < 100)),
  projected_serves numeric CHECK (projected_serves IS NULL OR projected_serves >= 0),
  sort_order       integer,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_cocktails_event_name_key
  ON public.event_cocktails (event_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_event_cocktails_event ON public.event_cocktails (event_id);

COMMENT ON TABLE public.event_cocktails IS
  'A drink sold as one menu item. Cost is the sum of its stock-product serves.';
COMMENT ON COLUMN public.event_cocktails.serve_label IS
  'Optional serve printed on the menu, e.g. Coupe or Rocks.';

CREATE TABLE IF NOT EXISTS public.event_cocktail_ingredients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations(id),
  cocktail_id uuid NOT NULL REFERENCES public.event_cocktails(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  measures    numeric NOT NULL CHECK (measures > 0),
  position    integer NOT NULL DEFAULT 0,
  CONSTRAINT event_cocktail_ingredients_cocktail_product_key UNIQUE (cocktail_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_event_cocktail_ingredients_product
  ON public.event_cocktail_ingredients (product_id);

COMMENT ON COLUMN public.event_cocktail_ingredients.measures IS
  'How many of this product''s menu serves go into one cocktail. 1 is a single, 2 is a double.';

CREATE TABLE IF NOT EXISTS public.saved_menu_cocktails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organisations(id),
  menu_id         uuid NOT NULL REFERENCES public.saved_menus(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  serve_label     text CHECK (serve_label IS NULL OR char_length(serve_label) <= 40),
  menu_price      numeric CHECK (menu_price IS NULL OR menu_price >= 0),
  suggested_price numeric CHECK (suggested_price IS NULL OR suggested_price >= 0),
  target_gp_pct   numeric CHECK (target_gp_pct IS NULL OR (target_gp_pct > -100 AND target_gp_pct < 100)),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_menu_cocktails_menu_name_key
  ON public.saved_menu_cocktails (menu_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.saved_menu_cocktail_ingredients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations(id),
  cocktail_id uuid NOT NULL REFERENCES public.saved_menu_cocktails(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  measures    numeric NOT NULL CHECK (measures > 0),
  position    integer NOT NULL DEFAULT 0,
  CONSTRAINT saved_menu_cocktail_ingredients_key UNIQUE (cocktail_id, product_id)
);

COMMENT ON TABLE public.saved_menu_cocktails IS
  'Cocktail recipes stored with a saved menu. Projected serves stay on the event.';

SELECT public.tenant_enable('event_cocktails', '''derive:event_id:events''', true);
SELECT public.tenant_enable('event_cocktail_ingredients', '''derive:cocktail_id:event_cocktails'',''check:product_id:products''', true);
SELECT public.tenant_enable('saved_menu_cocktails', '''derive:menu_id:saved_menus''', true);
SELECT public.tenant_enable('saved_menu_cocktail_ingredients', '''derive:cocktail_id:saved_menu_cocktails'',''check:product_id:products''', true);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.event_cocktails;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.event_cocktails
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- Freeze cocktail rows with the rest of the event menu.
CREATE OR REPLACE FUNCTION public.event_pricing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_event uuid;
BEGIN
  IF current_setting('app.pricing_snapshot', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_ARGV[0] = 'scenario' THEN
    SELECT event_id INTO v_event FROM public.pricing_scenarios WHERE id = (rec ->> 'scenario_id')::uuid;
  ELSIF TG_ARGV[0] = 'cocktail' THEN
    SELECT event_id INTO v_event FROM public.event_cocktails WHERE id = (rec ->> 'cocktail_id')::uuid;
  ELSE
    v_event := (rec ->> 'event_id')::uuid;
  END IF;

  IF public.event_pricing_locked(v_event) THEN
    RAISE EXCEPTION 'Pricing is locked for reconciled or archived events' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS event_pricing_guard ON public.event_cocktails;
CREATE TRIGGER event_pricing_guard BEFORE INSERT OR UPDATE OR DELETE ON public.event_cocktails
  FOR EACH ROW EXECUTE FUNCTION public.event_pricing_guard('event');
DROP TRIGGER IF EXISTS event_pricing_guard ON public.event_cocktail_ingredients;
CREATE TRIGGER event_pricing_guard BEFORE INSERT OR UPDATE OR DELETE ON public.event_cocktail_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.event_pricing_guard('cocktail');

-- Saved menus copy cocktails as well as products.
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
    (menu_id, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit)
  SELECT v_menu, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit
    FROM public.event_menu_items
   WHERE event_id = p_event AND included;

  INSERT INTO public.saved_menu_cocktails
    (menu_id, name, serve_label, menu_price, suggested_price, target_gp_pct)
  SELECT v_menu, name, serve_label, menu_price, suggested_price, target_gp_pct
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

  UPDATE public.event_cocktails ec
     SET included = true
    FROM public.saved_menu_cocktails s
   WHERE ec.event_id = p_event
     AND s.menu_id = p_menu
     AND lower(btrim(ec.name)) = lower(btrim(s.name))
     AND ec.included IS DISTINCT FROM true;

  INSERT INTO public.event_cocktails
    (event_id, name, included, serve_label, menu_price, suggested_price, target_gp_pct)
  SELECT p_event, s.name, true, s.serve_label, s.menu_price, s.suggested_price, s.target_gp_pct
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

-- Fold cocktail ingredients when two products are merged.
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
