-- =====================================================================
-- 084 — Square live sales (OAuth), beside the CSV import
-- =====================================================================
-- Background:
--   An organisation connects one Square merchant. Completed orders are
--   stored in square_orders / square_order_lines and matched to an event
--   by bar ↔ location links and the event dates. events.sales_source
--   stays 'csv' until someone switches that event, so till_imports and
--   till_sale_rows are never rewritten by this path.
--
--   Access and refresh tokens live only in org_square_connections.
--   Authenticated users can read the status columns, not the tokens.
--   Order rows are written by the service role (webhook, sync, cron).
--
-- Apply: AFTER 083. Idempotent: yes.
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sales_source text NOT NULL DEFAULT 'csv';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_sales_source_check') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_sales_source_check CHECK (sales_source IN ('csv', 'square'));
  END IF;
END $$;

COMMENT ON COLUMN public.events.sales_source IS
  'Which feed projections and recon read. csv is the uploaded file. square is the live order feed. The other feed is kept.';

-- ---------- merchant connection (tokens server-only) -----------------

CREATE TABLE IF NOT EXISTS public.org_square_connections (
  org_id              uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  merchant_id         text NOT NULL CHECK (char_length(merchant_id) BETWEEN 1 AND 64),
  environment         text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  merchant_name       text CHECK (merchant_name IS NULL OR char_length(merchant_name) <= 200),
  scopes              text CHECK (scopes IS NULL OR char_length(scopes) <= 500),
  access_token_enc    text NOT NULL,
  refresh_token_enc   text NOT NULL,
  token_expires_at    timestamptz,
  connected_at        timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_sync_at        timestamptz,
  last_webhook_at     timestamptz,
  last_error          text CHECK (last_error IS NULL OR char_length(last_error) <= 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS org_square_connections_merchant_env
  ON public.org_square_connections (environment, merchant_id);

ALTER TABLE public.org_square_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_square_connections_select ON public.org_square_connections;
CREATE POLICY org_square_connections_select ON public.org_square_connections
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.current_org_id()));

REVOKE ALL ON public.org_square_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  org_id, merchant_id, environment, merchant_name, scopes,
  token_expires_at, connected_at, updated_at, last_sync_at, last_webhook_at, last_error
) ON public.org_square_connections TO authenticated;
GRANT ALL ON public.org_square_connections TO service_role;

-- ---------- bar ↔ Square location ------------------------------------

CREATE TABLE IF NOT EXISTS public.event_bar_square_locations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organisations(id),
  event_id              uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  bar_id                uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  square_location_id    text NOT NULL CHECK (char_length(square_location_id) BETWEEN 1 AND 64),
  square_location_name  text CHECK (square_location_name IS NULL OR char_length(square_location_name) <= 200),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_bar_square_locations_bar
  ON public.event_bar_square_locations (bar_id);
CREATE INDEX IF NOT EXISTS idx_event_bar_square_locations_event
  ON public.event_bar_square_locations (event_id);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.event_bar_square_locations;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.event_bar_square_locations
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

SELECT public.tenant_enable(
  'event_bar_square_locations',
  '''derive:event_id:events'',''check:bar_id:bars''',
  false
);

-- ---------- orders ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.square_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organisations(id),
  event_id            uuid REFERENCES public.events(id) ON DELETE SET NULL,
  square_order_id     text NOT NULL CHECK (char_length(square_order_id) BETWEEN 1 AND 64),
  square_location_id  text NOT NULL CHECK (char_length(square_location_id) BETWEEN 1 AND 64),
  location_name       text CHECK (location_name IS NULL OR char_length(location_name) <= 200),
  state               text NOT NULL CHECK (char_length(state) <= 32),
  closed_at           timestamptz,
  currency            text CHECK (currency IS NULL OR char_length(currency) = 3),
  unmatched_reason    text CHECK (unmatched_reason IS NULL OR unmatched_reason IN ('no_event', 'overlap')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS square_orders_org_order
  ON public.square_orders (org_id, square_order_id);
CREATE INDEX IF NOT EXISTS idx_square_orders_event ON public.square_orders (event_id);
CREATE INDEX IF NOT EXISTS idx_square_orders_unmatched
  ON public.square_orders (org_id, unmatched_reason)
  WHERE unmatched_reason IS NOT NULL;

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.square_orders;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.square_orders
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

SELECT public.tenant_enable('square_orders', '''derive:event_id:events''', false);

CREATE TABLE IF NOT EXISTS public.square_order_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations(id),
  order_id      uuid NOT NULL REFERENCES public.square_orders(id) ON DELETE CASCADE,
  event_id      uuid REFERENCES public.events(id) ON DELETE CASCADE,
  line_uid      text NOT NULL CHECK (char_length(line_uid) BETWEEN 1 AND 200),
  kind          text NOT NULL CHECK (kind IN ('item', 'modifier')),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  variation     text CHECK (variation IS NULL OR char_length(variation) <= 200),
  sku           text CHECK (sku IS NULL OR char_length(sku) <= 120),
  category      text CHECK (category IS NULL OR char_length(category) <= 200),
  items_sold    numeric NOT NULL DEFAULT 0 CHECK (items_sold >= 0),
  net_sales     numeric NOT NULL DEFAULT 0,
  gross_sales   numeric NOT NULL DEFAULT 0,
  location      text CHECK (location IS NULL OR char_length(location) <= 120),
  sale_date     date,
  modifier_set  text CHECK (modifier_set IS NULL OR char_length(modifier_set) <= 200),
  modifier      text CHECK (modifier IS NULL OR char_length(modifier) <= 200),
  qty_sold      numeric NOT NULL DEFAULT 0 CHECK (qty_sold >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS square_order_lines_order_uid
  ON public.square_order_lines (order_id, line_uid);
CREATE INDEX IF NOT EXISTS idx_square_order_lines_event
  ON public.square_order_lines (event_id);

SELECT public.tenant_enable(
  'square_order_lines',
  '''derive:order_id:square_orders'',''check:event_id:events''',
  false
);

-- Service role writes orders. The browser only reads them.
REVOKE INSERT, UPDATE, DELETE ON public.square_orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.square_order_lines FROM authenticated;
DROP POLICY IF EXISTS square_orders_insert ON public.square_orders;
DROP POLICY IF EXISTS square_orders_update ON public.square_orders;
DROP POLICY IF EXISTS square_orders_delete ON public.square_orders;
DROP POLICY IF EXISTS square_order_lines_insert ON public.square_order_lines;
DROP POLICY IF EXISTS square_order_lines_update ON public.square_order_lines;
DROP POLICY IF EXISTS square_order_lines_delete ON public.square_order_lines;

-- Order volume would flood the audit log, and connection rows hold tokens.
DROP TRIGGER IF EXISTS zz_audit_row_change ON public.square_orders;
DROP TRIGGER IF EXISTS zz_audit_row_change ON public.square_order_lines;

GRANT ALL ON public.event_bar_square_locations TO service_role;
GRANT ALL ON public.square_orders TO service_role;
GRANT ALL ON public.square_order_lines TO service_role;
