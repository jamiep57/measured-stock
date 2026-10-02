-- Accounts: backfill, no duplicates, supplier/recipient sync, permissions, rider pricing.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff@test');
UPDATE public.profiles SET status = 'active';
INSERT INTO public.organisation_members (org_id, profile_id, role) VALUES
  (public.default_org_id(), '00000000-0000-0000-0000-00000000000a', 'admin'),
  (public.default_org_id(), '00000000-0000-0000-0000-00000000000c', 'staff');

-- Legacy rows that existed before accounts (sync triggers off).
ALTER TABLE public.suppliers DISABLE TRIGGER zy_sync_supplier_account;
ALTER TABLE public.recipients DISABLE TRIGGER ab_recipients_link_account;
INSERT INTO public.events (id, org_id, name, status, start_date, end_date)
VALUES ('00000000-0000-0000-0000-0000000000e1', public.default_org_id(), 'Festival', 'active', '2026-07-01', '2026-07-03');
INSERT INTO public.suppliers (id, org_id, name, contact_name, email)
VALUES ('00000000-0000-0000-0000-000000000051', public.default_org_id(), 'Brewer Co', 'Sam', 'sam@brewer.test');
INSERT INTO public.recipients (event_id, name, department, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'Artist Liaison', 'Main stage', 'ml@test'),
  ('00000000-0000-0000-0000-0000000000e1', 'artist liaison ', 'Second stage', 'ss@test'),
  ('00000000-0000-0000-0000-0000000000e1', 'BREWER CO', NULL, NULL);
ALTER TABLE public.suppliers ENABLE TRIGGER zy_sync_supplier_account;
ALTER TABLE public.recipients ENABLE TRIGGER ab_recipients_link_account;

\ir ../../migrations/071_accounts.sql

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.accounts) = 2, 'two accounts after backfill (no duplicates)';
  ASSERT (SELECT is_supplier AND is_client FROM public.accounts WHERE supplier_id = '00000000-0000-0000-0000-000000000051'),
    'supplier also used as a client is one account with both flags';
  ASSERT (SELECT count(*) FROM public.recipients WHERE account_id IS NULL) = 0, 'every recipient linked';
  ASSERT (SELECT count(DISTINCT account_id) FROM public.recipients WHERE lower(btrim(name)) = 'artist liaison') = 1,
    'same-name recipients share one account';
  ASSERT (SELECT count(*) FROM public.account_contacts WHERE role = 'order' AND name = 'Sam' AND is_primary) = 1, 'supplier contact backfilled';
  ASSERT (SELECT count(*) FROM public.account_contacts WHERE role = 'transfer') = 2, 'recipient emails become transfer contacts';
END $$;

-- Re-running the migration changes nothing.
\ir ../../migrations/071_accounts.sql
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.accounts) = 2, 'idempotent backfill';
  ASSERT (SELECT count(*) FROM public.account_contacts) = 3, 'no duplicate contacts';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

-- New supplier creates its account; new recipient links instead of duplicating.
INSERT INTO public.suppliers (id, name, contact_name) VALUES ('00000000-0000-0000-0000-000000000052', 'Glass Hire', 'Jo');
INSERT INTO public.recipients (event_id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', ' glass hire');
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.accounts WHERE lower(name) = 'glass hire') = 1, 'one Glass Hire account';
  ASSERT (SELECT is_client FROM public.accounts WHERE lower(name) = 'glass hire'), 'flagged as client too';
END $$;

-- Duplicate names are rejected whatever the case / spacing.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.accounts (name, is_client) VALUES ('  brewer co', true);
    RAISE EXCEPTION 'duplicate account should fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Account edits flow to the supplier; supplier accounts create suppliers.
UPDATE public.accounts SET name = 'Brewer Company', phone = '0207' WHERE supplier_id = '00000000-0000-0000-0000-000000000051';
INSERT INTO public.accounts (name, is_supplier, email) VALUES ('Ice Ltd', true, 'ice@test');
DO $$
BEGIN
  ASSERT (SELECT name FROM public.suppliers WHERE id = '00000000-0000-0000-0000-000000000051') = 'Brewer Company', 'supplier renamed';
  ASSERT (SELECT phone FROM public.suppliers WHERE id = '00000000-0000-0000-0000-000000000051') = '0207', 'supplier phone synced';
  ASSERT (SELECT a.supplier_id IS NOT NULL FROM public.accounts a WHERE a.name = 'Ice Ltd'), 'supplier row created for supplier account';
  ASSERT (SELECT email FROM public.suppliers WHERE name = 'Ice Ltd') = 'ice@test', 'new supplier has account details';
END $$;

-- Rider pricing: event-specific agreement beats the general one.
INSERT INTO public.products (id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Lager');
INSERT INTO public.rider_price_agreements (id, account_id, name, status, valid_from)
SELECT '00000000-0000-0000-0000-0000000000a1', id, 'General 2026', 'active', '2026-01-01' FROM public.accounts WHERE name = 'Artist Liaison';
INSERT INTO public.rider_price_agreements (id, account_id, event_id, name, status)
SELECT '00000000-0000-0000-0000-0000000000a2', id, '00000000-0000-0000-0000-0000000000e1', 'Festival rider', 'active' FROM public.accounts WHERE name = 'Artist Liaison';
INSERT INTO public.rider_price_lines (agreement_id, product_id, price) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 5.0),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 4.2);
DO $$
DECLARE v_acc uuid := (SELECT id FROM public.accounts WHERE name = 'Artist Liaison');
BEGIN
  ASSERT public.rider_price_for(v_acc, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1') = 4.2, 'event rider price';
  UPDATE public.rider_price_agreements SET status = 'ended' WHERE id = '00000000-0000-0000-0000-0000000000a2';
  ASSERT public.rider_price_for(v_acc, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1') = 5.0, 'falls back to general agreement';
  UPDATE public.rider_price_agreements SET valid_from = '2027-01-01' WHERE id = '00000000-0000-0000-0000-0000000000a1';
  ASSERT public.rider_price_for(v_acc, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1') IS NULL, 'not valid before start date';
END $$;

-- Merging a duplicate product keeps its rider prices.
INSERT INTO public.products (id, name) VALUES ('00000000-0000-0000-0000-0000000000f2', 'Lager dup');
INSERT INTO public.rider_price_lines (agreement_id, product_id, price)
VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2', 9.9);
DELETE FROM public.rider_price_lines
 WHERE agreement_id = '00000000-0000-0000-0000-0000000000a2' AND product_id = '00000000-0000-0000-0000-0000000000f1';
SELECT public.merge_products('00000000-0000-0000-0000-0000000000f1', ARRAY['00000000-0000-0000-0000-0000000000f2']::uuid[]);
DO $$
BEGIN
  ASSERT (SELECT price FROM public.rider_price_lines
           WHERE agreement_id = '00000000-0000-0000-0000-0000000000a2'
             AND product_id = '00000000-0000-0000-0000-0000000000f1') = 9.9, 'rider price carried to keeper';
END $$;

-- Staff read accounts but cannot write them, and never see rider pricing.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.accounts) >= 3, 'staff can read accounts';
  ASSERT (SELECT count(*) FROM public.account_contacts) >= 1, 'staff can read contacts';
  ASSERT (SELECT count(*) FROM public.rider_price_agreements) = 0, 'staff cannot see rider pricing';
  BEGIN
    INSERT INTO public.accounts (name) VALUES ('Staff Co');
    RAISE EXCEPTION 'staff insert should fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
