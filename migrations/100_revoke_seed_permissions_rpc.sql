-- =====================================================================
-- 100 — Stop anonymous callers seeding role permissions
-- =====================================================================
-- seed_role_permissions is a security-definer writer. Default privileges
-- left EXECUTE with anon and authenticated, so a public API key could
-- insert permission rows for any organisation id.
-- The organisations trigger calls it as the function owner, so the
-- client never needs this grant.
--
-- Apply: AFTER 099. Idempotent: yes.
-- =====================================================================

REVOKE ALL ON FUNCTION public.seed_role_permissions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_role_permissions(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.organisations_seed_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organisations_seed_permissions() TO service_role;

ALTER FUNCTION public.default_feature_enabled(text, text) SET search_path TO 'public';
