-- Hidden practice event for the admin walkthrough.
-- One sample event per organisation. Event pickers omit is_sample rows.
-- ensure_walkthrough_event() creates it and optionally clears planning data.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS events_one_sample_per_org
  ON public.events (org_id) WHERE is_sample;

COMMENT ON COLUMN public.events.is_sample IS
  'Practice event for the admin walkthrough. Hidden from event lists.';

CREATE OR REPLACE FUNCTION public.ensure_walkthrough_event(p_reset boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_event uuid;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organisation' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_event
  FROM public.events
  WHERE org_id = v_org AND is_sample
  LIMIT 1;

  IF v_event IS NULL THEN
    INSERT INTO public.events (org_id, name, status, is_sample)
    VALUES (v_org, 'Walkthrough', 'draft', true)
    RETURNING id INTO v_event;
    RETURN v_event;
  END IF;

  IF p_reset THEN
    DELETE FROM public.purchase_orders WHERE event_id = v_event;
    DELETE FROM public.forecast_imports WHERE event_id = v_event;
    DELETE FROM public.event_cocktails WHERE event_id = v_event;
    DELETE FROM public.event_menu_items WHERE event_id = v_event;
    DELETE FROM public.event_products WHERE event_id = v_event;
    UPDATE public.events
    SET target_revenue = NULL,
        order_buffer_pct = 0
    WHERE id = v_event;
  END IF;

  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_walkthrough_event(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_walkthrough_event(boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
