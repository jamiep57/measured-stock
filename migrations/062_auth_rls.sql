-- =====================================================================
-- 062 — Full RLS rewrite for Supabase Auth
-- =====================================================================
-- Deny anon. Require authenticated + active profile (is_active_user()).
-- DELETE + sensitive RPCs require is_admin().
-- Sync infrastructure: no client policies (service role only).
-- Prerequisite: 061_profiles_auth.sql
-- =====================================================================

-- ---------- Operational tables (active users: CRUD; admin: delete) ----
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'categories','suppliers','warehouses','products','product_suppliers','case_sizes',
    'events','bars','recipients','event_products','bar_products','distribution',
    'stock_counts','stock_count_lines','closing_stock',
    'transfers','transfer_lines','warehouse_stock',
    'deliveries','delivery_lines','supplier_return_lines',
    'topup_sessions','topup_lines','wastage_batches','wastage_lines',
    'till_imports','till_sale_rows','modifier_imports','modifier_sale_rows',
    'recipes','recipe_ingredients','bug_reports',
    'event_kit_items','kit_movements','kit_movement_lines',
    'kit_container_contents','kit_scan_sessions','kit_scan_events','kit_label_queue',
    'stock_events'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.is_active_user());',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user());',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user());',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (public.is_admin());',
      t, t
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
  END LOOP;
END $$;

-- Staff need to delete operational line items (counts, transfers, etc.)
-- Narrow admin-only delete to catalog / destructive tables; allow active
-- users to delete day-to-day operational rows.
DO $$
DECLARE
  t text;
  staff_delete text[] := ARRAY[
    'stock_count_lines','stock_counts','closing_stock',
    'transfer_lines','transfers',
    'delivery_lines','deliveries','supplier_return_lines',
    'topup_lines','topup_sessions','wastage_lines','wastage_batches',
    'till_sale_rows','till_imports','modifier_sale_rows','modifier_imports',
    'recipe_ingredients','bug_reports',
    'event_kit_items','kit_movement_lines','kit_movements',
    'kit_container_contents','kit_scan_events','kit_scan_sessions','kit_label_queue',
    'bar_products','distribution','event_products','bars','recipients'
  ];
BEGIN
  FOREACH t IN ARRAY staff_delete LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (public.is_active_user());',
      t, t
    );
  END LOOP;
END $$;

-- ---------- Sync infra: service role only (no client policies) -------
DO $$
DECLARE
  t text;
  sync_tables text[] := ARRAY['legacy_id_map','system_sync_state','sync_locks'];
  pol record;
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t);
  END LOOP;
END $$;

-- ---------- RPCs -----------------------------------------------------
REVOKE ALL ON FUNCTION public.merge_products(uuid, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_products(uuid, uuid[], jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_products(uuid, uuid[], jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.merge_categories(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_categories(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_categories(uuid, uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_product(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid) TO authenticated, service_role;

-- ---------- Storage buckets ------------------------------------------
DO $$
DECLARE
  buckets text[] := ARRAY[
    'delivery-photos','bug-screenshots','event-images','product-images'
  ];
  b text;
  pol record;
BEGIN
  FOREACH b IN ARRAY buckets LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND (
          policyname ILIKE '%' || replace(b, '-', '_') || '%'
          OR policyname ILIKE '%' || b || '%'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', pol.policyname);
    END LOOP;
  END LOOP;

  -- Broad authenticated policies scoped by bucket_id
  DROP POLICY IF EXISTS storage_active_select ON storage.objects;
  CREATE POLICY storage_active_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      public.is_active_user()
      AND bucket_id IN ('delivery-photos','bug-screenshots','event-images','product-images')
    );

  DROP POLICY IF EXISTS storage_active_insert ON storage.objects;
  CREATE POLICY storage_active_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      public.is_active_user()
      AND bucket_id IN ('delivery-photos','bug-screenshots','event-images','product-images')
    );

  DROP POLICY IF EXISTS storage_active_update ON storage.objects;
  CREATE POLICY storage_active_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      public.is_active_user()
      AND bucket_id IN ('delivery-photos','bug-screenshots','event-images','product-images')
    )
    WITH CHECK (
      public.is_active_user()
      AND bucket_id IN ('delivery-photos','bug-screenshots','event-images','product-images')
    );

  DROP POLICY IF EXISTS storage_active_delete ON storage.objects;
  CREATE POLICY storage_active_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      public.is_active_user()
      AND bucket_id IN ('delivery-photos','bug-screenshots','event-images','product-images')
    );
END $$;
