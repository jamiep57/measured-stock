-- Tenancy isolation, org_id derivation, cross-tenant FK guard, role mirror, audit.
\set ON_ERROR_STOP 1
BEGIN;

-- Two users: alice (admin of default org), bob (admin of org B).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'alice@test'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test');
UPDATE public.profiles SET status = 'active';
INSERT INTO public.organisation_members (org_id, profile_id, role)
VALUES (public.default_org_id(), '00000000-0000-0000-0000-00000000000a', 'admin');

INSERT INTO public.organisations (id, name) VALUES ('00000000-0000-0000-0000-0000000000b0', 'Org B');
INSERT INTO public.organisation_members (org_id, profile_id, role)
VALUES ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-00000000000b', 'admin');

DO $$
BEGIN
  ASSERT (SELECT active_org_id FROM public.profiles WHERE email = 'bob@test') = '00000000-0000-0000-0000-0000000000b0',
    'membership insert should set active org';
  ASSERT (SELECT role FROM public.profiles WHERE email = 'alice@test') = 'admin', 'role mirrored from membership';
END $$;

-- Service role (no auth.uid) insert falls back to default org.
INSERT INTO public.events (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Default org event');
DO $$
BEGIN
  ASSERT (SELECT org_id FROM public.events WHERE id = '00000000-0000-0000-0000-0000000000e1') = public.default_org_id(),
    'service insert falls back to default org';
END $$;

-- Upsert keyed on (org_id, label) when org_id is filled by the trigger.
INSERT INTO public.case_sizes (label, units_per_case) VALUES ('TEST 24x330', 24)
ON CONFLICT (org_id, label) DO UPDATE SET units_per_case = EXCLUDED.units_per_case;
INSERT INTO public.case_sizes (label, units_per_case) VALUES ('TEST 24x330', 12)
ON CONFLICT (org_id, label) DO UPDATE SET units_per_case = EXCLUDED.units_per_case;
DO $$
BEGIN
  ASSERT (SELECT units_per_case FROM public.case_sizes WHERE label = 'TEST 24x330') = 12, 'org-scoped upsert merges';
END $$;

-- Act as bob (org B).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.events) = 0, 'bob must not see default org events';
END $$;

INSERT INTO public.events (id, name) VALUES ('00000000-0000-0000-0000-0000000000e2', 'Org B event');
INSERT INTO public.bars (id, event_id, name) VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', 'Main');
INSERT INTO public.categories (id, name) VALUES ('00000000-0000-0000-0000-0000000000c2', 'Beer');
INSERT INTO public.products (id, name, category_id) VALUES ('00000000-0000-0000-0000-0000000000f2', 'Org B lager', '00000000-0000-0000-0000-0000000000c2');

DO $$
BEGIN
  ASSERT (SELECT org_id FROM public.bars WHERE id = '00000000-0000-0000-0000-0000000000a2') = '00000000-0000-0000-0000-0000000000b0',
    'child row inherits org from event';
END $$;

-- Cross-tenant reference: bob cannot attach a bar to the default org event.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.bars (event_id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Sneaky');
    RAISE EXCEPTION 'cross-tenant insert should fail';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- org_id cannot be changed.
DO $$
BEGIN
  BEGIN
    UPDATE public.events SET org_id = public.default_org_id() WHERE id = '00000000-0000-0000-0000-0000000000e2';
    RAISE EXCEPTION 'org_id change should fail';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- Same supplier name allowed in different orgs.
INSERT INTO public.suppliers (name) VALUES ('Shared Name Ltd');

-- Bob cannot switch into an org he is not a member of.
DO $$
BEGIN
  BEGIN
    PERFORM public.set_active_org(public.default_org_id());
    RAISE EXCEPTION 'set_active_org should fail for non-member';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- Audit trail visible to bob for his org only.
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.audit_log WHERE table_name = 'events') >= 1, 'event insert audited';
  ASSERT NOT EXISTS (SELECT 1 FROM public.audit_log WHERE org_id <> '00000000-0000-0000-0000-0000000000b0'),
    'audit log scoped to org';
END $$;

-- Act as alice (default org).
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
INSERT INTO public.suppliers (name) VALUES ('Shared Name Ltd');
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.events) = 1, 'alice sees only default org events';
  ASSERT NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Org B lager'), 'alice cannot see org B products';
END $$;

ROLLBACK;
