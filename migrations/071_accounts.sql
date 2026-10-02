-- =====================================================================
-- 071 — Accounts, contacts and third-party rider pricing
-- =====================================================================
-- Background:
--   One accounts table for clients and suppliers (is_client / is_supplier
--   flags). Names are unique per organisation, case- and space-insensitive,
--   so the same company is never entered twice.
--
--   Legacy tables stay in place and are kept in step:
--     suppliers   ⇄ accounts.supplier_id (backfilled; inserts / renames on
--                   either side sync to the other)
--     recipients  → recipients.account_id (backfilled by name; new
--                   recipients link to — or create — a client account)
--     events      → events.client_account_id
--
--   account_contacts hold people with a role: account_manager, order,
--   transfer, accounts, other.
--
--   rider_price_agreements / rider_price_lines: prices agreed with a third
--   party (account) for products, optionally for one event and/or price
--   year, with validity dates. Admin-only.
--
--   Accounts and contacts are readable by every member of the organisation
--   (transfer and order screens need them); only admins can write.
--
-- Apply: AFTER 070. Idempotent: yes.
-- =====================================================================

-- ---------- accounts --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organisations(id),
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  is_client    boolean NOT NULL DEFAULT false,
  is_supplier  boolean NOT NULL DEFAULT false,
  supplier_id  uuid UNIQUE REFERENCES public.suppliers(id) ON DELETE SET NULL,
  legal_name   text CHECK (legal_name IS NULL OR char_length(legal_name) <= 160),
  email        text CHECK (email IS NULL OR char_length(email) <= 200),
  phone        text CHECK (phone IS NULL OR char_length(phone) <= 60),
  address      text CHECK (address IS NULL OR char_length(address) <= 500),
  website      text CHECK (website IS NULL OR char_length(website) <= 200),
  vat_number   text CHECK (vat_number IS NULL OR char_length(vat_number) <= 40),
  notes        text,
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_org_name_key
  ON public.accounts (org_id, lower(btrim(name)));

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.accounts;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- ---------- account_contacts ------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  role        text NOT NULL DEFAULT 'other'
              CHECK (role IN ('account_manager', 'order', 'transfer', 'accounts', 'other')),
  job_title   text CHECK (job_title IS NULL OR char_length(job_title) <= 80),
  email       text CHECK (email IS NULL OR char_length(email) <= 200),
  phone       text CHECK (phone IS NULL OR char_length(phone) <= 60),
  is_primary  boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_contacts_dedupe_key
  ON public.account_contacts (account_id, role, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_account_contacts_account ON public.account_contacts (account_id);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.account_contacts;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.account_contacts
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- One primary contact per role per account.
CREATE UNIQUE INDEX IF NOT EXISTS account_contacts_one_primary
  ON public.account_contacts (account_id, role) WHERE is_primary;

-- ---------- links from legacy tables ----------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS client_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.recipients
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_client_account ON public.events (client_account_id);
CREATE INDEX IF NOT EXISTS idx_recipients_account ON public.recipients (account_id);

-- ---------- rider pricing ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.rider_price_agreements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations(id),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  event_id      uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  price_year_id uuid REFERENCES public.price_years(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  reference     text CHECK (reference IS NULL OR char_length(reference) <= 80),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  valid_from    date,
  valid_to      date,
  prices_include_vat boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_price_agreements_dates CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_rider_agreements_account ON public.rider_price_agreements (account_id);
CREATE INDEX IF NOT EXISTS idx_rider_agreements_event ON public.rider_price_agreements (event_id);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.rider_price_agreements;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.rider_price_agreements
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.rider_price_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organisations(id),
  agreement_id uuid NOT NULL REFERENCES public.rider_price_agreements(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price        numeric NOT NULL CHECK (price >= 0 AND price <= 100000),
  unit_label   text CHECK (unit_label IS NULL OR char_length(unit_label) <= 40),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_price_lines_agreement_product_key UNIQUE (agreement_id, product_id)
);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.rider_price_lines;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.rider_price_lines
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- ---------- tenancy, audit, RLS ---------------------------------------

SELECT public.tenant_enable('accounts', '''check:supplier_id:suppliers''', false);
SELECT public.tenant_enable('account_contacts', '''derive:account_id:accounts''', false);
SELECT public.tenant_enable('rider_price_agreements',
  '''derive:account_id:accounts'',''check:event_id:events'',''check:price_year_id:price_years''', true);
SELECT public.tenant_enable('rider_price_lines',
  '''derive:agreement_id:rider_price_agreements'',''check:product_id:products''', true);

-- Members read accounts / contacts; only admins write.
DO $$
DECLARE
  t text;
  v_admin text := 'org_id = (SELECT public.current_org_id()) AND (SELECT public.is_admin())';
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'account_contacts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t || '_insert', t, v_admin);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t || '_update', t, v_admin, v_admin);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', t || '_delete', t, v_admin);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.events;
CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard(
    'check:linked_event_id:events', 'check:price_year_id:price_years', 'check:client_account_id:accounts');

DROP TRIGGER IF EXISTS aa_tenant_row_guard ON public.recipients;
CREATE TRIGGER aa_tenant_row_guard BEFORE INSERT OR UPDATE ON public.recipients
  FOR EACH ROW EXECUTE FUNCTION public.tenant_row_guard('derive:event_id:events', 'check:account_id:accounts');

-- ---------- account helpers -------------------------------------------

CREATE OR REPLACE FUNCTION public.account_name_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT lower(btrim(p)) $$;

-- Find or create an account by name in an organisation (no duplicates).
CREATE OR REPLACE FUNCTION public.ensure_account(p_org uuid, p_name text, p_client boolean, p_supplier boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.accounts
   WHERE org_id = p_org AND lower(btrim(name)) = lower(btrim(p_name));
  IF v_id IS NULL THEN
    INSERT INTO public.accounts (org_id, name, is_client, is_supplier)
    VALUES (p_org, btrim(p_name), p_client, p_supplier)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.accounts
       WHERE org_id = p_org AND lower(btrim(name)) = lower(btrim(p_name));
    END IF;
  ELSE
    UPDATE public.accounts
       SET is_client = is_client OR p_client,
           is_supplier = is_supplier OR p_supplier
     WHERE id = v_id AND ((p_client AND NOT is_client) OR (p_supplier AND NOT is_supplier));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_account(uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- ---------- supplier ⇄ account sync -----------------------------------

CREATE OR REPLACE FUNCTION public.sync_supplier_to_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc uuid;
BEGIN
  IF current_setting('app.account_sync', true) = 'on' THEN RETURN NEW; END IF;
  PERFORM set_config('app.account_sync', 'on', true);

  SELECT id INTO v_acc FROM public.accounts WHERE supplier_id = NEW.id;
  IF v_acc IS NULL THEN
    v_acc := public.ensure_account(NEW.org_id, NEW.name, false, true);
    UPDATE public.accounts SET supplier_id = NEW.id
     WHERE id = v_acc AND supplier_id IS NULL;
  END IF;

  UPDATE public.accounts a SET
    name = CASE WHEN NOT EXISTS (
             SELECT 1 FROM public.accounts x
              WHERE x.org_id = a.org_id AND x.id <> a.id
                AND lower(btrim(x.name)) = lower(btrim(NEW.name))
           ) THEN btrim(NEW.name) ELSE a.name END,
    is_supplier = true,
    email = COALESCE(NULLIF(NEW.email, ''), a.email),
    phone = COALESCE(NULLIF(NEW.phone, ''), a.phone),
    address = COALESCE(NULLIF(NEW.address, ''), a.address)
  WHERE a.id = v_acc AND a.supplier_id = NEW.id;

  IF NULLIF(btrim(NEW.contact_name), '') IS NOT NULL AND v_acc IS NOT NULL THEN
    INSERT INTO public.account_contacts (org_id, account_id, name, role, email, phone, is_primary)
    SELECT NEW.org_id, v_acc, btrim(NEW.contact_name), 'order', NULLIF(NEW.email, ''), NULLIF(NEW.phone, ''),
           NOT EXISTS (SELECT 1 FROM public.account_contacts c WHERE c.account_id = v_acc AND c.role = 'order' AND c.is_primary)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM set_config('app.account_sync', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zy_sync_supplier_account ON public.suppliers;
CREATE TRIGGER zy_sync_supplier_account AFTER INSERT OR UPDATE OF name, email, phone, address, contact_name
  ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.sync_supplier_to_account();

-- Account edits flow back to the linked supplier; marking an account as a
-- supplier creates the supplier row used by product offers and orders.
CREATE OR REPLACE FUNCTION public.sync_account_to_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sup uuid;
BEGIN
  IF current_setting('app.account_sync', true) = 'on' THEN RETURN NEW; END IF;
  PERFORM set_config('app.account_sync', 'on', true);

  IF NEW.is_supplier AND NEW.supplier_id IS NULL THEN
    SELECT id INTO v_sup FROM public.suppliers
     WHERE org_id = NEW.org_id AND lower(btrim(name)) = lower(btrim(NEW.name))
       AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.supplier_id = suppliers.id);
    IF v_sup IS NULL THEN
      INSERT INTO public.suppliers (org_id, name, email, phone, address)
      VALUES (NEW.org_id, btrim(NEW.name), NEW.email, NEW.phone, NEW.address)
      RETURNING id INTO v_sup;
    END IF;
    UPDATE public.accounts SET supplier_id = v_sup WHERE id = NEW.id;
  ELSIF NEW.supplier_id IS NOT NULL AND TG_OP = 'UPDATE' THEN
    UPDATE public.suppliers s SET
      name = CASE WHEN NOT EXISTS (
               SELECT 1 FROM public.suppliers x
                WHERE x.org_id = s.org_id AND x.id <> s.id AND x.name = btrim(NEW.name)
             ) THEN btrim(NEW.name) ELSE s.name END,
      email = NEW.email,
      phone = NEW.phone,
      address = NEW.address
    WHERE s.id = NEW.supplier_id
      AND (s.name IS DISTINCT FROM btrim(NEW.name) OR s.email IS DISTINCT FROM NEW.email
           OR s.phone IS DISTINCT FROM NEW.phone OR s.address IS DISTINCT FROM NEW.address);
  END IF;

  PERFORM set_config('app.account_sync', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zy_sync_account_supplier ON public.accounts;
CREATE TRIGGER zy_sync_account_supplier AFTER INSERT OR UPDATE OF name, email, phone, address, is_supplier
  ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.sync_account_to_supplier();

-- ---------- recipients link to client accounts ------------------------

CREATE OR REPLACE FUNCTION public.recipients_link_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    NEW.account_id := public.ensure_account(NEW.org_id, NEW.name, true, false);
  END IF;
  RETURN NEW;
END;
$$;

-- Runs after aa_tenant_row_guard (alphabetical) so org_id is resolved.
DROP TRIGGER IF EXISTS ab_recipients_link_account ON public.recipients;
CREATE TRIGGER ab_recipients_link_account BEFORE INSERT OR UPDATE OF name, account_id
  ON public.recipients FOR EACH ROW EXECUTE FUNCTION public.recipients_link_account();

-- ---------- backfill --------------------------------------------------

DO $$
DECLARE
  s record;
  v_acc uuid;
BEGIN
  PERFORM set_config('app.account_sync', 'on', true);
  FOR s IN SELECT * FROM public.suppliers WHERE NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.supplier_id = suppliers.id
  ) LOOP
    v_acc := public.ensure_account(s.org_id, s.name, false, true);
    UPDATE public.accounts SET
      supplier_id = COALESCE(supplier_id, s.id),
      email = COALESCE(email, NULLIF(s.email, '')),
      phone = COALESCE(phone, NULLIF(s.phone, '')),
      address = COALESCE(address, NULLIF(s.address, ''))
    WHERE id = v_acc;
    IF NULLIF(btrim(s.contact_name), '') IS NOT NULL THEN
      INSERT INTO public.account_contacts (org_id, account_id, name, role, email, phone, is_primary)
      VALUES (s.org_id, v_acc, btrim(s.contact_name), 'order', NULLIF(s.email, ''), NULLIF(s.phone, ''), true)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.account_sync', 'off', true);
END $$;

UPDATE public.recipients r
   SET account_id = public.ensure_account(r.org_id, r.name, true, false)
 WHERE r.account_id IS NULL AND NULLIF(btrim(r.name), '') IS NOT NULL;

-- Recipient emails become transfer contacts on the client account.
INSERT INTO public.account_contacts (org_id, account_id, name, role, email)
SELECT DISTINCT ON (r.account_id, lower(btrim(COALESCE(NULLIF(r.department, ''), r.name))))
       r.org_id, r.account_id, btrim(COALESCE(NULLIF(r.department, ''), r.name)), 'transfer', NULLIF(r.email, '')
  FROM public.recipients r
 WHERE r.account_id IS NOT NULL AND NULLIF(btrim(r.email), '') IS NOT NULL
 ORDER BY r.account_id, lower(btrim(COALESCE(NULLIF(r.department, ''), r.name))), r.created_at DESC
ON CONFLICT DO NOTHING;

-- ---------- rider price lookup ----------------------------------------

-- Active agreement price for an account + product on an event (event-
-- specific agreement first, then the newest general one valid that day).
CREATE OR REPLACE FUNCTION public.rider_price_for(p_account uuid, p_event uuid, p_product uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT l.price
    FROM public.rider_price_lines l
    JOIN public.rider_price_agreements a ON a.id = l.agreement_id
    LEFT JOIN public.events e ON e.id = p_event
   WHERE a.account_id = p_account
     AND l.product_id = p_product
     AND a.status = 'active'
     AND (a.event_id IS NULL OR a.event_id = p_event)
     AND (a.valid_from IS NULL OR COALESCE(e.end_date, e.start_date) IS NULL
          OR a.valid_from <= COALESCE(e.end_date, e.start_date))
     AND (a.valid_to IS NULL OR e.start_date IS NULL OR a.valid_to >= e.start_date)
   ORDER BY (a.event_id IS NOT NULL) DESC, a.valid_from DESC NULLS LAST, a.created_at DESC
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.rider_price_for(uuid, uuid, uuid) TO authenticated;

-- =====================================================================
-- Verify:
--   SELECT count(*) FILTER (WHERE is_supplier), count(*) FILTER (WHERE is_client) FROM accounts;
--   SELECT count(*) FROM suppliers s WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.supplier_id = s.id);
--   SELECT count(*) FROM recipients WHERE account_id IS NULL;
-- =====================================================================
