-- =====================================================================
-- 074 — Pin search_path on older functions; explicit deny on sync tables
-- =====================================================================
-- Background:
--   Supabase's advisor flags functions without a fixed search_path
--   (a caller could shadow public objects). Every body below already
--   schema-qualifies its tables, so pinning to public changes nothing.
--
--   legacy_id_map, sync_locks and system_sync_state are written only by
--   the server sync engine with the service role (which bypasses RLS).
--   RLS was on with no policies, which already denied clients; a
--   restrictive USING (false) policy makes that intent explicit.
--
-- Apply: AFTER 073. Idempotent: yes.
-- =====================================================================

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.norm_case_size_alias(text)',
    'public.norm_case_size_label(text)',
    'public.product_suppliers_after_change()',
    'public.product_suppliers_enforce_preferred()',
    'public.reap_sync_locks()',
    'public.set_profiles_updated_at()',
    'public.set_updated_at()',
    'public.sync_product_from_stock_case_size()',
    'public.sync_product_preferred_supplier(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legacy_id_map', 'sync_locks', 'system_sync_state'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_server_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t || '_server_only', t
    );
  END LOOP;
END $$;

-- =====================================================================
-- Verify:
--   SELECT proname, proconfig FROM pg_proc WHERE proname = 'reap_sync_locks';
--   SELECT tablename, policyname FROM pg_policies WHERE policyname LIKE '%_server_only';
-- =====================================================================
