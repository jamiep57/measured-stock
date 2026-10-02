-- =====================================================================
-- 069 — Purchase orders (order forms, references, history)
-- =====================================================================
-- Background:
--   purchase_orders / purchase_order_lines record what was ordered from
--   which supplier, when, under which reference. Status flow:
--     draft → sent → confirmed      (draft → confirmed allowed)
--     draft | sent | confirmed → cancelled
--   Lines are editable only while draft or sent. Confirmed / cancelled
--   orders are kept as history (never deleted; drafts may be deleted).
--
--   Orders are a ledger of intent, NOT physical stock. Confirming an
--   order only makes sure the product is listed on the event with zero
--   quantities; it never writes qty_ordered, delivered_qty or any stock
--   table (opening stock falls back to qty_ordered, so writing it would
--   create stock that never arrived).
--
--   events.order_buffer_pct pads planned quantities (e.g. 10% safety).
--
-- Apply: AFTER 068
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS order_buffer_pct numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_order_buffer_pct_check') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_order_buffer_pct_check CHECK (order_buffer_pct >= 0 AND order_buffer_pct <= 200);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organisations(id),
  event_id       uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  supplier_id    uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  reference      text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 1 AND 40),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'cancelled')),
  order_date     date NOT NULL DEFAULT CURRENT_DATE,
  delivery_date  date,
  supplier_ref   text CHECK (supplier_ref IS NULL OR char_length(supplier_ref) <= 80),
  notes          text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_by     uuid DEFAULT auth.uid(),
  sent_at        timestamptz,
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_org_reference_key UNIQUE (org_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_event ON public.purchase_orders (event_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders (supplier_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations(id),
  po_id       uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_cases   numeric NOT NULL CHECK (qty_cases > 0 AND qty_cases <= 100000),
  case_price  numeric CHECK (case_price IS NULL OR case_price >= 0),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_lines_po_product_key UNIQUE (po_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_product ON public.purchase_order_lines (product_id);

-- Allow the event / supplier links to be checked against the PO's org.
SELECT public.tenant_enable('purchase_orders', '''derive:event_id:events'',''check:supplier_id:suppliers''', true);
SELECT public.tenant_enable('purchase_order_lines', '''derive:po_id:purchase_orders'',''check:product_id:products''', true);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.purchase_orders;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- ---------- reference numbering --------------------------------------
-- PO-00001 style per organisation when no reference is supplied.

CREATE OR REPLACE FUNCTION public.purchase_orders_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    SELECT COALESCE(max((substring(reference FROM '^PO-(\d+)$'))::integer), 0) + 1
      INTO v_next
      FROM public.purchase_orders
     WHERE org_id = NEW.org_id;
    NEW.reference := 'PO-' || lpad(v_next::text, 5, '0');
  ELSE
    NEW.reference := btrim(NEW.reference);
  END IF;
  RETURN NEW;
END;
$$;

-- Runs after the tenant guard (aa_) has resolved org_id.
DROP TRIGGER IF EXISTS ab_purchase_orders_defaults ON public.purchase_orders;
CREATE TRIGGER ab_purchase_orders_defaults BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_defaults();

-- ---------- status + immutability guards -----------------------------

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
    OR NEW.supplier_ref IS DISTINCT FROM OLD.supplier_ref
  ) THEN
    RAISE EXCEPTION 'Order % is cancelled', OLD.reference USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_orders_guard ON public.purchase_orders;
CREATE TRIGGER purchase_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard();

-- Lines follow their order: editable while draft / sent only. Cascaded
-- deletes of a draft order pass because the parent row is already gone.
CREATE OR REPLACE FUNCTION public.purchase_order_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po     uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.po_id ELSE NEW.po_id END;
  v_status text;
  v_ref    text;
  v_supplier uuid;
BEGIN
  -- merge_products (070) repoints rows from duplicate products.
  IF current_setting('app.product_merge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status, reference, supplier_id INTO v_status, v_ref, v_supplier
    FROM public.purchase_orders WHERE id = v_po;
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF v_status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'Order % is % — lines cannot change', v_ref, v_status USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.po_id IS DISTINCT FROM OLD.po_id THEN
    RAISE EXCEPTION 'A line cannot move to another order' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.case_price IS NULL THEN
    SELECT ps.case_price INTO NEW.case_price
      FROM public.product_suppliers ps
     WHERE ps.product_id = NEW.product_id AND ps.supplier_id = v_supplier
     ORDER BY ps.is_preferred DESC NULLS LAST
     LIMIT 1;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS purchase_order_lines_guard ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_order_lines_guard();

-- ---------- confirm RPC ----------------------------------------------
-- Confirms an order and lists its products on the event with zero
-- quantities (so deliveries / counts can record them). Never writes
-- stock quantities.

CREATE OR REPLACE FUNCTION public.confirm_purchase_order(p_po uuid, p_supplier_ref text DEFAULT NULL)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.purchase_orders%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm orders' USING ERRCODE = '42501';
  END IF;

  UPDATE public.purchase_orders
     SET status = 'confirmed',
         supplier_ref = COALESCE(NULLIF(btrim(p_supplier_ref), ''), supplier_ref)
   WHERE id = p_po
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.event_products (event_id, product_id, qty_ordered)
  SELECT v_row.event_id, l.product_id, 0
    FROM public.purchase_order_lines l
   WHERE l.po_id = p_po
     AND NOT EXISTS (
       SELECT 1 FROM public.event_products ep
        WHERE ep.event_id = v_row.event_id AND ep.product_id = l.product_id
     );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_order(uuid, text) TO authenticated;

-- =====================================================================
-- Verify:
--   SELECT reference, status FROM public.purchase_orders ORDER BY created_at DESC LIMIT 5;
-- =====================================================================
