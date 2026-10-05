-- =====================================================================
-- 055 — products.notes + products.archived (kit library polish; usable for stock too)
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_archived
  ON public.products (archived)
  WHERE archived = true;

COMMENT ON COLUMN public.products.notes IS
  'Optional free-text notes (e.g. kit specs, packing hints).';

COMMENT ON COLUMN public.products.archived IS
  'When true, hide from default library lists (soft archive).';
