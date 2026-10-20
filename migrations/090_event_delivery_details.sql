-- =====================================================================
-- 090 — Delivery details for purchase orders
-- =====================================================================
-- What3Words, the on-site contact and a driver fact sheet live on the
-- event and are printed on every purchase order. Each order also carries
-- an AM/PM delivery window next to its delivery date.
--
-- The fact sheet file itself is stored in the public event-images bucket
-- (PDF or image). Only the URL and original filename are on the event.
--
-- Apply: AFTER 089
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS what3words text,
  ADD COLUMN IF NOT EXISTS delivery_contact_name text,
  ADD COLUMN IF NOT EXISTS delivery_contact_phone text,
  ADD COLUMN IF NOT EXISTS delivery_fact_sheet_url text,
  ADD COLUMN IF NOT EXISTS delivery_fact_sheet_name text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS delivery_time text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_what3words_len') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_what3words_len CHECK (what3words IS NULL OR char_length(what3words) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_delivery_contact_name_len') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_delivery_contact_name_len CHECK (delivery_contact_name IS NULL OR char_length(delivery_contact_name) <= 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_delivery_contact_phone_len') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_delivery_contact_phone_len CHECK (delivery_contact_phone IS NULL OR char_length(delivery_contact_phone) <= 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_delivery_fact_sheet_url_len') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_delivery_fact_sheet_url_len CHECK (delivery_fact_sheet_url IS NULL OR char_length(delivery_fact_sheet_url) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_delivery_fact_sheet_name_len') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_delivery_fact_sheet_name_len CHECK (delivery_fact_sheet_name IS NULL OR char_length(delivery_fact_sheet_name) <= 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_delivery_time_check') THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_delivery_time_check CHECK (delivery_time IS NULL OR delivery_time IN ('am', 'pm'));
  END IF;
END $$;

COMMENT ON COLUMN public.events.what3words IS
  'what3words address for the venue, shown on purchase orders.';
COMMENT ON COLUMN public.events.delivery_contact_name IS
  'On-site delivery point of contact, shown on purchase orders.';
COMMENT ON COLUMN public.events.delivery_contact_phone IS
  'Phone number for the on-site delivery contact.';
COMMENT ON COLUMN public.events.delivery_fact_sheet_url IS
  'Public URL of the driver fact sheet (PDF or image) attached to purchase orders.';
COMMENT ON COLUMN public.events.delivery_fact_sheet_name IS
  'Original filename of the driver fact sheet.';
COMMENT ON COLUMN public.purchase_orders.delivery_time IS
  'Requested delivery window: am or pm. Null until set.';

-- Cancelled orders keep the same lock as the delivery date.
CREATE OR REPLACE FUNCTION public.purchase_orders_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
BEGIN
  IF public.event_pricing_locked(v_event) THEN
    RAISE EXCEPTION 'Orders are locked for reconciled or archived events' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft orders can be deleted — cancel % instead', OLD.reference USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'sent') THEN
      RAISE EXCEPTION 'New orders start as draft or sent' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'sent' THEN NEW.sent_at := COALESCE(NEW.sent_at, now()); END IF;
    RETURN NEW;
  END IF;

  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'An order cannot move to another event' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('sent', 'confirmed', 'cancelled'))
      OR (OLD.status = 'sent' AND NEW.status IN ('draft', 'confirmed', 'cancelled'))
      OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Order % cannot go from % to %', OLD.reference, OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE po_id = NEW.id) THEN
      RAISE EXCEPTION 'Order % has no lines', OLD.reference USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'sent' THEN NEW.sent_at := COALESCE(NEW.sent_at, now()); END IF;
    IF NEW.status = 'confirmed' THEN NEW.confirmed_at := now(); END IF;
    IF NEW.status = 'cancelled' THEN NEW.cancelled_at := now(); END IF;
  END IF;

  IF OLD.status IN ('confirmed', 'cancelled') AND (
    NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
    OR NEW.reference IS DISTINCT FROM OLD.reference
    OR NEW.order_date IS DISTINCT FROM OLD.order_date
  ) THEN
    RAISE EXCEPTION 'Order % is % — supplier, reference and date are fixed', OLD.reference, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'cancelled' AND (
    NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
    OR NEW.delivery_time IS DISTINCT FROM OLD.delivery_time
    OR NEW.supplier_ref IS DISTINCT FROM OLD.supplier_ref
  ) THEN
    RAISE EXCEPTION 'Order % is cancelled', OLD.reference USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_orders_guard() FROM PUBLIC, anon, authenticated;
