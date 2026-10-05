-- Purchase orders: numbering, status flow, immutability, stock integrity.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff@test');
UPDATE public.profiles SET status = 'active';
INSERT INTO public.organisation_members (org_id, profile_id, role) VALUES
  (public.default_org_id(), '00000000-0000-0000-0000-00000000000a', 'admin'),
  (public.default_org_id(), '00000000-0000-0000-0000-00000000000c', 'staff');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

INSERT INTO public.suppliers (id, name) VALUES ('00000000-0000-0000-0000-000000000051', 'Brewer');
INSERT INTO public.products (id, name, units_per_case) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Lager keg', 1),
  ('00000000-0000-0000-0000-0000000000f2', 'Cider can', 24);
INSERT INTO public.product_suppliers (product_id, supplier_id, case_price, is_preferred)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000051', 95, true);
INSERT INTO public.events (id, name, status) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Festival', 'active');
INSERT INTO public.event_products (event_id, product_id, qty_ordered)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 5);

INSERT INTO public.purchase_orders (id, event_id, supplier_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000051'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000051');

DO $$
BEGIN
  ASSERT (SELECT reference FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a1') = 'PO-00001', 'first reference';
  ASSERT (SELECT reference FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a2') = 'PO-00002', 'second reference';
END $$;

INSERT INTO public.purchase_order_lines (po_id, product_id, qty_cases) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 12),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2', 10);

DO $$
BEGIN
  ASSERT (SELECT case_price FROM public.purchase_order_lines WHERE product_id = '00000000-0000-0000-0000-0000000000f1') = 95,
    'line price defaults from supplier offer';
END $$;

-- Confirming an empty order fails.
DO $$
BEGIN
  BEGIN
    PERFORM public.confirm_purchase_order('00000000-0000-0000-0000-0000000000a2');
    RAISE EXCEPTION 'empty confirm should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'empty confirm should fail' THEN RAISE; END IF;
  END;
END $$;

SELECT public.confirm_purchase_order('00000000-0000-0000-0000-0000000000a1', 'BRW-778');

DO $$
BEGIN
  ASSERT (SELECT status FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a1') = 'confirmed', 'confirmed';
  ASSERT (SELECT supplier_ref FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a1') = 'BRW-778', 'supplier ref stored';
  ASSERT (SELECT confirmed_at FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a1') IS NOT NULL, 'confirmed_at set';
  -- Stock integrity: confirming never creates stock.
  ASSERT (SELECT qty_ordered FROM public.event_products
           WHERE product_id = '00000000-0000-0000-0000-0000000000f1') = 0, 'new event product has zero ordered';
  ASSERT (SELECT delivered_qty FROM public.event_products
           WHERE product_id = '00000000-0000-0000-0000-0000000000f1') IS NULL, 'nothing delivered';
  ASSERT (SELECT qty_ordered FROM public.event_products
           WHERE product_id = '00000000-0000-0000-0000-0000000000f2') = 5, 'existing manual order untouched';
  ASSERT (SELECT count(*) FROM public.delivery_lines) = 0, 'no deliveries created';
END $$;

-- Confirmed lines are immutable; confirmed orders cannot be deleted or reopened.
DO $$
BEGIN
  BEGIN
    UPDATE public.purchase_order_lines SET qty_cases = 99 WHERE po_id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'confirmed line edit should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'confirmed line edit should fail' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'confirmed delete should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'confirmed delete should fail' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.purchase_orders SET status = 'draft' WHERE id = '00000000-0000-0000-0000-0000000000a1';
    RAISE EXCEPTION 'reopen should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'reopen should fail' THEN RAISE; END IF;
  END;
END $$;

-- Cancelling keeps history.
UPDATE public.purchase_orders SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-0000000000a1';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.purchase_order_lines WHERE po_id = '00000000-0000-0000-0000-0000000000a1') = 2,
    'cancelled order keeps lines';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE table_name = 'purchase_orders') >= 3, 'order history audited';
END $$;

-- Draft orders can be deleted (lines cascade).
DELETE FROM public.purchase_orders WHERE id = '00000000-0000-0000-0000-0000000000a2';

-- Staff cannot see orders.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.purchase_orders) = 0, 'staff cannot see orders';
END $$;

ROLLBACK;
