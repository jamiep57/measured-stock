-- =====================================================================
-- 075 — Freeze library prices onto the event
-- =====================================================================
-- Recon reads the price captured when a product joins an event.
-- Later edits to the library (product or supplier offer) do not
-- rewrite that copy, so existing events keep the same recon.
-- A product added after the library change picks up the new price.
--
-- Apply: AFTER 074
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.event_products
  ADD COLUMN IF NOT EXISTS case_price_snapshot numeric,
  ADD COLUMN IF NOT EXISTS unit_price_snapshot numeric,
  ADD COLUMN IF NOT EXISTS prices_captured_at timestamptz;

COMMENT ON COLUMN public.event_products.case_price_snapshot IS
  'Case price copied from the library when this product joined the event. Library edits do not update it.';
COMMENT ON COLUMN public.event_products.unit_price_snapshot IS
  'Unit price copied from the library when this product joined the event. Library edits do not update it.';
COMMENT ON COLUMN public.event_products.prices_captured_at IS
  'When the library price was copied onto this event. Null only for rows captured before this column existed.';

-- Preferred supplier offer, else the product's own price. Same order recon uses.
CREATE OR REPLACE FUNCTION public.product_library_prices(p_product uuid)
RETURNS TABLE (case_price numeric, unit_price numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH p AS (
    SELECT id, units_per_case, unit_price, case_price
      FROM public.products
     WHERE id = p_product
  ),
  offer AS (
    SELECT ps.case_price, ps.unit_price
      FROM public.product_suppliers ps
      JOIN p ON p.id = ps.product_id
     WHERE ps.case_price IS NOT NULL OR ps.unit_price IS NOT NULL
     ORDER BY ps.is_preferred DESC, ps.created_at ASC
     LIMIT 1
  )
  SELECT
    COALESCE(o.case_price, p.case_price),
    COALESCE(
      o.unit_price,
      o.case_price / NULLIF(p.units_per_case, 0),
      p.unit_price,
      p.case_price / NULLIF(p.units_per_case, 0)
    )
  FROM p
  LEFT JOIN offer o ON true;
$$;

CREATE OR REPLACE FUNCTION public.event_products_capture_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case numeric;
  v_unit numeric;
BEGIN
  IF NEW.prices_captured_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT src.case_price, src.unit_price INTO v_case, v_unit
    FROM public.product_library_prices(NEW.product_id) src;
  NEW.case_price_snapshot := v_case;
  NEW.unit_price_snapshot := v_unit;
  NEW.prices_captured_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_products_capture_price ON public.event_products;
CREATE TRIGGER event_products_capture_price
  BEFORE INSERT ON public.event_products
  FOR EACH ROW EXECUTE FUNCTION public.event_products_capture_price();

-- Existing events keep the price recon is using today.
UPDATE public.event_products ep
   SET case_price_snapshot = src.case_price,
       unit_price_snapshot = src.unit_price,
       prices_captured_at = now()
  FROM (
    SELECT ep2.id, prices.case_price, prices.unit_price
      FROM public.event_products ep2
      CROSS JOIN LATERAL public.product_library_prices(ep2.product_id) AS prices
  ) src
 WHERE ep.id = src.id
   AND ep.prices_captured_at IS NULL;

REVOKE ALL ON FUNCTION public.product_library_prices(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_products_capture_price() FROM PUBLIC;
