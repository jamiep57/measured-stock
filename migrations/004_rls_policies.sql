-- =====================================================================
-- 004 — Row Level Security policies
-- =====================================================================
-- Match the security model already in use on stock_events: RLS is ON
-- and an open policy allows the anon role to read/write. The service
-- role (used by the api/sync-event.js function) bypasses RLS entirely
-- and is not affected by these policies.
--
-- If your stock_events table has RLS DISABLED (no policies), see the
-- comment block at the bottom for the alternative.
--
-- Apply: AFTER 001, 002, 003
-- Idempotent: yes (DROP POLICY IF EXISTS … then CREATE POLICY)
-- =====================================================================

-- Helper to (re)create one open policy per table for the anon role.
-- We use a DO block so we can iterate over the list of tables.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- base v2
    'categories','suppliers','warehouses','products','events',
    'bars','recipients','event_products','bar_products','distribution',
    'stock_counts','stock_count_lines','closing_stock',
    'transfers','transfer_lines','warehouse_stock',
    'deliveries','delivery_lines',
    -- V4 extensions
    'topup_sessions','topup_lines','wastage_batches','wastage_lines',
    'till_imports','till_sale_rows','modifier_imports','modifier_sale_rows',
    'recipes','recipe_ingredients','bug_reports',
    -- sync infrastructure
    'legacy_id_map','system_sync_state'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- skip if table doesn't exist (defensive)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'Skipping % (table not found)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- Open SELECT policy for anon + authenticated
    EXECUTE format('DROP POLICY IF EXISTS %I_anon_select ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_select ON public.%I FOR SELECT USING (true);',
      t, t
    );

    -- Open INSERT
    EXECUTE format('DROP POLICY IF EXISTS %I_anon_insert ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_insert ON public.%I FOR INSERT WITH CHECK (true);',
      t, t
    );

    -- Open UPDATE
    EXECUTE format('DROP POLICY IF EXISTS %I_anon_update ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_update ON public.%I FOR UPDATE USING (true) WITH CHECK (true);',
      t, t
    );

    -- Open DELETE
    EXECUTE format('DROP POLICY IF EXISTS %I_anon_delete ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_delete ON public.%I FOR DELETE USING (true);',
      t, t
    );
  END LOOP;
END $$;

-- =====================================================================
-- Verification
-- =====================================================================
--
-- 1. List all new tables and confirm RLS is enabled:
--
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--     AND tablename NOT IN ('stock_events')
--   ORDER BY tablename;
--
-- 2. List policies per table:
--
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, cmd;
--
-- Every new table should show four policies (select/insert/update/delete).
--
-- =====================================================================
-- Alternative: if stock_events has RLS DISABLED on your project, then
-- the anon key currently works "because there are no policies to enforce".
-- To exactly mirror that pattern on the new tables (no RLS at all):
--
--   ALTER TABLE public.<each_new_table> DISABLE ROW LEVEL SECURITY;
--
-- The open-policies-with-RLS-on approach above is functionally identical
-- for security (open = open) but is more honest with Supabase's tooling
-- (the dashboard linter stops nagging you about unprotected tables).
-- =====================================================================
