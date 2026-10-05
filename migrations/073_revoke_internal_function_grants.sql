-- =====================================================================
-- 073 — Revoke API access to internal functions
-- =====================================================================
-- Background:
--   Supabase grants EXECUTE on new public functions to anon and
--   authenticated directly, so "REVOKE ... FROM PUBLIC" alone left them
--   callable over /rest/v1/rpc. promote_profile_admin (061) in particular
--   must only ever run as service_role.
--
--   Trigger functions are revoked too: EXECUTE is checked when a trigger
--   is created, not when it fires, so the triggers keep working.
--
-- Apply: AFTER 072. Idempotent: yes.
-- =====================================================================

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.promote_profile_admin(text)',
    'public.handle_new_user()',
    'public.tenant_enable(text, text, boolean)',
    'public.audit_row_change()',
    'public.tenant_row_guard()',
    'public.profiles_mirror_org_role()',
    'public.organisation_members_after_change()',
    'public.event_pricing_guard()',
    'public.house_menu_prices_guard()',
    'public.price_years_guard()',
    'public.events_snapshot_menu_costs()',
    'public.purchase_orders_defaults()',
    'public.purchase_orders_guard()',
    'public.purchase_order_lines_guard()',
    'public.sync_supplier_to_account()',
    'public.sync_account_to_supplier()',
    'public.recipients_link_account()',
    'public.planning_touch_updated_at()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.default_org_id() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.promote_profile_admin(text) TO service_role;

ALTER FUNCTION public.planning_touch_updated_at() SET search_path = public;
ALTER FUNCTION public.price_years_guard() SET search_path = public;
ALTER FUNCTION public.account_name_key(text) SET search_path = public;

-- =====================================================================
-- Verify:
--   SELECT has_function_privilege('anon', 'public.promote_profile_admin(text)', 'EXECUTE');  -- false
-- =====================================================================
