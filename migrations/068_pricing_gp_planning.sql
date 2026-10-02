-- =====================================================================
-- 068 — Price years, house / event menus, pricing scenarios, GP targets
-- =====================================================================
-- Background:
--   price_years        One pricing season per organisation (e.g. "2026").
--                      Locking a year freezes its house menu prices.
--   house_menu_prices  Default menu price / target GP per product per year.
--   event_menu_items   The event menu: which products are on sale at an
--                      event (agreed deals), its own menu price copy, other
--                      event and suggested prices, projected serves and an
--                      optional deal cost. Removing an item never touches
--                      the master product.
--   pricing_scenarios  Named "what if" price sets per event, with
--   scenario_prices    per-product prices.
--
--   Event menus copy prices from the house menu when seeded, so editing a
--   later year never rewrites an earlier event. Once an event is
--   reconciled or archived its menu, scenarios and cost snapshot are
--   read-only (enforced here, not just in the UI).
--
--   Planning data includes cost and GP, so every table here is readable
--   and writable by organisation admins only.
--
-- Apply: AFTER 067
-- Idempotent: yes
-- =====================================================================

-- ---------- reusable tenant wiring -----------------------------------
-- Adds the org guard trigger, RLS policies, grants and audit trigger to
-- a table that already has an org_id column.

