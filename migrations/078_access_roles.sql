-- 078 — Access roles (sysadmin, admin, manager, user) and per-role feature grants.
-- Existing staff become user. The earliest admin in each organisation becomes
-- sysadmin so developer tools and the access page have an owner. Further
-- admins stay admin and cannot see sysadmin accounts.

-- ---------- widen role checks -----------------------------------------

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.organisation_members DROP CONSTRAINT IF EXISTS organisation_members_role_check;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE public.organisation_members ALTER COLUMN role SET DEFAULT 'user';

UPDATE public.profiles SET role = 'user' WHERE role = 'staff';
UPDATE public.organisation_members SET role = 'user' WHERE role = 'staff';

-- One sysadmin per org: the earliest current admin, and only when none exists yet.
WITH ranked AS (
  SELECT org_id, profile_id,
         row_number() OVER (PARTITION BY org_id ORDER BY created_at, profile_id) AS n
  FROM public.organisation_members
  WHERE role = 'admin'
)
UPDATE public.organisation_members m
SET role = 'sysadmin'
FROM ranked r
WHERE m.org_id = r.org_id
  AND m.profile_id = r.profile_id
  AND r.n = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.organisation_members s
    WHERE s.org_id = m.org_id AND s.role = 'sysadmin'
  );

UPDATE public.profiles p
SET role = m.role
FROM public.organisation_members m
WHERE m.profile_id = p.id
  AND m.org_id = p.active_org_id
  AND p.role IS DISTINCT FROM m.role;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('sysadmin', 'admin', 'manager', 'user'));

ALTER TABLE public.organisation_members
  ADD CONSTRAINT organisation_members_role_check
  CHECK (role IN ('sysadmin', 'admin', 'manager', 'user'));

