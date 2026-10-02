-- Sales detail columns, loose stock allowances/payments: validation, tenancy, permissions, audit.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff@test');
UPDATE public.profiles SET status = 'active';
INSERT INTO public.organisation_members (org_id, profile_id, role) VALUES
  (public.default_org_id(), '00000000-0000-0000-0000-00000000000a', 'admin'),
  (public.default_org_id(), '00000000-0000-0000-0000-00000000000c', 'staff');
INSERT INTO public.organisations (id, name) VALUES ('00000000-0000-0000-0000-0000000000b0', 'Org B');
INSERT INTO public.organisation_members (org_id, profile_id, role)
VALUES ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-00000000000b', 'admin');

INSERT INTO public.events (id, org_id, name, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', public.default_org_id(), 'Festival', 'active');
INSERT INTO public.categories (id, org_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', public.default_org_id(), 'Spirits');
INSERT INTO public.products (id, org_id, name, category_id) VALUES
  ('00000000-0000-0000-0000-0000000000f1', public.default_org_id(), 'Vodka', '00000000-0000-0000-0000-0000000000c1');

-- Re-applying is safe.
\ir ../../migrations/072_sales_detail_loose_stock.sql

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

-- Sales rows keep location and date; legacy rows without them still insert.
INSERT INTO public.till_imports (id, event_id, file_name) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'items.csv');
INSERT INTO public.till_sale_rows (import_id, name, variation, items_sold, net_sales, gross_sales, location, sale_date) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Vodka Mixer', 'Regular', 10, 75, 90, 'Main Bar', '2026-07-01'),
  ('00000000-0000-0000-0000-0000000000d1', 'Vodka Mixer', 'Regular', 4, 30, 36, 'Stage Bar', '2026-07-02');
INSERT INTO public.till_sale_rows (import_id, name, items_sold) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Water', 3);
DO $$
BEGIN
  ASSERT (SELECT sum(items_sold) FROM public.till_sale_rows WHERE name = 'Vodka Mixer') = 14, 'detail rows kept';
  ASSERT (SELECT count(DISTINCT location) FROM public.till_sale_rows) = 2, 'locations stored';
END $$;

-- Allowances: exactly one of product / category, one per scope, non-negative.
INSERT INTO public.loose_stock_allowances (event_id, product_id, allowance_units) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 6);
INSERT INTO public.loose_stock_allowances (event_id, category_id, allowance_units) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 20);
DO $$
BEGIN
  ASSERT (SELECT org_id FROM public.loose_stock_allowances LIMIT 1) = public.default_org_id(), 'org derived from event';
  BEGIN
    INSERT INTO public.loose_stock_allowances (event_id, product_id, allowance_units)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 2);
    RAISE EXCEPTION 'duplicate product allowance should fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.loose_stock_allowances (event_id, product_id, category_id, allowance_units)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 1);
    RAISE EXCEPTION 'product + category scope should fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.loose_stock_allowances SET allowance_units = -1 WHERE product_id IS NOT NULL;
    RAISE EXCEPTION 'negative allowance should fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Payments: non-zero, audited.
INSERT INTO public.loose_stock_payments (event_id, amount, reference) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 120.50, 'BACS 123'),
  ('00000000-0000-0000-0000-0000000000e1', -20, 'Refund');
DO $$
BEGIN
  ASSERT (SELECT sum(amount) FROM public.loose_stock_payments) = 100.50, 'payments and refunds net';
  ASSERT (SELECT created_by FROM public.loose_stock_payments LIMIT 1) = '00000000-0000-0000-0000-00000000000a', 'creator recorded';
  BEGIN
    INSERT INTO public.loose_stock_payments (event_id, amount) VALUES ('00000000-0000-0000-0000-0000000000e1', 0);
    RAISE EXCEPTION 'zero payment should fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM public.audit_log WHERE table_name = 'loose_stock_payments' AND op = 'INSERT') = 2, 'payments audited';
  ASSERT (SELECT count(*) FROM public.audit_log WHERE table_name = 'loose_stock_allowances') >= 2, 'allowances audited';
END $$;

-- Staff can't see or write loose stock money.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.loose_stock_payments) = 0, 'staff cannot read payments';
  ASSERT (SELECT count(*) FROM public.loose_stock_allowances) = 0, 'staff cannot read allowances';
  BEGIN
    INSERT INTO public.loose_stock_payments (event_id, amount) VALUES ('00000000-0000-0000-0000-0000000000e1', 5);
    RAISE EXCEPTION 'staff payment insert should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Another organisation's admin sees nothing and can't attach rows to this event.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.loose_stock_payments) = 0, 'other org cannot read payments';
  BEGIN
    INSERT INTO public.loose_stock_payments (event_id, amount) VALUES ('00000000-0000-0000-0000-0000000000e1', 5);
    RAISE EXCEPTION 'cross-org payment should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