CREATE OR REPLACE FUNCTION public.tenant_enable(p_tbl text, p_guard_args text, p_admin_only boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pol record;
  v_access text := CASE WHEN p_admin_only
    THEN 'org_id = (SELECT public.current_org_id()) AND (SELECT public.is_admin())'
    ELSE 'org_id = (SELECT public.current_org_id())' END;
BEGIN
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id)', 'idx_' || p_tbl || '_org', p_tbl);

  EXECUTE format('DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.%I', p_tbl);
  EXECUTE format(
    'CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard(%s)',
    p_tbl, COALESCE(NULLIF(p_guard_args, ''), '')
  );

  EXECUTE format('DROP TRIGGER IF EXISTS zz_audit_row_change ON public.%I', p_tbl);
  EXECUTE format(
    'CREATE TRIGGER zz_audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
    p_tbl
  );

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_tbl);
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = p_tbl LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, p_tbl);
  END LOOP;
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', p_tbl || '_select', p_tbl, v_access);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', p_tbl || '_insert', p_tbl, v_access);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', p_tbl || '_update', p_tbl, v_access, v_access);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', p_tbl || '_delete', p_tbl, v_access);

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', p_tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon', p_tbl);
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_enable(text, text, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.planning_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------- price_years ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.price_years (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organisations(id),
  label                 text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  starts_on             date,
  ends_on               date,
  vat_rate              numeric NOT NULL DEFAULT 0.20 CHECK (vat_rate >= 0 AND vat_rate < 1),
  default_target_gp_pct numeric NOT NULL DEFAULT 70 CHECK (default_target_gp_pct > -100 AND default_target_gp_pct < 100),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked')),
  locked_at             timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_years_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT price_years_org_label_key UNIQUE (org_id, label)
);

-- ---------- house_menu_prices ----------------------------------------

CREATE TABLE IF NOT EXISTS public.house_menu_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organisations(id),
  price_year_id   uuid NOT NULL REFERENCES public.price_years(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  menu_price      numeric CHECK (menu_price IS NULL OR menu_price >= 0),
  suggested_price numeric CHECK (suggested_price IS NULL OR suggested_price >= 0),
  target_gp_pct   numeric CHECK (target_gp_pct IS NULL OR (target_gp_pct > -100 AND target_gp_pct < 100)),
  serve_label     text CHECK (serve_label IS NULL OR char_length(serve_label) <= 40),
  serves_per_unit numeric CHECK (serves_per_unit IS NULL OR serves_per_unit > 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT house_menu_prices_year_product_key UNIQUE (price_year_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_house_menu_prices_product ON public.house_menu_prices (product_id);

-- ---------- events: pricing context ----------------------------------

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS price_year_id uuid;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS target_gp_pct numeric;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gp_amber_band numeric NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_price_year_id_fkey') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_price_year_id_fkey FOREIGN KEY (price_year_id)
      REFERENCES public.price_years(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_target_gp_pct_check') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_target_gp_pct_check
      CHECK (target_gp_pct IS NULL OR (target_gp_pct > -100 AND target_gp_pct < 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_gp_amber_band_check') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_gp_amber_band_check CHECK (gp_amber_band >= 0 AND gp_amber_band <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_price_year ON public.events (price_year_id);

DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.events;
CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard('check:linked_event_id:events', 'check:price_year_id:price_years');

-- ---------- event_menu_items -----------------------------------------

CREATE TABLE IF NOT EXISTS public.event_menu_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organisations(id),
  event_id             uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id           uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  included             boolean NOT NULL DEFAULT true,
  deal_ref             text CHECK (deal_ref IS NULL OR char_length(deal_ref) <= 120),
  serve_label          text CHECK (serve_label IS NULL OR char_length(serve_label) <= 40),
  serves_per_unit      numeric CHECK (serves_per_unit IS NULL OR serves_per_unit > 0),
  menu_price           numeric CHECK (menu_price IS NULL OR menu_price >= 0),
  suggested_price      numeric CHECK (suggested_price IS NULL OR suggested_price >= 0),
  other_event_price    numeric CHECK (other_event_price IS NULL OR other_event_price >= 0),
  other_event_label    text CHECK (other_event_label IS NULL OR char_length(other_event_label) <= 80),
  target_gp_pct        numeric CHECK (target_gp_pct IS NULL OR (target_gp_pct > -100 AND target_gp_pct < 100)),
  projected_serves     numeric CHECK (projected_serves IS NULL OR projected_serves >= 0),
  planned_qty_override numeric CHECK (planned_qty_override IS NULL OR planned_qty_override >= 0),
  unit_cost_override   numeric CHECK (unit_cost_override IS NULL OR unit_cost_override >= 0),
  unit_cost_snapshot   numeric CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
  cost_locked_at       timestamptz,
  sort_order           integer,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_menu_items_event_product_key UNIQUE (event_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_event_menu_items_product ON public.event_menu_items (product_id);

COMMENT ON COLUMN public.event_menu_items.unit_cost_override IS 'Agreed deal cost per stock unit; replaces the supplier offer cost.';
COMMENT ON COLUMN public.event_menu_items.unit_cost_snapshot IS 'Cost per stock unit frozen when costs are locked or the event is reconciled.';

-- ---------- pricing scenarios ----------------------------------------

CREATE TABLE IF NOT EXISTS public.pricing_scenarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organisations(id),
  event_id       uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  client_visible boolean NOT NULL DEFAULT false,
  sort_order     integer,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_scenarios_event_name_key UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS public.scenario_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations(id),
  scenario_id uuid NOT NULL REFERENCES public.pricing_scenarios(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price       numeric NOT NULL CHECK (price >= 0),
  CONSTRAINT scenario_prices_scenario_product_key UNIQUE (scenario_id, product_id)
);

-- ---------- tenancy, RLS, audit --------------------------------------

SELECT public.tenant_enable('price_years', '', true);
SELECT public.tenant_enable('house_menu_prices', '''derive:price_year_id:price_years'',''check:product_id:products''', true);
SELECT public.tenant_enable('event_menu_items', '''derive:event_id:events'',''check:product_id:products''', true);
SELECT public.tenant_enable('pricing_scenarios', '''derive:event_id:events''', true);
SELECT public.tenant_enable('scenario_prices', '''derive:scenario_id:pricing_scenarios'',''check:product_id:products''', true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['price_years', 'house_menu_prices', 'event_menu_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at()',
      t
    );
  END LOOP;
END $$;

-- ---------- historical price protection ------------------------------

CREATE OR REPLACE FUNCTION public.event_pricing_locked(p_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT status IN ('reconciled', 'archived') FROM public.events WHERE id = p_event), false);
$$;

-- Price year: once locked only status / notes may change, and unlocking
-- is an explicit, audited admin action.
CREATE OR REPLACE FUNCTION public.price_years_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'locked' AND NEW.status = 'locked' AND (
      NEW.vat_rate IS DISTINCT FROM OLD.vat_rate
      OR NEW.default_target_gp_pct IS DISTINCT FROM OLD.default_target_gp_pct
      OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
      OR NEW.ends_on IS DISTINCT FROM OLD.ends_on
      OR NEW.label IS DISTINCT FROM OLD.label
    ) THEN
      RAISE EXCEPTION 'Price year % is locked', OLD.label USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'locked' AND OLD.status <> 'locked' THEN
      NEW.locked_at := now();
    ELSIF NEW.status = 'open' THEN
      NEW.locked_at := NULL;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'locked' THEN
      RAISE EXCEPTION 'Price year % is locked and cannot be deleted', OLD.label USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS price_years_guard ON public.price_years;
CREATE TRIGGER price_years_guard BEFORE UPDATE OR DELETE ON public.price_years
  FOR EACH ROW EXECUTE FUNCTION public.price_years_guard();

CREATE OR REPLACE FUNCTION public.house_menu_prices_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.price_year_id ELSE NEW.price_year_id END;
BEGIN
  -- merge_products (070) repoints rows from duplicate products.
  IF current_setting('app.product_merge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF EXISTS (SELECT 1 FROM public.price_years WHERE id = v_year AND status = 'locked')
     OR (TG_OP = 'UPDATE' AND EXISTS (
       SELECT 1 FROM public.price_years WHERE id = OLD.price_year_id AND status = 'locked'
     )) THEN
    RAISE EXCEPTION 'House menu prices for a locked price year cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS house_menu_prices_guard ON public.house_menu_prices;
CREATE TRIGGER house_menu_prices_guard BEFORE INSERT OR UPDATE OR DELETE ON public.house_menu_prices
  FOR EACH ROW EXECUTE FUNCTION public.house_menu_prices_guard();

-- Event menu, scenarios and scenario prices freeze once the event is
-- reconciled / archived. The reconcile snapshot sets app.pricing_snapshot
-- so it can fill in frozen costs. Deleting the event itself still works:
-- by the time cascaded rows are removed the event row is gone.
CREATE OR REPLACE FUNCTION public.event_pricing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec   jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_event uuid;
BEGIN
  IF current_setting('app.pricing_snapshot', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_ARGV[0] = 'scenario' THEN
    SELECT event_id INTO v_event FROM public.pricing_scenarios WHERE id = (rec ->> 'scenario_id')::uuid;
  ELSE
    v_event := (rec ->> 'event_id')::uuid;
  END IF;

  IF public.event_pricing_locked(v_event) THEN
    RAISE EXCEPTION 'Pricing is locked for reconciled or archived events' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS event_pricing_guard ON public.event_menu_items;
CREATE TRIGGER event_pricing_guard BEFORE INSERT OR UPDATE OR DELETE ON public.event_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.event_pricing_guard('event');
DROP TRIGGER IF EXISTS event_pricing_guard ON public.pricing_scenarios;
CREATE TRIGGER event_pricing_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pricing_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.event_pricing_guard('event');
DROP TRIGGER IF EXISTS event_pricing_guard ON public.scenario_prices;
CREATE TRIGGER event_pricing_guard BEFORE INSERT OR UPDATE OR DELETE ON public.scenario_prices
  FOR EACH ROW EXECUTE FUNCTION public.event_pricing_guard('scenario');

-- ---------- cost resolution + snapshots ------------------------------

-- Cost per stock unit: preferred supplier offer, else product price.
CREATE OR REPLACE FUNCTION public.product_unit_cost(p_product uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(ps.unit_price, ps.case_price / NULLIF(p.units_per_case, 0))
       FROM public.product_suppliers ps
      WHERE ps.product_id = p.id
        AND (ps.unit_price IS NOT NULL OR ps.case_price IS NOT NULL)
      ORDER BY ps.is_preferred DESC NULLS LAST, ps.created_at
      LIMIT 1),
    p.unit_price,
    p.case_price / NULLIF(p.units_per_case, 0)
  )
  FROM public.products p
  WHERE p.id = p_product;
$$;

-- Freeze cost per unit on every menu item that has no snapshot yet.
-- Existing snapshots are never overwritten.
CREATE OR REPLACE FUNCTION public.snapshot_event_menu_costs(p_event uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can lock menu costs' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.pricing_snapshot', 'on', true);
  UPDATE public.event_menu_items emi
     SET unit_cost_snapshot = COALESCE(emi.unit_cost_override, public.product_unit_cost(emi.product_id)),
         cost_locked_at = now()
   WHERE emi.event_id = p_event
     AND emi.unit_cost_snapshot IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.pricing_snapshot', 'off', true);
  RETURN v_count;
END;
$$;

-- Clear snapshots so live costs apply again (open events only).
CREATE OR REPLACE FUNCTION public.clear_event_menu_cost_snapshots(p_event uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can unlock menu costs' USING ERRCODE = '42501';
  END IF;
  UPDATE public.event_menu_items
     SET unit_cost_snapshot = NULL, cost_locked_at = NULL
   WHERE event_id = p_event AND unit_cost_snapshot IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Reconciling / archiving an event freezes any remaining live costs.
CREATE OR REPLACE FUNCTION public.events_snapshot_menu_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('reconciled', 'archived') AND OLD.status NOT IN ('reconciled', 'archived') THEN
    PERFORM set_config('app.pricing_snapshot', 'on', true);
    UPDATE public.event_menu_items emi
       SET unit_cost_snapshot = COALESCE(emi.unit_cost_override, public.product_unit_cost(emi.product_id)),
           cost_locked_at = now()
     WHERE emi.event_id = NEW.id AND emi.unit_cost_snapshot IS NULL;
    PERFORM set_config('app.pricing_snapshot', 'off', true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_snapshot_menu_costs ON public.events;
CREATE TRIGGER events_snapshot_menu_costs AFTER UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_snapshot_menu_costs();

-- ---------- RPCs -----------------------------------------------------

-- Copy the house menu for the event's price year (and any products
-- already on the event) into the event menu. Existing rows are kept
-- unless p_refresh_prices, which re-copies house prices into rows that
-- still match the house menu year.
CREATE OR REPLACE FUNCTION public.seed_event_menu(p_event uuid, p_refresh_prices boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year  uuid;
  v_count integer := 0;
  v_n     integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can edit event menus' USING ERRCODE = '42501';
  END IF;
  SELECT price_year_id INTO v_year FROM public.events WHERE id = p_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_year IS NOT NULL THEN
    INSERT INTO public.event_menu_items
      (event_id, product_id, included, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit)
    SELECT p_event, h.product_id, true, h.menu_price, h.suggested_price, h.target_gp_pct, h.serve_label, h.serves_per_unit
      FROM public.house_menu_prices h
     WHERE h.price_year_id = v_year
    ON CONFLICT (event_id, product_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_count := v_count + v_n;

    IF p_refresh_prices THEN
      UPDATE public.event_menu_items emi
         SET menu_price = h.menu_price,
             suggested_price = h.suggested_price,
             target_gp_pct = COALESCE(h.target_gp_pct, emi.target_gp_pct)
        FROM public.house_menu_prices h
       WHERE emi.event_id = p_event
         AND h.price_year_id = v_year
         AND h.product_id = emi.product_id;
    END IF;
  END IF;

  INSERT INTO public.event_menu_items (event_id, product_id, included)
  SELECT p_event, ep.product_id, true
    FROM public.event_products ep
   WHERE ep.event_id = p_event
  ON CONFLICT (event_id, product_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_count + v_n;
END;
$$;

-- Start a new pricing year from an existing one with an optional uplift.
-- Prices round up to the nearest p_round_to (e.g. 0.05 / 0.10). The
-- source year is only read, never modified.
CREATE OR REPLACE FUNCTION public.roll_price_year(
  p_from uuid,
  p_label text,
  p_uplift_pct numeric DEFAULT 0,
  p_round_to numeric DEFAULT 0.05
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  src     public.price_years%ROWTYPE;
  v_new   uuid;
  v_mult  numeric := 1 + COALESCE(p_uplift_pct, 0) / 100;
  v_step  numeric := NULLIF(p_round_to, 0);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can create price years' USING ERRCODE = '42501';
  END IF;
  IF p_uplift_pct IS NOT NULL AND (p_uplift_pct <= -100 OR p_uplift_pct > 500) THEN
    RAISE EXCEPTION 'Uplift must be between -100%% and 500%%' USING ERRCODE = '22023';
  END IF;
  IF v_step IS NOT NULL AND v_step < 0 THEN
    RAISE EXCEPTION 'Rounding step must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO src FROM public.price_years WHERE id = p_from;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source price year not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.price_years (label, starts_on, ends_on, vat_rate, default_target_gp_pct, notes)
  VALUES (
    btrim(p_label),
    src.starts_on + interval '1 year',
    src.ends_on + interval '1 year',
    src.vat_rate,
    src.default_target_gp_pct,
    'Rolled from ' || src.label
  )
  RETURNING id INTO v_new;

  INSERT INTO public.house_menu_prices
    (price_year_id, product_id, menu_price, suggested_price, target_gp_pct, serve_label, serves_per_unit, notes)
  SELECT v_new, h.product_id,
         CASE WHEN h.menu_price IS NULL THEN NULL
              WHEN v_step IS NULL THEN round(h.menu_price * v_mult, 2)
              ELSE ceil(round(h.menu_price * v_mult / v_step, 6)) * v_step END,
         CASE WHEN h.suggested_price IS NULL THEN NULL
              WHEN v_step IS NULL THEN round(h.suggested_price * v_mult, 2)
              ELSE ceil(round(h.suggested_price * v_mult / v_step, 6)) * v_step END,
         h.target_gp_pct, h.serve_label, h.serves_per_unit, h.notes
    FROM public.house_menu_prices h
   WHERE h.price_year_id = p_from;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.event_pricing_locked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_unit_cost(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_event_menu_costs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_event_menu_cost_snapshots(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_event_menu(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_price_year(uuid, text, numeric, numeric) TO authenticated;

-- =====================================================================
-- Verify:
--   SELECT * FROM public.price_years;
--   SELECT count(*) FROM public.event_menu_items;
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.event_menu_items'::regclass;
-- =====================================================================
