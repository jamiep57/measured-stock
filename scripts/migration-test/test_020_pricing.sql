-- Price years, house / event menus, locks, cost snapshots, admin-only access.
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

INSERT INTO public.products (id, name, units_per_case, unit_price)
VALUES ('00000000-0000-0000-0000-0000000000f1', 'Lager keg', 1, 90);
INSERT INTO public.price_years (id, label, vat_rate, default_target_gp_pct)
VALUES ('00000000-0000-0000-0000-000000000101', '2026', 0.2, 70);
INSERT INTO public.house_menu_prices (price_year_id, product_id, menu_price, target_gp_pct, serves_per_unit)
VALUES ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000f1', 6.50, 72, 88);

INSERT INTO public.events (id, name, status, price_year_id)
VALUES ('00000000-0000-0000-0000-0000000000e1', 'Festival 2026', 'active', '00000000-0000-0000-0000-000000000101');

DO $$
BEGIN
  ASSERT public.seed_event_menu('00000000-0000-0000-0000-0000000000e1') = 1, 'seed copies house menu';
  ASSERT (SELECT menu_price FROM public.event_menu_items WHERE event_id = '00000000-0000-0000-0000-0000000000e1') = 6.50,
    'event menu copies house price';
  ASSERT public.seed_event_menu('00000000-0000-0000-0000-0000000000e1') = 0, 'reseed is idempotent';
END $$;

-- Rolling into a new year never changes the source year or event menu.
DO $$
DECLARE v_new uuid;
BEGIN
  v_new := public.roll_price_year('00000000-0000-0000-0000-000000000101', '2027', 5, 0.10);
  ASSERT (SELECT menu_price FROM public.house_menu_prices WHERE price_year_id = v_new) = 6.90,
    'uplift 6.50 * 1.05 = 6.825 rounds up to 6.90';
  ASSERT (SELECT menu_price FROM public.house_menu_prices WHERE price_year_id = '00000000-0000-0000-0000-000000000101') = 6.50,
    'source year unchanged';
  UPDATE public.house_menu_prices SET menu_price = 7.20 WHERE price_year_id = v_new;
  ASSERT (SELECT menu_price FROM public.event_menu_items WHERE event_id = '00000000-0000-0000-0000-0000000000e1') = 6.50,
    'future year edits do not touch event menus';
END $$;

-- Locked price year freezes house prices.
UPDATE public.price_years SET status = 'locked' WHERE id = '00000000-0000-0000-0000-000000000101';
DO $$
BEGIN
  BEGIN
    UPDATE public.house_menu_prices SET menu_price = 1 WHERE price_year_id = '00000000-0000-0000-0000-000000000101';
    RAISE EXCEPTION 'locked year edit should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'locked year edit should fail' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.price_years SET vat_rate = 0.1 WHERE id = '00000000-0000-0000-0000-000000000101';
    RAISE EXCEPTION 'locked year vat edit should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'locked year vat edit should fail' THEN RAISE; END IF;
  END;
END $$;

-- Reconciling snapshots costs and freezes the event menu.
UPDATE public.events SET status = 'reconciled' WHERE id = '00000000-0000-0000-0000-0000000000e1';
DO $$
BEGIN
  ASSERT (SELECT unit_cost_snapshot FROM public.event_menu_items WHERE event_id = '00000000-0000-0000-0000-0000000000e1') = 90,
    'reconcile snapshots unit cost';
  BEGIN
    UPDATE public.event_menu_items SET menu_price = 1 WHERE event_id = '00000000-0000-0000-0000-0000000000e1';
    RAISE EXCEPTION 'reconciled menu edit should fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'reconciled menu edit should fail' THEN RAISE; END IF;
  END;
END $$;

-- Later product cost changes leave the snapshot alone.
UPDATE public.products SET unit_price = 120 WHERE id = '00000000-0000-0000-0000-0000000000f1';
DO $$
BEGIN
  ASSERT (SELECT unit_cost_snapshot FROM public.event_menu_items WHERE event_id = '00000000-0000-0000-0000-0000000000e1') = 90,
    'snapshot survives cost change';
END $$;

-- Staff cannot read planning data.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.event_menu_items) = 0, 'staff cannot see menu items';
  ASSERT (SELECT count(*) FROM public.price_years) = 0, 'staff cannot see price years';
END $$;

ROLLBACK;
