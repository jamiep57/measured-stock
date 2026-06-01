-- =====================================================================
-- 002 — V4 extensions
-- =====================================================================
-- Adds V4-specific columns and tables on top of the base v2 schema:
--   - event_products.already_in_stock  (V4 opening-stock UX)
--   - closing_stock.closing_cases / .closing_singles / .carried_over
--   - events.event_type / .linked_event_id (V4 stock/kit pairing)
--   - topups, wastage, till_imports, modifier_imports
--   - recipes + recipe_ingredients (global; replaces __recipes__ blob)
--   - bug_reports (optional; replaces __bugs__ blob)
--
-- Apply: AFTER 001_base_v2_schema.sql
-- Idempotent: yes
-- =====================================================================

-- ---------- event_products: V4 opening-stock column ------------------

ALTER TABLE public.event_products
  ADD COLUMN IF NOT EXISTS already_in_stock numeric NOT NULL DEFAULT 0;
  -- numeric: V4 allows fractional alreadyInStock (e.g. partial kegs)

-- ---------- closing_stock: V4 closing UX -----------------------------
-- V4 splits the close count into cases + singles, surfaces
-- carried_over (not derived). close_count and return_amount remain
-- for compatibility with v2 reports.
-- Numeric because V4 allows fractional singles (keg pours).

ALTER TABLE public.closing_stock
  ADD COLUMN IF NOT EXISTS closing_cases    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_singles  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carried_over     numeric NOT NULL DEFAULT 0;

-- ---------- events: V4 stock/kit pairing ----------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_type        text,
  ADD COLUMN IF NOT EXISTS linked_event_id   uuid;

-- self-FK on linked_event_id (added separately so re-runs don't fail)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_linked_event_id_fkey'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_linked_event_id_fkey
      FOREIGN KEY (linked_event_id) REFERENCES public.events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- event_type check constraint (allow null for legacy / non-typed events)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_event_type_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_event_type_check
      CHECK (event_type IS NULL OR event_type IN ('stock','kit'));
  END IF;
END $$;

-- ---------- topups ---------------------------------------------------
-- V4 topup sessions are mini-deliveries during an event: extra stock
-- received from a supplier mid-event (e.g. "Fri 29 May Top-Up").
-- Shape in V4 blob: { id, date, name, supplier, entries: { pid:
-- { qty, damaged, supplier, invoicePrice } } }.

CREATE TABLE IF NOT EXISTS public.topup_sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  supplier_id  uuid        REFERENCES public.suppliers(id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topup_sessions_event ON public.topup_sessions(event_id);

CREATE TABLE IF NOT EXISTS public.topup_lines (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid    NOT NULL REFERENCES public.topup_sessions(id) ON DELETE CASCADE,
  product_id     uuid    NOT NULL REFERENCES public.products(id),
  qty            numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  damaged_qty    numeric NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  invoice_price  numeric,
  supplier_id    uuid    REFERENCES public.suppliers(id)
                   -- optional per-line override (V4 stores supplier on each entry)
);

CREATE INDEX IF NOT EXISTS idx_topup_lines_session ON public.topup_lines(session_id);

-- ---------- wastage --------------------------------------------------
-- V4 logs wastage as a batch + lines (one batch per user save click,
-- multiple lines if multiple products were wasted at once). Each line
-- also carries a reason ("Damaged", "Recipe testing", etc.) which V4
-- stores per-row but is shared within a batch — promoted to the batch.

CREATE TABLE IF NOT EXISTS public.wastage_batches (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  unit          text        NOT NULL DEFAULT 'cases'
                  CHECK (unit IN ('cases','units')),
  reason        text,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wastage_batches_event ON public.wastage_batches(event_id);

CREATE TABLE IF NOT EXISTS public.wastage_lines (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid    NOT NULL REFERENCES public.wastage_batches(id) ON DELETE CASCADE,
  product_id  uuid    NOT NULL REFERENCES public.products(id),
  qty         numeric NOT NULL CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_wastage_lines_batch ON public.wastage_lines(batch_id);

-- ---------- till imports (Square CSV) -------------------------------
-- V4 only keeps the LATEST import per event (subsequent imports
-- overwrite). Enforced by UNIQUE(event_id).

CREATE TABLE IF NOT EXISTS public.till_imports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  file_name    text
);

CREATE TABLE IF NOT EXISTS public.till_sale_rows (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id    uuid    NOT NULL REFERENCES public.till_imports(id) ON DELETE CASCADE,
  name         text    NOT NULL,
  variation    text,
  sku          text,
  category     text,
  items_sold   integer NOT NULL DEFAULT 0,
  net_sales    numeric NOT NULL DEFAULT 0,
  gross_sales  numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_till_sale_rows_import ON public.till_sale_rows(import_id);

-- ---------- modifier imports (Square CSV) ---------------------------

CREATE TABLE IF NOT EXISTS public.modifier_imports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  file_name    text
);

CREATE TABLE IF NOT EXISTS public.modifier_sale_rows (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id     uuid    NOT NULL REFERENCES public.modifier_imports(id) ON DELETE CASCADE,
  modifier_set  text,
  modifier      text    NOT NULL,
  qty_sold      integer NOT NULL DEFAULT 0,
  net_sales     numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_modifier_sale_rows_import ON public.modifier_sale_rows(import_id);

-- ---------- recipes (global; replaces __recipes__ blob) -------------
-- A recipe maps a till item (Square sale name + variation) to a list
-- of ingredients (product + qty in case-fractions). product_name is
-- stored as text to match V4's name-matching pattern; merged app can
-- resolve to a product_id at render time.

CREATE TABLE IF NOT EXISTS public.recipes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  till_item       text        NOT NULL,
  till_variation  text        NOT NULL DEFAULT '',
  unit_model      text                  -- 'case' for case-fraction recipes, NULL for legacy
                    CHECK (unit_model IS NULL OR unit_model IN ('case','unit')),
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (till_item, till_variation)
);

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     uuid    NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_name  text    NOT NULL,
  qty           numeric NOT NULL CHECK (qty > 0),
  position      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);

-- ---------- bug reports (optional; replaces __bugs__ blob) ----------

CREATE TABLE IF NOT EXISTS public.bug_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  area         text,
  title        text        NOT NULL,
  description  text,
  status       text        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','wontfix')),
  severity     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

-- =====================================================================
-- Enable Row Level Security on every new table (policies added by 004).
-- Keeps the Supabase "MIGRATIONS_WITHOUT_RLS" linter quiet.
-- =====================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'topup_sessions','topup_lines',
    'wastage_batches','wastage_lines',
    'till_imports','till_sale_rows',
    'modifier_imports','modifier_sale_rows',
    'recipes','recipe_ingredients',
    'bug_reports'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- =====================================================================
-- DONE. Verify event_products has the new column:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'event_products';
-- Verify all new tables exist:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('topup_sessions','topup_lines','wastage_batches',
--                         'wastage_lines','till_imports','till_sale_rows',
--                         'modifier_imports','modifier_sale_rows',
--                         'recipes','recipe_ingredients','bug_reports');
-- =====================================================================
