-- =====================================================================
-- 072 — Sales by location / date, loose stock allowances and payments
-- =====================================================================
-- Background:
--   till_sale_rows gains optional location and sale_date, filled when the
--   Square Item Details export (Date, Location / Device Name) is imported.
--   Older event-wide imports keep NULLs and still reconcile as before:
--   recon sums every row per till item, so the extra detail never changes
--   stock or PLU figures.
--
--   Loose stock = opened-case singles left at close (closing_stock), which
--   events are charged for. Agreed allowances can be set per product or per
--   category (pooled); anything above allowance is chargeable. Payments
--   received against an event's loose stock are recorded here so Reports
--   can show paid vs outstanding. Neither table touches physical stock.
--
--   Allowances and payments are financial, so admin-only. Every change is
--   audited (zz_audit_row_change).
--
-- Apply: AFTER 071. Idempotent: yes.
-- =====================================================================

-- ---------- sales detail --------------------------------------------

ALTER TABLE public.till_sale_rows ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.till_sale_rows ADD COLUMN IF NOT EXISTS sale_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'till_sale_rows_location_len') THEN
    ALTER TABLE public.till_sale_rows
      ADD CONSTRAINT till_sale_rows_location_len CHECK (location IS NULL OR char_length(location) <= 120);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_till_sale_rows_import_location ON public.till_sale_rows (import_id, location);
CREATE INDEX IF NOT EXISTS idx_till_sale_rows_import_date ON public.till_sale_rows (import_id, sale_date);

-- ---------- loose stock allowances ----------------------------------

CREATE TABLE IF NOT EXISTS public.loose_stock_allowances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organisations(id),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category_id     uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  allowance_units numeric NOT NULL CHECK (allowance_units >= 0 AND allowance_units <= 1000000),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loose_stock_allowances_scope CHECK ((product_id IS NULL) <> (category_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS loose_stock_allowances_event_product
  ON public.loose_stock_allowances (event_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS loose_stock_allowances_event_category
  ON public.loose_stock_allowances (event_id, category_id) WHERE category_id IS NOT NULL;

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.loose_stock_allowances;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.loose_stock_allowances
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- ---------- loose stock payments ------------------------------------

CREATE TABLE IF NOT EXISTS public.loose_stock_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations(id),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  amount      numeric NOT NULL CHECK (amount <> 0 AND abs(amount) <= 10000000),
  paid_on     date NOT NULL DEFAULT current_date,
  reference   text CHECK (reference IS NULL OR char_length(reference) <= 120),
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loose_stock_payments_event ON public.loose_stock_payments (event_id, paid_on);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.loose_stock_payments;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.loose_stock_payments
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

-- ---------- tenancy, audit, RLS -------------------------------------

SELECT public.tenant_enable('loose_stock_allowances',
  '''derive:event_id:events'',''check:product_id:products'',''check:category_id:categories''', true);
SELECT public.tenant_enable('loose_stock_payments',
  '''derive:event_id:events'',''check:account_id:accounts''', true);

-- ---------- verification --------------------------------------------
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'till_sale_rows' AND column_name IN ('location','sale_date');
-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('loose_stock_allowances','loose_stock_payments');
