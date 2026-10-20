-- =====================================================================
-- 091 — VAT on or off for a purchase order
-- =====================================================================
-- Case prices stay ex VAT. When include_vat is true the order adds UK
-- VAT at 20%. When false the payable total is the ex-VAT order value.
-- Existing orders keep VAT on.
--
-- Apply: AFTER 090
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS include_vat boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.purchase_orders.include_vat IS
  'When true, the purchase order total adds UK VAT at 20%. Case prices stay ex VAT.';

-- Confirmed and cancelled orders cannot change whether VAT applies.
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
    OR NEW.include_vat IS DISTINCT FROM OLD.include_vat
  ) THEN
    RAISE EXCEPTION 'Order % is % — supplier, reference, date and VAT are fixed', OLD.reference, OLD.status USING ERRCODE = 'P0001';
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
