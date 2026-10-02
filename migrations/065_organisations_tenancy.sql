-- =====================================================================
-- 065 — Organisations (multi-tenant isolation)
-- =====================================================================
-- Background:
--   Until now every active user could see every row. This migration adds
--   organisations + memberships, an org_id on every operational table and
--   rewrites RLS so users only see rows for their *active* organisation.
--
--   All existing data is assigned to a seeded default organisation and
--   every existing profile becomes a member of it (same role), so the
--   current deployment behaves exactly as before.
--
--   org_id is filled server-side by tenant_row_guard():
--     1. child rows inherit the org of their parent (event, delivery …)
--     2. root rows use NEW.org_id, else current_org_id(), else the
--        default organisation (service-role sync jobs have no auth.uid()).
--   Every referenced row (product, supplier, bar …) must belong to the
--   same organisation, so cross-tenant FK references are rejected even
--   though FK checks themselves bypass RLS.
--
--   profiles.role is kept as a mirror of the user's role in their active
--   organisation, so existing gates (is_admin(), /api/auth/session cookie,
--   ensureAppAuth requireAdmin) keep working unchanged.
--
-- Apply: AFTER 064
-- Idempotent: yes
-- =====================================================================

-- ---------- organisations + members ----------------------------------

CREATE TABLE IF NOT EXISTS public.organisations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organisations_single_default
  ON public.organisations (is_default) WHERE is_default;

COMMENT ON TABLE public.organisations IS
  'Tenant. Every operational row carries org_id; RLS scopes reads/writes to profiles.active_org_id.';

CREATE TABLE IF NOT EXISTS public.organisation_members (
  org_id      uuid        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, profile_id)
);

CREATE INDEX IF NOT EXISTS organisation_members_profile_idx
  ON public.organisation_members (profile_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_org_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;

-- Seed default org + memberships for existing users.
DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organisations WHERE is_default LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO public.organisations (name, is_default)
    VALUES ('Main organisation', true)
    RETURNING id INTO v_org;
  END IF;

  INSERT INTO public.organisation_members (org_id, profile_id, role)
  SELECT v_org, p.id, CASE WHEN p.role = 'admin' THEN 'admin' ELSE 'staff' END
  FROM public.profiles p
  ON CONFLICT (org_id, profile_id) DO NOTHING;

  UPDATE public.profiles SET active_org_id = v_org WHERE active_org_id IS NULL;
END $$;

-- ---------- helper functions -----------------------------------------

CREATE OR REPLACE FUNCTION public.default_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.organisations WHERE is_default LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.active_org_id
  FROM public.profiles p
  JOIN public.organisation_members m
    ON m.org_id = p.active_org_id AND m.profile_id = p.id
  WHERE p.id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_members m
    JOIN public.profiles p ON p.id = m.profile_id
    WHERE m.org_id = p_org
      AND m.profile_id = auth.uid()
      AND p.status = 'active'
  );
$$;

-- Admin of the *active* organisation.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.organisation_members m
      ON m.org_id = p.active_org_id AND m.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND m.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role
  FROM public.profiles p
  JOIN public.organisation_members m
    ON m.org_id = p.active_org_id AND m.profile_id = p.id
  WHERE p.id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.default_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated, anon, service_role;

-- ---------- role mirror (membership -> profiles.role) ----------------

CREATE OR REPLACE FUNCTION public.profiles_mirror_org_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.active_org_id IS DISTINCT FROM OLD.active_org_id THEN
    IF NEW.active_org_id IS NOT NULL THEN
      SELECT role INTO v_role
      FROM public.organisation_members
      WHERE org_id = NEW.active_org_id AND profile_id = NEW.id;
      IF v_role IS NULL THEN
        RAISE EXCEPTION 'Not a member of organisation %', NEW.active_org_id
          USING ERRCODE = '42501';
      END IF;
      NEW.role := v_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_mirror_org_role ON public.profiles;
CREATE TRIGGER profiles_mirror_org_role
  BEFORE INSERT OR UPDATE OF active_org_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_mirror_org_role();

