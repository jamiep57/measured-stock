-- merge_products folds planning + purchase order rows into the keeper.
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
  ('00000000-0000-0000-0000-0000000000b1', 'Lager', 1),
  ('00000000-0000-0000-0000-0000000000d1', 'Lager (dup)', 1);
INSERT INTO public.events (id, name, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'Only dup on menu', 'active'),
  ('00000000-0000-0000-0000-0000000000e2', 'Both on menu', 'active');

INSERT INTO public.price_years (id, label) VALUES ('00000000-0000-0000-0000-0000000000c1', '2026');
INSERT INTO public.house_menu_prices (price_year_id, product_id, menu_price)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 6.5);
UPDATE public.price_years SET status = 'locked' WHERE id = '00000000-0000-0000-0000-0000000000c1';

INSERT INTO public.event_menu_items (event_id, product_id, menu_price) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 7),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', 8),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 9);

INSERT INTO public.purchase_orders (id, event_id, supplier_id)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000051');
INSERT INTO public.purchase_order_lines (po_id, product_id, qty_cases) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 2),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 3);
SELECT public.confirm_purchase_order('00000000-0000-0000-0000-0000000000a1');

-- Staff cannot merge.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.merge_products('00000000-0000-0000-0000-0000000000b1', ARRAY['00000000-0000-0000-0000-0000000000d1']::uuid[]);
    RAISE EXCEPTION 'staff merge should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
SELECT public.merge_products('00000000-0000-0000-0000-0000000000b1', ARRAY['00000000-0000-0000-0000-0000000000d1']::uuid[]);

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.products WHERE id = '00000000-0000-0000-0000-0000000000d1'), 'duplicate deleted';
  ASSERT (SELECT menu_price FROM public.house_menu_prices
           WHERE product_id = '00000000-0000-0000-0000-0000000000b1') = 6.5, 'locked-year house price carried over';
  ASSERT (SELECT menu_price FROM public.event_menu_items
           WHERE event_id = '00000000-0000-0000-0000-0000000000e1') = 7, 'dup-only menu row repointed';
  ASSERT (SELECT menu_price FROM public.event_menu_items
           WHERE event_id = '00000000-0000-0000-0000-0000000000e2') = 8, 'keeper menu row wins';
  ASSERT (SELECT count(*) FROM public.event_menu_items) = 2, 'no duplicate menu rows';
  ASSERT (SELECT qty_cases FROM public.purchase_order_lines
           WHERE po_id = '00000000-0000-0000-0000-0000000000a1') = 5, 'confirmed PO quantities summed';
  ASSERT (SELECT count(*) FROM public.purchase_order_lines) = 1, 'one PO line left';
  ASSERT coalesce(current_setting('app.product_merge', true), 'off') = 'off', 'merge flag cleared';
END $$;

-- Guards are back in force after the merge.
DO $$
BEGIN
  BEGIN
    UPDATE public.purchase_order_lines SET qty_cases = 1;
    RAISE EXCEPTION 'confirmed line edit should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'confirmed line edit should fail' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
