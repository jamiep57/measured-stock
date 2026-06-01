-- =====================================================================
-- 001 — Base v2 schema (relational tables)
-- =====================================================================
-- Adds the v2 normalised tables to the database. Does NOT touch the
-- existing public.stock_events table (V4 keeps writing to it until cutover).
--
-- Apply: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Order: run BEFORE 002_v4_extensions.sql
-- Idempotent: yes (CREATE TABLE IF NOT EXISTS everywhere)
-- =====================================================================

-- ---------- Reference tables (global) ---------------------------------

CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  colour_key  text        NOT NULL DEFAULT 'rtd',
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL UNIQUE,
  contact_name     text,
  email            text,
  phone            text,
  address          text,
  default_sor_pct  integer     NOT NULL DEFAULT 0
                    CHECK (default_sor_pct >= 0 AND default_sor_pct <= 100),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid        REFERENCES public.suppliers(id),
  category_id     uuid        REFERENCES public.categories(id),
  name            text        NOT NULL,
  abv             numeric,
  sku             text,
  case_size       text,
  units_per_case  numeric     NOT NULL DEFAULT 1,
  -- numeric (not integer): V4 allows fractional unitsPerSku (e.g. 52.8 for kegs)
  unit_price      numeric,
  case_price      numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);

-- ---------- Events ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  start_date  date,
  end_date    date,
  venue       text,
  status      text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('draft','active','closing','reconciled','archived')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bars (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bars_event ON public.bars(event_id);

CREATE TABLE IF NOT EXISTS public.recipients (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  department          text,
  email               text,
  chargeback_enabled  boolean     NOT NULL DEFAULT false,
  chargeback_code     text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipients_event ON public.recipients(event_id);

-- ---------- Per-event link tables -------------------------------------

CREATE TABLE IF NOT EXISTS public.event_products (
  id                    uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid     NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id            uuid     NOT NULL REFERENCES public.products(id),
  qty_ordered           numeric  NOT NULL DEFAULT 0,
  invoice_qty           numeric,
  delivered_qty         numeric,
  damaged_qty           numeric  NOT NULL DEFAULT 0,
  order_price_override  numeric,
  sor_pct_override      integer
                          CHECK (sor_pct_override IS NULL
                                 OR (sor_pct_override >= 0 AND sor_pct_override <= 100)),
  arrival_day           text,
  UNIQUE (event_id, product_id)
);
-- NOTE: quantity columns are numeric (not integer) because V4 allows
-- fractional "already-in-stock" / damaged values for keg pours, etc.

CREATE INDEX IF NOT EXISTS idx_event_products_event ON public.event_products(event_id);

CREATE TABLE IF NOT EXISTS public.bar_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id)  ON DELETE CASCADE,
  bar_id      uuid NOT NULL REFERENCES public.bars(id)    ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id),
  UNIQUE (bar_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bar_products_event ON public.bar_products(event_id);

CREATE TABLE IF NOT EXISTS public.distribution (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid    NOT NULL REFERENCES public.events(id)  ON DELETE CASCADE,
  bar_id         uuid    NOT NULL REFERENCES public.bars(id)    ON DELETE CASCADE,
  product_id     uuid    NOT NULL REFERENCES public.products(id),
  qty_allocated  numeric NOT NULL DEFAULT 0 CHECK (qty_allocated >= 0),
  UNIQUE (event_id, bar_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_distribution_event ON public.distribution(event_id);

-- ---------- Stock counts ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  bar_id      uuid        REFERENCES public.bars(id) ON DELETE SET NULL,
  name        text        NOT NULL,
  counted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_counts_event ON public.stock_counts(event_id);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id    uuid     NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id  uuid     NOT NULL REFERENCES public.products(id),
  bar_id      uuid     REFERENCES public.bars(id) ON DELETE SET NULL,
  cases       numeric  NOT NULL DEFAULT 0,
  singles     numeric  NOT NULL DEFAULT 0
);
-- bar_id is optional but added because V4's count "data" object keys are
-- "<productId>_<barName>" — keeping the bar dimension on the line lets a
-- single stock_counts session hold lines from multiple bars without
-- exploding it into N sessions (the v2 docs split pattern).
-- cases/singles are numeric because V4 supports fractional singles
-- (e.g. partial-keg pours: "7 cases + 4.7 singles").

CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON public.stock_count_lines(count_id);

-- ---------- Closing stock --------------------------------------------

CREATE TABLE IF NOT EXISTS public.closing_stock (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid    NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id     uuid    NOT NULL REFERENCES public.products(id),
  close_count    numeric NOT NULL DEFAULT 0 CHECK (close_count >= 0),
  return_amount  numeric NOT NULL DEFAULT 0 CHECK (return_amount >= 0),
  UNIQUE (event_id, product_id)
);
-- close_count is numeric because V4's fullCount is cases*upc + singles,
-- and singles can be fractional. The V4 closing UX additionally splits
-- it into closing_cases / closing_singles columns (added in 002).

CREATE INDEX IF NOT EXISTS idx_closing_stock_event ON public.closing_stock(event_id);

-- ---------- Transfers (6 types) --------------------------------------

CREATE TABLE IF NOT EXISTS public.transfers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_type       text        NOT NULL
                        CHECK (transfer_type IN ('event_to_warehouse',
                                                  'warehouse_to_event',
                                                  'event_to_event',
                                                  'warehouse_to_warehouse',
                                                  'event_to_recipient',
                                                  'warehouse_to_recipient')),
  from_event_id       uuid        REFERENCES public.events(id)     ON DELETE CASCADE,
  to_event_id         uuid        REFERENCES public.events(id)     ON DELETE CASCADE,
  from_warehouse_id   uuid        REFERENCES public.warehouses(id),
  to_warehouse_id     uuid        REFERENCES public.warehouses(id),
  recipient_id        uuid        REFERENCES public.recipients(id) ON DELETE SET NULL,
  unit                text        NOT NULL DEFAULT 'cases'
                        CHECK (unit IN ('cases','units')),
  transferred_at      timestamptz NOT NULL DEFAULT now(),
  notes               text
);

CREATE INDEX IF NOT EXISTS idx_transfers_from_event  ON public.transfers(from_event_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_event    ON public.transfers(to_event_id);

CREATE TABLE IF NOT EXISTS public.transfer_lines (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id          uuid    NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  product_id           uuid    NOT NULL REFERENCES public.products(id),
  qty                  numeric NOT NULL CHECK (qty > 0),
  unit_cost            numeric,
  chargeback_applied   boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_transfer_lines_transfer ON public.transfer_lines(transfer_id);

-- ---------- Warehouse stock ------------------------------------------

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid        NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.products(id),
  qty_on_hand  numeric     NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, product_id)
);

-- ---------- Deliveries -----------------------------------------------

CREATE TABLE IF NOT EXISTS public.deliveries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  supplier_id         uuid        REFERENCES public.suppliers(id),
  delivered_at        timestamptz NOT NULL DEFAULT now(),
  reference           text,
  notes               text,
  delivery_note_url   text,
  photo_urls          text[]      NOT NULL DEFAULT '{}',
  damages_photo_urls  text[]      NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_event ON public.deliveries(event_id);

CREATE TABLE IF NOT EXISTS public.delivery_lines (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid    NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  product_id   uuid    NOT NULL REFERENCES public.products(id),
  qty          numeric NOT NULL DEFAULT 0,
  damaged_qty  numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_delivery_lines_delivery ON public.delivery_lines(delivery_id);

-- =====================================================================
-- Enable Row Level Security on every new table.
-- Policies are added by 004_rls_policies.sql; until then, only the
-- service role (sync function + dashboard owner) can access these
-- tables — which is exactly what we want during the migration window.
-- This block keeps the Supabase SQL Editor's "MIGRATIONS_WITHOUT_RLS"
-- linter quiet.
-- =====================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'categories','suppliers','warehouses','products','events',
    'bars','recipients','event_products','bar_products','distribution',
    'stock_counts','stock_count_lines','closing_stock',
    'transfers','transfer_lines','warehouse_stock',
    'deliveries','delivery_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- =====================================================================
-- DONE. Verify with:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' ORDER BY table_name;
-- =====================================================================