CREATE OR REPLACE FUNCTION public.organisation_members_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT m.org_id INTO v_next
    FROM public.organisation_members m
    WHERE m.profile_id = OLD.profile_id AND m.org_id <> OLD.org_id
    ORDER BY m.created_at
    LIMIT 1;
    UPDATE public.profiles
       SET active_org_id = v_next,
           role = CASE WHEN v_next IS NULL THEN 'staff' ELSE role END
     WHERE id = OLD.profile_id AND active_org_id = OLD.org_id;
    RETURN OLD;
  END IF;

  UPDATE public.profiles
     SET active_org_id = NEW.org_id
   WHERE id = NEW.profile_id AND active_org_id IS NULL;

  UPDATE public.profiles
     SET role = NEW.role
   WHERE id = NEW.profile_id
     AND active_org_id = NEW.org_id
     AND role IS DISTINCT FROM NEW.role;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organisation_members_after_change ON public.organisation_members;
CREATE TRIGGER organisation_members_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.organisation_members
  FOR EACH ROW
  EXECUTE FUNCTION public.organisation_members_after_change();

-- ---------- RPCs: switch / create organisation -----------------------

CREATE OR REPLACE FUNCTION public.set_active_org(p_org uuid)
RETURNS public.organisations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organisations;
BEGIN
  IF NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'Not a member of that organisation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET active_org_id = p_org WHERE id = auth.uid();
  SELECT * INTO v_row FROM public.organisations WHERE id = p_org;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organisation(p_name text)
RETURNS public.organisations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organisations;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only organisation admins can create organisations' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Organisation name is required';
  END IF;
  INSERT INTO public.organisations (name) VALUES (left(btrim(p_name), 80)) RETURNING * INTO v_row;
  INSERT INTO public.organisation_members (org_id, profile_id, role)
  VALUES (v_row.id, auth.uid(), 'admin');
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_org(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_organisation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_org(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_organisation(text) TO authenticated, service_role;

-- First admin bootstrap also joins the default organisation.
CREATE OR REPLACE FUNCTION public.promote_profile_admin(target_email text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.profiles;
  v_org uuid := public.default_org_id();
BEGIN
  SELECT * INTO row FROM public.profiles WHERE lower(email) = lower(trim(target_email));
  IF row.id IS NULL THEN
    RAISE EXCEPTION 'No profile found for email %', target_email;
  END IF;
  INSERT INTO public.organisation_members (org_id, profile_id, role)
  VALUES (COALESCE(row.active_org_id, v_org), row.id, 'admin')
  ON CONFLICT (org_id, profile_id) DO UPDATE SET role = 'admin';
  UPDATE public.profiles SET status = 'active', updated_at = now()
   WHERE id = row.id
  RETURNING * INTO row;
  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_profile_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_profile_admin(text) TO service_role;

-- ---------- RLS: organisations, members, profiles --------------------

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organisations_select ON public.organisations;
CREATE POLICY organisations_select ON public.organisations
  FOR SELECT TO authenticated
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS organisations_update ON public.organisations;
CREATE POLICY organisations_update ON public.organisations
  FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.is_admin())
  WITH CHECK (id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS organisation_members_select ON public.organisation_members;
CREATE POLICY organisation_members_select ON public.organisation_members
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR (org_id = public.current_org_id() AND public.is_admin()));

GRANT SELECT, UPDATE ON public.organisations TO authenticated;
GRANT SELECT ON public.organisation_members TO authenticated;
REVOKE ALL ON public.organisations FROM anon;
REVOKE ALL ON public.organisation_members FROM anon;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.organisation_members m
        WHERE m.profile_id = profiles.id AND m.org_id = public.current_org_id()
      )
    )
  );

