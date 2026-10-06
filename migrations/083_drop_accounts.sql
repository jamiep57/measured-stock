-- =====================================================================
-- 083 — Remove global accounts
-- =====================================================================
-- Cross-charging is per event (recipients). The accounts directory turned
-- each charge name into an organisation-wide customer, and also mirrored
-- every supplier. Contacts, event client links and rider agreements were
-- unused. Suppliers and recipients stay as they are.
--
-- Apply: AFTER 082. Idempotent: yes.
-- =====================================================================

DROP TRIGGER IF EXISTS zy_sync_supplier_account ON public.suppliers;
DROP TRIGGER IF EXISTS ab_recipients_link_account ON public.recipients;

DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.events;
CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard(
    'check:linked_event_id:events', 'check:price_year_id:price_years');

DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.recipients;
CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.recipients
  FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard('derive:event_id:events');

ALTER TABLE public.events DROP COLUMN IF EXISTS client_account_id;
ALTER TABLE public.recipients DROP COLUMN IF EXISTS account_id;
ALTER TABLE public.loose_stock_payments DROP COLUMN IF EXISTS account_id;

SELECT public.tenant_enable('loose_stock_payments', '''derive:event_id:events''', true);

DROP TABLE IF EXISTS public.rider_price_lines;
DROP TABLE IF EXISTS public.rider_price_agreements;
DROP TABLE IF EXISTS public.account_contacts;
DROP TABLE IF EXISTS public.accounts;

DROP FUNCTION IF EXISTS public.recipients_link_account();
DROP FUNCTION IF EXISTS public.sync_supplier_to_account();
DROP FUNCTION IF EXISTS public.sync_account_to_supplier();
DROP FUNCTION IF EXISTS public.ensure_account(uuid, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.account_name_key(text);
DROP FUNCTION IF EXISTS public.rider_price_for(uuid, uuid, uuid);

DELETE FROM public.organisation_role_permissions WHERE feature = 'home.accounts';

CREATE OR REPLACE FUNCTION public.seed_role_permissions(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  f text;
  roles text[] := ARRAY['admin', 'manager', 'user'];
  features text[] := ARRAY[
    'home.dashboard', 'home.library', 'home.suppliers', 'home.warehouses', 'home.event_setup',
    'planning.menu_gp', 'planning.orders', 'planning.distribution',
    'stock.products_view', 'stock.products_edit', 'stock.deliveries', 'stock.counts',
    'stock.transfers', 'stock.wastage', 'stock.closing',
    'kit.library', 'kit.event',
    'square.modifiers', 'square.volume_pools',
    'finance.reports', 'finance.recon',
    'workspace.organisation', 'workspace.users', 'workspace.access', 'workspace.history',
    'workspace.categories', 'workspace.case_sizes',
    'dev.bugs', 'dev.audit', 'dev.backup'
  ];
BEGIN
  FOREACH r IN ARRAY roles LOOP
    FOREACH f IN ARRAY features LOOP
      INSERT INTO public.organisation_role_permissions (org_id, role, feature, enabled)
      VALUES (p_org, r, f, public.default_feature_enabled(r, f))
      ON CONFLICT (org_id, role, feature) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_role_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_role_permissions(uuid) TO service_role;
