-- Accounts were removed. Charge names stay on the event as recipients.
\set ON_ERROR_STOP 1
BEGIN;

-- Re-applying the drop is safe.
\ir ../../migrations/083_drop_accounts.sql

DO $$
BEGIN
  ASSERT to_regclass('public.accounts') IS NULL, 'accounts table is gone';
  ASSERT to_regclass('public.account_contacts') IS NULL, 'contacts table is gone';
  ASSERT to_regclass('public.rider_price_agreements') IS NULL, 'rider agreements are gone';
  ASSERT to_regclass('public.rider_price_lines') IS NULL, 'rider lines are gone';
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'recipients' AND column_name = 'account_id'
  ), 'recipients are not linked to a global account';
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'client_account_id'
  ), 'events have no client account';
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'loose_stock_payments' AND column_name = 'account_id'
  ), 'loose stock payments have no account';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'suppliers' AND t.tgname = 'zy_sync_supplier_account' AND NOT t.tgisinternal
  ), 'suppliers no longer sync to accounts';
  ASSERT (SELECT count(*) FROM public.organisation_role_permissions WHERE feature = 'home.accounts') = 0,
    'accounts permission removed';
END $$;

INSERT INTO public.events (id, org_id, name, status, start_date, end_date)
VALUES ('00000000-0000-0000-0000-0000000000e1', public.default_org_id(), 'Festival', 'active', '2026-07-01', '2026-07-03');
INSERT INTO public.recipients (event_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'Artist Liaison'),
  ('00000000-0000-0000-0000-0000000000e1', 'Artist Liaison');
INSERT INTO public.suppliers (org_id, name) VALUES (public.default_org_id(), 'Brewer Co');

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.recipients WHERE name = 'Artist Liaison') = 2,
    'the same charge name can be used more than once';
  ASSERT (SELECT count(*) FROM public.suppliers WHERE name = 'Brewer Co') = 1, 'supplier insert still works';
END $$;

ROLLBACK;