-- Users may only edit their own display name; role/status/active org go
-- through the admin API or set_active_org().
DROP POLICY IF EXISTS profiles_update_own_name ON public.profiles;
CREATE POLICY profiles_update_own_name ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND status = (SELECT p.status FROM public.profiles p WHERE p.id = auth.uid())
    AND active_org_id IS NOT DISTINCT FROM (SELECT p.active_org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- ---------- tenant row guard -----------------------------------------
-- Trigger args are 'derive:<col>:<table>' or 'check:<col>:<table>'.
-- The first non-null derive reference sets org_id; every reference must
-- belong to the same organisation.

CREATE OR REPLACE FUNCTION public.tenant_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec      jsonb := to_jsonb(NEW);
  spec     text;
  v_kind   text;
  v_col    text;
  v_tbl    text;
  v_ref    uuid;
  v_ref_org uuid;
  v_target uuid;
  i        int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'org_id cannot be changed on %', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    v_target := OLD.org_id;
  ELSE
    FOR i IN 0 .. TG_NARGS - 1 LOOP
      spec := TG_ARGV[i];
      CONTINUE WHEN split_part(spec, ':', 1) <> 'derive';
      v_col := split_part(spec, ':', 2);
      v_tbl := split_part(spec, ':', 3);
      v_ref := NULLIF(rec ->> v_col, '')::uuid;
      CONTINUE WHEN v_ref IS NULL;
      EXECUTE format('SELECT org_id FROM public.%I WHERE id = $1', v_tbl) INTO v_target USING v_ref;
      EXIT WHEN v_target IS NOT NULL;
    END LOOP;
    v_target := COALESCE(v_target, NEW.org_id, public.current_org_id(), public.default_org_id());
  END IF;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Could not resolve organisation for %', TG_TABLE_NAME;
  END IF;
  NEW.org_id := v_target;

  FOR i IN 0 .. TG_NARGS - 1 LOOP
    spec := TG_ARGV[i];
    v_kind := split_part(spec, ':', 1);
    v_col := split_part(spec, ':', 2);
    v_tbl := split_part(spec, ':', 3);
    v_ref := NULLIF(rec ->> v_col, '')::uuid;
    CONTINUE WHEN v_ref IS NULL;
    IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> v_col) IS NOT DISTINCT FROM (rec ->> v_col) THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT org_id FROM public.%I WHERE id = $1', v_tbl) INTO v_ref_org USING v_ref;
    IF v_ref_org IS NOT NULL AND v_ref_org <> v_target THEN
      RAISE EXCEPTION '%.% references a row from another organisation', TG_TABLE_NAME, v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ---------- org_id on every tenant table -----------------------------

DO $$
DECLARE
  v_org uuid := public.default_org_id();
  spec record;
  args text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('categories',             ''),
      ('suppliers',              ''),
      ('warehouses',             ''),
      ('case_sizes',             ''),
      ('events',                 '''check:linked_event_id:events'''),
      ('recipes',                ''),
      ('bug_reports',            ''),
      ('stock_events',           ''),
      ('products',               '''check:category_id:categories'',''check:supplier_id:suppliers'',''check:case_size_id:case_sizes'',''check:stock_case_size_id:case_sizes'''),
      ('product_suppliers',      '''derive:product_id:products'',''check:supplier_id:suppliers'',''check:purchase_case_size_id:case_sizes'''),
      ('warehouse_stock',        '''derive:warehouse_id:warehouses'',''check:product_id:products'''),
      ('bars',                   '''derive:event_id:events'''),
      ('recipients',             '''derive:event_id:events'''),
      ('event_products',         '''derive:event_id:events'',''check:product_id:products'''),
      ('bar_products',           '''derive:event_id:events'',''check:bar_id:bars'',''check:product_id:products'''),
      ('distribution',           '''derive:event_id:events'',''check:bar_id:bars'',''check:product_id:products'''),
      ('closing_stock',          '''derive:event_id:events'',''check:product_id:products'''),
      ('stock_counts',           '''derive:event_id:events'',''check:bar_id:bars'''),
      ('stock_count_lines',      '''derive:count_id:stock_counts'',''check:product_id:products'',''check:bar_id:bars'''),
      ('deliveries',             '''derive:event_id:events'',''check:supplier_id:suppliers'''),
      ('delivery_lines',         '''derive:delivery_id:deliveries'',''check:product_id:products'''),
      ('supplier_return_lines',  '''derive:event_id:events'',''check:product_id:products'',''check:supplier_id:suppliers'''),
      ('topup_sessions',         '''derive:event_id:events'',''check:supplier_id:suppliers'''),
      ('topup_lines',            '''derive:session_id:topup_sessions'',''check:product_id:products'',''check:supplier_id:suppliers'''),
      ('wastage_batches',        '''derive:event_id:events'''),
      ('wastage_lines',          '''derive:batch_id:wastage_batches'',''check:product_id:products'''),
      ('transfers',              '''derive:from_event_id:events'',''derive:to_event_id:events'',''derive:from_warehouse_id:warehouses'',''derive:to_warehouse_id:warehouses'',''check:from_bar_id:bars'',''check:to_bar_id:bars'',''check:recipient_id:recipients'''),
      ('transfer_lines',         '''derive:transfer_id:transfers'',''check:product_id:products'''),
      ('till_imports',           '''derive:event_id:events'''),
      ('till_sale_rows',         '''derive:import_id:till_imports'''),
      ('modifier_imports',       '''derive:event_id:events'''),
      ('modifier_sale_rows',     '''derive:import_id:modifier_imports'''),
      ('recipe_ingredients',     '''derive:recipe_id:recipes'''),
      ('event_kit_items',        '''derive:event_id:events'',''check:product_id:products'''),
      ('kit_movements',          '''derive:event_id:events'''),
      ('kit_movement_lines',     '''derive:movement_id:kit_movements'',''check:product_id:products'',''check:supplier_id:suppliers'',''check:warehouse_id:warehouses'''),
      ('kit_container_contents', '''derive:container_product_id:products'',''check:child_product_id:products'''),
      ('kit_scan_sessions',      '''derive:event_id:events'''),
      ('kit_scan_events',        '''derive:session_id:kit_scan_sessions'''),
      ('kit_label_queue',        '''derive:product_id:products''')
    ) AS t(tbl, trig_args)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = spec.tbl
    ) THEN
      CONTINUE;
    END IF;

    -- Constant default backfills instantly without firing row triggers.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = 'org_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN org_id uuid NOT NULL DEFAULT %L REFERENCES public.organisations(id)',
        spec.tbl, v_org
      );
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id DROP DEFAULT', spec.tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id)', 'idx_' || spec.tbl || '_org', spec.tbl);

    args := NULLIF(spec.trig_args, '');
    EXECUTE format('DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.%I', spec.tbl);
    EXECUTE format(
      'CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard(%s)',
      spec.tbl, COALESCE(args, '')
    );
  END LOOP;
