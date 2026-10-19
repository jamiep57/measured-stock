-- =====================================================================
-- 087 — A recipe chooses its menu category
-- =====================================================================
-- Cocktail and spirit & mixer were two fixed sections. A recipe now stores
-- the category it sits under. Existing rows keep the section they already
-- used. drink_kind stays so older copies of a saved menu still load.
--
-- Apply: AFTER 086
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.event_cocktails
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.saved_menu_cocktails
  ADD COLUMN IF NOT EXISTS category text;

UPDATE public.event_cocktails
   SET category = CASE WHEN drink_kind = 'spirit_mixer' THEN 'Spirit & mixers' ELSE 'Cocktails' END
 WHERE category IS NULL OR btrim(category) = '';

UPDATE public.saved_menu_cocktails
   SET category = CASE WHEN drink_kind = 'spirit_mixer' THEN 'Spirit & mixers' ELSE 'Cocktails' END
 WHERE category IS NULL OR btrim(category) = '';

ALTER TABLE public.event_cocktails
  ALTER COLUMN category SET DEFAULT 'Cocktails';
ALTER TABLE public.event_cocktails
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE public.saved_menu_cocktails
  ALTER COLUMN category SET DEFAULT 'Cocktails';
ALTER TABLE public.saved_menu_cocktails
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE public.event_cocktails DROP CONSTRAINT IF EXISTS event_cocktails_category_len;
ALTER TABLE public.event_cocktails ADD CONSTRAINT event_cocktails_category_len
  CHECK (char_length(btrim(category)) BETWEEN 1 AND 80);

ALTER TABLE public.saved_menu_cocktails DROP CONSTRAINT IF EXISTS saved_menu_cocktails_category_len;
ALTER TABLE public.saved_menu_cocktails ADD CONSTRAINT saved_menu_cocktails_category_len
  CHECK (char_length(btrim(category)) BETWEEN 1 AND 80);

COMMENT ON COLUMN public.event_cocktails.category IS
  'Menu section this recipe sits in, e.g. Cocktails or Draught beer.';
COMMENT ON COLUMN public.saved_menu_cocktails.category IS
  'Menu section copied with the saved recipe.';

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
    (menu_id, name, serve_label, menu_price, suggested_price, target_gp_pct, square_item_name, square_variation, drink_kind, category)
  SELECT v_menu, name, serve_label, menu_price, suggested_price, target_gp_pct, square_item_name, square_variation, drink_kind, category
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
    (event_id, name, included, serve_label, menu_price, suggested_price, target_gp_pct, square_item_name, square_variation, drink_kind, category)
  SELECT p_event, s.name, true, s.serve_label, s.menu_price, s.suggested_price, s.target_gp_pct, s.square_item_name, s.square_variation, s.drink_kind, s.category
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
           category = s.category,
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
