-- Adding a product on Menu & GP also puts it on the event’s Products list.
-- Ordered quantity already on the event is left as it is.
-- Taking a product off the menu leaves it on Products.

BEGIN;

CREATE OR REPLACE FUNCTION public.attach_event_product(p_event uuid, p_product uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event IS NULL OR p_product IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.event_products (event_id, product_id)
  VALUES (p_event, p_product)
  ON CONFLICT (event_id, product_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_event_product(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_menu_item_to_event_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.included THEN
    PERFORM public.attach_event_product(NEW.event_id, NEW.product_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_menu_item_to_event_product() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_menu_items_sync_event_product ON public.event_menu_items;
CREATE TRIGGER event_menu_items_sync_event_product
  AFTER INSERT OR UPDATE OF included ON public.event_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_menu_item_to_event_product();

CREATE OR REPLACE FUNCTION public.sync_cocktail_ingredient_to_event_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid;
  v_included boolean;
BEGIN
  SELECT event_id, included INTO v_event, v_included
    FROM public.event_cocktails
   WHERE id = NEW.cocktail_id;
  IF v_event IS NOT NULL AND v_included IS DISTINCT FROM false THEN
    PERFORM public.attach_event_product(v_event, NEW.product_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_cocktail_ingredient_to_event_product() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_cocktail_ingredients_sync_event_product ON public.event_cocktail_ingredients;
CREATE TRIGGER event_cocktail_ingredients_sync_event_product
  AFTER INSERT ON public.event_cocktail_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.sync_cocktail_ingredient_to_event_product();

CREATE OR REPLACE FUNCTION public.sync_cocktail_to_event_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.included AND OLD.included IS DISTINCT FROM true THEN
    INSERT INTO public.event_products (event_id, product_id)
    SELECT NEW.event_id, eci.product_id
      FROM public.event_cocktail_ingredients eci
     WHERE eci.cocktail_id = NEW.id
    ON CONFLICT (event_id, product_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_cocktail_to_event_products() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_cocktails_sync_event_products ON public.event_cocktails;
CREATE TRIGGER event_cocktails_sync_event_products
  AFTER UPDATE OF included ON public.event_cocktails
  FOR EACH ROW EXECUTE FUNCTION public.sync_cocktail_to_event_products();

-- Products already on a menu should show on Products too.
INSERT INTO public.event_products (event_id, product_id)
SELECT DISTINCT emi.event_id, emi.product_id
  FROM public.event_menu_items emi
 WHERE emi.included
ON CONFLICT (event_id, product_id) DO NOTHING;

INSERT INTO public.event_products (event_id, product_id)
SELECT DISTINCT ec.event_id, eci.product_id
  FROM public.event_cocktail_ingredients eci
  JOIN public.event_cocktails ec ON ec.id = eci.cocktail_id
 WHERE ec.included
ON CONFLICT (event_id, product_id) DO NOTHING;

COMMIT;