END $$;

-- ---------- per-organisation uniqueness ------------------------------

ALTER TABLE public.suppliers  DROP CONSTRAINT IF EXISTS suppliers_name_key;
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS warehouses_name_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_kind_name_key;
ALTER TABLE public.case_sizes DROP CONSTRAINT IF EXISTS case_sizes_label_key;
ALTER TABLE public.recipes    DROP CONSTRAINT IF EXISTS recipes_till_item_till_variation_key;
DROP INDEX IF EXISTS public.idx_products_barcode_unique;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_org_name_key') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_org_name_key UNIQUE (org_id, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_org_name_key') THEN
    ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_org_name_key UNIQUE (org_id, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_org_kind_name_key') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_org_kind_name_key UNIQUE (org_id, kind, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_sizes_org_label_key') THEN
    ALTER TABLE public.case_sizes ADD CONSTRAINT case_sizes_org_label_key UNIQUE (org_id, label);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_org_till_item_variation_key') THEN
    ALTER TABLE public.recipes ADD CONSTRAINT recipes_org_till_item_variation_key UNIQUE (org_id, till_item, till_variation);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON public.products (org_id, barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

-- ---------- RLS rewrite: scope to active organisation ----------------

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
  pol record;
  del_check text;
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
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (org_id = (SELECT public.current_org_id()));',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (org_id = (SELECT public.current_org_id()));',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (org_id = (SELECT public.current_org_id())) WITH CHECK (org_id = (SELECT public.current_org_id()));',
      t, t
    );
    del_check := CASE WHEN t = ANY(staff_delete) THEN 'true' ELSE '(SELECT public.is_admin())' END;
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (org_id = (SELECT public.current_org_id()) AND %s);',
      t, t, del_check
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
  END LOOP;
END $$;

-- Destructive RPCs run as the caller so RLS confines them to the active org.
ALTER FUNCTION public.merge_products(uuid, uuid[], jsonb) SECURITY INVOKER;
ALTER FUNCTION public.merge_categories(uuid, uuid[]) SECURITY INVOKER;
ALTER FUNCTION public.delete_product(uuid) SECURITY INVOKER;

-- =====================================================================
-- Verify:
--   SELECT table_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='org_id' ORDER BY 1;
--   SELECT * FROM public.organisations;
--   SELECT * FROM public.organisation_members;
-- =====================================================================
