-- 079 — Keep Admin Users and Access on.
-- The grid locks these cells so an organisation cannot remove its own way
-- back into user management. Enforce the same lock in RLS.

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
    AND (
      role <> 'admin'
      OR feature NOT IN ('workspace.users', 'workspace.access')
      OR enabled
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
    AND (
      role <> 'admin'
      OR feature NOT IN ('workspace.users', 'workspace.access')
      OR enabled
    )
  );