-- ---------- helpers ----------------------------------------------------

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
      AND m.role IN ('admin', 'sysadmin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_sysadmin()
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
      AND m.role = 'sysadmin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_sysadmin() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dn text;
BEGIN
  dn := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    NULLIF(trim(split_part(COALESCE(NEW.email, ''), '@', 1)), ''),
    'User'
  );
  INSERT INTO public.profiles (id, email, display_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    left(dn, 40),
    'user',
    'pending'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = now();
  RETURN NEW;
END;
$$;

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
           role = CASE WHEN v_next IS NULL THEN 'user' ELSE role END
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

CREATE OR REPLACE FUNCTION public.create_organisation(p_name text)
RETURNS public.organisations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organisations;
  v_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only organisation admins can create organisations' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Organisation name is required';
  END IF;
  v_role := CASE WHEN public.is_sysadmin() THEN 'sysadmin' ELSE 'admin' END;
  INSERT INTO public.organisations (name) VALUES (left(btrim(p_name), 80)) RETURNING * INTO v_row;
  INSERT INTO public.organisation_members (org_id, profile_id, role)
  VALUES (v_row.id, auth.uid(), v_role);
  RETURN v_row;
END;
$$;

-- ---------- feature grants --------------------------------------------

CREATE OR REPLACE FUNCTION public.default_feature_enabled(p_role text, p_feature text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role = 'sysadmin' THEN true
    WHEN p_feature LIKE 'dev.%' THEN false
    WHEN p_role = 'admin' THEN true
    WHEN p_role = 'manager' THEN p_feature NOT IN (
      'planning.menu_gp',
      'finance.reports',
      'finance.recon',
      'workspace.organisation',
      'workspace.users',
      'workspace.access',
      'workspace.history',
      'workspace.categories',
      'workspace.case_sizes'
    )
    WHEN p_role = 'user' THEN p_feature IN ('stock.deliveries', 'stock.counts')
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.default_feature_enabled(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_feature_enabled(text, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.organisation_role_permissions (
  org_id   uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
  feature  text NOT NULL,
  enabled  boolean NOT NULL,
  PRIMARY KEY (org_id, role, feature)
);

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
    'home.dashboard', 'home.library', 'home.accounts', 'home.suppliers', 'home.warehouses', 'home.event_setup',
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

CREATE OR REPLACE FUNCTION public.organisations_seed_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_role_permissions(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organisations_seed_permissions ON public.organisations;
CREATE TRIGGER organisations_seed_permissions
  AFTER INSERT ON public.organisations
  FOR EACH ROW
  EXECUTE FUNCTION public.organisations_seed_permissions();

SELECT public.seed_role_permissions(id) FROM public.organisations;

ALTER TABLE public.organisation_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_permissions_select ON public.organisation_role_permissions;
CREATE POLICY role_permissions_select ON public.organisation_role_permissions
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.current_org_id())
    AND (
      role = (SELECT public.current_role())
      OR (SELECT public.is_admin())
    )
  );

DROP POLICY IF EXISTS role_permissions_insert ON public.organisation_role_permissions;
CREATE POLICY role_permissions_insert ON public.organisation_role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.current_org_id())
    AND (SELECT public.is_admin())
    AND role IN ('admin', 'manager', 'user')
    AND (
      feature NOT LIKE 'dev.%'
      OR (SELECT public.is_sysadmin())
    )
  );

DROP POLICY IF EXISTS role_permissions_update ON public.organisation_role_permissions;
CREATE POLICY role_permissions_update ON public.organisation_role_permissions
  FOR UPDATE TO authenticated
  USING (
    org_id = (SELECT public.current_org_id())
    AND (SELECT public.is_admin())
    AND role IN ('admin', 'manager', 'user')
    AND (
      feature NOT LIKE 'dev.%'
      OR (SELECT public.is_sysadmin())
    )
  )
  WITH CHECK (
    org_id = (SELECT public.current_org_id())
    AND (SELECT public.is_admin())
    AND role IN ('admin', 'manager', 'user')
    AND (
      feature NOT LIKE 'dev.%'
      OR (SELECT public.is_sysadmin())
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.organisation_role_permissions TO authenticated;
REVOKE ALL ON public.organisation_role_permissions FROM anon;

CREATE OR REPLACE FUNCTION public.has_feature(p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_sysadmin() THEN true
    WHEN public.current_role() IS NULL THEN false
    ELSE COALESCE(
      (
        SELECT enabled
        FROM public.organisation_role_permissions
        WHERE org_id = public.current_org_id()
          AND role = public.current_role()
          AND feature = p_feature
      ),
      public.default_feature_enabled(public.current_role(), p_feature)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_feature(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature(text) TO authenticated, service_role;

-- ---------- hide sysadmin from other admins ---------------------------

DROP POLICY IF EXISTS organisation_members_select ON public.organisation_members;
CREATE POLICY organisation_members_select ON public.organisation_members
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (
      org_id = public.current_org_id()
      AND public.is_admin()
      AND (role <> 'sysadmin' OR public.is_sysadmin())
    )
  );

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1
        FROM public.organisation_members m
        WHERE m.profile_id = profiles.id
          AND m.org_id = public.current_org_id()
          AND (m.role <> 'sysadmin' OR public.is_sysadmin())
      )
    )
  );

-- ---------- product and catalogue writes follow the grid --------------

DO $$
DECLARE
  spec record;
  pol record;
BEGIN
  FOR spec IN
    SELECT *
    FROM (VALUES
      ('products', 'stock.products_edit'),
      ('product_suppliers', 'stock.products_edit'),
      ('categories', 'workspace.categories'),
      ('case_sizes', 'workspace.case_sizes')
    ) AS t(table_name, feature)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = spec.table_name
    ) THEN
      CONTINUE;
    END IF;

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = spec.table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, spec.table_name);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (org_id = (SELECT public.current_org_id()));',
      spec.table_name, spec.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (org_id = (SELECT public.current_org_id()) AND public.has_feature(%L));',
      spec.table_name, spec.table_name, spec.feature
    );
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (org_id = (SELECT public.current_org_id()) AND public.has_feature(%L)) WITH CHECK (org_id = (SELECT public.current_org_id()) AND public.has_feature(%L));',
      spec.table_name, spec.table_name, spec.feature, spec.feature
    );
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (org_id = (SELECT public.current_org_id()) AND public.has_feature(%L));',
      spec.table_name, spec.table_name, spec.feature
    );
  END LOOP;
END $$;
